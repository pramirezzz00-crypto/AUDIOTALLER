"""OAuth de escritorio y almacén de credenciales por usuario de Windows.

No incluye claves de proyecto ni contraseñas en el repositorio. DPAPI vincula
el archivo cifrado a la cuenta local; la API de estado nunca devuelve tokens.
"""
import base64
import ctypes
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
import webbrowser
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer


class CloudError(ValueError):
    def __init__(self,message,status):
        super().__init__(message);self.status=status


def http_request(url, method='GET', data=None, headers=None, raw=False):
    """Un único transporte facilita pruebas sin cuentas ni publicación real."""
    if not url.startswith('https://'):
        raise ValueError('Los servicios externos requieren HTTPS.')
    request_headers=dict(headers or {})
    if isinstance(data,dict):
        data=json.dumps(data).encode();request_headers.setdefault('Content-Type','application/json')
    request=urllib.request.Request(url,data=data,headers=request_headers,method=method)
    try:
        with urllib.request.urlopen(request,timeout=90) as response:
            content=response.read(8*1024*1024)
            return response.status,dict(response.headers),content if raw else (json.loads(content) if content else {})
    except urllib.error.HTTPError as error:
        if error.code==308:
            return 308,dict(error.headers),{}
        # No reproducir cuerpos, URLs de subida o credenciales en el registro.
        try:
            content=json.loads(error.read(16384))
            detail=content.get('error',{})
            message=detail.get('message','') if isinstance(detail,dict) else str(detail)
        except (ValueError,AttributeError):
            message=''
        names={'EMAIL_EXISTS':'Ese correo ya tiene una cuenta. Indicá su contraseña actual para vincularlo.',
               'OPERATION_NOT_ALLOWED':'Habilitá Correo/contraseña en Firebase Authentication.',
               'INVALID_LOGIN_CREDENTIALS':'Correo o contraseña incorrectos.',
               'API_KEY_INVALID':'Revisá la clave web de Firebase.',
               'CONFIGURATION_NOT_FOUND':'Inicializá Firebase Authentication en el proyecto.'}
        if error.code==404:
            message='Recurso no encontrado. Revisá el proyecto, Firestore y los servicios habilitados.'
        elif message in names:
            message=names[message]
        else:
            message='Google rechazó la operación. Revisá los permisos, APIs habilitadas y espacio disponible.'
        raise CloudError(f'{message} (HTTP {error.code})',error.code) from None
    except urllib.error.URLError:
        raise ValueError('No se pudo conectar con Google. Revisá Internet y volvé a intentar.') from None


def form_post(url,values):
    return http_request(url,'POST',urllib.parse.urlencode(values).encode(),
                        {'Content-Type':'application/x-www-form-urlencoded'})[2]


def protect(data, decrypt=False):
    if os.name!='nt':
        raise ValueError('El almacén de credenciales de esta instalación requiere Windows.')
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_byte))]
    buffer=ctypes.create_string_buffer(data)
    source=Blob(len(data),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_byte)))
    result=Blob()
    operation=ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not operation(ctypes.byref(source),None,None,None,None,1,ctypes.byref(result)):
        raise ValueError('Windows no pudo abrir el almacén de credenciales. Reconectá la cuenta.')
    try:
        return ctypes.string_at(result.data,result.size)
    finally:
        ctypes.windll.kernel32.LocalFree(result.data)


class CredentialStore:
    def __init__(self,path):
        self.path=Path(path)
    def read(self):
        if not self.path.exists():
            return {}
        return json.loads(protect(self.path.read_bytes(),decrypt=True))
    def write(self,values):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        temporary=self.path.with_suffix('.tmp')
        temporary.write_bytes(protect(json.dumps(values).encode()))
        os.replace(temporary,self.path)


