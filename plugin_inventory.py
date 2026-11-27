"""Inventario de plugins de audio instalados y a qué central de licencias pertenece cada uno.

Solo lee: nunca modifica, mueve ni borra plugins instalados.
"""
import json
import os
import plistlib
import re
import sys
from pathlib import Path

# Formato -> extensión del plugin. Los bundles (carpetas) se tratan como una unidad.
EXTENSIONS = {'.vst3': 'VST3', '.clap': 'CLAP', '.component': 'AU', '.vst': 'VST2', '.aaxplugin': 'AAX'}
WINDOWS_VST2 = '.dll'

# Cómo se reinstala cada familia. «central»: programa del fabricante que instala y activa.
# «ilok»: licencia en iLok (se mueve con iLok License Manager). «clave»: instalador del sitio + tu número de serie.
VENDORS = [
    ('waves', 'Waves', r'waves|waveshell', 'central', 'Waves Central', 'https://www.waves.com/downloads/central'),
    ('arturia', 'Arturia', r'arturia', 'central', 'Arturia Software Center', 'https://www.arturia.com/support/downloads-manuals'),
    ('ni', 'Native Instruments', r'native ?instruments|\bkontakt|\bmassive|\breaktor|\bbattery ?4|\bguitar ?rig|\bfm8\b|\bmonark|\bsuper ?8|komplete|maschine', 'central', 'Native Access', 'https://www.native-instruments.com/en/specials/native-access/'),
    ('izotope', 'iZotope', r'izotope|ozone|neutron|nectar|\brx ?\d|trash|vinyl|\bvocalsynth|insight', 'central', 'Native Access', 'https://www.native-instruments.com/en/specials/native-access/'),
    ('pa', 'Plugin Alliance / Brainworx', r'plugin ?alliance|brainworx|\bbx_|\bbx |shadow ?hills|\bspl\b|lindell|elysia|maag|ampeg svt|black box', 'central', 'Plugin Alliance Installation Manager', 'https://www.plugin-alliance.com/en/installation-manager.html'),
    ('uad', 'Universal Audio', r'universal ?audio|\buad|\bua ', 'central', 'UA Connect', 'https://www.uaudio.com/uad-plugins/ua-connect.html'),
    ('softube', 'Softube', r'softube', 'central', 'Softube Central', 'https://www.softube.com/softube-central'),
    ('slate', 'Slate Digital', r'slate ?digital|\bvmr\b|virtual ?mix ?rack|\bfg-|\bvirtual ?(tape|console|buss)', 'central', 'Slate Digital Connect', 'https://slatedigital.com/connect/'),
    ('spitfire', 'Spitfire Audio', r'spitfire|\blabs\b', 'central', 'Spitfire Audio App', 'https://www.spitfireaudio.com/info/library-manager/'),
    ('toontrack', 'Toontrack', r'toontrack|superior ?drummer|\bezdrummer|\bezkeys|\bezbass|\bezmix', 'central', 'Toontrack Product Manager', 'https://www.toontrack.com/product-manager/'),
    ('xln', 'XLN Audio', r'xln|addictive ?(drums|keys)|\brc-20|\brc20|\bxo\b', 'central', 'XLN Online Installer', 'https://www.xlnaudio.com/installers'),
    ('ik', 'IK Multimedia', r'ik ?multimedia|amplitube|t-racks|sampletank|tonex|\bmodo ', 'central', 'IK Product Manager', 'https://www.ikmultimedia.com/products/productmanager/'),
    ('antares', 'Antares', r'antares|auto-?tune', 'central', 'Antares Central', 'https://www.antarestech.com/antares-central'),
    ('steinberg', 'Steinberg', r'steinberg|halion|groove ?agent|retrologue|padshop|backbone|spectralayers', 'central', 'Steinberg Download Assistant', 'https://www.steinberg.net/download-assistant/'),
    ('melda', 'MeldaProduction', r'melda', 'central', 'MPluginManager', 'https://www.meldaproduction.com/downloads'),
    ('soundtoys', 'Soundtoys', r'soundtoys|echoboy|decapitator|little ?alterboy|crystallizer|primaltap|microshift|effectrack', 'ilok', 'iLok License Manager', 'https://www.soundtoys.com/download/'),
    ('eventide', 'Eventide', r'eventide|h3000|blackhole|\bh910|\bmicropitch|ultratap', 'ilok', 'iLok License Manager', 'https://www.eventideaudio.com/downloads/'),
    ('mcdsp', 'McDSP', r'mcdsp', 'ilok', 'iLok License Manager', 'https://www.mcdsp.com/downloads/'),
    ('sonnox', 'Sonnox', r'sonnox|oxford', 'ilok', 'iLok License Manager', 'https://www.sonnox.com/downloads'),
    ('avid', 'Avid', r'\bavid\b|pro ?tools', 'ilok', 'iLok License Manager', 'https://www.avid.com/products/avid-link'),
    ('fabfilter', 'FabFilter', r'fabfilter|\bpro-(q|c|l|r|mb|ds|g)\b|\bsaturn ?2|\btimeless ?3|\bvolcano ?3|\btwin ?3|\bsimplon', 'clave', 'Instalador de FabFilter + tu licencia', 'https://www.fabfilter.com/download'),
    ('valhalla', 'Valhalla DSP', r'valhalla', 'clave', 'Instalador de Valhalla + tu licencia', 'https://valhalladsp.com/my-account/'),
    ('xfer', 'Xfer Records', r'xfer|serum|ott\b|lfo ?tool|cthulhu', 'clave', 'Instalador de Xfer + tu cuenta', 'https://xferrecords.com/'),
    ('uhe', 'u-he', r'\bu-he|diva|zebra|repro|hive|satin|presswerk|bazille|\bace\b|uhbik', 'clave', 'Instalador de u-he + tu número de serie', 'https://u-he.com/products/'),
    ('kilohearts', 'Kilohearts', r'kilohearts|phase ?plant|snap ?heap|multipass', 'central', 'Kilohearts Installer', 'https://kilohearts.com/download'),
    ('celemony', 'Celemony', r'celemony|melodyne', 'clave', 'Instalador de Melodyne + tu licencia', 'https://www.celemony.com/en/service1/downloads'),
    ('output', 'Output', r'\boutput\b|\barcade\b|\bportal\b|\bmovement\b|\bthermal\b|\bexhale\b', 'central', 'Output Hub', 'https://output.com/hub'),
]
# Fabricantes de plugins gratuitos conocidos: se pueden copiar sin licencia.
FREE = re.compile(r'airwindows|analog ?obsession|tal-noisemaker|vital|surge|dexed|tdr ?nova|tdr ?kotelnikov|klanghelm ?dc1a|spitfire ?labs|supermassive|freq ?echo|space ?modulator|ott\b|span\b|youlean|mvmeter|melda.*free|ozone ?imager|vinyl\b|cardinal|odin ?2|helm\b|ample ?(guitar|bass) ?m? ?lite|bluecat', re.I)


