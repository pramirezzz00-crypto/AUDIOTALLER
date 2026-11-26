"""Migración completa a otra computadora: base de AudioTaller, proyectos del disco interno y plugins.

El archivo de migración es un .zip común (se puede abrir sin AudioTaller) con:
  manifest.json        qué se exportó, de dónde venía cada carpeta y el inventario de plugins
  datos/...            la carpeta de datos de AudioTaller (base SQLite y biblioteca)
  proyectos/NNN/...    cada carpeta de sesiones del disco interno
  plugins/<raiz>/...   los plugins que se pueden copiar sin su instalador

Nunca borra ni pisa archivos del usuario: al importar, lo que ya existe se respalda o se deja como está.
"""
import json
import os
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from datetime import datetime
from pathlib import Path, PurePath

import plugin_inventory

FORMAT = 'audiotaller-migracion'
VERSION = 1
SESSION_TYPES = {'.als', '.flp', '.ptx', '.ptf', '.cpr', '.npr', '.rpp', '.song', '.bwproject', '.aup3', '.logicx', '.band', '.reason', '.mmpz', '.dawproject'}
SKIP_DATA = re.compile(r'(\.dpapi|\.tmp|-wal|-shm|-journal|inicio\.log)$', re.I)
SKIP_DATA_FOLDERS = {'migracion', 'respaldos-migracion', '__pycache__'}
STORED = {'.wav', '.aif', '.aiff', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.zip', '.rar', '.7z', '.jpg', '.jpeg', '.png', '.mp4', '.mov', '.ncw'}
GENERIC = {'desktop', 'escritorio', 'documents', 'documentos', 'downloads', 'descargas', 'music', 'música', 'musica', 'pictures', 'imágenes', 'videos', 'movies', 'onedrive'}


class Cancelled(Exception):
    pass


# ----------------------------------------------------------------- rutas

def is_absolute_text(value):
    if not isinstance(value, str) or not 2 < len(value) < 1024 or '\n' in value:
        return False
    if sys.platform == 'win32':
        return bool(re.match(r'^([A-Za-z]:[\\/]|\\\\[^\\])', value))
    return value.startswith('/') and not value.startswith('//')


def db_strings(db):
    """Todos los textos de la base, incluidos los que están dentro de documentos JSON."""
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for table in tables:
        for row in db.execute(f'SELECT * FROM "{table}"'):
            for value in row:
                if not isinstance(value, str):
                    continue
                yield value
                if value[:1] in '{[':
                    try:
                        yield from json_strings(json.loads(value))
                    except ValueError:
                        pass


def json_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from json_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from json_strings(item)


def inside(path, root):
    try:
        Path(path).relative_to(root)
        return True
    except ValueError:
        return False


def same_path(a, b):
    a, b = os.path.normpath(str(a)), os.path.normpath(str(b))
    return a.lower() == b.lower() if sys.platform == 'win32' else a == b


def disk_kind(path):
    """«interno» = el disco del sistema. Otros discos y unidades de red no viajan por defecto."""
    text = str(path)
    if sys.platform == 'win32':
        if text.startswith('\\\\'):
            return 'red'
        drive = PurePath(text).drive.upper()
        if drive == os.environ.get('SystemDrive', 'C:').upper():
            return 'interno'
        try:
            import ctypes
            kind = ctypes.windll.kernel32.GetDriveTypeW(drive + '\\')
            return {2: 'externo', 3: 'otro', 4: 'red'}.get(kind, 'externo')
        except Exception:
            return 'otro'
    if sys.platform == 'darwin':
        return 'externo' if text.startswith('/Volumes/') else 'interno'
    return 'externo' if re.match(r'^/(media|mnt|run/media)/', text) else 'interno'


def folder_root(path, home):
    """La carpeta que hay que llevar para una ruta de la base."""
    path = Path(path)
    if path.is_dir():
        return path
    parent = path.parent
    generic = parent == home or parent == Path(parent.anchor) or parent.name.lower() in GENERIC
    if path.suffix.lower() in SESSION_TYPES and not generic:
        return parent
    return path


def tree_stats(root, skip=()):
    size = count = 0
    if root.is_file():
        return root.stat().st_size, 1
    for folder, dirs, names in os.walk(root, followlinks=False):
        for name in names:
            item = Path(folder) / name
            if any(same_path(item, s) for s in skip):
                continue
            try:
                size += item.lstat().st_size
                count += 1
            except OSError:
                pass
    return size, count


def project_roots(db, data_dir, home=None):
    home = Path(home or Path.home())
    data_dir = Path(data_dir)
    roots, missing = {}, set()
    for value in db_strings(db):
        if not is_absolute_text(value):
            continue
        path = Path(value)
        if inside(path, data_dir):
            continue
        if not path.exists():
            missing.add(value)
            continue
        root = folder_root(path, home)
        if root == home or root == Path(root.anchor):
            continue
        roots[os.path.normcase(str(root))] = root
    ordered = sorted(roots.values(), key=lambda p: len(str(p)))
    final = []
    for root in ordered:
        if not any(inside(root, kept) for kept in final):
            final.append(root)
    return sorted(final, key=lambda p: str(p).lower()), sorted(missing)


# ----------------------------------------------------------------- trabajos en segundo plano

class Job:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = dict(activo=False)
        self.cancel = threading.Event()

    def start(self, kind, target):
        with self.lock:
            if self.state.get('activo'):
                raise ValueError('Ya hay una migración en curso. Esperá a que termine o cancelala.')
            self.cancel.clear()
            self.state = dict(activo=True, tipo=kind, fase='Preparando', hecho=0, total=0, archivo='', error='', resultado=None, inicio=time.time())

        def run():
            try:
                result = target(self)
                self.update(activo=False, fase='Listo', resultado=result)
            except Cancelled:
                self.update(activo=False, fase='Cancelada', error='Cancelaste la migración antes de que terminara. Si era una importación, tus proyectos anteriores en esta computadora siguen como estaban.')
            except Exception as error:  # se informa en pantalla y queda en el registro
                import logging
                logging.exception('Falló la migración')
                self.update(activo=False, fase='Error', error=str(error) or error.__class__.__name__)
        threading.Thread(target=run, daemon=True).start()

    def update(self, **values):
        with self.lock:
            self.state.update(values)

    def advance(self, size, name=''):
        if self.cancel.is_set():
            raise Cancelled()
        with self.lock:
            self.state['hecho'] += size
            if name:
                self.state['archivo'] = name

    def snapshot(self):
        with self.lock:
            return dict(self.state)


# ----------------------------------------------------------------- exportar

def build_plan(db, data_dir, db_file):
    data_dir = Path(data_dir)
    roots, missing = project_roots(db, data_dir)
    projects = []
    for index, root in enumerate(roots):
        kind = disk_kind(root)
        size, count = tree_stats(root)
        projects.append(dict(id=f'p{index:03d}', ruta=str(root), nombre=root.name, tipo='carpeta' if root.is_dir() else 'archivo',
                             disco=kind, incluir=kind == 'interno', tamano=size, archivos=count))
    data_size, data_count = data_stats(data_dir, db_file)
    plugins = plugin_inventory.scan()
    return dict(datos=dict(ruta=str(data_dir), tamano=data_size, archivos=data_count), proyectos=projects, no_encontrados=missing[:200],
                faltan_total=len(missing), plugins=plugins, centrales=plugin_inventory.summarize(plugins), sistema=sys.platform,
                avisos=license_notes(plugins))


def data_files(data_dir, db_file):
    for folder, dirs, names in os.walk(data_dir, followlinks=False):
        current = Path(folder)
        dirs[:] = [d for d in dirs if not (current == data_dir and d in SKIP_DATA_FOLDERS)]
        for name in names:
            path = current / name
            if same_path(path, db_file) or SKIP_DATA.search(name):
                continue
            yield path


def data_stats(data_dir, db_file):
    size = count = 0
    for path in data_files(Path(data_dir), db_file):
        try:
            size += path.lstat().st_size
            count += 1
        except OSError:
            pass
    return size + (Path(db_file).stat().st_size if Path(db_file).exists() else 0), count + 1


def add_file(archive, path, name, job):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode):
        entry = zipfile.ZipInfo(name, time.localtime(info.st_mtime)[:6])
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(entry, os.readlink(path))
        job.advance(0, name)
        return
    method = zipfile.ZIP_STORED if path.suffix.lower() in STORED or info.st_size > 50 * 1024 * 1024 else zipfile.ZIP_DEFLATED
    entry = zipfile.ZipInfo.from_file(path, name)
    entry.compress_type = method
    with open(path, 'rb') as source, archive.open(entry, 'w', force_zip64=info.st_size > 2 * 1024 ** 3) as target:
        while True:
            block = source.read(4 * 1024 * 1024)
            if not block:
                break
            target.write(block)
            job.advance(len(block), path.name)


