"""Integración de DAW instalados y registro estable de revisiones de sesión."""
import base64
import hashlib
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from flask import jsonify, request, Response
from management import required_row
from migrations import LEGACY_STAGE

DAW_SPECS = (
    ('Cubase','.cpr',('Steinberg/Cubase*/Cubase*.exe',)),
    ('REAPER','.rpp',('REAPER (x64)/reaper.exe','REAPER/reaper.exe')),
    ('Nuendo','.npr',('Steinberg/Nuendo*/Nuendo*.exe',)),
    ('Studio One','.song',('PreSonus/Studio One*/Studio One.exe',)),
    ('Pro Tools','.ptx',('Avid/Pro Tools/ProTools.exe',)),
    ('FL Studio','.flp',('Image-Line/FL Studio*/FL64.exe',)),
    ('Ableton Live','.als',('Ableton/Live*/Program/Ableton Live*.exe',)),
    ('WaveLab','.wpr',('Steinberg/WaveLab*/WaveLab*.exe',)),
)


def path_key(path):
    return str(Path(path).resolve()).casefold()


def group_key(sid, stage, path):
    return '|'.join((sid, LEGACY_STAGE.get(stage,stage), path_key(Path(path).parent), Path(path).suffix.lower()))


def file_date(path):
    try:
        stat = Path(path).stat()
        # Windows ofrece fecha de creación. En otros sistemas se usa modificación, no ctime.
        birth = getattr(stat,'st_birthtime', None)
        return (birth if birth is not None else stat.st_mtime), ('creación del archivo' if birth is not None else 'modificación del archivo')
    except OSError:
        return None, 'orden de registro; archivo no disponible'


def ensure_revisions(db, sid):
    """Los números ya asignados no cambian al aparecer archivos más antiguos o desconectarse un disco."""
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    rows = db.execute("""SELECT s.* FROM sesiones s LEFT JOIN revision_sesion r ON r.sesion_id=s.id
                         WHERE s.cancion_id=? AND r.sesion_id IS NULL ORDER BY s.creado,s.rowid""",(sid,)).fetchall()
    pending = []
    for row in rows:
        date, criterion = file_date(row['ruta'])
        pending.append((date if date is not None else float('inf'), row['ruta'].casefold(), row, criterion))
    for _, _, row, criterion in sorted(pending,key=lambda item:(item[0],item[1])):
        group = group_key(sid,row['etapa'],row['ruta'])
        existing = db.execute("""SELECT r.numero,s.ruta FROM revision_sesion r JOIN sesiones s ON s.id=r.sesion_id WHERE r.grupo=?""",(group,)).fetchall()
        same = next((item['numero'] for item in existing if path_key(item['ruta'])==path_key(row['ruta'])),None)
        number = same if same is not None else max((item['numero'] for item in existing),default=0)+1
        date, _ = file_date(row['ruta'])
        db.execute('INSERT INTO revision_sesion VALUES(?,?,?,?,?,?)',(row['id'],number,group,None,date,criterion))


def installed_daws(db):
    roots = list(dict.fromkeys(Path(os.environ[key]) for key in ('ProgramFiles','ProgramFiles(x86)','ProgramData') if os.environ.get(key)))
    found = {}
    for name,extension,patterns in DAW_SPECS:
        for root in roots:
            for pattern in patterns:
                for executable in sorted(root.glob(pattern),reverse=True):
                    if not executable.is_file():
                        continue
                    key = hashlib.sha256(path_key(executable).encode()).hexdigest()[:20]
                    found[key] = dict(id=key,nombre=name,ejecutable=str(executable),extension=extension,plantilla='')
    for row in db.execute('SELECT * FROM preferencias_daw'):
        if Path(row['ejecutable']).is_file():
            found[row['id']] = dict(row)
    for item in found.values():
        templates = []
        # Las plantillas del fabricante son proyectos nativos, no archivos vacíos con extensión falsa.
        directory = Path(item['ejecutable']).parent/'Project Templates'
        if directory.is_dir():
            for path in sorted(directory.rglob('*'+item['extension'])):
                if path.is_file():
                    templates.append(dict(ruta=str(path),nombre=str(path.relative_to(directory))))
        item['plantillas'] = templates
        item['vacio'] = item['extension']=='.rpp'
    return sorted(found.values(),key=lambda item:(item['nombre'],item['ejecutable']))


def copy_exclusive(source, target):
    """Reserva un nombre y copia una instantánea. Un DAW guardando simultáneamente provoca error."""
    before = source.stat()
    try:
        with source.open('rb') as src, target.open('xb') as dst:
            shutil.copyfileobj(src,dst,1024*1024)
        after = source.stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
            raise ValueError('La sesión cambió durante la copia. Guardala y cerrala en el DAW antes de repetir.')
    except FileExistsError:
        raise
    except Exception:
        target.unlink(missing_ok=True)
        raise


