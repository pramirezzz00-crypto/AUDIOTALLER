"""Gestor de plugins: ver lo instalado, instalar desde un archivo y desinstalar de forma reversible.

Desinstalar no borra: mueve el plugin a la carpeta de datos de AudioTaller («Plugins desactivados»)
y se puede restaurar. Nunca reemplaza un plugin que ya esté instalado.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from flask import jsonify, request

import plugin_catalog
import plugin_downloads
import plugin_inventory
from runtime_paths import open_path, reveal_path

PLUGIN_EXT = {'.vst3': 'VST3', '.clap': 'CLAP', '.component': 'AU', '.vst': 'VST2', '.aaxplugin': 'AAX', '.dll': 'VST2'}


def roots_by_key():
    return {key: dict(formato=fmt, ruta=Path(root), acceso=access) for key, fmt, root, access in plugin_inventory.plugin_roots()}


def install_root(fmt):
    """Carpeta estándar donde va un plugin nuevo de ese formato."""
    roots = roots_by_key()
    if sys.platform == 'darwin':
        key = {'VST3': 'vst3-user', 'CLAP': 'clap-user', 'AU': 'au-user', 'VST2': 'vst2-user'}.get(fmt)
    elif sys.platform == 'win32':
        key = {'VST3': 'vst3', 'CLAP': 'clap'}.get(fmt)
        if fmt == 'VST2':
            existing = [k for k, r in roots.items() if r['formato'] == 'VST2' and r['ruta'].is_dir()]
            key = existing[0] if existing else next((k for k, r in roots.items() if r['formato'] == 'VST2'), None)
    else:
        key = {'VST3': 'vst3-user', 'CLAP': 'clap-user', 'VST2': 'vst2-user'}.get(fmt)
    return (key, roots[key]) if key in roots else (None, None)


def run_admin(commands):
    """Ejecuta movimientos o copias en carpetas del sistema con un único pedido de permiso."""
    if not commands:
        return True
    if sys.platform == 'win32':
        quote = lambda p: "'" + str(p).replace("'", "''") + "'"
        lines = ['$ErrorActionPreference = "Stop"']
        for op, source, target in commands:
            lines.append(f'New-Item -ItemType Directory -Force -Path {quote(Path(target).parent)} | Out-Null')
            verb = 'Move-Item' if op == 'move' else 'Copy-Item -Recurse'
            lines.append(f'if (-not (Test-Path -LiteralPath {quote(target)})) {{ {verb} -LiteralPath {quote(source)} -Destination {quote(target)} }}')
        script = Path(tempfile.gettempdir()) / f'audiotaller-plugins-{uuid.uuid4().hex[:8]}.ps1'
        script.write_text('\r\n'.join(lines), encoding='utf-8-sig')
        command = f"Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"{script}\"'"
        try:
            done = subprocess.run(['powershell', '-NoProfile', '-Command', command], capture_output=True,
                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            return done.returncode == 0
        finally:
            script.unlink(missing_ok=True)
    if sys.platform == 'darwin':
        sh = lambda p: "'" + str(p).replace("'", "'\\''") + "'"
        parts = []
        for op, source, target in commands:
            parts.append(f"mkdir -p {sh(Path(target).parent)} && [ ! -e {sh(target)} ] && {'mv' if op == 'move' else 'cp -R'} {sh(source)} {sh(target)}")
        script = ' ; '.join(parts).replace('\\', '\\\\').replace('"', '\\"')
        done = subprocess.run(['/usr/bin/osascript', '-e', f'do shell script "{script}" with administrator privileges'], capture_output=True)
        return done.returncode == 0
    for op, source, target in commands:
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        if not Path(target).exists():
            (shutil.move if op == 'move' else (shutil.copytree if Path(source).is_dir() else shutil.copy2))(str(source), str(target))
    return True


def needs_admin(path):
    folder = Path(path).parent
    while not folder.exists() and folder != folder.parent:
        folder = folder.parent
    return not os.access(folder, os.W_OK)


def find_plugins(folder):
    found = []
    for current, dirs, names in os.walk(folder):
        here = Path(current)
        keep = []
        for name in dirs:
            if Path(name).suffix.lower() in PLUGIN_EXT:
                found.append(here / name)
            elif name != '__MACOSX':
                keep.append(name)
        dirs[:] = keep
        for name in names:
            suffix = Path(name).suffix.lower()
            if suffix in PLUGIN_EXT and not (suffix == '.dll' and sys.platform != 'win32'):
                found.append(here / name)
    return found


def copy_into_roots(candidates):
    """Copia plugins sueltos a la carpeta estándar de su formato. Nunca reemplaza uno instalado."""
    installed, skipped, admin = [], [], []
    for source in candidates:
        fmt = PLUGIN_EXT[source.suffix.lower()]
        if fmt == 'AAX':
            skipped.append(dict(nombre=source.name, motivo='Los AAX se instalan con el instalador del fabricante.'))
            continue
        key, root = install_root(fmt)
        if not root:
            skipped.append(dict(nombre=source.name, motivo=f'No hay carpeta estándar de {fmt} en este sistema.'))
            continue
        target = root['ruta'] / source.name
        if target.exists():
            skipped.append(dict(nombre=source.name, motivo='Ya está instalado: no lo reemplazo.'))
            continue
        if needs_admin(target):
            admin.append(('copy', source, target))
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            (shutil.copytree if source.is_dir() else shutil.copy2)(str(source), str(target), **({'symlinks': True} if source.is_dir() else {}))
            installed.append(dict(nombre=source.stem, formato=fmt, ruta=str(target)))
    if admin:
        run_admin(admin)
        for _, source, target in admin:
            if Path(target).exists():
                installed.append(dict(nombre=source.stem, formato=PLUGIN_EXT[source.suffix.lower()], ruta=str(target)))
            else:
                skipped.append(dict(nombre=source.name, motivo='Faltó el permiso de administrador.'))
    return installed, skipped


def install_worker(names):
    def work(state):
        with tempfile.TemporaryDirectory(prefix='audiotaller-plugins-') as temp:
            found_plugins, found_installers, owners = [], [], {}
            for row in state['plugins']:
                name = row['nombre']
                try:
                    row['estado'], state['paso'] = 'descargando', f'Descargando {name}…'
                    url = plugin_downloads.resolve(name)
                    folder = Path(temp) / uuid.uuid4().hex[:6]
                    folder.mkdir()

                    def progress(done, total, row=row):
                        row['detalle'] = f'{done / 1024 ** 2:.1f} MB' + (f' de {total / 1024 ** 2:.1f} MB' if total else '')
                    path = plugin_downloads.download(url, folder, progress)
                    row['estado'], row['detalle'] = 'preparando', path.name
                    plugins, installers = plugin_downloads.prepare(path, folder, find_plugins)
                    if not plugins and not installers:
                        raise ValueError('La descarga no trae plugins para esta computadora.')
                    found_plugins += plugins
                    for item in installers:
                        owners[str(item)] = row
                    found_installers += installers
                    row['estado'] = 'listo para instalar'
                except Exception as error:
                    row['estado'], row['detalle'] = 'error', str(error)[:200]
            if found_plugins:
                state['paso'] = 'Copiando plugins…'
                done, skipped = copy_into_roots(found_plugins)
                state['instalados'] += done
                state['omitidos'] += skipped
            if found_installers:
                state['paso'] = ('Ejecutando los instaladores. Windows te va a pedir permiso una sola vez.' if sys.platform == 'win32'
                                 else 'Ejecutando los instaladores. macOS te va a pedir tu contraseña una sola vez.')
                ok = plugin_downloads.run_installers(found_installers)
                if not ok:
                    for item in found_installers:
                        owners[str(item)]['estado'], owners[str(item)]['detalle'] = 'error', 'Se canceló el permiso o falló el instalador.'
            state['paso'] = 'Revisando lo instalado…'
            have = {i['nombre'] for i in plugin_inventory.scan()}
            checked = {e['nombre']: e['instalado'] for s in plugin_catalog.with_installed(list(have)) for g in s['grupos'] for e in g['items']}
            for row in state['plugins']:
                if checked.get(row['nombre']):
                    row['estado'], row['detalle'] = 'instalado', ''
                elif row['estado'] != 'error':
                    row['estado'], row['detalle'] = 'error', 'No aparece instalado. Probá descargarlo desde el sitio.'
            ok = sum(r['estado'] == 'instalado' for r in state['plugins'])
            state['paso'] = f'Listo: {ok} de {len(state["plugins"])} instalados. Volvé a escanear plugins en tu DAW.'
    return work



def youlean_installed():
    return any('youlean' in p['nombre'].lower() for p in plugin_inventory.scan())


def install_blocking(names):
    """Instala y espera (lo usa el instalador de AudioTaller para Youlean)."""
    state = dict(estado='trabajando', paso='', plugins=[dict(nombre=n, estado='en espera', detalle='') for n in names], instalados=[], omitidos=[])
    install_worker(names)(state)
    return state


def register_plugin_manager(app, data_folder):
    def disabled_dir():
        return Path(data_folder()) / 'Plugins desactivados'

    def index_path():
        return disabled_dir() / 'indice.json'

    def read_index():
        try:
            return json.loads(index_path().read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return []

    def write_index(items):
        disabled_dir().mkdir(parents=True, exist_ok=True)
        index_path().write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding='utf-8')

    @app.get('/api/plugins')
    def plugins_list():
        items = plugin_inventory.scan()
        roots = [dict(clave=k, formato=r['formato'], ruta=str(r['ruta']), existe=r['ruta'].is_dir()) for k, r in roots_by_key().items()]
        disabled = [dict(d, disponible=Path(d['guardado']).exists()) for d in read_index()]
        return jsonify(instalados=items, desactivados=disabled, carpetas=roots, sistema=sys.platform,
                       duplicados=plugin_inventory.find_duplicates(items),
                       sugeridos=plugin_catalog.with_installed([i['nombre'] for i in items]))

    @app.post('/api/plugins/instalar')
    def plugins_install():
        paths = (request.get_json() or {}).get('rutas', [])
        if not isinstance(paths, list) or not 0 < len(paths) <= 30:
            raise ValueError('Elegí entre 1 y 30 archivos o carpetas de plugins.')
        installed, skipped = [], []
        with tempfile.TemporaryDirectory() as temp:
            candidates = []
            for value in paths:
                path = Path(str(value)).expanduser()
                if not path.exists():
                    raise ValueError('No encuentro ' + str(path))
                if path.suffix.lower() == '.zip':
                    target = Path(temp) / uuid.uuid4().hex[:8]
                    with zipfile.ZipFile(path) as archive:
                        for member in archive.infolist():
                            dest = (target / member.filename).resolve()
                            if not str(dest).startswith(str(target.resolve())):
                                raise ValueError('El .zip tiene rutas inválidas.')
                        archive.extractall(target)
                    found = find_plugins(target)
                    if not found:
                        skipped.append(dict(nombre=path.name, motivo='El .zip no tiene plugins (puede traer un instalador: ejecutalo vos).'))
                    candidates += found
                elif path.suffix.lower() in PLUGIN_EXT:
                    candidates.append(path)
                elif path.is_dir():
                    found = find_plugins(path)
                    candidates += found or []
                    if not found:
                        skipped.append(dict(nombre=path.name, motivo='No encontré plugins en esa carpeta.'))
                elif path.suffix.lower() in ('.exe', '.msi', '.pkg', '.dmg'):
                    skipped.append(dict(nombre=path.name, motivo='Es un instalador: abrilo con doble clic para instalarlo.'))
                else:
                    skipped.append(dict(nombre=path.name, motivo='No es un plugin VST3, VST2, CLAP o AU.'))
            done, more = copy_into_roots(candidates)
            installed += done
            skipped += more
        return jsonify(instalados=installed, omitidos=skipped)

    def disable_many(ids):
        """Mueve plugins a «Plugins desactivados» (reversible), con un único pedido de permiso."""
        scanned = {p['id']: p for p in plugin_inventory.scan()}
        missing = [i for i in ids if i not in scanned]
        if missing:
            raise ValueError('Algún plugin ya no está en su carpeta. Volvé a escanear.')
        moves, entries, admin = [], [], []
        for identity in ids:
            plugin = scanned[identity]
            source = Path(plugin['ruta'])
            uid = uuid.uuid4().hex[:10]
            target = disabled_dir() / uid / source.name
            moves.append((uid, plugin, source, target))
            if needs_admin(source):
                admin.append(('move', source, target))
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(target))
        if admin:
            run_admin(admin)
        items = read_index()
        done = []
        for uid, plugin, source, target in moves:
            if not target.exists():
                continue
            items.append(dict(uid=uid, nombre=plugin['nombre'], formato=plugin['formato'], fabricante=plugin['fabricante'], central=plugin.get('central', ''),
                              origen=str(source), guardado=str(target), fecha=datetime.now().strftime('%Y-%m-%d %H:%M')))
            done.append(uid)
        write_index(items)
        if len(done) < len(moves):
            raise ValueError(f'Se movieron {len(done)} de {len(moves)}: hace falta el permiso de administrador.' if done else
                             'No se pudo mover: hace falta el permiso de administrador.')
        return done

    @app.post('/api/plugins/desactivar')
    def plugins_disable():
        identity = (request.get_json() or {}).get('id', '')
        return jsonify(ok=True, uid=disable_many([identity])[0])

    @app.post('/api/plugins/desactivar-varios')
    def plugins_disable_many():
        ids = (request.get_json() or {}).get('ids', [])
        if not isinstance(ids, list) or not 0 < len(ids) <= 200 or len(set(ids)) != len(ids):
            raise ValueError('Elegí qué copias quitar.')
        return jsonify(ok=True, uids=disable_many([str(i) for i in ids]))

    @app.post('/api/plugins/borrar')
    def plugins_delete_disabled():
        """Borra definitivamente plugins que ya están en «Plugins desactivados» (nunca de la carpeta de plugins)."""
        uids = (request.get_json() or {}).get('uids', [])
        if not isinstance(uids, list) or not uids:
            raise ValueError('Elegí qué plugins borrar.')
        items, base = read_index(), disabled_dir().resolve()
        keep, deleted = [], 0
        for entry in items:
            if entry['uid'] not in uids:
                keep.append(entry)
                continue
            folder = Path(entry['guardado']).parent.resolve()
            if folder.parent != base:
                raise ValueError('Ruta inesperada: no borro nada fuera de «Plugins desactivados».')
            shutil.rmtree(folder, ignore_errors=True)
            deleted += 1
        write_index(keep)
        return jsonify(ok=True, borrados=deleted)

    @app.post('/api/plugins/restaurar')
    def plugins_restore():
        uid = (request.get_json() or {}).get('uid', '')
        items = read_index()
        entry = next((i for i in items if i['uid'] == uid), None)
        if not entry:
            raise ValueError('No encuentro ese plugin desactivado.')
        source, target = Path(entry['guardado']), Path(entry['origen'])
        if target.exists():
            raise ValueError('Ya hay un plugin con ese nombre en la carpeta original: no lo reemplazo.')
        if not source.exists():
            raise ValueError('La copia guardada ya no está en ' + str(source))
        if needs_admin(target):
            if not run_admin([('move', source, target)]) or not target.exists():
                raise ValueError('No se pudo restaurar: hace falta el permiso de administrador.')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
        shutil.rmtree(source.parent, ignore_errors=True)
        write_index([i for i in items if i['uid'] != uid])
        return jsonify(ok=True)

    @app.post('/api/plugins/mostrar')
    def plugins_reveal():
        path = Path(os.path.normpath(str((request.get_json() or {}).get('ruta', ''))))
        roots = [Path(os.path.normpath(str(r['ruta']))) for r in roots_by_key().values()] + [Path(os.path.normpath(str(disabled_dir())))]
        key = lambda p: os.path.normcase(str(p))
        if not any(key(path) == key(root) or key(path).startswith(key(root).rstrip('\\/') + os.sep) for root in roots):
            raise ValueError('Esa ruta no es una carpeta de plugins.')
        if path.exists():
            reveal_path(path)
        elif path.parent.exists():
            open_path(str(path.parent))
        else:
            raise ValueError('El plugin ya no está en esa carpeta. Volvé a escanear.')
        return jsonify(ok=True)

    # ---------- Instalación automática de gratuitos ----------
    jobs = plugin_downloads.Jobs()

    @app.post('/api/plugins/instalar-gratis')
    def plugins_install_free():
        names = (request.get_json() or {}).get('nombres', [])
        if not isinstance(names, list) or not 0 < len(names) <= 40:
            raise ValueError('Elegí qué plugins instalar.')
        names = [str(n) for n in dict.fromkeys(names)]
        bad = [n for n in names if not plugin_downloads.available(n)]
        if bad:
            raise ValueError('Estos no se pueden instalar automáticamente en este sistema: ' + ', '.join(bad))
        return jsonify(jobs.start(names, install_worker(names)))

    @app.get('/api/plugins/trabajos/<job_id>')
    def plugins_job(job_id):
        state = jobs.get(job_id)
        if not state:
            raise ValueError('No encuentro esa instalación.')
        return jsonify(state)

    def youlean_flag():
        return Path(data_folder()) / 'youlean.json'

    @app.get('/api/plugins/youlean')
    def plugins_youlean():
        try:
            flag = json.loads(youlean_flag().read_text(encoding='utf-8'))
        except (OSError, ValueError):
            flag = {}
        return jsonify(instalado=youlean_installed(), ofrecido=bool(flag.get('ofrecido')),
                       automatico=plugin_downloads.available('Youlean Loudness Meter'))

    @app.post('/api/plugins/youlean/ofrecido')
    def plugins_youlean_offered():
        youlean_flag().write_text(json.dumps(dict(ofrecido=True, fecha=datetime.now().isoformat(timespec='seconds'))), encoding='utf-8')
        return jsonify(ok=True)