class GoogleSession:
    def __init__(self,store):
        self.store=store;self.lock=threading.RLock();self.status='Sin conectar';self.busy=False
    def import_client(self,data):
        client=data.get('installed',{}) if isinstance(data,dict) else {}
        if not isinstance(client,dict) or not isinstance(client.get('client_id'),str) or not client['client_id'].endswith('.apps.googleusercontent.com') or not isinstance(client.get('client_secret'),str):
            raise ValueError('Elegí el archivo OAuth JSON de una aplicación de escritorio de Google.')
        with self.lock:
            old=self.store.read()
            if old.get('client_id')!=client['client_id']:
                old={}
            old.update(client_id=client['client_id'],client_secret=client['client_secret'])
            self.store.write(old)
    def configured(self):
        values=self.store.read()
        status='Cuenta conectada' if values.get('refresh_token') and self.status=='Sin conectar' else self.status
        return dict(cliente=bool(values.get('client_id')),conectado=bool(values.get('refresh_token')),
                    estado=status,esperando=self.busy)
    def token(self):
        with self.lock:
            values=self.store.read()
            if values.get('access_token') and values.get('expires',0)>time.time()+120:
                return values['access_token']
            if not values.get('refresh_token'):
                raise ValueError('Primero conectá tu cuenta de Google.')
            result=form_post('https://oauth2.googleapis.com/token',dict(grant_type='refresh_token',
                client_id=values['client_id'],client_secret=values['client_secret'],refresh_token=values['refresh_token']))
            values.update(access_token=result['access_token'],expires=time.time()+int(result.get('expires_in',3600)))
            self.store.write(values)
            return values['access_token']
    def disconnect(self):
        with self.lock:
            old=self.store.read()
            self.store.write({key:old[key] for key in ('client_id','client_secret') if key in old})
            self.status='Desconectado en esta computadora'
    def start(self):
        if self.busy:
            raise ValueError('Ya hay una autorización en curso.')
        if not self.configured()['cliente']:
            raise ValueError('Primero importá el cliente OAuth de escritorio.')
        self.busy=True;self.status='Esperando autorización en el navegador'
        threading.Thread(target=self._authorize,daemon=True).start()
    def _authorize(self):
        state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(64)
        code={};owner=self
        class Callback(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                parsed=urllib.parse.urlparse(self.path);query=urllib.parse.parse_qs(parsed.query)
                if parsed.path!='/oauth/callback' or not secrets.compare_digest(query.get('state',[''])[0],state):
                    self.send_error(400);return
                code.update(code=query.get('code',[''])[0],error=query.get('error',[''])[0])
                self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers()
                self.wfile.write('<p>Podés cerrar esta pestaña y volver a AudioTaller.</p>'.encode())
        try:
            with HTTPServer(('127.0.0.1',0),Callback) as server:
                server.timeout=1
                redirect=f'http://127.0.0.1:{server.server_port}/oauth/callback'
                values=self.store.read()
                params=dict(client_id=values['client_id'],redirect_uri=redirect,response_type='code',access_type='offline',
                    prompt='consent',state=state,code_challenge_method='S256',
                    code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),
                    scope='https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/cloud-platform')
                webbrowser.open('https://accounts.google.com/o/oauth2/v2/auth?'+urllib.parse.urlencode(params))
                deadline=time.monotonic()+300
                while not code and time.monotonic()<deadline:server.handle_request()
                if not code.get('code'):
                    raise ValueError('La autorización se canceló o venció. Podés volver a conectar.')
                result=form_post('https://oauth2.googleapis.com/token',dict(client_id=values['client_id'],
                    client_secret=values['client_secret'],code=code['code'],code_verifier=verifier,
                    redirect_uri=redirect,grant_type='authorization_code'))
                if not result.get('refresh_token'):
                    raise ValueError('Google no devolvió acceso duradero. Volvé a autorizar la cuenta.')
                values.update(access_token=result['access_token'],refresh_token=result['refresh_token'],
                              expires=time.time()+int(result.get('expires_in',3600)))
                with self.lock:self.store.write(values)
                self.status='Cuenta conectada'
        except Exception as error:
            self.status=str(error) if isinstance(error,ValueError) else 'No se pudo completar la autorización.'
        finally:self.busy=False
