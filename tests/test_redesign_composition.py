import io, sys, tempfile, unittest, wave, struct, zipfile
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


class ArrangementBusesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'; app.LIBRARY = root / 'Artistas'; self.root = root
        self.c = app.app.test_client()
        aid = self.c.post('/api/artistas', json={'nombre': 'Luna', 'tipo': 'Solista'}).json['id']
        self.sid = self.c.post(f'/api/artistas/{aid}/canciones', json={'titulo': 'Mareas'}).json['id']
        self.session = root / 'sesion'; self.session.mkdir()
        for name in ('Kick In.wav', 'Bajo DI.wav', 'Voz Lead.wav', 'Fx raro.wav'):
            with wave.open(str(self.session / name), 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000); w.writeframes(struct.pack('<h', 0) * 8000)
        (self.session / 'Mareas.rpp').write_text('<REAPER_PROJECT\n>\n')
        self.c.post(f'/api/produccion/{self.sid}/sesiones', json={'etapa': 'grabacion', 'ruta': str(self.session / 'Mareas.rpp'), 'daw': 'Reaper', 'nombre': 'Mareas'})

    def tearDown(self):
        self.tmp.cleanup()

    def test_clasifica_y_crea_sesiones_nuevas_sin_tocar_la_original(self):
        takes = self.c.get(f'/api/arreglos/canciones/{self.sid}/tomas').json['tomas']
        result = self.c.post(f'/api/arreglos/{self.sid}/clasificar', json={'perfil_id': 'mezcla', 'pistas': takes}).json['pistas']
        buses = {t['nombre']: t['bus'] for t in result}
        self.assertEqual((buses['Kick In.wav'], buses['Bajo DI.wav'], buses['Voz Lead.wav'], buses['Fx raro.wav']), ('Batería', 'Bajo', 'Voces', ''))
        items = [dict(token=t['token'], bus=t['bus'] or 'Efectos') for t in result]
        rpp = self.c.post(f'/api/arreglos/{self.sid}/crear-sesion', json={'daw': 'reaper', 'nombre': 'Base', 'pistas': items, 'aprender': {'fx': 'Efectos'}}).json
        text = Path(rpp['ruta']).read_text()
        self.assertIn('ISBUS 1 1', text); self.assertIn('NAME "Batería"', text); self.assertIn('Kick In.wav', text)
        dawproject = self.c.post(f'/api/arreglos/{self.sid}/crear-sesion', json={'daw': 'dawproject', 'nombre': 'Base', 'pistas': items}).json
        project = zipfile.ZipFile(dawproject['ruta']).read('project.xml').decode()
        self.assertIn('role="submix"', project); self.assertIn('Voz Lead.wav', project)
        self.assertEqual((self.session / 'Mareas.rpp').read_text(), '<REAPER_PROJECT\n>\n')
        sessions = self.c.get(f'/api/produccion/{self.sid}').json['sesiones']
        self.assertEqual(len(sessions), 3)
        relearned = self.c.post(f'/api/arreglos/{self.sid}/clasificar', json={'perfil_id': 'mezcla', 'pistas': takes}).json['pistas']
        self.assertEqual({t['nombre']: t['bus'] for t in relearned}['Fx raro.wav'], 'Efectos')


class PeopleRedesignTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'; app.LIBRARY = root / 'Artistas'
        self.c = app.app.test_client()
        self.aid = self.c.post('/api/artistas', json={'nombre': 'Los Cardos', 'tipo': 'Banda'}).json['id']

    def tearDown(self):
        self.tmp.cleanup()

    def test_proyecto_con_personas_roles_y_alertas(self):
        bad = self.c.post(f'/api/artistas-rediseno/{self.aid}', json={'tipo_proyecto': 'Banda', 'relacion': 'Cliente', 'personas': [{'nombre': 'Ana', 'ipi': '12'}]})
        self.assertEqual(bad.status_code, 400)
        self.c.post(f'/api/artistas-rediseno/{self.aid}', json={'tipo_proyecto': 'Banda', 'relacion': 'Del estudio',
            'personas': [{'nombre': 'Ana', 'roles': ['Autor/a de letra', 'Intérprete'], 'aadi': '123'}], 'plataformas': {'spotify': 'https://open.spotify.com/x'}})
        artist = self.c.get('/api/artistas-rediseno').json[0]
        self.assertEqual((artist['tipo_proyecto'], artist['relacion'], artist['completo']), ('Banda', 'Del estudio', False))
        self.assertIn('Ana: sin n.º de SADAIC', artist['alertas'])


class LaunchAndVideoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'; app.LIBRARY = root / 'Artistas'; self.root = root
        self.c = app.app.test_client()
        self.aid = self.c.post('/api/artistas', json={'nombre': 'Luna', 'tipo': 'Solista'}).json['id']
        self.album = self.c.post(f'/api/artistas/{self.aid}/discos', json={'nombre': 'Viento', 'tipo': 'EP'}).json['id']
        for t in ('A', 'B', 'C', 'D'):
            self.c.post(f'/api/artistas/{self.aid}/canciones', json={'titulo': t, 'disco_id': self.album})

    def tearDown(self):
        self.tmp.cleanup()

    def test_campana_sugerida_fechas_limite_y_pdf(self):
        draft = self.c.get(f'/api/discos/{self.album}/campana-sugerida?fecha=2027-03-15').json
        self.assertEqual([s['tipo'] for s in draft['etapas']], ['Single', 'Single', 'EP'])
        saved = self.c.post('/api/campanas', json=draft).json
        self.assertEqual(saved['etapas'][2]['limites'], {'distribuidora': '2027-02-15', 'pitch': '2027-03-08'})
        self.assertTrue(self.c.get(f"/api/campanas/{saved['id']}/pdf").data.startswith(b'%PDF'))
        self.assertEqual(next(p for p in self.c.get('/api/producciones').json if p['id'] == self.album)['campana']['id'], saved['id'])

    def test_audiovisual_y_desprender_musica(self):
        video = self.c.post('/api/audiovisual', json={'nombre': 'Sesión en vivo', 'origen': 'audio_desde_video', 'plantilla': 'Sesión en vivo / Recital'}).json
        self.assertEqual(video['etapas'][0]['nombre'], 'Preproducción')
        audio = self.root / 'tema1.wav'
        with wave.open(str(audio), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000); w.writeframes(struct.pack('<h', 0) * 800)
        result = self.c.post(f"/api/audiovisual/{video['id']}/desprender", json={'artista_id': self.aid, 'canciones': [{'titulo': 'Tema en vivo', 'ruta': str(audio)}]}).json
        sid = result['canciones'][0]['id']
        files = self.c.get(f'/api/produccion/{sid}').json['archivos']
        self.assertEqual((files[0]['etapa'], files[0]['modo']), ('mezcla', 'vinculado'))
        self.assertIn(sid, self.c.get('/api/audiovisual').json[0]['canciones'])

    def test_asistente_sin_clave_explica_que_falta(self):
        self.assertFalse(self.c.get('/api/asistente/config').json['clave'])
        self.assertEqual(self.c.post('/api/asistente/config', json={'api_key': 'mala'}).status_code, 400)
        response = self.c.post('/api/asistente/mensaje', json={'mensajes': [{'rol': 'user', 'texto': 'hola'}]})
        self.assertEqual(response.status_code, 400, response.data[:200])
        self.assertIn('clave de API', response.get_json(force=True)['error'])
