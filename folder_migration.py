"""Copia completa y verificada de carpetas DAW, con cambio de vínculos solo al finalizar."""
import hashlib
import json
import os
import shutil
import sqlite3
import threading
import uuid
from contextlib import closing
from pathlib import Path
from flask import jsonify
from management import required_row
from daw_operations import path_key, emit_event, group_key

BOOT = uuid.uuid4().hex


def digest(path):
    result=hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda:file.read(1024*1024),b''):
            result.update(block)
    return result.hexdigest()


def tree_snapshot(root):
    """Una referencia que sale de la carpeta se informa, sin copiarla silenciosamente."""
    files=[]
    folders=[]
    for directory,subdirs,names in os.walk(root,onerror=lambda error: (_ for _ in ()).throw(error)):
        current=Path(directory)
        for name in subdirs+names:
            path=current/name
            if path.is_symlink() or path.is_junction():
                raise ValueError('La carpeta contiene un enlace o junction: '+str(path)+'. Revisá los medios externos antes de copiarla.')
        folders.append(str(current.relative_to(root)))
        for name in names:
            path=current/name
            stat=path.stat()
            files.append(dict(relative=str(path.relative_to(root)),size=stat.st_size,mtime=stat.st_mtime_ns))
    return dict(carpetas=sorted(folders),archivos=sorted(files,key=lambda item:item['relative']))


def linked_rows(db,sid):
    return dict(
        sesiones=[dict(row) for row in db.execute('SELECT id,ruta FROM sesiones WHERE cancion_id=? ORDER BY id',(sid,))],
        archivos=[dict(row) for row in db.execute('SELECT id,ruta FROM archivos WHERE cancion_id=? ORDER BY id',(sid,))],
        versiones=[dict(row) for row in db.execute('SELECT v.id,v.ruta FROM versiones v JOIN sesiones s ON v.sesion_id=s.id WHERE s.cancion_id=? ORDER BY v.id',(sid,))]
    )


