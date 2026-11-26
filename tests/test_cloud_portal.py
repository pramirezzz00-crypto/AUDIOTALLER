"""Contratos externos simulados: no sube archivos ni crea cuentas reales."""
import copy
import gzip
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from cloud_auth import CredentialStore,GoogleSession,CloudError
from cloud_portal import Publisher,decode,public_config
from catalog import playlist_data

CONFIG=dict(projectId='audiotaller-test',apiKey='AIza'+'X'*35,driveApiKey='AIza'+'Y'*35,
            siteId='audiotaller-test-portal',producerName='Mi estudio',color='#55d6be')


class CloudPortalTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.root=Path(self.tmp.name).resolve();app.DB=self.root/'db.sqlite3';app.LIBRARY=self.root/'Artistas'
        self.c=app.app.test_client()
        aid=self.c.post('/api/artistas',json={'nombre':'Artista'}).json['id']
        self.sid=self.c.post('/api/artistas/'+aid+'/canciones',json={'titulo':'Tema'}).json['id']
        self.file=self.c.post('/api/produccion/'+self.sid+'/archivos/mezcla',data={'file':(io.BytesIO(b'audio de prueba'),'Mix.wav')}).json['id']
        self.pid=self.c.post('/api/playlists',json={'nombre':'Escucha','notas':'Privado','archivos':[self.file]}).json['id']
        self.publisher=Publisher(app.db_open,Mock(token=lambda:'TOKEN_SIMULADO'),CONFIG)
    def tearDown(self):self.tmp.cleanup()

    def test_configuracion_no_expone_secretos_y_requiere_confirmacion(self):
        self.assertEqual(self.c.post('/api/portal/config',json=CONFIG).status_code,200)
        data=self.c.get('/api/portal/config').json
        self.assertFalse(data['google']['conectado'])
        self.assertNotIn('access_token',json.dumps(data))
        self.assertEqual(self.c.post('/api/portal/instalar',json={}).status_code,400)
        self.assertEqual(self.c.post('/api/playlists/'+self.pid+'/publicar-web',json={}).status_code,400)
        with self.assertRaises(ValueError):public_config({**CONFIG,'projectId':'../otro'})

    @unittest.skipUnless(os.name=='nt','DPAPI es específico de Windows')
    def test_credenciales_cifradas_y_actualizacion_de_token(self):
        store=CredentialStore(self.root/'secret.dpapi')
        store.write({'client_id':'demo.apps.googleusercontent.com','client_secret':'SECRETO_PRUEBA','refresh_token':'REFRESH_PRUEBA'})
        self.assertNotIn(b'REFRESH_PRUEBA',store.path.read_bytes())
        self.assertEqual(store.read()['refresh_token'],'REFRESH_PRUEBA')
        session=GoogleSession(store)
        with patch('cloud_auth.form_post',return_value={'access_token':'ACCESS_PRUEBA','expires_in':3600}) as network:
            self.assertEqual(session.token(),'ACCESS_PRUEBA');self.assertEqual(session.token(),'ACCESS_PRUEBA')
            self.assertEqual(network.call_count,1)
        self.assertNotIn('refresh_token',session.configured())
        session.disconnect();self.assertFalse(session.configured()['conectado'])

    def test_subida_reutiliza_copia_y_no_toca_original(self):
        with app.db_open() as db:audio=playlist_data(db,self.pid)['audios'][0]
        original=Path(audio['ruta']).read_bytes();calls=[]
        def google(url,method='GET',data=None,headers=None,raw=False):
            calls.append((url,method,data))
            if 'uploadType=resumable' in url:return 200,{'Location':'https://www.googleapis.com/upload/prueba'},{}
            if url.endswith('/upload/prueba'):return 200,{},dict(id='drive-file',webViewLink='https://drive.google.com/file/d/drive-file/view')
            if '/permissions' in url:return 200,{},dict(permissions=[{'id':'anyone','type':'anyone','role':'reader'}])
            return 200,{},dict(id='drive-file')
        with patch.object(self.publisher,'google',side_effect=google):
            first=self.publisher.upload_audio(audio,CONFIG['projectId'],lambda message:None)
            second=self.publisher.upload_audio(audio,CONFIG['projectId'],lambda message:None)
        self.assertEqual(first['id'],second['id'])
        self.assertEqual(sum('uploadType=resumable' in url for url,_,_ in calls),1)
        self.assertEqual(Path(audio['ruta']).read_bytes(),original)

    def test_publicar_y_reemplazar_conserva_url_y_acceso(self):
        remote={};accounts=[]
        def get(identity):return remote.get(identity)
        def save(identity,payload,previous=None):
            from cloud_portal import fields
            remote[identity]={'fields':fields(payload),'updateTime':'2026-11-07T01:00:00Z'}
            return remote[identity]
        def account(*args,**kwargs):accounts.append(args);return 200,{},dict(localId='artist-uid')
        with patch.object(self.publisher,'check_ready'),patch.object(self.publisher,'ensure_site_current'),patch.object(self.publisher,'get_document',side_effect=get),patch.object(self.publisher,'save_document',side_effect=save),\
             patch.object(self.publisher,'upload_audio',return_value=dict(id='drive-file')),patch('cloud_portal.http_request',side_effect=account):
            first=self.publisher.publish(self.pid,dict(email='artista@example.com',password='Prueba123',dias=7),lambda msg:None)
            self.c.post('/api/playlists/'+self.pid,json={'nombre':'Otra selección','revision':1,'archivos':[self.file]})
            second=self.publisher.publish(self.pid,dict(email='artista@example.com',dias=14),lambda msg:None)
        self.assertEqual(first['url'],second['url']);self.assertEqual(len(accounts),1)
        self.assertTrue(first['password']);self.assertFalse(second['password'])
        doc=decode(remote[first['id']]);self.assertEqual(doc['title'],'Otra selección')
        self.assertNotIn('Privado',str(doc));self.assertNotIn('ruta',str(doc));self.assertNotIn('password',str(doc))

    def test_instalar_solo_static_auth_rules_sin_servicios_pagos(self):
        calls=[];uploaded=[]
        def google(url,method='GET',data=None,headers=None,raw=False):
            calls.append((url,method,data))
            if '/databases/(default)' in url:return 200,{},{}
            if '/projects/' in url and '/sites/' in url and method=='GET':raise CloudError('Falta sitio',404)
            if url.endswith('/rulesets'):return 200,{},dict(name='projects/audiotaller-test/rulesets/rule')
            if url.endswith('/releases/cloud.firestore') and method=='GET':raise CloudError('Falta release',404)
            if url.endswith('/versions') and method=='POST':return 200,{},dict(name='sites/audiotaller-test-portal/versions/new')
            if url.endswith(':populateFiles'):
                return 200,{},dict(uploadRequiredHashes=list(data['files'].values()),uploadUrl='https://upload-firebasehosting.googleapis.com/files')
            if 'upload-firebasehosting' in url:uploaded.append(gzip.decompress(data));return 200,{},b''
            return 200,{},{}
        with patch.object(self.publisher,'google',side_effect=google):
            result=self.publisher.install(lambda message:None)
        self.assertTrue(result['url'].endswith('.web.app'))
        self.assertEqual(len(uploaded),4)
        deployment=next(data for url,method,data in calls if url.endswith('/versions') and method=='POST')
        self.assertEqual(deployment['config']['headers'][0]['headers']['Referrer-Policy'],'strict-origin-when-cross-origin')
        self.assertFalse(any('cloudrun' in url.lower() or 'billing' in url.lower() or 'storage.googleapis.com' in url for url,_,_ in calls))
        config=next(value for value in uploaded if value.startswith(b'{'))
        self.assertNotIn(b'TOKEN_SIMULADO',config)

    def test_error_de_subida_no_reemplaza_documento_publicado(self):
        with patch.object(self.publisher,'check_ready'),patch.object(self.publisher,'ensure_site_current'),patch.object(self.publisher,'get_document',return_value={'fields':{'artistEmail':{'stringValue':'artista@example.com'},'artistUid':{'stringValue':'uid'}}}),\
             patch.object(self.publisher,'upload_audio',side_effect=ValueError('Sin espacio')),patch.object(self.publisher,'save_document') as save:
            with self.assertRaises(ValueError):self.publisher.publish(self.pid,dict(email='artista@example.com'),lambda msg:None)
            save.assert_not_called()

    def test_devoluciones_sincroniza_y_conserva_seguimiento_e_historial(self):
        from cloud_portal import fields
        self.c.post('/api/portal/config',json=CONFIG)
        with app.db_open() as db:
            db.execute('INSERT INTO portal_publicaciones(id,playlist_id,proyecto,email) VALUES(?,?,?,?)',('portal',self.pid,CONFIG['projectId'],'artista@example.com'))
        note=dict(artistUid='uid',audioId=self.file,songId=self.sid,driveId='drive-old',revision=1,
                  audioLabel='Mix V1',body='<script>nota literal</script>',positionSeconds=12.5,createdAt='2026-11-07T10:00:00Z')
        page={'documents':[dict(name='projects/test/portals/portal/feedback/message',fields=fields(note))]}
        with patch.object(Publisher,'google',return_value=(200,{},page)):
            result=self.c.post('/api/portal/devoluciones/sincronizar',json={'playlist_id':self.pid})
            self.assertEqual(result.json['nuevas'],1)
            message=self.c.get('/api/portal/devoluciones?cancion_id='+self.sid).json[0]
            self.assertEqual(message['segundo'],12.5)
            self.assertEqual(self.c.post('/api/portal/devoluciones/'+message['id'],json={'estado':'Resuelta','nota_interna':'Ajustado en V2'}).status_code,200)
            self.c.post('/api/playlists/'+self.pid,json={'nombre':'Otra selección','revision':1,'archivos':[]})
            self.assertEqual(self.c.post('/api/portal/devoluciones/sincronizar',json={}).json['nuevas'],0)
        history=self.c.get('/api/portal/devoluciones?playlist_id='+self.pid).json
        self.assertEqual(len(history),1);self.assertEqual(history[0]['estado'],'Resuelta')
        self.assertEqual(history[0]['nota_interna'],'Ajustado en V2');self.assertEqual(history[0]['revision'],1)
        self.assertEqual(history[0]['texto'],note['body'])

    def test_importa_perfil_sin_aceptar_tokens_de_terceros(self):
        profile=dict(format='audiotaller-portal-v1',config=CONFIG,installed={'client_id':'demo.apps.googleusercontent.com','client_secret':'desktop'})
        result=self.c.post('/api/portal/conexion/importar',data={'file':(io.BytesIO(json.dumps(profile).encode()),'conexion.json')})
        self.assertEqual(result.status_code,200)
        self.assertTrue(self.c.get('/api/portal/config').json['google']['cliente'])
        profile['refresh_token']='NO_IMPORTAR'
        self.assertEqual(self.c.post('/api/portal/conexion/importar',data={'file':(io.BytesIO(json.dumps(profile).encode()),'conexion.json')}).status_code,400)

    def test_destinatario_desde_ficha_y_estado_invalido(self):
        with app.db_open() as db:
            aid=db.execute('SELECT artista_id FROM canciones WHERE id=?',(self.sid,)).fetchone()[0]
        self.c.post('/api/artistas/'+aid,json={'nombre':'Artista','perfil':{'correos':'uno@example.com; dos@example.com'}})
        recipients=self.c.get('/api/portal/destinatarios').json
        self.assertEqual(recipients[0]['correos'],['uno@example.com','dos@example.com'])
        self.assertEqual(self.c.post('/api/portal/devoluciones/inexistente',json={'estado':'Cualquier cosa'}).status_code,400)

    def test_snapshots_remotos_tienen_revision_y_audio_para_validar_devolucion(self):
        from cloud_portal import fields
        with patch.object(self.publisher,'check_ready'),patch.object(self.publisher,'ensure_site_current'),patch.object(self.publisher,'get_document',return_value={'updateTime':'before','fields':fields(dict(artistEmail='artista@example.com',artistUid='uid',revision=4))}),\
             patch.object(self.publisher,'upload_audio',return_value={'id':'drive-new'}),patch.object(self.publisher,'save_document') as save:
            self.publisher.publish(self.pid,dict(email='artista@example.com'),lambda msg:None)
            payload=save.call_args.args[1]
        self.assertEqual(payload['revision'],5);self.assertEqual(payload['audioKeys'][self.file],'drive-new')
        self.assertEqual(payload['audioSongs'][self.file],self.sid)
        self.assertIn('Mix.wav',payload['audioLabels'][self.file])
        self.assertEqual(decode({'fields':fields(payload)})['audioKeys'],payload['audioKeys'])

    @unittest.skipUnless(os.name=='nt','DPAPI requiere Windows')
    def test_invitacion_cifrada_reutiliza_acceso_sin_guardarlo_en_sqlite(self):
        self.c.post('/api/portal/config',json=CONFIG)
        def finish(task):
            deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                job=self.c.get('/api/portal/tareas/'+task.json['id']).json
                if job['estado']!='trabajando':return job
                time.sleep(.01)
            self.fail('Tarea no finalizó')
        result=dict(id='portal',url='https://test.web.app/p/portal',email='artista@example.com',password='InvitacionSegura123',mensaje='ok')
        with patch.object(Publisher,'publish',return_value=result.copy()):
            job=finish(self.c.post('/api/playlists/'+self.pid+'/publicar-web',json={'email':result['email'],'password':result['password'],'audios_publicos':True}))
        self.assertEqual(job['estado'],'completado')
        vault=self.root/'portal-accesos.dpapi'
        self.assertTrue(vault.exists());self.assertNotIn(result['password'].encode(),vault.read_bytes())
        self.assertNotIn(result['password'].encode(),app.DB.read_bytes())
        with patch.object(Publisher,'publish',return_value={**result,'password':''}) as publish:
            job=finish(self.c.post('/api/playlists/'+self.pid+'/publicar-web',json={'email':result['email'],'audios_publicos':True}))
            self.assertEqual(publish.call_args.args[1]['password'],result['password'])
        self.assertEqual(job['resultado']['password'],result['password'])