def add_tree(archive, root, prefix, job, skip, omitted):
    if root.is_file() or root.is_symlink():
        add_file(archive, root, prefix + root.name, job)
        return
    for folder, dirs, names in os.walk(root, followlinks=False):
        current = Path(folder)
        for name in list(dirs):
            path = current / name
            if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
                dirs.remove(name)
                if path.is_symlink() and not (hasattr(path, 'is_junction') and path.is_junction()):
                    add_file(archive, path, prefix + path.relative_to(root).as_posix(), job)
                else:
                    omitted.append(str(path))
        if not names and not dirs and current != root:
            archive.writestr(prefix + current.relative_to(root).as_posix().rstrip('.') + '/', b'')
        for name in names:
            path = current / name
            if any(same_path(path, s) for s in skip):
                continue
            try:
                add_file(archive, path, prefix + path.relative_to(root).as_posix(), job)
            except PermissionError:
                omitted.append(str(path))


def export(job, db_file, destination, include_projects, copy_plugins, app_version=''):
    db_file, destination = Path(db_file), Path(destination)
    data_dir = db_file.parent
    if destination.suffix.lower() != '.zip':
        destination = destination.with_suffix('.zip')
    if destination.exists():
        raise ValueError('Ya existe un archivo con ese nombre. Elegí otro nombre para no pisarlo.')
    if inside(destination, data_dir):
        raise ValueError('Guardá la migración fuera de la carpeta de datos de AudioTaller (por ejemplo en Descargas o en un disco externo).')
    job.update(fase='Revisando qué hay para exportar')
    with sqlite3.connect(db_file) as db:
        plan = build_plan(db, data_dir, db_file)
    chosen = [p for p in plan['proyectos'] if p['id'] in set(include_projects)]
    plugins = [p for p in plan['plugins'] if p['id'] in set(copy_plugins) and p['copiable']]
    total = plan['datos']['tamano'] + sum(p['tamano'] for p in chosen) + sum(p['tamano'] for p in plugins)
    free = shutil.disk_usage(destination.parent).free
    if free < total * 1.02 + 50 * 1024 * 1024:
        raise ValueError(f'No hay espacio suficiente en el destino: hacen falta {gb(total)} y hay {gb(free)} libres.')
    job.update(total=total, fase='Copiando la base de AudioTaller')
    partial = destination.with_name(destination.name + '.parcial')
    omitted = []
    skip = [destination, partial]
    try:
        with tempfile.TemporaryDirectory() as temp:
            snapshot = Path(temp) / 'audiotaller.sqlite3'
            with sqlite3.connect(db_file) as source, sqlite3.connect(snapshot) as copy:
                source.backup(copy)
            with zipfile.ZipFile(partial, 'w', allowZip64=True) as archive:
                add_file(archive, snapshot, 'datos/audiotaller.sqlite3', job)
                job.update(fase='Copiando biblioteca y ajustes de AudioTaller')
                for path in data_files(data_dir, db_file):
                    add_file(archive, path, 'datos/' + path.relative_to(data_dir).as_posix(), job)
                for project in chosen:
                    job.update(fase=f'Copiando proyecto «{project["nombre"]}»')
                    project['arc'] = f'proyectos/{project["id"]}/'
                    add_tree(archive, Path(project['ruta']), project['arc'], job, skip, omitted)
                for plugin in plugins:
                    job.update(fase=f'Copiando plugin «{plugin["nombre"]}»')
                    plugin['arc'] = f'plugins/{plugin["raiz"]}/{plugin["relativo"]}'
                    path = Path(plugin['ruta'])
                    add_tree(archive, path, plugin['arc'] + '/', job, skip, omitted) if path.is_dir() else add_file(archive, path, plugin['arc'], job)
                copied = {p['id']: p['arc'] for p in plugins}
                manifest = dict(formato=FORMAT, version=VERSION, creado=datetime.now().isoformat(timespec='seconds'), sistema=sys.platform,
                                app=app_version, home=str(Path.home()), datos=str(data_dir),
                                proyectos=[dict(id=p['id'], ruta=p['ruta'], nombre=p['nombre'], tipo=p['tipo'], arc=p['arc'], tamano=p['tamano']) for p in chosen],
                                no_incluidos=[dict(ruta=p['ruta'], disco=p['disco']) for p in plan['proyectos'] if p not in chosen],
                                plugins=[dict(p, arc=copied.get(p['id'], ''), copiado=p['id'] in copied, ruta=p['ruta']) for p in plan['plugins']],
                                omitidos=omitted[:500], tamano=total)
                archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=1))
        os.replace(partial, destination)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    return dict(archivo=str(destination), tamano=destination.stat().st_size, proyectos=len(chosen), plugins=len(plugins), omitidos=omitted[:50],
                avisos=license_notes(plan['plugins']))


