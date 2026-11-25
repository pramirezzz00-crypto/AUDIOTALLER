import sys, tempfile, unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class AudiovisualTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'; app.LIBRARY = root / 'Artistas'; self.root = root
        self.c = app.app.test_client()
        self.aid = self.c.post('/api/artistas', json={'nombre': 'Luna', 'tipo': 'Solista'}).json['id']
        self.sid = self.c.post(f'/api/artistas/{self.aid}/canciones', json={'titulo': 'Mareas'}).json['id']
        self.vid = self.c.post('/api/audiovisual', json={'nombre': 'Peña de Marce', 'origen': 'independiente', 'plantilla': 'Videoclip'}).json['id']

    def tearDown(self):
        self.tmp.cleanup()

    def test_guarda_artista_y_datos_del_rodaje(self):
        saved = self.c.post(f'/api/audiovisual/{self.vid}', json={'artista_id': self.aid, 'direccion': 'Marce', 'edicion': 'Iván'})
        self.assertEqual(saved.status_code, 200)
        listed = next(v for v in self.c.get('/api/audiovisual').json if v['id'] == self.vid)
        self.assertEqual((listed['artista'], listed['direccion'], listed['edicion']), ('Luna', 'Marce', 'Iván'))
        self.assertEqual(self.c.post(f'/api/audiovisual/{self.vid}', json={'artista_id': 'no-existe'}).status_code, 400)

    def test_artista_se_toma_de_la_cancion(self):
        video = self.c.post('/api/audiovisual', json={'nombre': 'Mareas', 'canciones': [self.sid]}).json
        self.assertEqual(video['artista'], 'Luna')

    def test_se_oculta_si_su_artista_va_a_la_papelera(self):
        self.c.post('/api/audiovisual', json={'nombre': 'Mareas', 'canciones': [self.sid]})
        self.c.post(f'/api/papelera-entidades/artista/{self.aid}')
        self.assertEqual([v['nombre'] for v in self.c.get('/api/audiovisual').json], ['Peña de Marce'])
        self.c.post(f'/api/papelera-entidades/artista:{self.aid}/restaurar')
        self.assertEqual(len(self.c.get('/api/audiovisual').json), 2)

    def test_progreso_por_etapa(self):
        video = self.c.get('/api/audiovisual').json[0]
        stages = [{k: v for k, v in s.items() if k not in ('color', 'progreso')} for s in video['etapas']]
        stages[0]['tareas'][0]['hecha'] = True
        result = self.c.post(f'/api/audiovisual/{self.vid}', json={'etapas': stages}).json
        self.assertEqual(result['etapas'][0]['progreso'], 20)
        self.assertEqual(result['etapas'][1]['progreso'], 0)

    def test_abre_premiere_y_cubase_vinculados(self):
        premiere = self.root / 'clip.prproj'; premiere.write_text('x')
        cubase = self.root / 'audio.cpr'; cubase.write_text('x')
        other = self.root / 'notas.exe'; other.write_text('x')
        result = self.c.post(f'/api/audiovisual/{self.vid}', json={'proyecto_editor': str(premiere), 'sesion_audio': str(cubase)}).json
        self.assertEqual(result['editor_programa'], 'Premiere Pro')
        self.assertTrue(result['editor_disponible'] and result['sesion_disponible'])
        with mock.patch('runtime_paths.open_path') as opened:
            self.assertEqual(self.c.post(f'/api/audiovisual/{self.vid}/abrir', json={'campo': 'proyecto_editor'}).status_code, 200)
            self.assertEqual(self.c.post(f'/api/audiovisual/{self.vid}/abrir', json={'campo': 'sesion_audio'}).status_code, 200)
            self.assertEqual([Path(call.args[0]).name for call in opened.call_args_list], ['clip.prproj', 'audio.cpr'])
            self.c.post(f'/api/audiovisual/{self.vid}', json={'proyecto_editor': str(other)})
            self.assertEqual(self.c.post(f'/api/audiovisual/{self.vid}/abrir', json={'campo': 'proyecto_editor'}).status_code, 400)
            self.assertEqual(opened.call_count, 2)


if __name__ == '__main__':
    unittest.main()
