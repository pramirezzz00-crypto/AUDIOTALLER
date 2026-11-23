import io, sys, tempfile, unittest, wave, struct
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
from redesign_comp import parse_beat_name, detect_sections, read_pdf_text
from metadata_export import render_pdf


class CompositionRedesignTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'; app.LIBRARY = root / 'Artistas'; self.root = root
        self.c = app.app.test_client()
        aid = self.c.post('/api/artistas', json={'nombre': 'Luna', 'tipo': 'Solista'}).json['id']
        self.sid = self.c.post(f'/api/artistas/{aid}/canciones', json={'titulo': 'Mareas'}).json['id']

    def tearDown(self):
        self.tmp.cleanup()

    def test_lee_bpm_y_tonalidad_del_nombre(self):
        self.assertEqual(parse_beat_name('Madrugada_76bpm_Cm.wav'), {'bpm': 76, 'tonalidad': 'Do menor'})
        self.assertEqual(parse_beat_name('Ruta 110 BPM F#.wav'), {'bpm': 110, 'tonalidad': 'Fa# mayor'})

    def test_detecta_secciones_con_y_sin_encabezados(self):
        tagged = detect_sections('[Verso 1]\nuno\ndos\n\n[Estribillo]\ntres')
        self.assertEqual([b['tipo'] for b in tagged], ['verse', 'chorus'])
        plain = detect_sections('a\nb\n\nest\nribillo\n\nc\nd\n\nest\nribillo')
        self.assertEqual([b['tipo'] for b in plain], ['verse', 'chorus', 'verse', 'chorus'])

    def test_letra_por_secciones_versiones_y_exportacion(self):
        sections = [{'tipo': 'verse', 'lineas': ['Mareas que vuelven'], 'tiempos': [12.5]}, {'tipo': 'chorus', 'lineas': ['Y vos'], 'tiempos': [30]}]
        self.c.post(f'/api/composicion/letras/{self.sid}', json={'esquema': 'letras', 'secciones': sections, 'estado': 'Borrador', 'idioma': 'Español'})
        result = self.c.post(f'/api/composicion/letras/{self.sid}', json={'esquema': 'letras', 'secciones': sections, 'estado': 'Final', 'nueva_version': True}).json
        self.assertEqual((result['letra']['version'], result['letra']['nombres']), (2, ['A', 'B']))
        self.assertIn('[00:12.50]Mareas que vuelven', self.c.get(f'/api/composicion/letras/{self.sid}.lrc').data.decode())
        exported = self.c.get(f'/api/creditos/{self.sid}').json['letra']
        self.assertIn('[A]', exported)

    def test_importa_pdf_de_texto(self):
        pdf = render_pdf([('p', 'Verso uno de prueba')], 'x', logo=False)
        self.assertIn('Verso uno de prueba', read_pdf_text(pdf))
        response = self.c.post('/api/composicion/letras/importar', data={'file': (io.BytesIO(pdf), 'letra.pdf')}, content_type='multipart/form-data')
        self.assertEqual(response.json['secciones'][0]['lineas'], ['Verso uno de prueba'])

    def test_importa_carpeta_de_beats(self):
        folder = self.root / 'beats'; (folder / 'Stems').mkdir(parents=True)
        for name in ('Madrugada_76bpm_Cm.wav', 'Stems/kick.wav'):
            with wave.open(str(folder / name), 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000); w.writeframes(struct.pack('<h', 0) * 800)
        scan = self.c.post('/api/composicion/beats/escanear', json={'carpeta': str(folder)}).json['archivos']
        self.assertEqual([(f['archivo'], f['bpm'], f['stems']) for f in scan], [('Madrugada_76bpm_Cm.wav', 76, 1)])
        self.assertEqual(self.c.post('/api/composicion/beats/importar', json={'archivos': scan}).json['agregados'], 1)
        beat = self.c.get('/api/composicion/beats').json['beats'][0]
        self.assertEqual((beat['nombre'], beat['estado'], beat['etiquetas']), ('Madrugada', 'Libre', ['nuevo']))

    def test_entidades_guia_y_carpeta_de_tramite(self):
        self.assertTrue(self.c.get('/api/entidades/guia/sadaic-obra.pdf').data.startswith(b'%PDF'))
        self.assertEqual(len(self.c.get('/api/entidades').json), 6)
        result = self.c.post('/api/entidades/preparar', json={'entidad': 'sadaic', 'cancion_id': self.sid}).json
        self.assertTrue((Path(result['carpeta']) / result['archivos'][0]).is_file())
        self.c.post(f'/api/entidades/estado/{self.sid}', json={'dnda_obra': 'tramite'})
        self.assertEqual(self.c.get('/api/entidades/estado').json[0]['dnda_obra'], 'tramite')


if __name__ == '__main__':
    unittest.main()