def license_notes(plugins):
    """Qué hacer en la computadora vieja antes de dejarla."""
    managers = {p['central'] for p in plugins if p['licencia'] in ('central', 'ilok')}
    notes = []
    if 'Waves Central' in managers:
        notes.append('Waves: abrí Waves Central → Licencias y pasá tus licencias a la nube (Waves Cloud) antes de formatear o vender esta computadora.')
    if 'iLok License Manager' in managers:
        notes.append('iLok: si alguna licencia está en esta computadora (no en un iLok USB ni en iLok Cloud), movela con iLok License Manager antes de dejarla.')
    if managers - {'Waves Central', 'iLok License Manager'}:
        notes.append('El resto de las centrales (' + ', '.join(sorted(managers - {'Waves Central', 'iLok License Manager'})) + ') guardan las licencias en tu cuenta: en la computadora nueva solo iniciás sesión. Algunas tienen un límite de activaciones; si te pide liberar una, desactivá esta computadora desde la central.')
    return notes


def gb(size):
    return f'{size / 1024 ** 3:.1f} GB' if size >= 1024 ** 3 else f'{size / 1024 ** 2:.0f} MB'


# ----------------------------------------------------------------- importar

def read_manifest(path):
    path = Path(path)
    if not zipfile.is_zipfile(path):
        raise ValueError('Ese archivo no es una migración de AudioTaller (no es un .zip válido).')
    with zipfile.ZipFile(path) as archive:
        try:
            manifest = json.loads(archive.read('manifest.json'))
        except KeyError:
            raise ValueError('Ese .zip no tiene el manifiesto de AudioTaller. ¿Es el archivo que generó «Exportar todo»?') from None
    if manifest.get('formato') != FORMAT:
        raise ValueError('Ese archivo no es una migración de AudioTaller.')
    if int(manifest.get('version', 0)) > VERSION:
        raise ValueError('Esta migración la hizo una versión más nueva de AudioTaller. Actualizá AudioTaller en esta computadora y volvé a intentar.')
    return manifest


