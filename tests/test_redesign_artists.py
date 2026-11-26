import base64, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app

PNG = 'data:image/png;base64,' + base64.b64encode(bytes.fromhex(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000'
    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')).decode()


class ArtistWizardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'; app.LIBRARY = root / 'Artistas'
        self.c = app.app.test_client()
        self.aid = self.c.post('/api/artistas', json={'nombre': 'Luna', 'tipo': 'Solista'}).json['id']

    def tearDown(self):
        self.tmp.cleanup()

    def save(self, **extra):
        data = dict(nombre='Luna Austral', tipo_proyecto='Solista', relacion='Cliente', personas=[
            dict(nombre='Luna', roles=['Intérprete', 'Autor/a de letra'], sadaic_estado='No', aadi_estado='Sí', aadi='45')], **extra)
        return self.c.post(f'/api/artistas-rediseno/{self.aid}', json=data)

    def test_guarda_foto_nombre_y_ficha_en_el_alta(self):
        self.assertEqual(self.save(imagen=PNG, genero='Pop', ciudad='Mar del Plata', bio='Breve', primer_lanzamiento=True).status_code, 200)
        artist = self.c.get('/api/artistas-rediseno').json[0]
        self.assertEqual((artist['nombre'], artist['imagen'], artist['genero'], artist['ciudad'], artist['bio']), ('Luna Austral', PNG, 'Pop', 'Mar del Plata', 'Breve'))
        self.assertTrue(artist['primer_lanzamiento'])
        self.assertEqual(self.c.get(f'/api/artistas/{self.aid}').json['imagen'], PNG)

    def test_no_socio_de_sadaic_no_cuenta_como_faltante(self):
        self.save()
        artist = self.c.get('/api/artistas-rediseno').json[0]
        self.assertEqual(artist['alertas'], [])
        self.assertTrue(artist['completo'])

    def test_rechaza_imagen_invalida_y_conserva_la_anterior(self):
        self.save(imagen=PNG)
        self.assertEqual(self.save(imagen='data:text/html;base64,PGI+').status_code, 400)
        self.assertEqual(self.c.get(f'/api/artistas/{self.aid}').json['imagen'], PNG)


if __name__ == '__main__':
    unittest.main()
