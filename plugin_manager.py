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
import plugin_inventory
from runtime_paths import open_path

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
                       sugeridos=plugin_catalog.with_installed([i['nombre'] for i in items]))

    @app.post('/api/plugins/instalar')
    def plugins_install():
        paths = (request.get_json() or {}).get('rutas', [])
        if not isinstance(paths, list) or not 0 < len(paths) <= 30:
            raise ValueError('Elegí entre 1 y 30 archivos o carpetas de plugins.')
        installed, skipped, admin = [], [], []
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
                    (shutil.copytree if source.is_dir() else shutil.copy2)(str(source), str(target))
                    installed.append(dict(nombre=source.stem, formato=fmt, ruta=str(target)))
            if admin:
                run_admin(admin)
                for _, source, target in admin:
                    if Path(target).exists():
                        installed.append(dict(nombre=source.stem, formato=PLUGIN_EXT[source.suffix.lower()], ruta=str(target)))
                    else:
                        skipped.append(dict(nombre=source.name, motivo='Faltó el permiso de administrador.'))
        return jsonify(instalados=installed, omitidos=skipped)

    @app.post('/api/plugins/desactivar')
    def plugins_disable():
        identity = (request.get_json() or {}).get('id', '')
        plugin = next((p for p in plugin_inventory.scan() if p['id'] == identity), None)
        if not plugin:
            raise ValueError('Ese plugin ya no está en la carpeta. Volvé a escanear.')
        source = Path(plugin['ruta'])
        uid = uuid.uuid4().hex[:10]
        target = disabled_dir() / uid / source.name
        if needs_admin(source):
            ok = run_admin([('move', source, target)])
            if not ok or not target.exists():
                raise ValueError('No se pudo mover el plugin: hace falta el permiso de administrador.')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
        items = read_index()
        items.append(dict(uid=uid, nombre=plugin['nombre'], formato=plugin['formato'], fabricante=plugin['fabricante'], central=plugin.get('central', ''),
                          origen=str(source), guardado=str(target), fecha=datetime.now().strftime('%Y-%m-%d %H:%M')))
        write_index(items)
        return jsonify(ok=True, uid=uid)

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
        path = Path(str((request.get_json() or {}).get('ruta', '')))
        roots = [r['ruta'] for r in roots_by_key().values()] + [disabled_dir()]
        if not any(str(path).startswith(str(root)) for root in roots):
            raise ValueError('Esa ruta no es una carpeta de plugins.')
        open_path(str(path.parent if path.exists() else path.parent.parent))
        return jsonify(ok=True)