def translate_home(path, old_home, new_home):
    path, old_home = PurePath(path), PurePath(old_home)
    try:
        return Path(new_home) / path.relative_to(old_home)
    except ValueError:
        return Path(path)


def available(path):
    """Una ruta libre: la misma, o con « (migrado)» si ya hay algo ahí."""
    path = Path(path)
    if not path.exists() or (path.is_dir() and not any(path.iterdir())):
        return path
    for n in range(1, 100):
        label = ' (migrado)' if n == 1 else f' (migrado {n})'
        candidate = path.with_name(path.stem + label + path.suffix) if path.suffix and not path.is_dir() else path.with_name(path.name + label)
        if not candidate.exists():
            return candidate
    raise ValueError('No encontré un nombre libre para ' + str(path))


def inspect(path, db_file):
    manifest = read_manifest(path)
    home = Path.home()
    targets = []
    for project in manifest['proyectos']:
        wanted = translate_home(project['ruta'], manifest['home'], home)
        if sys.platform == 'win32' and not Path(wanted.anchor).exists():
            wanted = home / 'Music' / 'AudioTaller migración' / wanted.name
        target = available(wanted)
        targets.append(dict(project, destino=str(target), cambia=not same_path(target, project['ruta'])))
    existing = 0
    if Path(db_file).exists():
        try:
            with sqlite3.connect(db_file) as db:
                existing = db.execute('SELECT COUNT(*) FROM canciones').fetchone()[0]
        except sqlite3.Error:
            existing = 0
    same_os = manifest.get('sistema') == sys.platform
    plugins = manifest.get('plugins', [])
    return dict(archivo=str(path), creado=manifest.get('creado'), sistema=manifest.get('sistema'), mismo_sistema=same_os, proyectos=targets,
                no_incluidos=manifest.get('no_incluidos', []), canciones_actuales=existing, tamano=manifest.get('tamano', 0),
                plugins_copiados=sum(1 for p in plugins if p.get('copiado')) if same_os else 0, plugins_total=len(plugins),
                centrales=plugin_inventory.summarize(plugins))