def plugin_roots(platform=None, environ=None, home=None):
    """Carpetas estándar de plugins, con su formato y si se escriben como usuario o como administrador."""
    platform = platform or sys.platform
    environ = os.environ if environ is None else environ
    home = Path.home() if home is None else Path(home)
    roots = []
    if platform == 'win32':
        common = Path(environ.get('CommonProgramFiles', r'C:\Program Files\Common Files'))
        program = Path(environ.get('ProgramFiles', r'C:\Program Files'))
        local = Path(environ.get('LOCALAPPDATA', home / 'AppData' / 'Local'))
        roots += [('vst3', 'VST3', common / 'VST3', 'admin'), ('vst3-user', 'VST3', local / 'Programs' / 'Common' / 'VST3', 'user'),
                  ('clap', 'CLAP', common / 'CLAP', 'admin'), ('clap-user', 'CLAP', local / 'Programs' / 'Common' / 'CLAP', 'user'),
                  ('aax', 'AAX', common / 'Avid' / 'Audio' / 'Plug-Ins', 'admin')]
        vst2 = [program / 'VSTPlugins', program / 'Steinberg' / 'VSTPlugins', common / 'VST2', common / 'Steinberg' / 'VST2']
        vst2 += windows_registry_vst2()
        seen = set()
        for index, folder in enumerate(vst2):
            key = str(folder).lower().rstrip('\\/')
            if key not in seen:
                seen.add(key)
                roots.append((f'vst2-{index}', 'VST2', Path(folder), 'admin'))
    elif platform == 'darwin':
        for scope, base in (('', Path('/Library/Audio/Plug-Ins')), ('-user', home / 'Library' / 'Audio' / 'Plug-Ins')):
            access = 'user' if scope else 'admin'
            roots += [('au' + scope, 'AU', base / 'Components', access), ('vst2' + scope, 'VST2', base / 'VST', access),
                      ('vst3' + scope, 'VST3', base / 'VST3', access), ('clap' + scope, 'CLAP', base / 'CLAP', access)]
        roots.append(('aax', 'AAX', Path('/Library/Application Support/Avid/Audio/Plug-Ins'), 'admin'))
    else:
        roots += [('vst3-user', 'VST3', home / '.vst3', 'user'), ('clap-user', 'CLAP', home / '.clap', 'user'),
                  ('vst2-user', 'VST2', home / '.vst', 'user')]
    return roots


