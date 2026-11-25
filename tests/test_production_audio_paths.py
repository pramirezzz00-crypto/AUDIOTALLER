import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class ProductionAudioPathsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root = Path(self.tmp.name)
        app.DB = self.root / 'test.sqlite'
        app.LIBRARY = self.root / 'Artistas'
        self.client = app.app.test_client()
        artist = self.client.post('/api/artistas', json={'nombre': 'Prueba', 'tipo': 'Solista'}).json['id']
        self.song = self.client.post(f'/api/artistas/{artist}/canciones', json={'titulo': 'Audio'}).json['id']
        self.original = self.root / 'fuente.wav'
        self.original_bytes = b'audio original de prueba'
        self.original.write_bytes(self.original_bytes)

    def tearDown(self):
        self.tmp.cleanup()

    def test_copia_audio_desde_ubicacion_sin_alterar_original(self):
        response = self.client.post(
            f'/api/produccion/{self.song}/copias-audio/grabacion',
            json={'ruta': str(self.original)},
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        audio = self.client.get(f'/api/produccion/{self.song}').json['archivos'][0]
        copied = Path(audio['ruta'])
        self.assertEqual(audio['modo'], 'importado')
        self.assertNotEqual(copied.resolve(), self.original.resolve())
        self.assertEqual(copied.read_bytes(), self.original_bytes)
        self.assertEqual(self.original.read_bytes(), self.original_bytes)

    def test_vincula_audio_original_sin_crear_copia(self):
        response = self.client.post(
            f'/api/produccion/{self.song}/vinculos',
            json={'ruta': str(self.original), 'etapa': 'grabacion'},
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        audio = self.client.get(f'/api/produccion/{self.song}').json['archivos'][0]
        self.assertEqual(audio['modo'], 'vinculado')
        self.assertEqual(Path(audio['ruta']).resolve(), self.original.resolve())
        self.assertEqual(self.original.read_bytes(), self.original_bytes)

    def test_copia_desde_ubicacion_rechaza_archivos_que_no_son_audio(self):
        document = self.root / 'notas.txt'
        document.write_text('no es audio', encoding='utf-8')
        response = self.client.post(
            f'/api/produccion/{self.song}/copias-audio/grabacion',
            json={'ruta': str(document)},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get(f'/api/produccion/{self.song}').json['archivos'], [])


if __name__ == '__main__':
    unittest.main()
