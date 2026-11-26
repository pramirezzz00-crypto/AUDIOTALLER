"""Bandeja de devoluciones: conserva el audio y la entrega que oyó el artista.

Firestore recibe notas inmutables. SQLite conserva una copia y el estado privado
de trabajo; sincronizar nunca sobrescribe ese estado ni las notas del productor.
"""
import json
import math
import re
from pathlib import Path
from flask import jsonify,request
from management import required_row
from cloud_auth import CredentialStore


def register_feedback(app,connect,publisher_factory,data_folder):
    @app.get('/api/portal/destinatarios')
    def feedback_recipients():
        with connect() as db:
            result=[]
            for row in db.execute('SELECT a.id,a.nombre,p.datos FROM artistas a LEFT JOIN perfiles_artista p ON p.id=a.id ORDER BY a.nombre'):
                profile=json.loads(row['datos'] or '{}')
                emails=profile.get('correos','')
                if isinstance(emails,list):emails=','.join(map(str,emails))
                emails=re.split(r'[,;\s]+',str(emails))
                result.append(dict(id=row['id'],nombre=row['nombre'],correos=[mail for mail in emails if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',mail)]))
        return jsonify(result)

    @app.get('/api/portal/devoluciones')
    def feedback_list():
        conditions=[];params=[]
        for key in ('playlist_id','cancion_id'):
            if request.args.get(key):conditions.append('f.'+key+'=?');params.append(request.args[key])
        with connect() as db:
            rows=db.execute('''SELECT f.*,p.nombre AS playlist,c.titulo,a.nombre AS artista,d.nombre AS disco,
                ar.nombre AS archivo_nombre,ar.etapa AS archivo_etapa,rv.nombre AS resuelve_nombre FROM portal_devoluciones f
                JOIN playlists p ON p.id=f.playlist_id LEFT JOIN canciones c ON c.id=f.cancion_id
                LEFT JOIN artistas a ON a.id=c.artista_id LEFT JOIN discos d ON d.id=c.disco_id
                LEFT JOIN archivos ar ON ar.id=f.archivo_id LEFT JOIN archivos rv ON rv.id=f.resuelve_archivo'''+(' WHERE '+' AND '.join(conditions) if conditions else '')+
                ' ORDER BY f.creado DESC,f.id',params).fetchall()
        return jsonify([dict(row) for row in rows])

    @app.post('/api/portal/devoluciones/sincronizar')
    def feedback_sync():
        from cloud_portal import decode
        data=request.get_json() or {};publisher=publisher_factory()
        with connect() as db:
            publications=[dict(row) for row in db.execute('SELECT * FROM portal_publicaciones WHERE proyecto=?'+
                (' AND playlist_id=?' if data.get('playlist_id') else ''),
                [publisher.config['projectId']]+([data['playlist_id']] if data.get('playlist_id') else []))]
        count=0
        for publication in publications:
            token='';seen=set()
            while True:
                from urllib.parse import urlencode
                page=publisher.google(publisher.document_url(publication['id'])+'/feedback?'+urlencode(dict(pageSize=100,**({'pageToken':token} if token else {}))))[2]
                with connect() as db:
                    for document in page.get('documents',[]):
                        note=decode(document);identity=document['name'].rsplit('/',1)[-1]
                        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',identity):continue
                        text=note.get('body','');second=note.get('positionSeconds',0)
                        if not isinstance(text,str) or not text.strip() or len(text)>4000:continue
                        try:second=float(second)
                        except (TypeError,ValueError):continue
                        if not math.isfinite(second) or not 0<=second<=86400:continue
                        # El ID incluye la publicación para evitar colisiones entre entregas.
                        cursor=db.execute('''INSERT INTO portal_devoluciones
                            (id,publicacion_id,playlist_id,email,archivo_id,cancion_id,drive_id,revision,etiqueta,texto,segundo,creado)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING''',
                            (publication['id']+':'+identity,publication['id'],publication['playlist_id'],publication['email'],
                             note.get('audioId',''),note.get('songId',''),note.get('driveId',''),int(note.get('revision',0)),
                             str(note.get('audioLabel',''))[:1000],text,second,str(note.get('createdAt',''))))
                        count+=cursor.rowcount
                token=page.get('nextPageToken','')
                if not token:break
                if token in seen:raise ValueError('Google repitió una página. Reintentá la sincronización.')
                seen.add(token)
        return jsonify(ok=True,nuevas=count,mensaje=f'{count} devoluciones nuevas. Las notas anteriores se conservan.')

    STATES=('Pendiente','En revisión','Resuelta','Sin cambios')

    def scoped_notes(db,archivo_id):
        notes=[dict(row) for row in db.execute('SELECT * FROM portal_devoluciones WHERE archivo_id=? ORDER BY segundo',(archivo_id,))]
        if not notes:raise ValueError('Ese audio no tiene devoluciones.')
        return notes

    @app.get('/api/portal/devoluciones/marcadores.<kind>')
    def feedback_markers_download(kind):
        from flask import Response
        from feedback_markers import midi_markers,csv_markers
        offset=float(request.args.get('desfase',0) or 0)
        with connect() as db:
            notes=scoped_notes(db,request.args.get('archivo_id',''))
            name=(db.execute('SELECT nombre FROM archivos WHERE id=?',(notes[0]['archivo_id'],)).fetchone() or {'nombre':'audio'})['nombre']
        stem=Path(name).stem+'_devoluciones'
        if kind=='mid':
            return Response(midi_markers(notes,offset,stem),mimetype='audio/midi',headers={'Content-Disposition':f'attachment; filename="{stem}.mid"'})
        if kind=='csv':
            return Response(csv_markers(notes,offset),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':f'attachment; filename="{stem}.csv"'})
        raise ValueError('Formato de marcadores inválido.')

    @app.post('/api/portal/devoluciones/marcadores')
    def feedback_markers_save():
        """Guarda .mid y .csv junto a la sesión (o al audio) y, si es REAPER, una copia .rpp con los marcadores."""
        from feedback_markers import midi_markers,csv_markers,rpp_with_markers
        data=request.get_json() or {}
        offset=float(data.get('desfase',0) or 0)
        if not -3600<=offset<=3600:raise ValueError('Desfase inválido.')
        with connect() as db:
            notes=scoped_notes(db,str(data.get('archivo_id','')))
            audio=required_row(db,'archivos',notes[0]['archivo_id'])
            session=None
            if data.get('sesion_id'):
                session=required_row(db,'sesiones',data['sesion_id'])
                if session['cancion_id']!=audio['cancion_id']:raise ValueError('La sesión es de otra canción.')
            elif audio['sesion_id']:
                session=db.execute('SELECT * FROM sesiones WHERE id=?',(audio['sesion_id'],)).fetchone()
        folder=Path(session['ruta']).parent if session and session['ruta'] else Path(audio['ruta']).parent
        if not folder.is_dir():raise ValueError('La carpeta de la sesión no está disponible.')
        stem=Path(audio['nombre']).stem+'_devoluciones'
        written=[]
        for suffix,payload in (('.mid',midi_markers(notes,offset,stem)),('.csv',csv_markers(notes,offset).encode('utf-8'))):
            target=folder/(stem+suffix);n=2
            while target.exists():target=folder/f'{stem}_{n}{suffix}';n+=1
            target.write_bytes(payload);written.append(str(target))
        if data.get('reaper') and session and str(session['ruta']).lower().endswith('.rpp') and Path(session['ruta']).is_file():
            written.append(str(rpp_with_markers(session['ruta'],notes,offset)))
        count=sum(1 for n in notes if n['segundo']>0)
        return jsonify(ok=True,archivos=written,mensaje=f'{count} marcadores guardados en {folder}.')

    @app.post('/api/portal/devoluciones/<path:identity>')
    def feedback_status(identity):
        data=request.get_json() or {}
        with connect() as db:
            current=dict(required_row(db,'portal_devoluciones',identity))
            status=data.get('estado',current['estado']);note=data.get('nota_interna',current['nota_interna'])
            reply=data.get('respuesta',current.get('respuesta',''));resolves=data.get('resuelve_archivo',current.get('resuelve_archivo',''))
            loop_start=data.get('bucle_inicio',current.get('bucle_inicio'));loop_end=data.get('bucle_fin',current.get('bucle_fin'))
            if status not in STATES or not isinstance(note,str) or len(note)>8000 or not isinstance(reply,str) or len(reply)>8000:
                raise ValueError('Estado, respuesta o nota interna inválidos.')
            if status=='Sin cambios' and not (reply.strip() or note.strip()):
                raise ValueError('Contá por qué no se cambia: escribilo en la respuesta.')
            if resolves:
                target=required_row(db,'archivos',resolves)
                if target['cancion_id']!=current['cancion_id']:raise ValueError('La versión con el cambio debe ser de la misma canción.')
            for value in (loop_start,loop_end):
                if value is not None and (not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<=value<=86400):
                    raise ValueError('Bucle inválido.')
            db.execute("""UPDATE portal_devoluciones SET estado=?,nota_interna=?,respuesta=?,resuelve_archivo=?,
                bucle_inicio=?,bucle_fin=?,actualizado=CURRENT_TIMESTAMP WHERE id=?""",
                (status,note,reply,resolves or '',loop_start,loop_end,identity))
        return jsonify(ok=True)

    @app.get('/api/portal/publicaciones/<identity>/acceso')
    def feedback_access(identity):
        with connect() as db:publication=dict(required_row(db,'portal_publicaciones',identity))
        vault=CredentialStore(Path(data_folder())/'portal-accesos.dpapi').read()
        key=publication['proyecto']+':'+publication['email']
        return jsonify(url=publication['url'],email=publication['email'],password=vault.get(key,''))
