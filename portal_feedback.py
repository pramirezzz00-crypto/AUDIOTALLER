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
            rows=db.execute('''SELECT f.*,p.nombre AS playlist FROM portal_devoluciones f
                JOIN playlists p ON p.id=f.playlist_id'''+(' WHERE '+' AND '.join(conditions) if conditions else '')+
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

    @app.post('/api/portal/devoluciones/<path:identity>')
    def feedback_status(identity):
        data=request.get_json() or {};status=data.get('estado','Pendiente');note=data.get('nota_interna','')
        if status not in ('Pendiente','En revisión','Resuelta') or not isinstance(note,str) or len(note)>8000:
            raise ValueError('Estado o nota interna inválidos.')
        with connect() as db:
            required_row(db,'portal_devoluciones',identity)
            db.execute('UPDATE portal_devoluciones SET estado=?,nota_interna=? WHERE id=?',(status,note,identity))
        return jsonify(ok=True)

    @app.get('/api/portal/publicaciones/<identity>/acceso')
    def feedback_access(identity):
        with connect() as db:publication=dict(required_row(db,'portal_publicaciones',identity))
        vault=CredentialStore(Path(data_folder())/'portal-accesos.dpapi').read()
        key=publication['proyecto']+':'+publication['email']
        return jsonify(url=publication['url'],email=publication['email'],password=vault.get(key,''))
