"""Publicación opcional en Firebase Spark con copias compartidas por enlace en Drive.

No publica la administración local, no activa facturación y no borra originales.
Google OAuth autoriza al dueño a desplegar; Firebase Auth autoriza al artista
a consultar la playlist. Los enlaces directos de audio siguen siendo públicos.
"""
import gzip
import hashlib
import json
import mimetypes
import re
import secrets
import threading
import time
import uuid
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode,urlparse,quote
from flask import jsonify,request
from catalog import playlist_data
from cloud_auth import CredentialStore,GoogleSession,http_request,CloudError
from management import required_row

ASSETS=Path(__file__).parent/'artist_web'


SITE_FILES=('index.html','portal.js','portal.css')


def site_hash():
    """Huella de la web del artista y sus reglas: si cambia, la próxima publicación la actualiza sola."""
    h=hashlib.sha256((ASSETS/'firestore.rules').read_bytes())
    for name in SITE_FILES:h.update((ASSETS/'public'/name).read_bytes())
    return h.hexdigest()


def audio_peaks(path,bins=160):
    """Forma de onda liviana para el portal (solo WAV PCM); sin ella el portal muestra una barra simple."""
    try:
        from audio_waveform import pcm_waveform
        peaks=pcm_waveform(path,bins)['peaks']
        top=max(peaks) or 1
        return [round(value/top,2) for value in peaks]
    except Exception:
        return []


def digest(path):
    result=hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()


def fields(data):
    result={}
    for key,value in data.items():
        if isinstance(value,bool):result[key]={'booleanValue':value}
        elif isinstance(value,datetime):result[key]={'timestampValue':value.isoformat().replace('+00:00','Z')}
        elif isinstance(value,int):result[key]={'integerValue':str(value)}
        elif isinstance(value,dict):result[key]={'mapValue':{'fields':fields(value)}}
        elif isinstance(value,float):result[key]={'doubleValue':value}
        else:result[key]={'stringValue':str(value)}
    return result


def decode(document):
    def value(raw):
        if 'mapValue' in raw:return decode(raw['mapValue'])
        if 'integerValue' in raw:return int(raw['integerValue'])
        return next(iter(raw.values()))
    return {key:value(raw) for key,raw in document.get('fields',{}).items()}


def public_config(data):
    if not isinstance(data,dict):raise ValueError('Configuración inválida.')
    config={key:str(data.get(key,'')).strip() for key in ('projectId','apiKey','driveApiKey','siteId','producerName','color')}
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]',config['projectId']):
        raise ValueError('Ingresá el ID real del proyecto Firebase (no su nombre visible).')
    config['siteId']=config['siteId'] or (config['projectId'][:22]+'-portal')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,28}[a-z0-9]',config['siteId']):
        raise ValueError('El identificador del sitio debe tener letras minúsculas, números o guiones, hasta 30 caracteres.')
    for key in ('apiKey','driveApiKey'):
        if not config[key]:
            if key=='driveApiKey':config[key]=config['apiKey']
            else:raise ValueError('Pegá la clave web pública de Firebase.')
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,100}',config[key]):raise ValueError('Clave web no válida.')
    config['producerName']=config['producerName'][:150]
    config['color']=config['color'] or '#55d6be'
    if not re.fullmatch(r'#[a-fA-F0-9]{6}',config['color']):raise ValueError('Color inválido.')
    return config


