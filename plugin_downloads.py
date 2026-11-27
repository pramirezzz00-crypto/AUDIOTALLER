"""Descarga e instalación de plugins gratuitos desde el sitio oficial de cada fabricante.

- Solo descarga de los dominios oficiales listados en DOWNLOADS (HTTPS).
- Busca el enlace vigente en la página del fabricante; si no lo encuentra usa el último conocido.
- Plugins sueltos (.vst3, .component, .clap, .dll dentro de un .zip o .dmg): se copian a la carpeta
  estándar de su formato. Nunca reemplaza uno instalado.
- Instaladores (.exe, .msi, .pkg): se ejecutan todos juntos con un único pedido de permiso.
"""
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path

UA = 'Mozilla/5.0 (AudioTaller; instalador de plugins gratuitos)'
MAX_BYTES = 800 * 1024 ** 2


def d(pagina, win=None, mac=None, nota=''):
    """win/mac: (patrón del enlace en la página, enlace conocido)."""
    return dict(pagina=pagina, win=win, mac=mac, nota=nota)


def tdr(name, folder, version):
    base = f'https://www.tokyodawn.net/labs/{folder}/{version}/'
    q = re.escape(folder)
    return d(f'https://www.tokyodawn.net/{name}/',
             win=(rf'/labs/{q}/[\d.]+/[^"\'<>]*?\((?:no%20|no )installer\)\.zip', base + urllib.parse.quote(f'{tdr_title(name)} (no installer).zip')),
             mac=(rf'/labs/{q}/[\d.]+/(?:(?!installer)[^"\'<>/])*?\.zip', base + urllib.parse.quote(f'{tdr_title(name)}.zip')))


def tdr_title(page):
    return {'tdr-nova': 'TDR Nova', 'tdr-kotelnikov': 'TDR Kotelnikov', 'tdr-vos-slickeq': 'TDR VOS SlickEQ',
            'tdr-molotok': 'TDR Molotok', 'tdr-prism': 'TDR Prism'}[page]


def voxengo(slug, name, version):
    return d(f'https://www.voxengo.com/product/{slug}/',
             win=(rf'/files/Voxengo{name}_\d+_Win32_64_VST_VST3_AAX_setup\.exe', f'https://www.voxengo.com/files/Voxengo{name}_{version}_Win32_64_VST_VST3_AAX_setup.exe'),
             mac=(rf'/files/Voxengo{name}_\d+_Mac_AU_AAX_VST_setup\.dmg', f'https://www.voxengo.com/files/Voxengo{name}_{version}_Mac_AU_AAX_VST_setup.dmg'))


def tbpro(slug, name, version):
    base = 'https://www.tbproaudio.de/assets/content/download/'
    return d(f'https://www.tbproaudio.de/products/{slug}',
             win=(rf'/download/{name}_Installer_WIN_\d+\.zip', f'{base}{name}_Installer_WIN_{version}.zip'),
             mac=(rf'/download/{name}_Installer_OSX_\d+\.zip', f'{base}{name}_Installer_OSX_{version}.zip'))


def klanghelm(product, script):
    page = f'https://klanghelm.com/contents/products/{product}'
    return d(page, win=(rf'/free/{script}\.php\?id=1', f'https://klanghelm.com/free/{script}.php?id=1'),
             mac=(rf'/free/{script}\.php\?id=3', f'https://klanghelm.com/free/{script}.php?id=3'))


