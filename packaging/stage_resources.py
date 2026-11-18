"""Verifica el contenido de distribución sin depender de carpetas de OneDrive.

Se copian los recursos como archivos explícitos y se comprueba cada hash.
Nunca se recorren los datos de AppData ni la instalación del desarrollador.
"""
import hashlib,json,shutil,sys
from pathlib import Path

def stage(destination):
    repo=Path(__file__).resolve().parents[1]
    package=Path(destination).resolve();internal=package/'_internal'
    config=json.loads((repo/'artist_web/public/config.json').read_text(encoding='utf-8'))
    if any(config.values()):raise ValueError('La configuración de distribución debe estar vacía.')
    manifest={}
    for name in ('static','artist_web','docs'):
        for source in (repo/name).rglob('*'):
            if not source.is_file():continue
            if source.suffix.lower() in ('.dpapi','.sqlite3','.db','.wav','.mp3'):
                raise ValueError('Archivo personal en la distribución: '+str(source.relative_to(repo)))
            relative=source.relative_to(repo);target=internal/relative
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)
            original=hashlib.sha256(source.read_bytes()).hexdigest()
            assert hashlib.sha256(target.read_bytes()).hexdigest()==original,relative
            manifest[str(relative).replace('\\','/')]=original
    (internal/'recursos-verificados.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('Recursos verificados:',len(manifest))

if __name__=='__main__':stage(sys.argv[1])
