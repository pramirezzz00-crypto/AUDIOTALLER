"""Rutas por usuario y apertura nativa sin intérprete de comandos."""
import os
import sys
import subprocess
from pathlib import Path


def data_directory(platform=None, environ=None, home=None):
    platform = platform or sys.platform
    environ = os.environ if environ is None else environ
    home = Path.home() if home is None else Path(home)
    if platform == 'darwin':
        return home / 'Library' / 'Application Support' / 'AudioTaller'
    if platform == 'win32':
        return Path(environ.get('LOCALAPPDATA', home)) / 'AudioTaller'
    return Path(environ.get('XDG_DATA_HOME', home / '.local' / 'share')) / 'AudioTaller'


def open_path(path):
    if sys.platform == 'darwin':
        return subprocess.Popen(['/usr/bin/open', str(path)], shell=False)
    if os.name == 'nt':
        return os.startfile(str(path))
    return subprocess.Popen(['xdg-open', str(path)], shell=False)


def reveal_path(path):
    """Abre el explorador (o el Finder) en la carpeta del elemento y lo deja seleccionado."""
    path = os.path.normpath(str(path))
    if sys.platform == 'darwin':
        return subprocess.Popen(['/usr/bin/open', '-R', path], shell=False)
    if os.name == 'nt':
        # explorer.exe trae la ventana al frente; os.startfile puede abrirla detrás de AudioTaller.
        return subprocess.Popen(['explorer.exe', '/select,', path], shell=False)
    return subprocess.Popen(['xdg-open', os.path.dirname(path)], shell=False)


def launch_daw(executable, project, folder):
    if sys.platform == 'darwin' and Path(executable).suffix.lower() == '.app':
        return subprocess.Popen(['/usr/bin/open', '-a', str(executable), str(project)], shell=False, cwd=str(folder))
    return subprocess.Popen([str(executable), str(project)], shell=False, cwd=str(folder))