# Clave: nombre del plugin en el catálogo de sugeridos (plugin_catalog).
DOWNLOADS = {
    'Youlean Loudness Meter': d('https://youlean.co/download-youlean-loudness-meter/',
        win=(r'https://cdn\.youlean\.co/[^"\'<>\s]*Youlean-Loudness-Meter-2-V[\d.]+-Windows(?:-\d+)?\.zip',
             'https://cdn.youlean.co/wp-content/uploads/2026/09/Youlean-Loudness-Meter-2-V2.5.15-Windows.zip'),
        mac=(r'https://cdn\.youlean\.co/[^"\'<>\s]*Youlean-Loudness-Meter-2-V[\d.]+-macOS(?:-\d+)?\.dmg',
             'https://cdn.youlean.co/wp-content/uploads/2026/09/Youlean-Loudness-Meter-2-V2.5.15-macOS.dmg')),
    'SPAN': voxengo('span', 'SPAN', '324'),
    'MSED': voxengo('msed', 'MSED', '313'),
    'Correlometer': voxengo('correlometer', 'Correlometer', '19'),
    'TDR Nova': tdr('tdr-nova', 'Nova', '2.2.3'),
    'TDR Kotelnikov': tdr('tdr-kotelnikov', 'Kotelnikov', '1.6.7'),
    'TDR VOS SlickEQ': tdr('tdr-vos-slickeq', 'SlickEQ', '1.3.9'),
    'TDR Molotok': tdr('tdr-molotok', 'Molotok', '1.0.7'),
    'TDR Prism': tdr('tdr-prism', 'Prism', '1.1.4'),
    'mvMeter2': tbpro('mvmeter2', 'mvMeter2', '273'),
    'GSat+': tbpro('gsatplus', 'GSatPlus', '1312'),
    'ISOL8': tbpro('isol8', 'ISOL8', '294'),
    'DC1A': klanghelm('DC1A', 'DC1A3dl'),
    'IVGI': klanghelm('IVGI', 'IVGI2dl'),
    'MJUC jr': klanghelm('MJUCjr', 'MJUCjrdl'),
}
ALLOWED_HOSTS = ('youlean.co', 'voxengo.com', 'tokyodawn.net', 'tbproaudio.de', 'klanghelm.com')


def platform_key(platform=None):
    platform = platform or sys.platform
    return 'win' if platform == 'win32' else 'mac' if platform == 'darwin' else ''


def available(name, platform=None):
    entry, key = DOWNLOADS.get(name), platform_key(platform)
    return bool(entry and key and entry.get(key))


def host_allowed(url):
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or '').lower()
    return parts.scheme == 'https' and any(host == h or host.endswith('.' + h) for h in ALLOWED_HOSTS)


def fetch(url, timeout=40):
    if not host_allowed(url):
        raise ValueError('Dominio no permitido: ' + url)
    request = urllib.request.Request(url, headers={'User-Agent': UA})
    return urllib.request.urlopen(request, timeout=timeout)


def resolve(name, platform=None, opener=fetch):
    """Enlace de descarga vigente: lo busca en la página oficial y, si no, usa el conocido."""
    entry = DOWNLOADS[name]
    pattern, fallback = entry[platform_key(platform)]
    try:
        with opener(entry['pagina'], timeout=25) as response:
            page = html.unescape(response.read(2_000_000).decode('utf-8', 'replace'))
        match = re.search(pattern, page) or re.search(pattern.replace('(?:no%20|no )', '(?:no%20|no )'), page.replace('%20', ' '))
        if match:
            url = urllib.parse.urljoin(entry['pagina'], match.group(0).replace(' ', '%20'))
            if host_allowed(url):
                return url
    except (OSError, urllib.error.URLError, ValueError):
        pass
    return fallback.replace(' ', '%20')


def download(url, folder, progress=None, opener=fetch):
    with opener(url, timeout=60) as response:
        final = response.geturl()
        if not final.startswith('https://'):
            raise ValueError('La descarga no es segura (no es HTTPS).')
        name = filename_from(response, final)
        target = Path(folder) / name
        total = int(response.headers.get('Content-Length') or 0)
        done = 0
        with open(target, 'wb') as out:
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                done += len(chunk)
                if done > MAX_BYTES:
                    raise ValueError('La descarga es demasiado grande.')
                out.write(chunk)
                if progress:
                    progress(done, total)
    return target


def filename_from(response, url):
    disposition = response.headers.get('Content-Disposition') or ''
    match = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', disposition, re.I)
    name = urllib.parse.unquote(match.group(1) if match else Path(urllib.parse.urlsplit(url).path).name) or 'descarga'
    name = re.sub(r'[\\/:*?"<>|]+', '_', name).strip() or 'descarga'
    return name