def emit_event(db,sid,stage,kind,reference,detail):
    db.execute('INSERT INTO eventos(id,cancion_id,etapa,tipo,referencia,detalle) VALUES(?,?,?,?,?,?)',
               (uuid.uuid4().hex,sid,stage,kind,reference,detail))
    db.execute("""INSERT INTO estado_cancion(id) VALUES(?) ON CONFLICT(id)
                  DO UPDATE SET actualizado=CURRENT_TIMESTAMP""",(sid,))


def register_daw_operations(app,connect,safe_name):
    @app.get('/api/daw/instalados')
    def daws():
        with connect() as db:
            return jsonify(installed_daws(db))

    @app.get('/api/daw/<identity>/icono')
    def icon(identity):
        with connect() as db:
            daw = next((item for item in installed_daws(db) if item['id']==identity),None)
        if not daw:
            raise ValueError('El DAW no está disponible.')
        try:
            # pywebview ya depende de pythonnet. El icono proviene del ejecutable local.
            import clr
            clr.AddReference('System.Drawing')
            from System.Drawing import Icon
            from System.Drawing.Imaging import ImageFormat
            from System.IO import MemoryStream
            native = Icon.ExtractAssociatedIcon(daw['ejecutable'])
            try:
                bitmap = native.ToBitmap()
                stream = MemoryStream()
                try:
                    bitmap.Save(stream,ImageFormat.Png)
                    content = bytes(stream.ToArray())
                finally:
                    stream.Dispose()
                    bitmap.Dispose()
            finally:
                native.Dispose()
            return Response(content,mimetype='image/png')
        except Exception:
            initial = re.sub('[^A-Z0-9]','',daw['nombre'].upper())[:2]
            return Response('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="9" fill="#12434b"/><text x="24" y="30" text-anchor="middle" fill="#4ed8c1" font-size="18">'+initial+'</text></svg>',mimetype='image/svg+xml')

    @app.post('/api/daw/configurar')
    def configure():
        data=request.get_json() or {}
        executable=Path(data.get('ejecutable',''))
        extension=data.get('extension','').lower()
        name=data.get('nombre','').strip()
        if not executable.is_absolute() or not executable.is_file() or executable.suffix.lower()!='.exe':
            raise ValueError('Elegí el ejecutable .exe instalado del DAW.')
        if not name or len(name)>100 or not re.fullmatch(r'\.[a-z0-9]{1,10}',extension):
            raise ValueError('Indicá el nombre y extensión de proyecto del DAW, por ejemplo .cpr.')
        template=data.get('plantilla','').strip()
        if template and (not Path(template).is_file() or Path(template).suffix.lower()!=extension):
            raise ValueError('La plantilla debe ser un proyecto nativo existente de este DAW.')
        identity=hashlib.sha256(path_key(executable).encode()).hexdigest()[:20]
        with connect() as db:
            db.execute('INSERT OR REPLACE INTO preferencias_daw VALUES(?,?,?,?,?)',(identity,name,str(executable),extension,template))
        return jsonify(id=identity)

    @app.post('/api/produccion/<sid>/duplicar-sesion/<identity>')
    def duplicate(sid,identity):
        data=request.get_json() or {}
        name=data.get('nombre','').strip()
        if not name or len(name)>100 or safe_name(name)!=name or name in ('.','..'):
            raise ValueError('Ingresá un nombre válido de hasta 100 caracteres, sin extensión.')
        destination=None
        try:
            with connect() as db:
                original=required_row(db,'sesiones',identity)
                if original['cancion_id']!=sid:
                    raise ValueError('La sesión no pertenece a la canción.')
                from production import DAW_PROJECTS
                source=Path(original['ruta']).resolve()
                if not source.is_file() or source.suffix.lower() not in DAW_PROJECTS:
                    raise ValueError('Para duplicar elegí el archivo de proyecto DAW, por ejemplo un .cpr disponible.')
                stage=LEGACY_STAGE.get(original['etapa'],original['etapa'])
                db.execute('BEGIN IMMEDIATE')
                ensure_revisions(db,sid)
                group=group_key(sid,stage,source)
                number=db.execute('SELECT COALESCE(MAX(numero),0)+1 FROM revision_sesion WHERE grupo=?',(group,)).fetchone()[0]
                # Respeta también archivos que todavía no fueron registrados en AudioTaller.
                base=re.sub(r'(?i)[ _-]V\d+$','',name).strip() or name
                while True:
                    candidate=source.with_name(f'{base}_V{number:03d}{source.suffix}')
                    try:
                        copy_exclusive(source,candidate)
                        destination=candidate
                        break
                    except FileExistsError:
                        number+=1
                new_id=uuid.uuid4().hex
                db.execute('INSERT INTO sesiones(id,cancion_id,etapa,daw,ruta,comentario) VALUES(?,?,?,?,?,?)',
                           (new_id,sid,stage,original['daw'],str(destination),data.get('notas','')))
                db.execute('INSERT INTO sesion_info(id,nombre,modo) VALUES(?,?,?)',(new_id,destination.stem,'vinculada'))
                date,criterion=file_date(destination)
                db.execute('INSERT INTO revision_sesion VALUES(?,?,?,?,?,?)',(new_id,number,group,identity,date,criterion))
                db.execute('INSERT INTO versiones(id,sesion_id,ruta,comentario) VALUES(?,?,?,?)',
                           (new_id,identity,str(destination),data.get('notas','')))
                emit_event(db,sid,stage,'Archivo de sesión duplicado',new_id,str(source)+' → '+str(destination))
        except Exception:
            if destination:
                destination.unlink(missing_ok=True)
            raise
        return jsonify(id=new_id,ruta=str(destination),version=number),201

    @app.post('/api/produccion/<sid>/crear-en-daw')
    def new_daw_project(sid):
        data=request.get_json() or {}
        name=data.get('nombre','').strip()
        if not name or len(name)>100 or safe_name(name)!=name or name in ('.','..'):
            raise ValueError('Indicá un nombre válido de sesión sin extensión.')
        folder=None
        made_folder=False
        file=None
        try:
            with connect() as db:
                song=required_row(db,'canciones',sid)
                stage=required_stage(db,data.get('etapa'))
                daw=next((item for item in installed_daws(db) if item['id']==data.get('daw_id')),None)
                if not daw:
                    raise ValueError('El DAW elegido no está instalado o su ruta cambió.')
                template=data.get('plantilla','').strip() or daw['plantilla']
                if template and (not Path(template).is_absolute() or not Path(template).is_file() or Path(template).suffix.lower()!=daw['extension']):
                    raise ValueError('Seleccioná una plantilla de proyecto válida para este DAW.')
                if not template and not daw['vacio']:
                    raise ValueError('Este DAW necesita una plantilla de proyecto nativo. Elegí una de sus plantillas o un proyecto vacío guardado desde el DAW.')
                identity=uuid.uuid4().hex
                if data.get('ruta','').strip():
                    parent=Path(data['ruta'].strip())
                    if not parent.is_absolute() or not parent.is_dir():
                        raise ValueError('Elegí una carpeta de destino disponible.')
                    folder=parent/(safe_name(name)+'-'+identity[:8])
                else:
                    parent=Path(song['carpeta']).resolve()
                    folder=parent/stage['carpeta']/'Sesiones'/('AT-'+identity[:12])
                    if not folder.resolve().is_relative_to(parent):
                        raise ValueError('La carpeta administrada apunta fuera de la canción.')
                folder.mkdir(parents=True,exist_ok=False)
                made_folder=True
                file=folder/(name+'_V001'+daw['extension'])
                if template:
                    copy_exclusive(Path(template),file)
                else:
                    file.write_text('<REAPER_PROJECT 0.1 7.0 1\n  SAMPLERATE 48000\n  TEMPO 120\n>\n',encoding='utf8')
                db.execute('INSERT INTO sesiones(id,cancion_id,etapa,daw,ruta,comentario) VALUES(?,?,?,?,?,?)',
                           (identity,sid,stage['clave'],daw['nombre'],str(file),data.get('notas','')))
                db.execute('INSERT INTO sesion_info(id,nombre,modo) VALUES(?,?,?)',(identity,file.stem,'administrada' if not data.get('ruta') else 'vinculada'))
                date,criterion=file_date(file)
                db.execute('INSERT INTO revision_sesion VALUES(?,?,?,?,?,?)',(identity,1,group_key(sid,stage['clave'],file),None,date,criterion))
                emit_event(db,sid,stage['clave'],'Proyecto DAW creado',identity,str(file))
        except Exception:
            if made_folder:
                if file:file.unlink(missing_ok=True)
                folder.rmdir()
            raise
        # El guardado y el registro ya están confirmados. Un error al abrir no pierde la sesión.
        warning=''
        try:
            subprocess.Popen([daw['ejecutable'],str(file)],shell=False,cwd=str(folder))
        except OSError:
            warning='La sesión quedó guardada. No se pudo iniciar el DAW; podés abrirla con Abrir en DAW.'
        return jsonify(id=identity,ruta=str(file),advertencia=warning),201


def required_stage(db,key):
    row=db.execute('SELECT * FROM etapas WHERE clave=?',(LEGACY_STAGE.get(key,key),)).fetchone()
    if not row:raise ValueError('Etapa inválida.')
    return row
