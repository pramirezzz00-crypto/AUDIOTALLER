"""Entregas de escucha revocables y su vista pública de mínimo alcance.

En escritorio solo es una vista previa local. El blueprint público puede
servirse aparte: nunca es necesario publicar las API de administración del DAW.
"""
import hashlib
import json
import secrets
import time
import math
from pathlib import Path
from flask import Blueprint, jsonify, request, send_file, make_response
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from werkzeug.security import generate_password_hash, check_password_hash
from management import required_row
from catalog import playlist_data
from song_hub import text

STATIC = Path(__file__).parent/'static'


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def portal_blueprint(connect):
    portal = Blueprint('listening_portal',__name__)
    access = URLSafeTimedSerializer(secrets.token_bytes(32),salt='portal-access')
    attempts = {}

    def lookup(token, authenticate=True):
        if not isinstance(token,str) or not 32 <= len(token) <= 100:
            return None,404
        digest=token_hash(token)
        with connect() as db:
            row=db.execute('SELECT * FROM entregas_playlist WHERE token_hash=?',(digest,)).fetchone()
        if not row or row['revocada'] or row['vence'] <= time.time():
            return None,410
        row=dict(row)
        if authenticate and row['clave_hash']:
            try:
                if access.loads(request.cookies.get('at_portal_'+digest[:16],''),max_age=1800) != digest:
                    return None,401
            except (BadSignature,SignatureExpired):
                return None,401
        return row,200

    @portal.after_request
    def privacy(response):
        response.headers['Cache-Control']='no-store'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
        return response

    @portal.get('/portal-assets/<name>')
    def assets(name):
        if name not in ('portal.js','portal.css'):
            return jsonify(error='Recurso no disponible.'),404
        return send_file(STATIC/name)

    @portal.get('/portal/<token>')
    def page(token):
        row,code=lookup(token,False)
        if not row:
            return 'Esta entrega no está disponible o venció.',code
        return send_file(STATIC/'portal.html')

    @portal.post('/portal/<token>/acceso')
    def unlock(token):
        row,code=lookup(token,False)
        if not row:
            return jsonify(error='Entrega no disponible.'),code
        # Límite en memoria por enlace/dirección para evitar intentos masivos.
        key=(token_hash(token),request.remote_addr)
        now=time.monotonic()
        attempts[key]=[moment for moment in attempts.get(key,[]) if now-moment<300]
        if len(attempts[key]) >= 10:
            return jsonify(error='Demasiados intentos. Esperá cinco minutos.'),429
        data=request.get_json(silent=True) or {}
        password=data.get('clave','') if isinstance(data,dict) else ''
        if not isinstance(password,str) or len(password)>256:
            return jsonify(error='Clave inválida.'),400
        if row['clave_hash'] and not check_password_hash(row['clave_hash'],password):
            attempts[key].append(now)
            # Acota también las claves del contador para un servidor persistente.
            if len(attempts)>10000:
                attempts.clear()
            return jsonify(error='Clave incorrecta.'),401
        attempts.pop(key,None)
        digest=token_hash(token)
        response=make_response(jsonify(ok=True))
        response.set_cookie('at_portal_'+digest[:16],access.dumps(digest),httponly=True,samesite='Strict',
                            secure=request.is_secure,max_age=1800,path='/portal/'+token)
        return response

    @portal.get('/portal/<token>/datos')
    def public_data(token):
        row,code=lookup(token)
        if not row:
            return jsonify(error='Ingresá la clave.' if code==401 else 'Entrega revocada o vencida.'),code
        snapshot=json.loads(row['instantanea'])
        # Una lista explícita evita filtrar rutas, comentarios internos o datos de contactos.
        return jsonify(nombre=row['nombre'],descarga=bool(row['descarga']),vence=row['vence'],
            audios=[{key:value for key,value in item.items() if key not in ('mtime','size')} for item in snapshot])

    @portal.get('/portal/<token>/audio/<identity>')
    def public_audio(token,identity):
        row,code=lookup(token)
        if not row:
            return jsonify(error='Entrega no disponible.'),code
        item=next((item for item in json.loads(row['instantanea']) if item['id']==identity),None)
        if not item:
            return jsonify(error='Ese archivo no pertenece a esta entrega.'),404
        download=request.args.get('descarga')=='1'
        if download and not row['descarga']:
            return jsonify(error='La descarga no está habilitada.'),403
        with connect() as db:
            file=db.execute('SELECT ruta,nombre FROM archivos WHERE id=?',(identity,)).fetchone()
        if not file or not Path(file['ruta']).is_file():
            return jsonify(error='El archivo no está disponible.'),404
        stat=Path(file['ruta']).stat()
        if stat.st_size != item['size'] or stat.st_mtime_ns != item['mtime']:
            return jsonify(error='El archivo cambió. Solicitá una nueva entrega al productor.'),409
        return send_file(Path(file['ruta']),as_attachment=download,download_name=item['nombre'],conditional=True)

    return portal


