import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class ProductionTrashTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root = Path(self.tmp.name)
        app.DB = self.root / 'test.sqlite'
        app.LIBRARY = self.root / 'Artistas'
        self.client = app.app.test_client()
        self.artist = self.client.post('/api/artistas', json={'nombre': 'Prueba', 'tipo': 'Solista'}).json['id']
        self.song = self.client.post(f'/api/artistas/{self.artist}/canciones', json={'titulo': 'Papelera'}).json['id']

    def tearDown(self):
        self.tmp.cleanup()

    def import_audio(self, name='mezcla.wav'):
        response = self.client.post(
            f'/api/produccion/{self.song}/archivos/mezcla',
            data={'file': (io.BytesIO(b'copia de audio'), name)},
            content_type='multipart/form-data',
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.json['id']

    def trash(self, identity):
        response = self.client.post(f'/api/produccion/{self.song}/papelera/{identity}', json={})
        self.assertEqual(response.status_code, 200, response.get_json())

    def test_papelera_oculta_y_restaurar_conserva_playlist_y_archivo(self):
        identity = self.import_audio()
        playlist = self.client.post('/api/playlists', json={'nombre': 'Entrega', 'archivos': [identity]}).json
        original = Path(self.client.get(f'/api/produccion/{self.song}').json['archivos'][0]['ruta'])

        self.trash(identity)

        self.assertEqual(self.client.get(f'/api/produccion/{self.song}').json['archivos'], [])
        self.assertEqual(self.client.get('/api/catalogo').json['total'], 0)
        self.assertEqual(self.client.get('/api/playlists').json[0]['total'], 0)
        self.assertEqual(self.client.get('/api/playlists/' + playlist['id']).json['audios'], [])
        self.assertTrue(original.is_file())
        self.assertEqual(self.client.get('/api/produccion/archivo/' + identity).status_code, 400)
        trashed = self.client.get('/api/papelera').json
        self.assertEqual((trashed[0]['id'], trashed[0]['playlists']), (identity, 1))

        changed = self.client.post('/api/playlists/' + playlist['id'], json={
            'nombre': playlist['nombre'], 'notas': playlist['notas'], 'revision': playlist['revision'], 'archivos': []
        })
        self.assertEqual(changed.status_code, 200, changed.get_json())
        self.assertEqual(self.client.post(f'/api/papelera/{identity}/restaurar', json={}).status_code, 200)
        self.assertEqual(self.client.get(f'/api/produccion/{self.song}').json['archivos'][0]['id'], identity)
        self.assertEqual(self.client.get('/api/playlists/' + playlist['id']).json['audios'][0]['id'], identity)

    def test_perfil_artista_se_puede_mover_y_restaurar_sin_perder_producciones(self):
        moved = self.client.post(f'/api/papelera-entidades/artista/{self.artist}', json={})
        self.assertEqual(moved.status_code, 200, moved.get_json())
        self.assertNotIn(self.artist, [item['id'] for item in self.client.get('/api/artistas-rediseno').json])
        self.assertNotIn(self.song, [item['id'] for item in self.client.get('/api/proyectos').json['canciones']])
        trash = self.client.get('/api/papelera-entidades').json
        self.assertEqual((trash[0]['tipo'], trash[0]['elementos']), ('artista', 1))
        restored = self.client.post(f"/api/papelera-entidades/{moved.json['grupo']}/restaurar", json={})
        self.assertEqual(restored.status_code, 200, restored.get_json())
        self.assertIn(self.song, [item['id'] for item in self.client.get('/api/proyectos').json['canciones']])

    def test_mover_disco_a_papelera_oculta_canciones_y_restaurar_las_recupera(self):
        created = self.client.post(f'/api/artistas/{self.artist}/discos', json={'nombre': 'Disco prueba', 'tipo': 'EP'})
        self.assertEqual(created.status_code, 201, created.get_json())
        album_id = created.json['id']
        # La canción suelta permanece fuera del disco; se agrega otra canción al álbum.
        song = self.client.post(f'/api/artistas/{self.artist}/canciones', json={'titulo': 'Tema', 'disco_id': album_id})
        self.assertEqual(song.status_code, 201, song.get_json())
        moved = self.client.post(f'/api/papelera-entidades/disco/{album_id}', json={})
        self.assertEqual(moved.status_code, 200, moved.get_json())
        songs = [item['id'] for item in self.client.get('/api/proyectos').json['canciones']]
        self.assertNotIn(song.json['id'], songs)
        self.assertIn(self.song, songs)
        self.client.post(f"/api/papelera-entidades/{moved.json['grupo']}/restaurar", json={})
        self.assertIn(song.json['id'], [item['id'] for item in self.client.get('/api/proyectos').json['canciones']])

    def test_eliminar_artista_definitivamente_limpia_datos_y_conserva_archivos(self):
        audio_id = self.import_audio('mezcla_original.wav')
        audio_path = Path(self.client.get(f'/api/produccion/{self.song}').json['archivos'][0]['ruta'])
        moved = self.client.post(f'/api/papelera-entidades/artista/{self.artist}', json={})
        self.assertEqual(moved.status_code, 200, moved.get_json())

        deleted = self.client.delete(f"/api/papelera-entidades/{moved.json['grupo']}")

        self.assertEqual(deleted.status_code, 200, deleted.get_json())
        self.assertTrue(audio_path.is_file())
        self.assertEqual(self.client.get('/api/papelera-entidades').json, [])
        with app.db_open() as db:
            self.assertFalse(db.execute('SELECT 1 FROM artistas WHERE id=?', (self.artist,)).fetchone())
            self.assertFalse(db.execute('SELECT 1 FROM canciones WHERE id=?', (self.song,)).fetchone())
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_eliminar_disco_definitivamente_conserva_artista_y_canciones_sueltas(self):
        album = self.client.post(f'/api/artistas/{self.artist}/discos', json={'nombre': 'EP prueba', 'tipo': 'EP'}).json['id']
        song = self.client.post(f'/api/artistas/{self.artist}/canciones', json={'titulo': 'Tema de EP', 'disco_id': album}).json['id']
        moved = self.client.post(f'/api/papelera-entidades/disco/{album}', json={}).json

        deleted = self.client.delete(f"/api/papelera-entidades/{moved['grupo']}")

        self.assertEqual(deleted.status_code, 200, deleted.get_json())
        self.assertIn(self.artist, [item['id'] for item in self.client.get('/api/artistas-rediseno').json])
        active = [item['id'] for item in self.client.get('/api/proyectos').json['canciones']]
        self.assertIn(self.song, active)
        self.assertNotIn(song, active)
        with app.db_open() as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
    def test_eliminacion_definitiva_borra_solo_la_copia_administrada(self):
        identity = self.import_audio('copia.wav')
        self.client.post('/api/catalogo/' + identity, json={'favorito': True})
        playlist = self.client.post('/api/playlists', json={'nombre': 'Entrega', 'archivos': [identity]}).json
        copied = Path(self.client.get(f'/api/produccion/{self.song}').json['archivos'][0]['ruta'])
        self.assertTrue(copied.is_file())
        self.trash(identity)

        response = self.client.delete('/api/papelera/' + identity)

        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertTrue(response.json['copia_eliminada'])
        self.assertFalse(copied.exists())
        self.assertEqual(self.client.get('/api/papelera').json, [])
        self.assertEqual(self.client.get('/api/playlists/' + playlist['id']).json['audios'], [])
        self.assertEqual(self.client.get('/api/playlists').json[0]['total'], 0)

    def test_eliminar_definitivamente_vinculo_no_borra_original(self):
        original = self.root / 'original.wav'
        original.write_bytes(b'original intacto')
        linked = self.client.post(f'/api/produccion/{self.song}/vinculos', json={
            'ruta': str(original), 'etapa': 'mezcla'
        }).json['id']
        playlist = self.client.post('/api/playlists', json={'nombre': 'Entrega', 'archivos': [linked]}).json
        self.trash(linked)

        response = self.client.delete('/api/papelera/' + linked)

        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertFalse(response.json['copia_eliminada'])
        self.assertEqual(original.read_bytes(), b'original intacto')
        self.assertEqual(self.client.get(f'/api/produccion/{self.song}').json['archivos'], [])
        self.assertEqual(self.client.get('/api/playlists/' + playlist['id']).json['audios'], [])


if __name__ == '__main__':
    unittest.main()