def rewrite_text(value, mappings):
    for pattern, replacement in mappings:
        value = pattern.sub(lambda _m, r=replacement: r, value)
    return value


def build_mappings(pairs):
    """Patrones de reemplazo para rutas tal cual, dentro de JSON y con barras normales."""
    mappings = []
    flags = re.I if sys.platform == 'win32' else 0
    for old, new in sorted(pairs, key=lambda pair: -len(pair[0])):
        old, new = str(old).rstrip('\\/'), str(new).rstrip('\\/')
        variants = {(old, new), (old.replace('\\', '\\\\'), new.replace('\\', '\\\\'))}
        if '\\' in old:
            variants.add((old.replace('\\', '/'), new.replace('\\', '/')))
        for before, after in variants:
            mappings.append((re.compile(re.escape(before) + r'(?=$|[\\/"])', flags), after))
    return mappings


def rewrite_database(db_path, pairs):
    mappings = build_mappings(pairs)
    changed = 0
    with sqlite3.connect(db_path) as db:
        db.execute('PRAGMA foreign_keys=OFF')
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            columns = [row[1] for row in db.execute(f'PRAGMA table_info("{table}")')]
            for rowid, *values in db.execute(f'SELECT rowid, * FROM "{table}"').fetchall():
                updates = {}
                for column, value in zip(columns, values):
                    if isinstance(value, str) and value:
                        new = rewrite_text(value, mappings)
                        if new != value:
                            updates[column] = new
                if updates:
                    db.execute(f'UPDATE "{table}" SET ' + ', '.join(f'"{c}"=?' for c in updates) + ' WHERE rowid=?', [*updates.values(), rowid])
                    changed += 1
    return changed


def extract_member(archive, info, target, job):
    mode = info.external_attr >> 16
    target.parent.mkdir(parents=True, exist_ok=True)
    if stat.S_ISLNK(mode) and os.name != 'nt':
        if not target.exists() and not target.is_symlink():
            os.symlink(archive.read(info).decode(), target)
        return
    if info.is_dir():
        target.mkdir(parents=True, exist_ok=True)
        return
    temporary = target.with_name(target.name + '.at-tmp')
    with archive.open(info) as source, open(temporary, 'wb') as output:
        while True:
            block = source.read(4 * 1024 * 1024)
            if not block:
                break
            output.write(block)
            job.advance(len(block), target.name)
    if mode & 0o111 and os.name != 'nt':
        os.chmod(temporary, (mode & 0o777) | 0o600)
    stamp = time.mktime(info.date_time + (0, 0, -1))
    os.utime(temporary, (stamp, stamp))
    os.replace(temporary, target)


