"""Ficha atómica, catálogo no destructivo y controles reales de entrega local."""
import copy
import io
import json
import os
import struct
import sys
import tempfile
import time
import unittest
import wave
import zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from catalog import wav_header
from portal_server import create_app


def wav_bytes():
    stream=io.BytesIO()
    with wave.open(stream,'wb') as audio:
        audio.setnchannels(2);audio.setsampwidth(2);audio.setframerate(48000)
        audio.writeframes(struct.pack('<hh',1000,-1000)*4800)
    return stream.getvalue()


class CatalogHubTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.root=Path(self.tmp.name).resolve()
        app.DB=self.root/'db.sqlite3';app.LIBRARY=self.root/'Artistas'
        self.c=app.app.test_client()
        self.aid=self.c.post('/api/artistas',json={'nombre':'Artista'}).json['id']
        self.mid=self.c.post('/api/artistas',json={'nombre':'María','tipo':'Músico'}).json['id']
        self.sid=self.c.post('/api/artistas/'+self.aid+'/canciones',json={'titulo':'Tema'}).json['id']
        self.first=self.upload('mastering','Master.wav')
        self.second=self.upload('mezcla','Mix.wav')

    def tearDown(self):
        self.tmp.cleanup()

    def upload(self,stage,name):
        result=self.c.post('/api/produccion/'+self.sid+'/archivos/'+stage,data={'file':(io.BytesIO(wav_bytes()),name)})
        self.assertEqual(result.status_code,201,result.data)
        return result.json['id']

    def card(self):
        result=self.c.get('/api/canciones/'+self.sid+'/ficha').json
        result['ficha']={'letra':'Canción de la montaña','etiquetas':['Acústico','Nostalgia'],
            'campos':{'clima':'íntimo'},'anio':'2026','notas':'Secreto interno',
            'publicacion':{},'links':{}}
        result['cancion'].update(bpm='91.5',tonalidad='Am',metadata='No compartir',estado='Finalizada')
        result['obra']={'genero':'Folk','idioma':'Español','iswc':'T1234567890','notas':'Privado'}
        result['grabaciones']=[{'nombre':'Master streaming','isrc':'ARABC2600001'}]
        result['creditos']=[{'persona_id':self.mid,'rol':'Compositora'}]
        return result

    def save_card(self):
        result=self.c.post('/api/canciones/'+self.sid+'/ficha',json=self.card())
        self.assertEqual(result.status_code,200,result.data)
        return result.json

    def playlist(self,ids=None):
        result=self.c.post('/api/playlists',json={'nombre':'Selección','notas':'Comentario privado','archivos':ids or [self.first,self.second]})
        self.assertEqual(result.status_code,200,result.data)
        return result.json

    def delivery(self,pid,**values):
        result=self.c.post('/api/playlists/'+pid+'/entregas',json={'dias':7,**values})
        self.assertEqual(result.status_code,201,result.data)
        return result.json

    def test_ficha_atomica_y_rechaza_edicion_obsoleta(self):
        old=self.card();saved=self.c.post('/api/canciones/'+self.sid+'/ficha',json=old).json
        self.assertEqual(saved['ficha']['letra'],'Canción de la montaña')
        self.assertEqual(saved['creditos'][0]['persona'],'María')
        self.assertEqual(self.c.post('/api/canciones/'+self.sid+'/ficha',json=old).status_code,400)
        invalid=copy.deepcopy(saved);invalid['cancion']['titulo']='No guardar';invalid['grabaciones'][0]['isrc']='incorrecto'
        self.assertEqual(self.c.post('/api/canciones/'+self.sid+'/ficha',json=invalid).status_code,400)
        self.assertEqual(self.c.get('/api/canciones/'+self.sid+'/ficha').json,saved)

    def test_busqueda_filtros_y_tecnica_sin_modificar_wav(self):
        self.save_card()
        self.assertEqual(self.c.post('/api/catalogo/'+self.first,json={'favorito':True,'version':'V3','clase':'Master'}).status_code,200)
        row=self.c.get('/api/catalogo/'+self.first).json
        self.assertEqual(row['tecnica']['frecuencia'],48000)
        self.assertEqual(row['tecnica']['bits'],16)
        self.assertEqual(row['tecnica']['canales'],2)
        self.assertAlmostEqual(row['tecnica']['duracion'],.1)
        for query in ('q=montana','q=maria','q=intimo','genero=Folk&bpm_min=90&bpm_max=92'):
            self.assertEqual(self.c.get('/api/catalogo?'+query).json['total'],2)
        self.assertEqual(self.c.get('/api/catalogo?genero=folk').json['total'],2)
        self.assertEqual(self.c.get('/api/catalogo?enlaces=1').json['total'],0)
        self.assertIn('montaña',self.c.get('/api/proyectos').json['canciones'][0]['busqueda_metadata'])
        self.assertIn('María',self.c.get('/api/artistas/'+self.aid+'/contenido').json['canciones'][0]['busqueda_metadata'])
        self.assertEqual(self.c.get('/api/catalogo?favoritos=1&clase=Master').json['total'],1)
        self.assertEqual(self.c.get('/api/catalogo?bpm_min=100').json['total'],0)
        self.assertEqual(Path(row['ruta']).read_bytes(),wav_bytes())

    def test_asociacion_fonograma_se_conserva_al_editar_ficha(self):
        saved=self.save_card();rid=saved['grabaciones'][0]['id']
        self.c.post('/api/catalogo/'+self.first,json={'grabacion_id':rid})
        saved['grabaciones'][0]['version']='Remaster'
        self.assertEqual(self.c.post('/api/canciones/'+self.sid+'/ficha',json=saved).status_code,200)
        self.assertEqual(self.c.get('/api/catalogo/'+self.first).json['grabacion_id'],rid)

    def test_playlists_orden_revision_y_validacion_previa(self):
        playlist=self.playlist()
        result=self.c.post('/api/playlists/'+playlist['id'],json={'nombre':playlist['nombre'],
            'revision':playlist['revision'],'archivos':[self.second,self.first]})
        self.assertEqual([a['id'] for a in result.json['audios']],[self.second,self.first])
        self.assertEqual(self.c.post('/api/playlists/'+playlist['id'],json={'nombre':'Viejo','revision':1,'archivos':[]}).status_code,400)
        self.assertEqual(self.c.post('/api/playlists',json={'nombre':'Inválida','archivos':[self.first,'ajeno']}).status_code,400)
        self.assertEqual(len(self.c.get('/api/playlists').json),1)

    def test_portal_seleccion_fija_descarga_y_revocacion(self):
        playlist=self.playlist([self.first]);delivery=self.delivery(playlist['id'])
        base=delivery['ruta']
        self.assertEqual(self.c.get(base+'/audio/'+self.first+'?descarga=1').status_code,403)
        self.assertEqual(self.c.get(base+'/audio/'+self.second).status_code,404)
        stream=self.c.get(base+'/audio/'+self.first,headers={'Range':'bytes=0-15'})
        self.assertEqual(stream.status_code,206);self.assertEqual(stream.data,wav_bytes()[:16]);stream.close()
        self.c.post('/api/playlists/'+playlist['id'],json={'nombre':'Cambiada','revision':1,'archivos':[self.second]})
        self.assertEqual(self.c.get(base+'/datos').json['audios'][0]['id'],self.first)
        self.assertNotIn('ruta',json.dumps(self.c.get(base+'/datos').json))
        self.assertNotIn('Comentario privado',json.dumps(self.c.get(base+'/datos').json))
        self.c.post('/api/entregas/'+delivery['id']+'/revocar',json={})
        self.assertEqual(self.c.get(base+'/datos').status_code,410)
        self.assertEqual(self.c.get(base+'/audio/'+self.first).status_code,410)

    def test_portal_clave_vencimiento_y_cambio_de_archivo(self):
        playlist=self.playlist([self.first]);delivery=self.delivery(playlist['id'],clave='privada',descarga=True)
        base=delivery['ruta']
        self.assertEqual(self.c.get(base+'/datos').status_code,401)
        self.assertEqual(self.c.post(base+'/acceso',json={'clave':'mal'}).status_code,401)
        self.assertEqual(self.c.post(base+'/acceso',json={'clave':'privada'}).status_code,200)
        self.assertEqual(self.c.get(base+'/datos').status_code,200)
        download=self.c.get(base+'/audio/'+self.first+'?descarga=1');self.assertEqual(download.status_code,200);download.close()
        path=Path(self.c.get('/api/catalogo/'+self.first).json['ruta']);path.write_bytes(b'cambiado')
        self.assertEqual(self.c.get(base+'/audio/'+self.first).status_code,409)
        with app.db_open() as db:
            row=db.execute('SELECT * FROM entregas_playlist WHERE id=?',(delivery['id'],)).fetchone()
            self.assertNotIn('privada',row['clave_hash']);self.assertNotIn(base.split('/')[-1],row['token_hash'])
            db.execute('UPDATE entregas_playlist SET vence=? WHERE id=?',(time.time()-1,delivery['id']))
        self.assertEqual(self.c.get(base+'/datos').status_code,410)

    def test_portal_publico_no_expone_api_administracion(self):
        playlist=self.playlist([self.first]);delivery=self.delivery(playlist['id'])
        with patch.dict(os.environ,{'AUDIOTALLER_PORTAL_DB':str(app.DB)}):
            client=create_app().test_client()
        self.assertEqual(client.get('/api/personas').status_code,404)
        self.assertEqual(client.get('/api/catalogo').status_code,404)
        self.assertEqual(client.get(delivery['ruta']+'/datos').status_code,200)

    def test_exportacion_editorial_separa_notas_y_no_altera_audio(self):
        self.save_card()
        result=self.c.get('/api/canciones/'+self.sid+'/entrega-editorial')
        self.assertEqual(result.status_code,200)
        with zipfile.ZipFile(io.BytesIO(result.data)) as package:
            self.assertIn('metadata.csv',package.namelist())
            data=json.loads(package.read('ficha.json'))
            self.assertEqual(data['letra'],'Canción de la montaña')
            self.assertEqual(data['grabaciones'][0]['isrc'],'ARABC2600001')
            self.assertNotIn('Secreto interno',str(data));self.assertNotIn('No compartir',str(data))

    def test_encabezado_wav_float(self):
        fmt=struct.pack('<HHIIHH',3,2,48000,384000,8,32)
        samples=struct.pack('<ff',.2,-.2)*48
        body=b'WAVE'+b'fmt '+struct.pack('<I',len(fmt))+fmt+b'data'+struct.pack('<I',len(samples))+samples
        path=self.root/'float.wav';path.write_bytes(b'RIFF'+struct.pack('<I',len(body))+body)
        info=wav_header(str(path),path.stat().st_size,path.stat().st_mtime_ns)
        self.assertEqual(info['codificacion'],'Float');self.assertAlmostEqual(info['duracion'],.001)
