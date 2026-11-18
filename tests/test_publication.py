"""Asociaciones sin traslado de archivos y separación obra / fonograma."""
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app


class PublicationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.root = Path(self.tmp.name)
        app.DB = self.root/'test.sqlite3'
        app.LIBRARY = self.root/'Artistas'
        self.c = app.app.test_client()
        self.aid = self.c.post('/api/artistas',json={'nombre':'Artista'}).json['id']
        self.mid = self.c.post('/api/artistas',json={'nombre':'Música','tipo':'Músico'}).json['id']
        self.sid = self.song(self.aid)

    def tearDown(self):
        self.tmp.cleanup()

    def song(self, artist):
        return self.c.post('/api/artistas/'+artist+'/canciones',json={'titulo':'Obra'}).json['id']

    def test_incorpora_sueltas_conservando_archivos_y_creditos(self):
        song = self.c.get('/api/canciones/'+self.sid).json
        audio = Path(song['carpeta'])/'01. DEMO'/'voz.wav'
        audio.write_bytes(b'original')
        credit = {'persona_id':self.mid,'rol':'Guitarra'}
        self.c.post('/api/creditos',json={**credit,'cancion_id':self.sid})
        result = self.c.post('/api/artistas/'+self.aid+'/discos',json={
            'nombre':'Disco','canciones':[self.sid],'creditos':[credit]})
        self.assertEqual(result.status_code,201,result.data)
        did = result.json['id']
        content = self.c.get('/api/artistas/'+self.aid+'/contenido').json
        self.assertEqual(content['sueltas'],[])
        self.assertEqual(content['canciones'][0]['disco_id'],did)
        self.assertEqual(content['canciones'][0]['carpeta'],song['carpeta'])
        self.assertEqual(audio.read_bytes(),b'original')
        self.assertEqual(len(self.c.get('/api/produccion-creditos/cancion/'+self.sid).json),1)
        self.assertEqual(len(self.c.get('/api/produccion-creditos/disco/'+did).json),1)
        other = self.song(self.aid)
        self.assertEqual(self.c.post('/api/discos/'+did+'/incorporar-canciones',json={'canciones':[other]}).status_code,200)
        # Nunca roba una canción que ya está en otro disco.
        self.assertEqual(self.c.post('/api/discos/'+did+'/incorporar-canciones',json={'canciones':[other]}).status_code,400)

    def test_rechaza_asociacion_ajena_sin_creacion_parcial(self):
        stranger = self.song(self.mid)
        result = self.c.post('/api/artistas/'+self.aid+'/discos',json={'nombre':'Error','canciones':[self.sid,stranger]})
        self.assertEqual(result.status_code,400)
        self.assertFalse(self.c.get('/api/proyectos').json['discos'])
        self.assertEqual(self.c.get('/api/canciones/'+self.sid).json['disco_id'],'')
        self.assertEqual(list(app.LIBRARY.rglob('Error-*')),[])

    def test_codigos_opcionales_y_grabaciones_independientes(self):
        url = '/api/registro/obra/'+self.sid
        payload = {'datos':{'iswc':'T-123.456.789-0','notas':'Notas de obra'},'grabaciones':[
            {'nombre':'Estudio','isrc':'AR-ABC-26-00001','notas':'Primera'},
            {'nombre':'En vivo','isrc':'ARABC2600002'}]}
        response = self.c.post(url,json=payload)
        self.assertEqual(response.status_code,200,response.data)
        stored = response.json
        self.assertEqual(stored['datos']['iswc'],'T1234567890')
        self.assertEqual(stored['datos']['notas'],'Notas de obra')
        self.assertEqual(stored['grabaciones'][0]['isrc'],'ARABC2600001')
        self.assertNotEqual(stored['grabaciones'][0]['id'],stored['grabaciones'][1]['id'])
        self.assertEqual(self.c.post(url,json=stored).json,stored)
        stored['grabaciones'][1]['isrc']='incorrecto'
        self.assertEqual(self.c.post(url,json=stored).status_code,400)
        self.assertEqual(self.c.get(url).json['grabaciones'][1]['isrc'],'ARABC2600002')
        person = '/api/registro/persona/'+self.mid
        self.assertEqual(self.c.post(person,json={'datos':{'ipi':'00012345678','ipn':'000123'}}).json['datos']['ipi'],'00012345678')
        self.assertEqual(self.c.post(person,json={'datos':{}}).status_code,200)
        with app.db_open() as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')

    def test_creditos_se_editan_atomicamente(self):
        url = '/api/produccion-creditos/cancion/'+self.sid
        self.assertEqual(self.c.post(url,json={'agregar':[{'persona_id':self.mid,'rol':'Voz'}]}).status_code,200)
        cid = self.c.get(url).json[0]['id']
        self.assertEqual(self.c.post(url,json={'quitar':[cid],'agregar':[{'persona_id':'inexistente','rol':'Piano'}]}).status_code,400)
        self.assertEqual(self.c.get(url).json[0]['id'],cid)
        self.assertEqual(self.c.post(url,json={'quitar':[cid],'agregar':[{'persona_id':self.mid,'rol':'Piano'}]}).json[0]['rol'],'Piano')