def windows_registry_vst2():
    if sys.platform != 'win32':
        return []
    import winreg
    found = []
    for view in (r'SOFTWARE\VST', r'SOFTWARE\WOW6432Node\VST'):
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, view) as key:
                value, _ = winreg.QueryValueEx(key, 'VSTPluginsPath')
                if value:
                    found.append(Path(os.path.expandvars(value)))
        except OSError:
            continue
    return found


def bundle_size(path):
    if path.is_file():
        return path.stat().st_size
    total = 0
    for folder, _, names in os.walk(path):
        for name in names:
            try:
                total += (Path(folder) / name).lstat().st_size
            except OSError:
                pass
    return total


def read_vendor_metadata(path):
    """Fabricante declarado por el propio plugin (moduleinfo.json de VST3, Info.plist en Mac, recurso de versión en Windows)."""
    if path.is_dir():
        info = path / 'Contents' / 'Resources' / 'moduleinfo.json'
        if info.is_file():
            try:
                data = json.loads(re.sub(r',\s*([}\]])', r'\1', info.read_text(encoding='utf-8', errors='replace')))
                vendor = (data.get('Factory Info') or {}).get('Vendor') or ''
                if vendor:
                    return vendor
            except (ValueError, OSError):
                pass
        plist = path / 'Contents' / 'Info.plist'
        if plist.is_file():
            try:
                data = plistlib.loads(plist.read_bytes())
                for key in ('NSHumanReadableCopyright', 'CFBundleGetInfoString', 'CFBundleIdentifier'):
                    if data.get(key):
                        return str(data[key])
            except Exception:
                pass
        if sys.platform == 'win32':
            for dll in (path / 'Contents' / 'x86_64-win').glob('*.vst3'):
                return windows_company(dll)
    elif sys.platform == 'win32' and path.suffix.lower() in ('.dll', '.vst3', '.clap'):
        return windows_company(path)
    return ''


def windows_company(path):
    try:
        import ctypes
        from ctypes import wintypes
        version = ctypes.windll.version
        size = version.GetFileVersionInfoSizeW(str(path), None)
        if not size:
            return ''
        buffer = ctypes.create_string_buffer(size)
        version.GetFileVersionInfoW(str(path), 0, size, buffer)
        pointer, length = ctypes.c_void_p(), wintypes.UINT()
        version.VerQueryValueW(buffer, r'\VarFileInfo\Translation', ctypes.byref(pointer), ctypes.byref(length))
        lang, codepage = ctypes.cast(pointer, ctypes.POINTER(ctypes.c_ushort * 2)).contents if length.value else (0x0409, 0x04B0)
        text = ctypes.c_wchar_p()
        if version.VerQueryValueW(buffer, rf'\StringFileInfo\{lang:04x}{codepage:04x}\CompanyName', ctypes.byref(text), ctypes.byref(length)) and length.value:
            return text.value or ''
    except Exception:
        return ''
    return ''