def safe_target(base, relative):
    target = (Path(base) / relative).resolve()
    if not inside(target, Path(base).resolve()):
        raise ValueError('El archivo de migración tiene una ruta inválida: ' + relative)
    return target


def import_archive(job, path, db_file, install_plugins=True):
    path, db_file = Path(path), Path(db_file)
    data_dir = db_file.parent
    plan = inspect(path, db_file)
    manifest = read_manifest(path)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = data_dir / 'respaldos-migracion' / stamp
    staging = data_dir / 'migracion' / stamp
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        job.update(total=sum(m.file_size for m in members), fase='Revisando espacio libre')
        need = sum(m.file_size for m in members)
        free = shutil.disk_usage(data_dir if data_dir.exists() else Path.home()).free
        if free < need * 1.02:
            raise ValueError(f'No hay espacio suficiente en esta computadora: hacen falta {gb(need)} y hay {gb(free)} libres.')
        data_dir.mkdir(parents=True, exist_ok=True)
        # 1. base nueva en un lugar aparte (todavía no reemplaza la actual)
        job.update(fase='Preparando la base de AudioTaller')
        staging.mkdir(parents=True, exist_ok=True)
        new_db = staging / 'audiotaller.sqlite3'
        extract_member(archive, archive.getinfo('datos/audiotaller.sqlite3'), new_db, job)
        # 2. proyectos
        targets = {p['id']: Path(p['destino']) for p in plan['proyectos']}
        sources = {p['id']: p for p in manifest['proyectos']}
        for project_id, target in targets.items():
            project = sources[project_id]
            job.update(fase=f'Copiando proyecto «{project["nombre"]}»')
            prefix = project['arc']
            for info in members:
                if not info.filename.startswith(prefix) or info.filename == prefix:
                    continue
                relative = info.filename[len(prefix):]
                if project['tipo'] == 'archivo':
                    extract_member(archive, info, target, job)
                else:
                    extract_member(archive, info, safe_target(target, relative), job)
        # 3. biblioteca de AudioTaller: lo que ya existía se respalda antes de reemplazarlo
        job.update(fase='Copiando biblioteca y ajustes de AudioTaller')
        for info in members:
            if not info.filename.startswith('datos/') or info.filename == 'datos/audiotaller.sqlite3' or info.is_dir():
                continue
            relative = info.filename[len('datos/'):]
            target = safe_target(data_dir, relative)
            if target.exists():
                copy = safe_target(backup, relative)
                copy.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, copy)
            extract_member(archive, info, target, job)
        # 4. rutas viejas -> rutas nuevas
        job.update(fase='Actualizando las rutas de tus proyectos')
        pairs = [(manifest['datos'], str(data_dir))]
        pairs += [(sources[i]['ruta'], str(t)) for i, t in targets.items() if not same_path(sources[i]['ruta'], t)]
        pairs += [(external['ruta'], str(translate_home(external['ruta'], manifest['home'], Path.home())))
                  for external in manifest.get('no_incluidos', []) if inside(external['ruta'], manifest['home'])]
        pairs.append((manifest['home'], str(Path.home())))  # cualquier otra ruta de la carpeta personal
        changed = rewrite_database(new_db, [(old, new) for old, new in pairs if not same_path(old, new)])
        # 5. reemplazar la base (la anterior queda respaldada)
        if db_file.exists():
            backup.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(db_file) as current, sqlite3.connect(backup / 'audiotaller.sqlite3') as copy:
                current.backup(copy)
        with sqlite3.connect(new_db) as source, sqlite3.connect(db_file) as target_db:
            source.backup(target_db)
        # 6. plugins copiables
        installed = dict(instalados=0, existentes=0, pendientes=[])
        if install_plugins and plan['mismo_sistema']:
            job.update(fase='Instalando plugins gratuitos')
            installed = install_copied_plugins(archive, manifest, staging / 'plugins', job)
    record = dict(fecha=stamp, archivo=str(path), plugins=manifest.get('plugins', []), instalacion=installed, sistema=manifest.get('sistema'))
    (data_dir / 'migracion').mkdir(exist_ok=True)
    (data_dir / 'migracion' / 'ultima.json').write_text(json.dumps(record, ensure_ascii=False), encoding='utf-8')
    shutil.rmtree(staging, ignore_errors=True)
    return dict(proyectos=len(targets), rutas_actualizadas=changed, respaldo=str(backup) if backup.exists() else '',
                plugins=installed, reubicados=[dict(antes=sources[i]['ruta'], ahora=str(t)) for i, t in targets.items() if not same_path(sources[i]['ruta'], t)])


