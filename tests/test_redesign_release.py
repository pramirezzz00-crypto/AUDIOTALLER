import io, math, struct, sys, tempfile, unittest, wave, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
import loudness


def tone(path, amp, channels=2, rate=48000, seconds=3):
    frames = b''.join(struct.pack('<' + 'h' * channels, *([int(amp * 32767 * math.sin(2 * math.pi * 997 * i / rate))] * channels)) for i in range(rate * seconds))
    with wave.open(str(path), 'wb') as audio:
        audio.setnchannels(channels); audio.setsampwidth(2); audio.setframerate(rate); audio.writeframes(frames)


class ReleaseRedesignTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'; app.LIBRARY = root / 'Artistas'; self.root = root
        self.c = app.app.test_client()
        aid = self.c.post('/api/artistas', json={'nombre': 'Luna', 'tipo': 'Solista'}).json['id']
        self.album = self.c.post(f'/api/artistas/{aid}/discos', json={'nombre': 'Viento', 'tipo': 'EP'}).json['id']
        self.sid = self.c.post(f'/api/artistas/{aid}/canciones', json={'titulo': 'Mareas', 'disco_id': self.album, 'pista': '1'}).json['id']

    def tearDown(self):
        self.tmp.cleanup()

    def test_sonoridad_de_referencia_bs1770(self):
        path = self.root / 'tono.wav'
        tone(path, 0.1)
        result = loudness.measure(path)
        self.assertAlmostEqual(result['lufs'], -20.0, delta=0.2)
        self.assertAlmostEqual(result['dbtp'], -20.0, delta=0.3)

    def test_creditos_validan_reparto_y_codigos(self):
        data = self.c.post(f'/api/creditos/{self.sid}', json={'iswc': 'T-345.246.800-1', 'isrc': 'AR-A12-26-00011',
            'autores': [{'nombre': 'Luna', 'rol': 'Letra', 'porcentaje': '60'}]}).json
        self.assertEqual((data['iswc'], data['isrc'], data['total_autoria']), ('T3452468001', 'ARA122600011', 60))
        self.assertIn('reparto distinto de 100 %', data['faltan'])
        self.assertEqual(self.c.post(f'/api/creditos/{self.sid}', json={'iswc': 'X1'}).status_code, 400)
        self.c.post(f'/api/discos/{self.album}/creditos/tecnica', json={'rol': 'Mastering', 'nombre': 'Sol'})
        self.assertEqual(self.c.get(f'/api/creditos/{self.sid}').json['tecnica'], [{'rol': 'Mastering', 'nombre': 'Sol', 'estudio': ''}])

    def test_producciones_y_estado_del_disco(self):
        item = next(i for i in self.c.get('/api/producciones').json if i['id'] == self.album)
        self.assertEqual((item['tipo'], item['estado'], len(item['canciones'])), ('disco', 'En producción', 1))
        self.c.post(f'/api/discos/{self.album}/estado', json={'estado': 'Finalizado'})
        item = next(i for i in self.c.get('/api/producciones').json if i['id'] == self.album)
        self.assertEqual(item['estado'], 'Finalizado')

    def test_exporta_csv_excel_word_y_pdf(self):
        self.c.post(f'/api/creditos/{self.sid}', json={'autores': [{'nombre': 'Luna', 'rol': 'Letra y música', 'porcentaje': 100}]})
        for fmt, magic in (('csv', b'\xef\xbb\xbf'), ('xlsx', b'PK'), ('docx', b'PK'), ('pdf', b'%PDF')):
            response = self.c.get(f'/api/exportar/archivo?alcance=disco&id={self.album}&destino=ama&formato={fmt}&logo=1&letras=1')
            self.assertEqual(response.status_code, 200, fmt)
            self.assertTrue(response.data.startswith(magic), fmt)
        sheets = zipfile.ZipFile(io.BytesIO(self.c.get(f'/api/exportar/archivo?alcance=disco&id={self.album}&formato=xlsx').data)).read('xl/workbook.xml')
        self.assertIn('Créditos'.encode(), sheets)
        saved = self.c.get(f'/api/exportar/archivo?alcance=cancion&id={self.sid}&formato=pdf&guardar=1').json
        self.assertTrue(Path(saved['ruta']).is_file() and Path(saved['ruta']).parent.name == 'Entregas')


if __name__ == '__main__':
    unittest.main()