def register_folder_migration(app,connect,database):
    @app.post('/api/produccion/<sid>/copiar-produccion/plan')
    def plan(sid):
        with connect() as db:
            for active in db.execute("SELECT datos FROM operaciones_archivo WHERE cancion_id=? AND estado='copiando'",(sid,)):
                if json.loads(active['datos']).get('boot')==BOOT:
                    raise ValueError('Ya hay una copia de esta canción en curso. Abrí su progreso antes de preparar otra.')
            song=required_row(db,'canciones',sid)
            snapshot=linked_rows(db,sid)
        target=Path(song['carpeta']).resolve()
        roots=[]
        # La carpeta completa junto al proyecto incluye Audio, Auto Saves, imágenes, etc.
        for row in snapshot['sesiones']:
            path=Path(row['ruta']).resolve()
            if not path.exists():
                raise ValueError('Una sesión no está disponible: '+str(path)+'. Conectá la unidad antes de preparar la copia.')
            root=path if path.is_dir() else path.parent
            if root.is_relative_to(target):
                continue
            if target.is_relative_to(root):
                raise ValueError('El destino de AudioTaller está dentro de una carpeta de origen. Elegí una carpeta de proyecto más específica.')
            if not any(root.is_relative_to(existing) for existing in roots):
                roots=[existing for existing in roots if not existing.is_relative_to(root)]
                roots.append(root)
        roots.sort(key=lambda root:str(root).casefold())
        identity=uuid.uuid4().hex
        final=target/'Producciones administradas'/('AT-'+sid[:8]+'-'+identity[:8])
        groups=[]
        for index,root in enumerate(roots,1):
            tree=tree_snapshot(root)
            groups.append(dict(origen=str(root),destino='FUENTE-'+str(index).zfill(3),**tree))
        # Incluye también archivos vinculados fuera de las carpetas de sesiones.
        extra=[]
        for row in snapshot['archivos']:
            path=Path(row['ruta']).resolve()
            if path.is_relative_to(target) or any(path.is_relative_to(root) for root in roots):
                continue
            if not path.is_file():
                raise ValueError('Un archivo vinculado no está disponible: '+str(path))
            if not any(path_key(item['origen'])==path_key(path) for item in extra):
                extra.append(dict(origen=str(path),destino=uuid.uuid4().hex[:12]+'-'+path.name,
                                  size=path.stat().st_size,mtime=path.stat().st_mtime_ns))
        if not roots and not extra:
            raise ValueError('Las carpetas y archivos de las sesiones ya están dentro de la canción en AudioTaller.')
        if not final.resolve().is_relative_to(target):
            raise ValueError('La carpeta de destino apunta fuera de la canción.')
        total=sum(item['size'] for group in groups for item in group['archivos'])+sum(item['size'] for item in extra)
        files=sum(len(group['archivos']) for group in groups)+len(extra)
        parent=target
        while not parent.exists():parent=parent.parent
        if shutil.disk_usage(parent).free<total:
            raise ValueError('No hay espacio libre suficiente en el destino.')
        data=dict(grupos=groups,extras=extra,referencias=snapshot,destino=str(final),raiz=str(target),boot=BOOT)
        with connect() as db:
            db.execute('INSERT INTO operaciones_archivo(id,cancion_id,estado,datos,total) VALUES(?,?,?,?,?)',
                       (identity,sid,'plan',json.dumps(data),total))
        return jsonify(id=identity,carpetas=[str(root) for root in roots],archivos=files,bytes=total,
                       destino=str(final),extras=len(extra))

    @app.get('/api/produccion/<sid>/copiar-produccion/pendiente')
    def pending(sid):
        with connect() as db:
            required_row(db,'canciones',sid)
            job=db.execute("""SELECT id,estado,datos FROM operaciones_archivo
                WHERE cancion_id=? AND estado IN ('copiando','error') ORDER BY rowid DESC LIMIT 1""",(sid,)).fetchone()
        return jsonify(dict(id=job['id'],estado=job['estado']) if job else None)

    @app.post('/api/produccion/<sid>/copiar-produccion/<identity>/iniciar')
    def start(sid,identity):
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            job=required_row(db,'operaciones_archivo',identity)
            if job['cancion_id']!=sid:raise ValueError('La operación no pertenece a esta canción.')
            data=json.loads(job['datos'])
            if job['estado']=='completada' or (job['estado']=='copiando' and data['boot']==BOOT):
                return jsonify(id=identity)
            if job['estado'] not in ('plan','error','copiando'):
                raise ValueError('La operación no se puede iniciar.')
            data['boot']=BOOT
            db.execute("UPDATE operaciones_archivo SET estado='copiando',datos=?,error=NULL,copiados=0,actualizado=CURRENT_TIMESTAMP WHERE id=?",
                       (json.dumps(data),identity))
        threading.Thread(target=run,args=(sid,identity,data),daemon=True).start()
        return jsonify(id=identity),202

    @app.get('/api/produccion/<sid>/copiar-produccion/<identity>')
    def status(sid,identity):
        with connect() as db:
            job=dict(required_row(db,'operaciones_archivo',identity))
        if job['cancion_id']!=sid:raise ValueError('La operación no pertenece a esta canción.')
        result={key:job[key] for key in ('id','estado','copiados','total','error','resultado')}
        if job['estado']=='copiando' and json.loads(job['datos']).get('boot')!=BOOT:
            result['estado']='interrumpida'
            result['error']='La aplicación se cerró durante la copia. Podés reintentar; los vínculos originales siguen vigentes.'
        return jsonify(result)

    def run(sid,identity,data):
        final=Path(data['destino'])
        partial=final.with_name('.parcial-'+identity+'-'+uuid.uuid4().hex[:8])
        published=False
        done=0
        try:
            with connect() as db:
                if linked_rows(db,sid)!=data['referencias']:
                    raise ValueError('Los vínculos cambiaron desde la vista previa. Prepará otra copia.')
            if not partial.resolve().is_relative_to(Path(data['raiz'])):
                raise ValueError('La carpeta de destino cambió. Prepará otra copia.')
            partial.mkdir(parents=True,exist_ok=False)

            def copy_verified(source,target,size,mtime):
                nonlocal done
                current=source.stat()
                if (current.st_size,current.st_mtime_ns)!=(size,mtime):
                    raise ValueError('Un archivo cambió desde la vista previa. Cerrá el DAW y prepará otra copia: '+str(source))
                with source.open('rb') as src,target.open('xb') as dest:
                    shutil.copyfileobj(src,dest,1024*1024)
                if digest(source)!=digest(target):
                    raise ValueError('La verificación de copia falló: '+str(source))
                after=source.stat()
                if (after.st_size,after.st_mtime_ns)!=(size,mtime):
                    raise ValueError('El archivo se modificó mientras se copiaba: '+str(source))
                shutil.copystat(source,target)
                done+=size
                with connect() as db:
                    db.execute('UPDATE operaciones_archivo SET copiados=?,actualizado=CURRENT_TIMESTAMP WHERE id=?',(done,identity))

            for group in data['grupos']:
                source=Path(group['origen'])
                for directory in group['carpetas']:
                    (partial/group['destino']/directory).mkdir(parents=True,exist_ok=True)
                for file in group['archivos']:
                    copy_verified(source/file['relative'],partial/group['destino']/file['relative'],file['size'],file['mtime'])
                if tree_snapshot(source)!=dict(carpetas=group['carpetas'],archivos=group['archivos']):
                    raise ValueError('Cambió el contenido de una carpeta durante la copia. Cerrá el DAW y prepará otra copia.')
            if data['extras']:
                (partial/'Archivos vinculados').mkdir()
                for file in data['extras']:
                    copy_verified(Path(file['origen']),partial/'Archivos vinculados'/file['destino'],file['size'],file['mtime'])
            # Respaldo antes de reasociar las rutas de producción.
            dbpath=Path(database())
            backup=dbpath.with_name(dbpath.stem+'.antes-copia-'+identity[:12]+'.sqlite3')
            with closing(sqlite3.connect(dbpath)) as source,closing(sqlite3.connect(backup)) as dest:
                source.backup(dest)
            def relocate(value):
                path=Path(value).resolve()
                for group in data['grupos']:
                    root=Path(group['origen'])
                    if path.is_relative_to(root):return str(final/group['destino']/path.relative_to(root))
                for file in data['extras']:
                    if path_key(path)==path_key(file['origen']):return str(final/'Archivos vinculados'/file['destino'])
                return value
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if linked_rows(db,sid)!=data['referencias']:
                    raise ValueError('Los vínculos cambiaron durante la copia. Prepará una nueva vista previa.')
                partial.rename(final)
                published=True
                for table,rows in data['referencias'].items():
                    for row in rows:
                        new=relocate(row['ruta'])
                        if new!=row['ruta']:
                            db.execute('UPDATE '+table+' SET ruta=? WHERE id=?',(new,row['id']))
                            if table=='sesiones':
                                session=db.execute('SELECT etapa FROM sesiones WHERE id=?',(row['id'],)).fetchone()
                                db.execute('UPDATE revision_sesion SET grupo=? WHERE sesion_id=?',
                                           (group_key(sid,session['etapa'],new),row['id']))
                                db.execute("UPDATE sesion_info SET modo='administrada' WHERE id=?",(row['id'],))
                            elif table=='archivos':
                                db.execute("UPDATE archivos SET modo='importado' WHERE id=?",(row['id'],))
                emit_event(db,sid,None,'Producción copiada a AudioTaller',identity,str(final))
                result=json.dumps(dict(destino=str(final),respaldo=str(backup)))
                db.execute("UPDATE operaciones_archivo SET estado='completada',resultado=?,actualizado=CURRENT_TIMESTAMP WHERE id=?",(result,identity))
        except Exception as error:
            # Un fallo mantiene las rutas originales. La copia parcial queda identificada para revisión.
            if published:
                try:final.rename(partial)
                except OSError:pass
            with connect() as db:
                db.execute("UPDATE operaciones_archivo SET estado='error',error=?,resultado=?,actualizado=CURRENT_TIMESTAMP WHERE id=?",
                           (str(error),json.dumps(dict(copia_parcial=str(partial))),identity))