def kind_of(path):
    """Tipo real del archivo por su contenido (no por la extensión)."""
    path = Path(path)
    with open(path, 'rb') as f:
        head = f.read(8)
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 512))
        tail = f.read(512)
    if head.startswith(b'PK'):
        return 'zip'
    if head.startswith(b'MZ'):
        return 'msi' if path.suffix.lower() == '.msi' else 'exe'
    if head.startswith(b'\xd0\xcf\x11\xe0'):
        return 'msi'
    if head.startswith(b'xar!'):
        return 'pkg'
    if b'koly' in tail or path.suffix.lower() == '.dmg':
        return 'dmg'
    return 'otro'


def exe_flags(path):
    """Instalación silenciosa si se reconoce el instalador (Inno Setup o NSIS); si no, se abre normal."""
    try:
        with open(path, 'rb') as f:
            data = f.read(6 * 1024 * 1024)
    except OSError:
        return []
    if b'Inno Setup' in data:
        return ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-']
    if b'Nullsoft' in data or b'NSIS' in data:
        return ['/S']
    return []


def safe_extract(archive, target):
    target = Path(target).resolve()
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            dest = (target / member.filename).resolve()
            if not str(dest).startswith(str(target)):
                raise ValueError('El .zip tiene rutas inválidas.')
        z.extractall(target)
        # Los bundles de Mac dentro de un .zip pierden el permiso de ejecución: se restaura.
        for member in z.infolist():
            mode = member.external_attr >> 16
            if mode & 0o111:
                try:
                    os.chmod(target / member.filename, mode & 0o777)
                except OSError:
                    pass


def collect(folder, find_plugins, platform=None):
    """Plugins sueltos e instaladores dentro de una carpeta ya extraída."""
    platform = platform or sys.platform
    plugins = [p for p in find_plugins(folder) if '__MACOSX' not in p.parts]
    if platform == 'win32':
        # Las versiones de 32 bits no sirven en un DAW de 64 bits y tienen el mismo nombre.
        bits32 = {'x86', '32bit', '32-bit', '32 bit', 'win32', 'vst32', '32'}
        plugins = [p for p in plugins if not any(part.lower() in bits32 for part in p.relative_to(folder).parts[:-1])]
    installers = []
    for path in Path(folder).rglob('*'):
        if '__MACOSX' in path.parts or any(str(path).startswith(str(p)) for p in plugins):
            continue
        suffix = path.suffix.lower()
        if platform == 'win32' and suffix in ('.exe', '.msi') and path.is_file() and 'uninst' not in path.name.lower():
            installers.append(path)
        elif platform == 'darwin' and suffix in ('.pkg', '.mpkg'):
            if not any(str(path).startswith(str(i) + os.sep) for i in installers):
                installers.append(path)
        elif platform == 'darwin' and suffix == '.dmg' and path.is_file():
            installers.append(path)
    # Un instalador de Windows suele traer todos los formatos: si hay instalador no se copian sueltos repetidos.
    return plugins, installers