def classify(name, vendor_text, folder_hint=''):
    """Devuelve el fabricante conocido y cómo se reinstala."""
    sample = ' '.join(filter(None, (vendor_text, folder_hint, name)))
    if FREE.search(sample):
        return dict(fabricante=clean_vendor(vendor_text) or folder_hint or '—', licencia='gratis', central='', enlace='')
    for key, label, pattern, kind, manager, url in VENDORS:
        if re.search(pattern, vendor_text or '', re.I) or re.search(pattern, folder_hint or '', re.I):
            return dict(fabricante=label, licencia=kind, central=manager, enlace=url, clave=key)
    for key, label, pattern, kind, manager, url in VENDORS:
        if key == 'melda':
            continue
        if re.search(pattern, name, re.I):
            return dict(fabricante=label, licencia=kind, central=manager, enlace=url, clave=key)
    return dict(fabricante=clean_vendor(vendor_text) or folder_hint or 'Sin identificar', licencia='desconocida', central='', enlace='')


def clean_vendor(text):
    text = re.sub(r'(?i)copyright|\(c\)|©|all rights reserved\.?|\d{4}(-\d{4})?', '', text or '')
    if re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+){2,}', text.strip(), re.I):  # com.fabricante.plugin
        return text.strip().split('.')[1].capitalize()
    return text.strip(' ,.-')[:60]


def walk_plugins(root, fmt):
    """Recorre una carpeta de plugins sin entrar en los bundles."""
    found = []
    if not root.is_dir():
        return found
    wanted = {ext for ext, kind in EXTENSIONS.items() if kind == fmt}
    if fmt == 'VST2' and sys.platform == 'win32':
        wanted.add(WINDOWS_VST2)
    for folder, dirs, names in os.walk(root, followlinks=False):
        current = Path(folder)
        keep = []
        for name in dirs:
            path = current / name
            if path.suffix.lower() in wanted:
                found.append(path)
            elif not path.is_symlink():
                keep.append(name)
        dirs[:] = keep
        for name in names:
            path = current / name
            if path.suffix.lower() in wanted:
                found.append(path)
    return found


def scan(roots=None):
    """Plugins instalados en esta computadora."""
    items = []
    for key, fmt, root, access in roots or plugin_roots():
        for path in walk_plugins(Path(root), fmt):
            relative = path.relative_to(root)
            hint = relative.parts[0] if len(relative.parts) > 1 else ''
            vendor = read_vendor_metadata(path)
            info = classify(path.stem, vendor, hint)
            copyable = fmt != 'AAX' and info['licencia'] in ('gratis', 'desconocida', 'clave')
            items.append(dict(id=f'{key}:{relative.as_posix()}', nombre=path.stem, formato=fmt, raiz=key, relativo=relative.as_posix(),
                              ruta=str(path), acceso=access, tamano=bundle_size(path), copiable=copyable,
                              version=read_version(path), modificado=binary_mtime(path),
                              copiar=copyable and info['licencia'] in ('gratis', 'desconocida'), **info))
    items.sort(key=lambda x: (x['fabricante'].lower(), x['nombre'].lower(), x['formato']))
    return items