def local_root(key):
    roots = {k: (fmt, Path(root), access) for k, fmt, root, access in plugin_inventory.plugin_roots()}
    if sys.platform == 'darwin' and key in roots and roots[key][2] == 'admin' and key + '-user' in roots:
        key = key + '-user'  # en Mac se instalan en la carpeta del usuario: no hace falta contraseña de administrador
    return roots.get(key)


def install_copied_plugins(archive, manifest, staging, job):
    result = dict(instalados=0, existentes=0, pendientes=[], requiere_permiso=False)
    elevated = []
    for plugin in manifest.get('plugins', []):
        if not plugin.get('copiado'):
            continue
        root = local_root(plugin['raiz'])
        if not root:
            result['pendientes'].append(plugin['nombre'])
            continue
        _, folder, access = root
        target = folder / plugin['relativo']
        if target.exists():
            result['existentes'] += 1
            continue
        prefix = plugin['arc']
        destination = target if access == 'user' else staging / plugin['raiz'] / plugin['relativo']
        for info in archive.infolist():
            if info.filename == prefix:
                extract_member(archive, info, destination, job)
            elif info.filename.startswith(prefix + '/'):
                extract_member(archive, info, safe_target(destination, info.filename[len(prefix) + 1:]), job)
        if access == 'user':
            result['instalados'] += 1
        else:
            elevated.append((plugin, destination, target))
    if elevated:
        result['requiere_permiso'] = True
        ok = copy_as_admin([(source, target) for _, source, target in elevated])
        for plugin, source, target in elevated:
            if target.exists():
                result['instalados'] += 1
            else:
                result['pendientes'].append(plugin['nombre'])
        if not ok:
            result['aviso'] = 'Windows no dio permiso de administrador: esos plugins no se instalaron. Podés reintentar desde la lista de plugins.'
    return result