def run_installers(installers, platform=None):
    """Ejecuta los instaladores con un único pedido de permiso. Devuelve True si terminaron."""
    platform = platform or sys.platform
    if not installers:
        return True
    if platform == 'win32':
        quote = lambda p: "'" + str(p).replace("'", "''") + "'"
        lines = ['$ErrorActionPreference = "Continue"']
        for path in installers:
            if Path(path).suffix.lower() == '.msi':
                lines.append(f"Start-Process msiexec.exe -Wait -ArgumentList @('/i', {quote(path)}, '/qb', '/norestart')")
            else:
                flags = exe_flags(path)
                args = f" -ArgumentList @({', '.join(quote(f) for f in flags)})" if flags else ''
                lines.append(f'Start-Process -FilePath {quote(path)}{args} -Wait')
        script = Path(tempfile.gettempdir()) / f'audiotaller-instalar-{uuid.uuid4().hex[:8]}.ps1'
        script.write_text('\r\n'.join(lines), encoding='utf-8-sig')
        command = (f"Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden "
                   f"-ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"{script}\"'")
        try:
            done = subprocess.run(['powershell', '-NoProfile', '-Command', command], capture_output=True,
                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            return done.returncode == 0
        finally:
            script.unlink(missing_ok=True)
    if platform == 'darwin':
        sh = lambda p: "'" + str(p).replace("'", "'\\''") + "'"
        parts = [f'/usr/sbin/installer -pkg {sh(p)} -target /' for p in installers]
        script = ' ; '.join(parts).replace('\\', '\\\\').replace('"', '\\"')
        done = subprocess.run(['/usr/bin/osascript', '-e', f'do shell script "{script}" with administrator privileges'], capture_output=True)
        return done.returncode == 0
    return False


class Mount:
    """Monta un .dmg en solo lectura y lo desmonta al salir."""
    def __init__(self, dmg):
        self.dmg, self.point = dmg, Path(tempfile.mkdtemp(prefix='audiotaller-dmg-'))

    def __enter__(self):
        subprocess.run(['/usr/bin/hdiutil', 'attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', str(self.point), str(self.dmg)],
                       check=True, capture_output=True, input=b'Y\n')
        return self.point

    def __exit__(self, *exc):
        subprocess.run(['/usr/bin/hdiutil', 'detach', str(self.point), '-force'], capture_output=True)
        shutil.rmtree(self.point, ignore_errors=True)


def prepare(path, work, find_plugins, platform=None):
    """De un archivo descargado obtiene plugins sueltos e instaladores listos (copiados a la carpeta de trabajo)."""
    platform = platform or sys.platform
    kind = kind_of(path)
    if kind == 'zip':
        target = Path(work) / ('x-' + uuid.uuid4().hex[:6])
        safe_extract(path, target)
        plugins, installers = collect(target, find_plugins, platform)
        extra_plugins, final = [], []
        for item in installers:
            if item.suffix.lower() == '.dmg':
                p, i = prepare(item, work, find_plugins, platform)
                extra_plugins += p
                final += i
            else:
                final.append(item)
        if final and platform == 'win32':
            plugins = []  # el instalador ya trae los plugins
        return plugins + extra_plugins, final
    if kind in ('exe', 'msi'):
        return [], [path] if platform == 'win32' else []
    if kind == 'pkg':
        return [], [path] if platform == 'darwin' else []
    if kind == 'dmg' and platform == 'darwin':
        copy = Path(work) / ('dmg-' + uuid.uuid4().hex[:6])
        with Mount(path) as point:
            plugins, installers = collect(point, find_plugins, platform)
            copy.mkdir(parents=True)
            out_plugins, out_installers = [], []
            for item in plugins + installers:
                dest = copy / item.name
                if item.is_dir():
                    shutil.copytree(item, dest, symlinks=True)
                else:
                    shutil.copy2(item, dest)
                (out_installers if item in installers else out_plugins).append(dest)
        return out_plugins, out_installers
    raise ValueError('No reconozco el archivo descargado.')


class Jobs:
    """Instalaciones en segundo plano, con el progreso que consulta la interfaz."""
    def __init__(self):
        self.items, self.lock = {}, threading.Lock()

    def start(self, names, worker):
        job_id = uuid.uuid4().hex[:10]
        state = dict(id=job_id, estado='trabajando', paso='Preparando…', plugins=[dict(nombre=n, estado='en espera', detalle='') for n in names],
                     instalados=[], omitidos=[])
        with self.lock:
            self.items[job_id] = state
        threading.Thread(target=self._run, args=(state, worker), daemon=True).start()
        return state

    def _run(self, state, worker):
        try:
            worker(state)
            state['estado'] = 'listo'
        except Exception as error:  # el detalle queda visible para el usuario
            state['estado'] = 'error'
            state['paso'] = str(error)

    def get(self, job_id):
        with self.lock:
            return self.items.get(job_id)
