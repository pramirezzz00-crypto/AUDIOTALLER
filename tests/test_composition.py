"""Colecciones de composición y convivencia con las entregas existentes."""
from contextlib import closing
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app

class CompositionTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        app.DB=self.root/'base.sqlite3';app.LIBRARY=self.root/'Artistas'
        self.c=app.app.test_client()
        self.playlist=self.c.post('/api/playlists',json={'nombre':'Entrega al artista'}).json
        self.audio=self.root/'Beat.wav';self.audio.write_bytes(b'beat original')

    def tearDown(self):self.temp.cleanup()

    def test_beats_separados_de_entregas_orden_y_originales(self):
        pid=self.c.post('/api/beats/playlists',json={'nombre':'Ideas'}).json['id']
        data={'paths':[str(self.audio)],'playlist_id':pid}
        self.assertEqual(self.c.post('/api/beats',json=data).json['agregados'],1)
        self.assertEqual(self.c.post('/api/beats',json=data).json['omitidos'],1)
        self.assertEqual(self.c.post('/api/beats',json={**data,'playlist_id':'default'}).json['agregados'],1)
        rows=self.c.get('/api/beats?playlist_id='+pid).json['audios']
        other=self.root/'Dos.wav';other.write_bytes(b'segundo beat')
        self.c.post('/api/beats',json={'paths':[str(other)],'playlist_id':pid})
        rows=self.c.get('/api/beats?playlist_id='+pid).json['audios'];ids=[x['id'] for x in rows][::-1]
        self.assertEqual(self.c.put('/api/beats/orden',json={'ids':ids[:-1],'playlist_id':pid}).status_code,409)
        self.assertEqual(self.c.put('/api/beats/orden',json={'ids':ids,'playlist_id':pid}).status_code,200)
        self.assertEqual([x['id'] for x in self.c.get('/api/beats?playlist_id='+pid).json['audios']],ids)
        response=self.c.get('/api/beats/'+ids[1]+'/audio');self.assertEqual(response.data,b'beat original');response.close()
        self.assertEqual(self.c.patch('/api/beats/playlists/'+pid,json={'nombre':'Ideas nuevas'}).status_code,200)
        self.assertEqual(self.c.delete('/api/beats/playlists/'+pid).status_code,200)
        self.assertTrue(self.audio.is_file());self.assertTrue(other.is_file())
        self.assertEqual([x['id'] for x in self.c.get('/api/playlists').json],[self.playlist['id']])
        self.c.delete('/api/beats/playlists/default')
        self.assertEqual(self.c.get('/api/beats/playlists').json['listas'],[])

    def test_partituras_letras_docx_y_archivos_desconectados(self):
        for section,extension,content,key in [('scores','.pdf',b'%PDF-1.4\nprueba','partituras'),('lyrics','.txt','Verso con canción'.encode(),'letras')]:
            cid=self.c.post('/api/'+section+'/collections',json={'nombre':'Colección'}).json['id']
            original=self.root/(section+extension);original.write_bytes(content)
            post=self.c.post('/api/'+section,json={'collection_id':cid,'paths':[str(original)]})
            self.assertEqual(post.json['agregados'],1)
            row=self.c.get('/api/'+section+'?collection_id='+cid).json[key][0]
            response=self.c.get('/api/'+section+'/'+row['id']+'/file');self.assertEqual(response.data,content);response.close()
            original.rename(original.with_suffix('.apartado'))
            self.assertFalse(self.c.get('/api/'+section+'?collection_id='+cid).json[key][0]['disponible'])
            self.assertEqual(self.c.get('/api/'+section+'/'+row['id']+'/file').status_code,404)
            self.assertEqual(self.c.delete('/api/'+section+'/collections/'+cid).status_code,200)
            self.assertEqual(original.with_suffix('.apartado').read_bytes(),content)
        cid=self.c.post('/api/lyrics/collections',json={'nombre':'DOCX'}).json['id']
        doc=self.root/'letra.docx'
        with zipfile.ZipFile(doc,'w') as archive:
            archive.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Una canción</w:t></w:r></w:p><w:p><w:r><w:t>Otro verso</w:t></w:r></w:p></w:body></w:document>')
        self.c.post('/api/lyrics',json={'collection_id':cid,'paths':[str(doc)]})
        lid=self.c.get('/api/lyrics?collection_id='+cid).json['letras'][0]['id']
        self.assertEqual(self.c.get('/api/lyrics/'+lid+'/file').get_data(as_text=True),'Una canción\nOtro verso')
        doc.write_bytes(b'DOCX invalido')
        self.assertEqual(self.c.get('/api/lyrics/'+lid+'/file').status_code,404)

    def test_migracion_respalda_y_conserva_playlists_existentes(self):
        with app.db_open() as db:
            for table in ('composition_beats','composition_playlists','composition_scores','composition_score_collections','composition_lyrics','composition_lyric_collections'):
                db.execute('DROP TABLE '+table)
            db.execute('UPDATE schema_audio SET version=7')
            before=dict(db.execute('SELECT * FROM playlists WHERE id=?',(self.playlist['id'],)).fetchone())
        with app.db_open() as db:
            self.assertEqual(db.execute('SELECT version FROM schema_audio').fetchone()[0],9)
            self.assertEqual(dict(db.execute('SELECT * FROM playlists WHERE id=?',(self.playlist['id'],)).fetchone()),before)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        backups=list(self.root.glob('*.respaldo-composicion-*.sqlite3'))
        self.assertTrue(backups)
        snapshots=[]
        for backup in backups:
            with closing(sqlite3.connect(backup)) as db:snapshots.append(db.execute('SELECT version FROM schema_audio').fetchone()[0])
        self.assertIn(7,snapshots)