def copy_as_admin(pairs):
    """Copia a carpetas del sistema con un único pedido de permiso de Windows. No pisa nada que ya exista."""
    if sys.platform != 'win32':
        for source, target in pairs:
            copy_without_overwrite(source, target)
        return True
    lines = ['$ErrorActionPreference = "Continue"']
    for source, target in pairs:
        quote = lambda p: "'" + str(p).replace("'", "''") + "'"
        if Path(source).is_dir():
            lines.append(f'robocopy {quote(source)} {quote(target)} /E /XC /XN /XO /R:1 /W:1 /NJH /NJS /NP | Out-Null')
        else:
            lines.append(f'New-Item -ItemType Directory -Force -Path {quote(Path(target).parent)} | Out-Null; if (-not (Test-Path -LiteralPath {quote(target)})) {{ Copy-Item -LiteralPath {quote(source)} -Destination {quote(target)} }}')
    script = Path(tempfile.gettempdir()) / f'audiotaller-plugins-{uuid.uuid4().hex[:8]}.ps1'
    script.write_text('\r\n'.join(lines), encoding='utf-8-sig')
    command = f"Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"{script}\"'"
    try:
        completed = subprocess.run(['powershell', '-NoProfile', '-Command', command], capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return completed.returncode == 0
    finally:
        script.unlink(missing_ok=True)


def copy_without_overwrite(source, target):
    source, target = Path(source), Path(target)
    if source.is_file():
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        return
    for folder, _, names in os.walk(source):
        for name in names:
            item = Path(folder) / name
            copy_without_overwrite(item, target / item.relative_to(source))


def plugin_checklist(data_dir):
    record_path = Path(data_dir) / 'migracion' / 'ultima.json'
    if not record_path.exists():
        return dict(migracion=None, centrales=[], plugins=[])
    record = json.loads(record_path.read_text(encoding='utf-8'))
    compared = plugin_inventory.compare(record['plugins'], plugin_inventory.scan())
    groups = plugin_inventory.summarize(compared)
    for group in groups:
        group['instalados'] = sum(1 for p in group['plugins'] if p['instalado'])
        group['total'] = len(group['plugins'])
    return dict(migracion=dict(fecha=record['fecha'], archivo=record['archivo']), centrales=groups,
                faltan=sum(1 for p in compared if not p['instalado']), total=len(compared), mismo_sistema=record.get('sistema') == sys.platform)


def retry_plugins(job, data_dir):
    record = json.loads((Path(data_dir) / 'migracion' / 'ultima.json').read_text(encoding='utf-8'))
    path = Path(record['archivo'])
    if not path.exists():
        raise ValueError('No encuentro el archivo de migración en ' + str(path) + '. Conectá el disco donde está y volvé a intentar.')
    with zipfile.ZipFile(path) as archive:
        manifest = read_manifest(path)
        job.update(total=sum(m.file_size for m in archive.infolist() if m.filename.startswith('plugins/')), fase='Instalando plugins gratuitos')
        staging = Path(data_dir) / 'migracion' / 'reintento'
        try:
            return install_copied_plugins(archive, manifest, staging, job)
        finally:
            shutil.rmtree(staging, ignore_errors=True)


# ----------------------------------------------------------------- rutas web

def register_migration(app, connect, db_path, app_version=''):
    from flask import jsonify, request
    job = Job()

    @app.get('/api/migracion/plan')
    def migration_plan():
        with connect() as db:
            pass  # asegura el esquema
        with sqlite3.connect(db_path()) as db:
            plan = build_plan(db, Path(db_path()).parent, db_path())
        plan['nombre_sugerido'] = f'AudioTaller migración {datetime.now():%Y-%m-%d}.zip'
        plan['carpeta_sugerida'] = str(Path.home() / 'Downloads') if (Path.home() / 'Downloads').is_dir() else str(Path.home())
        return jsonify(plan)

    @app.post('/api/migracion/exportar')
    def migration_export():
        data = request.get_json(force=True) or {}
        destination = str(data.get('destino', '')).strip()
        if not destination:
            raise ValueError('Elegí dónde guardar el archivo de migración.')
        job.start('exportar', lambda j: export(j, db_path(), destination, data.get('proyectos', []), data.get('plugins', []), app_version))
        return jsonify(job.snapshot())

    @app.post('/api/migracion/revisar')
    def migration_inspect():
        data = request.get_json(force=True) or {}
        return jsonify(inspect(str(data.get('archivo', '')).strip(), db_path()))

    @app.post('/api/migracion/importar')
    def migration_import():
        data = request.get_json(force=True) or {}
        archive = str(data.get('archivo', '')).strip()
        job.start('importar', lambda j: import_archive(j, archive, db_path(), bool(data.get('plugins', True))))
        return jsonify(job.snapshot())

    @app.post('/api/migracion/plugins/reintentar')
    def migration_retry_plugins():
        job.start('plugins', lambda j: retry_plugins(j, Path(db_path()).parent))
        return jsonify(job.snapshot())

    @app.get('/api/migracion/estado')
    def migration_status():
        return jsonify(job.snapshot())

    @app.post('/api/migracion/cancelar')
    def migration_cancel():
        job.cancel.set()
        return jsonify(job.snapshot())

    @app.get('/api/migracion/plugins')
    def migration_plugins():
        return jsonify(plugin_checklist(Path(db_path()).parent))

    return job