def summarize(items):
    """Agrupa por central para armar la lista de reinstalación."""
    groups = {}
    for item in items:
        if item['licencia'] in ('central', 'ilok', 'clave'):
            key = item['central']
        else:
            key = 'Copiados por AudioTaller' if item.get('copiar') else 'Instalar a mano'
        group = groups.setdefault(key, dict(central=key, licencia=item['licencia'] if item['licencia'] in ('central', 'ilok', 'clave') else 'copia',
                                            enlace=item.get('enlace', ''), fabricantes=set(), plugins=[]))
        group['fabricantes'].add(item['fabricante'])
        group['plugins'].append(item)
    order = {'central': 0, 'ilok': 1, 'clave': 2, 'copia': 3}
    result = []
    for group in sorted(groups.values(), key=lambda g: (order.get(g['licencia'], 4), g['central'].lower())):
        group['fabricantes'] = sorted(group['fabricantes'])
        result.append(group)
    return result


def compare(previous, installed):
    """Qué plugins de la computadora vieja ya están en esta."""
    have = {(p['formato'], p['nombre'].lower()) for p in installed}
    return [dict(p, instalado=(p['formato'], p['nombre'].lower()) in have) for p in previous]


def read_version(path):
    """Versión declarada por el plugin, si la tiene (moduleinfo.json o Info.plist)."""
    try:
        if path.is_dir():
            info = path / 'Contents' / 'Resources' / 'moduleinfo.json'
            if info.is_file():
                data = json.loads(re.sub(r',\s*([}\]])', r'\1', info.read_text(encoding='utf-8', errors='replace')))
                if data.get('Version'):
                    return str(data['Version'])[:20]
            plist = path / 'Contents' / 'Info.plist'
            if plist.is_file():
                data = plistlib.loads(plist.read_bytes())
                return str(data.get('CFBundleShortVersionString') or data.get('CFBundleVersion') or '')[:20]
    except Exception:
        return ''
    return ''


def binary_mtime(path):
    """Fecha del binario del plugin (en un bundle, la del ejecutable de adentro)."""
    try:
        if path.is_dir():
            for sub in ('x86_64-win', 'MacOS', 'arm64-win', 'x86-win'):
                folder = path / 'Contents' / sub
                if folder.is_dir():
                    times = [f.stat().st_mtime for f in folder.iterdir() if f.is_file() or f.suffix]
                    if times:
                        return max(times)
        return path.stat().st_mtime
    except OSError:
        return 0


COPY_MARK = re.compile(r'(?i)(\s*[-_ ]?(\(\d+\)|copy|copia|\d+ ?copy|- copia|\(x64\)|x64|_64|64[- ]?bit|\(64[- ]?bit\)))+$')


def duplicate_key(name):
    base = COPY_MARK.sub('', name.strip())
    return re.sub(r'[\s_\-.]+', '', base.lower())


def version_tuple(text):
    return tuple(int(n) for n in re.findall(r'\d+', text or '')[:4])


def find_duplicates(items):
    """Plugins repetidos dentro de un mismo formato (no cuenta el mismo plugin en VST3 y en AU).

    Sugiere conservar la versión más nueva; ante empate, la de fecha más reciente.
    """
    groups = {}
    for item in items:
        groups.setdefault((item['formato'], duplicate_key(item['nombre'])), []).append(item)
    out = []
    for (fmt, _), group in groups.items():
        if len(group) < 2:
            continue
        # Versión declarada; si empatan, la fecha (por día: copiar un archivo conserva su fecha);
        # después, el que no tiene marca de copia («(1)», «copy») y la ruta más corta.
        ranked = sorted(group, key=lambda i: (version_tuple(i.get('version')), int((i.get('modificado') or 0) // 86400),
                                              not COPY_MARK.search(i['nombre']), -len(i['relativo'])), reverse=True)
        keep = ranked[0]
        clean = min((COPY_MARK.sub('', i['nombre']).strip() or i['nombre'] for i in ranked), key=len)
        out.append(dict(formato=fmt, nombre=clean, conservar=keep['id'],
                        copias=[dict(i, sugerido=i['id'] == keep['id']) for i in ranked],
                        espacio=sum(i['tamano'] for i in ranked[1:]),
                        central=next((i['central'] for i in ranked if i['licencia'] in ('central', 'ilok')), '')))
    out.sort(key=lambda g: (g['nombre'].lower(), g['formato']))
    return out