class Publisher:
    def __init__(self,connect,session,config):
        self.connect=connect;self.session=session;self.config=config
    def google(self,url,method='GET',data=None,headers=None,raw=False):
        host=urlparse(url).hostname or ''
        if not (host.endswith('.googleapis.com') or host=='www.googleapis.com'):
            raise ValueError('Destino externo no autorizado.')
        return http_request(url,method,data,{'Authorization':'Bearer '+self.session.token(),**(headers or {})},raw)
    def document_url(self,identity):
        return 'https://firestore.googleapis.com/v1/projects/'+self.config['projectId']+'/databases/(default)/documents/portals/'+identity
    def get_document(self,identity):
        try:return self.google(self.document_url(identity))[2]
        except CloudError as error:
            if error.status==404:return None
            raise
    def save_document(self,identity,payload,previous=None):
        condition={'currentDocument.updateTime':previous['updateTime']} if previous else {'currentDocument.exists':'false'}
        return self.google(self.document_url(identity)+'?'+urlencode(condition),'PATCH',{'fields':fields(payload)})[2]
    def check_ready(self):
        self.google('https://firestore.googleapis.com/v1/projects/'+self.config['projectId']+'/databases/(default)')
        releases=self.google('https://firebasehosting.googleapis.com/v1beta1/sites/'+self.config['siteId']+'/releases?pageSize=1')[2]
        if not releases.get('releases'):
            raise ValueError('Primero instalá la web con Conectar portal web → Instalar portal.')
    def install(self,progress):
        result=self.deploy_site(progress,check_services=True)
        return dict(url=result,mensaje='Portal instalado. Publicá una playlist para generar su enlace.')
    def ensure_site_current(self,progress):
        """Si la web o las reglas cambiaron en esta versión de AudioTaller, las vuelve a subir antes de publicar."""
        if self.config.get('siteHash')==site_hash():return False
        progress('Actualizando la web del portal a la versión nueva…')
        self.deploy_site(progress,check_services=False)
        return True
    def deploy_site(self,progress,check_services=True):
        project=self.config['projectId'];site=self.config['siteId']
        progress('Comprobando Firestore (base default)…')
        self.google('https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)')
        progress('Comprobando el sitio dedicado al portal…')
        site_url='https://firebasehosting.googleapis.com/v1beta1/projects/'+project+'/sites/'+site
        try:self.google(site_url)
        except CloudError as error:
            if error.status!=404:raise
            self.google('https://firebasehosting.googleapis.com/v1beta1/projects/'+project+'/sites?siteId='+site,'POST',{})
        progress('Instalando reglas de lectura del artista…')
        rule_set=self.google('https://firebaserules.googleapis.com/v1/projects/'+project+'/rulesets','POST',
            {'source':{'files':[{'name':'firestore.rules','content':(ASSETS/'firestore.rules').read_text(encoding='utf-8')}]}})[2]
        release={'name':'projects/'+project+'/releases/cloud.firestore','rulesetName':rule_set['name']}
        url='https://firebaserules.googleapis.com/v1/projects/'+project+'/releases/cloud.firestore'
        try:self.google(url)
        except CloudError as error:
            if error.status!=404:raise
            self.google('https://firebaserules.googleapis.com/v1/projects/'+project+'/releases','POST',release)
        else:self.google(url,'PATCH',{'release':release,'updateMask':'rulesetName'})
        progress('Subiendo la interfaz de artista…')
        version=self.google('https://firebasehosting.googleapis.com/v1beta1/sites/'+site+'/versions','POST',
            {'config':{'rewrites':[{'glob':'**','path':'/index.html'}],
                       # Drive verifica el dominio permitido de la clave pública.
                       # Enviar sólo el origen evita revelar el ID de la playlist
                       # y mantiene compatible la restricción por sitio web.
                       'headers':[{'glob':'**','headers':{'Referrer-Policy':'strict-origin-when-cross-origin','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache, max-age=0, must-revalidate'}},
                                  {'glob':'/config.json','headers':{'Cache-Control':'no-store'}}]}})[2]['name']
        content={('/'+name):(ASSETS/'public'/name).read_bytes() for name in SITE_FILES}
        # Cada interfaz referencia sus propios recursos. Una pestaña abierta
        # antes de actualizar no debe mezclar HTML nuevo con JavaScript viejo.
        html=content['/index.html'].decode('utf-8')
        for name in ('portal.js','portal.css'):
            html=html.replace('/'+name,'/'+name+'?v='+hashlib.sha256(content['/'+name]).hexdigest()[:12])
        content['/index.html']=html.encode('utf-8')
        content['/config.json']=json.dumps({key:self.config[key] for key in ('projectId','apiKey','driveApiKey')}).encode()
        compressed={path:gzip.compress(value,mtime=0) for path,value in content.items()}
        hashes={path:hashlib.sha256(value).hexdigest() for path,value in compressed.items()}
        populated=self.google('https://firebasehosting.googleapis.com/v1beta1/'+version+':populateFiles','POST',{'files':hashes})[2]
        needed=set(populated.get('uploadRequiredHashes',[]))
        for path,value in compressed.items():
            if hashes[path] in needed:
                self.google(populated['uploadUrl']+'/'+hashes[path],'POST',value,{'Content-Type':'application/octet-stream'},raw=True)
        self.google('https://firebasehosting.googleapis.com/v1beta1/'+version+'?updateMask=status','PATCH',{'status':'FINALIZED'})
        self.google('https://firebasehosting.googleapis.com/v1beta1/sites/'+site+'/releases?'+urlencode({'versionName':version}),'POST',{})
        self.config['siteHash']=site_hash()
        with self.connect() as db:
            row=db.execute('SELECT datos FROM portal_config WHERE id=1').fetchone()
            if row:
                saved=json.loads(row['datos']);saved['siteHash']=self.config['siteHash']
                db.execute('UPDATE portal_config SET datos=? WHERE id=1',(json.dumps(saved),))
        return 'https://'+site+'.web.app'
    def build_replies(self,identity,items,progress):
        """Respuestas del productor por devolución, con la versión que resuelve (se sube a Drive si hace falta)."""
        from catalog import catalog_rows
        by_item={item['id']:item for item in items}
        with self.connect() as db:
            notes=[dict(row) for row in db.execute('''SELECT f.*,rv.nombre AS resuelve_nombre FROM portal_devoluciones f
                LEFT JOIN archivos rv ON rv.id=f.resuelve_archivo WHERE f.publicacion_id=?''',(identity,))]
            pending=[n['resuelve_archivo'] for n in notes if n['resuelve_archivo'] and n['resuelve_archivo'] not in by_item]
            audios={row['id']:row for row in catalog_rows(db) if row['id'] in pending} if pending else {}
        uploaded={}
        replies={}
        for note in notes:
            if not (note.get('respuesta') or note['estado']!='Pendiente' or note.get('resuelve_archivo')):continue
            resolved=note.get('resuelve_archivo') or ''
            drive='';label=''
            if resolved:
                if resolved in by_item:
                    drive=by_item[resolved]['driveId'];label=' · '.join(filter(None,[by_item[resolved]['clase'],by_item[resolved]['version']])) or by_item[resolved]['nombre']
                elif resolved in audios and audios[resolved].get('disponible'):
                    if resolved not in uploaded:
                        progress('Subiendo la versión corregida: '+audios[resolved]['nombre'])
                        uploaded[resolved]=self.upload_audio(audios[resolved],self.config['projectId'],progress)['id']
                    drive=uploaded[resolved];label=' · '.join(filter(None,[audios[resolved]['clase'],audios[resolved]['version']])) or audios[resolved]['nombre']
            replies[note['id'].split(':',1)[-1]]=dict(status=note['estado'],reply=note.get('respuesta') or '',resolvedAudioId=resolved,
                resolvedDriveId=drive,resolvedLabel=label or (note.get('resuelve_nombre') or ''),repliedAt=str(note.get('actualizado') or ''))
        return replies
    def send_replies(self,identity,progress):
        """Actualiza solo las respuestas del portal, sin volver a subir la playlist completa."""
        progress('Comprobando el portal…')
        self.check_ready();self.ensure_site_current(progress)
        previous=self.get_document(identity)
        if not previous:raise ValueError('Esta playlist todavía no está publicada en el portal.')
        items=json.loads(decode(previous).get('items','[]'))
        replies=self.build_replies(identity,items,progress)
        progress('Enviando respuestas al artista…')
        payload=dict(replies=json.dumps(replies,ensure_ascii=False),repliesUpdatedAt=datetime.now(timezone.utc))
        mask='&'.join('updateMask.fieldPaths='+key for key in payload)
        self.google(self.document_url(identity)+'?'+mask+'&'+urlencode({'currentDocument.updateTime':previous['updateTime']}),'PATCH',{'fields':fields(payload)})
        return dict(respuestas=len(replies),mensaje=f'{len(replies)} respuestas enviadas. El artista las ve al abrir o actualizar el portal.')
    def upload_audio(self,audio,project,progress):
        path=Path(audio['ruta']);before=path.stat();checksum=digest(path)
        with self.connect() as db:
            old=db.execute('SELECT datos FROM portal_drive WHERE archivo_id=? AND proyecto=? AND sha256=?',
                (audio['id'],project,checksum)).fetchone()
        if old:
            remote=json.loads(old['datos'])
            try:
                actual=self.google('https://www.googleapis.com/drive/v3/files/'+remote['id']+'?fields=id,webViewLink,webContentLink,resourceKey')[2]
                remote.update(actual)
            except CloudError as error:
                if error.status!=404:raise
                remote=None
        else:remote=None
        if not remote:
            mime=mimetypes.guess_type(audio['nombre'])[0] or 'application/octet-stream'
            metadata={'name':audio['nombre'],'appProperties':{'audiotallerFile':audio['id'],'sha256':checksum}}
            _,headers,_=self.google('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,webContentLink,resourceKey',
                'POST',metadata,{'X-Upload-Content-Type':mime,'X-Upload-Content-Length':str(before.st_size)})
            location=next((value for key,value in headers.items() if key.lower()=='location'),None)
            if not location:raise ValueError('Google no inició la subida del audio.')
            offset=0
            with path.open('rb') as source:
                while offset<before.st_size:
                    chunk=source.read(8*1024*1024)
                    if not chunk:raise ValueError('El archivo cambió durante la subida.')
                    end=offset+len(chunk)-1
                    status,_,response=self.google(location,'PUT',chunk,
                        {'Content-Type':mime,'Content-Range':f'bytes {offset}-{end}/{before.st_size}'})
                    if status not in (200,201,308):raise ValueError('No se pudo completar la subida a Drive.')
                    offset=end+1;progress(f'Subiendo {audio["nombre"]}: {round(offset/before.st_size*100)} %')
                    if status!=308:remote=response
            if not remote or not remote.get('id'):raise ValueError('No se recibió la confirmación del archivo en Drive.')
            # Cachear antes de compartir permite reintentar sin subir otro WAV completo.
            with self.connect() as db:
                db.execute('INSERT OR REPLACE INTO portal_drive VALUES(?,?,?,?)',
                    (audio['id'],project,checksum,json.dumps(remote)))
        after=path.stat()
        if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
            raise ValueError('El archivo cambió durante la subida. Volvé a publicar cuando termine de guardarse.')
        permissions=self.google('https://www.googleapis.com/drive/v3/files/'+remote['id']+'/permissions?fields=permissions(id,type,role)')[2]
        if not any(p.get('type')=='anyone' and p.get('role')=='reader' for p in permissions.get('permissions',[])):
            self.google('https://www.googleapis.com/drive/v3/files/'+remote['id']+'/permissions','POST',
                        {'type':'anyone','role':'reader','allowFileDiscovery':False})
        return remote
    def publish(self,pid,data,progress):
        email=str(data.get('email','')).strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or len(email)>254:
            raise ValueError('Ingresá el correo del artista para su acceso.')
        password=data.get('password','')
        if not isinstance(password,str) or (password and not 8<=len(password)<=128):
            raise ValueError('La contraseña debe tener entre 8 y 128 caracteres.')
        days=data.get('dias',7)
        try:days=int(days)
        except (ValueError,TypeError):raise ValueError('Ingresá la cantidad de días.')
        if not 1<=days<=365:raise ValueError('El vencimiento debe ser de 1 a 365 días.')
        project=self.config['projectId']
        with self.connect() as db:
            playlist=playlist_data(db,pid)
            old=db.execute('SELECT * FROM portal_publicaciones WHERE playlist_id=? AND proyecto=?',(pid,project)).fetchone()
        if not playlist['audios']:raise ValueError('La playlist está vacía.')
        if len(playlist['audios'])>100:raise ValueError('Cada portal admite hasta 100 audios por playlist.')
        if any(not audio['disponible'] or not audio['tamano'] for audio in playlist['audios']):
            raise ValueError('Hay audios vacíos o no disponibles. Revisalos antes de publicar.')
        progress('Comprobando que el portal esté instalado…')
        self.check_ready()
        self.ensure_site_current(progress)
        identity=old['id'] if old else uuid.uuid4().hex
        url='https://'+self.config['siteId']+'.web.app/p/'+identity
        if not old:
            # Reservar la dirección evita crear otra publicación si se interrumpe
            # la operación. No se marca Publicado hasta confirmar Firestore.
            with self.connect() as db:
                db.execute('INSERT INTO portal_publicaciones(id,playlist_id,proyecto,email,url,estado) VALUES(?,?,?,?,?,?)',
                    (identity,pid,project,email,url,'Preparando'))
        previous=self.get_document(identity)
        existing=decode(previous or {})
        created_password=''
        if existing.get('artistEmail')==email and existing.get('artistUid'):
            artist_uid=existing['artistUid']
            if password:
                # Ingresar otra contraseña aquí no debe reemplazar la guardada
                # sin verificarla, ni simular un cambio de clave en Firebase.
                try:
                    verified=http_request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+self.config['apiKey'],
                        'POST',{'email':email,'password':password,'returnSecureToken':True})[2]
                except CloudError as error:
                    if error.code in ('INVALID_PASSWORD','INVALID_LOGIN_CREDENTIALS'):
                        raise ValueError('Esa contraseña no es la que ya tiene el artista. Para actualizar la playlist dejá el campo de contraseña vacío: se conserva la actual (la ves con «Copiar datos de acceso»).') from None
                    raise
                if verified['localId']!=artist_uid:raise ValueError('El acceso no corresponde al artista de esta entrega.')
                created_password=password
        else:
            if not password:
                raise ValueError('Ingresá la contraseña para crear o verificar el acceso del artista. Luego se conservará al actualizar la playlist.')
            progress('Preparando la cuenta de acceso del artista…')
            candidate=password
            url='https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+self.config['apiKey']
            try:
                account=http_request(url,'POST',{'email':email,'password':candidate,'returnSecureToken':True})[2]
                created_password=candidate
            except CloudError as error:
                # Nunca apropiarse de un correo ya registrado sin verificar su clave.
                if not password:raise
                account=http_request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+self.config['apiKey'],
                    'POST',{'email':email,'password':password,'returnSecureToken':True})[2]
                created_password=password
            artist_uid=account['localId']
        items=[]
        for index,audio in enumerate(playlist['audios']):
            progress(f'Audio {index+1} de {len(playlist["audios"])}: {audio["nombre"]}')
            remote=self.upload_audio(audio,project,progress)
            items.append(dict(id=audio['id'],driveId=remote['id'],resourceKey=remote.get('resourceKey',''),
                driveView=remote.get('webViewLink') or 'https://drive.google.com/file/d/'+remote['id']+'/view',
                titulo=audio['titulo'],artista=audio['artista'],disco=audio['disco'] or '',nombre=audio['nombre'],
                clase=audio['clase'],version=audio['version'],cancionId=audio['cancion_id'],duracion=audio['tecnica'].get('duracion',0),
                peaks=audio_peaks(audio['ruta'])))
        payload=dict(title=playlist['nombre'],producerName=self.config['producerName'],color=self.config['color'],
            artistEmail=email,artistUid=artist_uid,expiresAt=datetime.fromtimestamp(time.time()+days*86400,timezone.utc),
            revoked=False,allowDownload=bool(data.get('descarga',False)),items=json.dumps(items,ensure_ascii=False),
            updatedAt=datetime.now(timezone.utc),publicAudio=True,
            revision=int(existing.get('revision',0))+1,
            audioKeys={item['id']:item['driveId'] for item in items},
            audioSongs={item['id']:item['cancionId'] for item in items},
            audioLabels={item['id']:' · '.join(filter(None,[item['titulo'],item['clase'],item['version'],item['nombre']])) for item in items})
        payload['replies']=json.dumps(self.build_replies(identity,items,progress),ensure_ascii=False)
        payload['repliesUpdatedAt']=datetime.now(timezone.utc)
        progress('Publicando la selección del artista…')
        self.save_document(identity,payload,previous)
        url='https://'+self.config['siteId']+'.web.app/p/'+identity
        with self.connect() as db:
            db.execute('''INSERT INTO portal_publicaciones(id,playlist_id,proyecto,email,artist_uid,url,estado)
                VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,artist_uid=excluded.artist_uid,
                url=excluded.url,estado=excluded.estado,actualizado=CURRENT_TIMESTAMP''',
                (identity,pid,project,email,artist_uid,url,'Publicado'))
        return dict(id=identity,url=url,email=email,password=created_password,
                    mensaje='Playlist publicada. El enlace conserva su dirección al actualizarla.')


