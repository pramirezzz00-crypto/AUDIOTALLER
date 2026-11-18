"""Incorpora los avisos de los componentes del entorno de compilación."""
import importlib.metadata as metadata
import shutil
import sys
from pathlib import Path

def collect(destination):
    target=Path(destination)/'_internal'/'third_party';target.mkdir(parents=True,exist_ok=True)
    lines=['Componentes de terceros incluidos en AudioTaller','']
    for dist in sorted(metadata.distributions(),key=lambda d:d.metadata.get('Name','').lower()):
        name=dist.metadata.get('Name','sin-nombre')
        if name.lower() in ('pyinstaller-hooks-contrib','pefile','altgraph','pywin32-ctypes'):continue
        lines.append(name+' '+dist.version)
        folder=target/name;folder.mkdir(exist_ok=True)
        (folder/'METADATA.txt').write_text(dist.read_text('METADATA') or name,encoding='utf-8')
        for file in dist.files or []:
            if any(word in file.name.lower() for word in ('license','copying','notice')) and '.py' not in file.name and dist.locate_file(file).is_file():
                # Se conserva la ubicación relativa para no colisionar licencias.
                output=folder/Path(str(file))
                if not output.resolve().is_relative_to(folder.resolve()):output=folder/file.name
                output.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(dist.locate_file(file),output)
    python_license=Path(sys.base_prefix)/'LICENSE.txt'
    if python_license.exists():shutil.copy2(python_license,target/'Python-LICENSE.txt')
    (target/'COMPONENTES.txt').write_text('\n'.join(lines),encoding='utf-8')

if __name__=='__main__':collect(sys.argv[1])