def register_listening_portal(app,connect):
    app.register_blueprint(portal_blueprint(connect))

    @app.get('/api/playlists/<pid>/entregas')
    def deliveries(pid):
        with connect() as db:
            required_row(db,'playlists',pid)
            rows=[dict(row) for row in db.execute('''SELECT id,nombre,descarga,vence,revocada,creado,
                CASE WHEN clave_hash='' THEN 0 ELSE 1 END AS con_clave FROM entregas_playlist WHERE playlist_id=? ORDER BY rowid DESC''',(pid,))]
        return jsonify(rows)

    @app.post('/api/playlists/<pid>/entregas')
    def create_delivery(pid):
        data=request.get_json() or {}
        password=text(data.get('clave',''),256)
        try:
            days=float(data.get('dias',7))
        except (ValueError,TypeError):
            raise ValueError('Duración de enlace inválida.')
        if not math.isfinite(days) or not 0 < days <= 365:
            raise ValueError('La entrega debe vencer dentro de un máximo de 365 días.')
        if not isinstance(data.get('descarga',False),bool):
            raise ValueError('Permiso de descarga inválido.')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            playlist=playlist_data(db,pid)
            if not playlist['audios']:
                raise ValueError('Agregá al menos un audio antes de preparar una entrega.')
            snapshot=[]
            for audio in playlist['audios']:
                if not audio['disponible']:
                    raise ValueError('Hay audios no disponibles. Conectá su unidad antes de preparar la entrega.')
                snapshot.append(dict(id=audio['id'],nombre=audio['nombre'],titulo=audio['titulo'],artista=audio['artista'],
                    disco=audio['disco'],clase=audio['clase'],version=audio['version'],duracion=audio['tecnica'].get('duracion'),
                    size=audio['tamano'],mtime=audio['modificado']))
            token=secrets.token_urlsafe(32)
            identity=secrets.token_hex(16)
            name=text(data.get('nombre') or playlist['nombre'],150)
            expires=time.time()+days*86400
            db.execute('''INSERT INTO entregas_playlist(id,playlist_id,token_hash,nombre,instantanea,descarga,clave_hash,vence)
                VALUES(?,?,?,?,?,?,?,?)''',(identity,pid,token_hash(token),name,json.dumps(snapshot,ensure_ascii=False),
                int(data.get('descarga',False)),generate_password_hash(password) if password else '',expires))
        # No se persiste el token en claro. Solo se muestra al preparar la entrega.
        return jsonify(id=identity,ruta='/portal/'+token,vence=expires,local=True),201

    @app.post('/api/entregas/<identity>/revocar')
    def revoke(identity):
        with connect() as db:
            required_row(db,'entregas_playlist',identity)
            db.execute('UPDATE entregas_playlist SET revocada=1 WHERE id=?',(identity,))
        return jsonify(ok=True)