def register_cloud_portal(app,connect,data_folder):
    sessions={};jobs={};active=threading.Lock()
    def session():
        root=Path(data_folder()).resolve()
        if str(root) not in sessions:sessions[str(root)]=GoogleSession(CredentialStore(root/'portal-google.dpapi'))
        return sessions[str(root)]
    def config():
        with connect() as db:row=db.execute('SELECT datos FROM portal_config WHERE id=1').fetchone()
        if not row:raise ValueError('Primero configurá el proyecto Firebase.')
        return json.loads(row['datos'])
    def run(kind,callback):
        if not active.acquire(blocking=False):raise ValueError('Ya hay una operación de publicación en curso.')
        identity=uuid.uuid4().hex
        jobs[identity]=dict(estado='trabajando',mensaje='Preparando…',tipo=kind)
        def worker():
            step={'paso':''}
            def progress(message):
                step['paso']=message;jobs[identity].update(mensaje=message)
            try:
                result=callback(progress)
                jobs[identity].update(estado='completado',resultado=result)
            except Exception as error:
                text=str(error) if isinstance(error,ValueError) else 'La operación no terminó. Podés reintentar; los originales se conservan.'
                if step['paso'] and isinstance(error,CloudError):text+=' — Paso: '+step['paso'].rstrip('…')
                app.logger.warning('Portal (%s) falló en «%s»: %s',kind,step['paso'],text)
                jobs[identity].update(estado='error',mensaje=text)
            finally:active.release()
        threading.Thread(target=worker,daemon=True).start()
        return jsonify(id=identity),202
    from portal_feedback import register_feedback
    register_feedback(app,connect,lambda:Publisher(connect,session(),config()),data_folder)
    @app.get('/api/portal/config')
    def cloud_status():
        with connect() as db:row=db.execute('SELECT datos FROM portal_config WHERE id=1').fetchone()
        return jsonify(config=json.loads(row['datos']) if row else {},google=session().configured(),ocupado=active.locked())
    @app.post('/api/portal/config')
    def cloud_configure():
        if active.locked():raise ValueError('Esperá a que termine la publicación antes de cambiar de proyecto.')
        values=public_config(request.get_json() or {})
        with connect() as db:db.execute('INSERT OR REPLACE INTO portal_config VALUES(1,?)',(json.dumps(values),))
        return jsonify(ok=True)
    @app.post('/api/portal/google/cliente')
    def cloud_client():
        if active.locked() or session().busy:raise ValueError('Esperá a que termine la operación actual.')
        file=request.files.get('file')
        if not file:raise ValueError('Elegí el archivo de cliente OAuth.')
        try:values=json.loads(file.read(65536))
        except (ValueError,UnicodeError):raise ValueError('El archivo OAuth debe ser JSON válido.')
        session().import_client(values)
        return jsonify(ok=True)
    @app.post('/api/portal/conexion/importar')
    def cloud_import_connection():
        """Un perfil de conexión evita pedirle código o claves al productor.

        Es una configuración preparada por el administrador del servicio. No
        admite cuentas de servicio ni importa tokens de otra computadora.
        Cada usuario deberá autorizar su propia cuenta de Google.
        """
        if active.locked() or session().busy:raise ValueError('Esperá a que termine la operación actual.')
        file=request.files.get('file')
        if not file:raise ValueError('Elegí el perfil de conexión de AudioTaller.')
        try:profile=json.loads(file.read(65536))
        except (ValueError,UnicodeError):raise ValueError('El perfil no es válido.')
        if not isinstance(profile,dict) or profile.get('format')!='audiotaller-portal-v1' or set(profile)-{'format','config','installed'}:
            raise ValueError('Usá un perfil de conexión de AudioTaller, sin tokens ni claves privadas de servidor.')
        values=public_config(profile.get('config',{}));client=profile.get('installed')
        if client is not None:
            if not isinstance(client,dict) or set(client)-{'client_id','client_secret'}:raise ValueError('Cliente de escritorio inválido.')
            session().import_client({'installed':client})
        with connect() as db:db.execute('INSERT OR REPLACE INTO portal_config VALUES(1,?)',(json.dumps(values),))
        return jsonify(ok=True,mensaje='Conexión importada. Ahora autorizá tu propia cuenta de Google.')
    @app.post('/api/portal/google/conectar')
    def cloud_login():
        session().start();return jsonify(ok=True)
    @app.post('/api/portal/google/desconectar')
    def cloud_logout():
        if active.locked() or session().busy:raise ValueError('Esperá a que termine la operación actual.')
        session().disconnect();return jsonify(ok=True)
    @app.post('/api/portal/instalar')
    def cloud_install():
        if (request.get_json() or {}).get('proyecto_dedicado') is not True:
            raise ValueError('Confirmá que el proyecto Firebase es exclusivo de AudioTaller antes de instalar sus reglas y su web.')
        publisher=Publisher(connect,session(),config())
        return run('instalar',publisher.install)
    @app.get('/api/portal/tareas/<identity>')
    def cloud_job(identity):
        if identity not in jobs:return jsonify(error='La tarea se interrumpió al cerrar la aplicación. Revisá el estado del portal antes de reintentar.'),404
        return jsonify(jobs[identity])
    @app.post('/api/playlists/<pid>/publicar-web')
    def cloud_publish(pid):
        data=request.get_json() or {}
        if data.get('audios_publicos') is not True:
            raise ValueError('Confirmá que los audios se compartirán por enlace en Drive.')
        publisher=Publisher(connect,session(),config())
        def publish_and_remember(progress):
            # Permite volver a copiar la invitación. Sólo en el almacén cifrado
            # del productor, nunca dentro de Firestore ni de la base SQLite.
            vault=CredentialStore(Path(data_folder())/'portal-accesos.dpapi')
            values=vault.read();key=publisher.config['projectId']+':'+str(data.get('email','')).strip().lower()
            prepared=dict(data)
            if not prepared.get('password') and values.get(key):prepared['password']=values[key]
            result=publisher.publish(pid,prepared,progress)
            password=result.get('password')
            if password:values[key]=password;vault.write(values)
            result['password']=password or values.get(key,'')
            return result
        return run('publicar',publish_and_remember)
    @app.get('/api/playlists/<pid>/publicaciones-web')
    def cloud_published(pid):
        with connect() as db:
            required_row(db,'playlists',pid)
            return jsonify([dict(row) for row in db.execute('SELECT * FROM portal_publicaciones WHERE playlist_id=?',(pid,))])
    @app.post('/api/portal/publicaciones/<identity>/respuestas')
    def cloud_send_replies(identity):
        with connect() as db:required_row(db,'portal_publicaciones',identity)
        publisher=Publisher(connect,session(),config())
        return run('respuestas',lambda progress:publisher.send_replies(identity,progress))
    @app.post('/api/portal/publicaciones/<identity>/revocar')
    def cloud_revoke(identity):
        if active.locked():raise ValueError('Esperá a que termine la publicación.')
        with connect() as db:publication=dict(required_row(db,'portal_publicaciones',identity))
        values=config()
        if publication['proyecto']!=values['projectId']:raise ValueError('Conectá el proyecto de esta publicación antes de revocarla.')
        publisher=Publisher(connect,session(),values);previous=publisher.get_document(identity)
        if previous:
            payload=decode(previous)
            payload['revoked']=True
            payload['expiresAt']=datetime.fromisoformat(payload['expiresAt'].replace('Z','+00:00'))
            payload['updatedAt']=datetime.now(timezone.utc)
            publisher.save_document(identity,payload,previous)
        with connect() as db:db.execute("UPDATE portal_publicaciones SET estado='Revocado' WHERE id=?",(identity,))
        return jsonify(ok=True,mensaje='Portal revocado. Los enlaces directos de Drive siguen compartidos.')
