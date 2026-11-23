import io, struct, sys, tempfile, unittest, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


def wav_bytes(seconds=1.0, rate=8000):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(rate)
        audio.writeframes(struct.pack('<h', 1000) * int(seconds * rate))
    return buffer.getvalue()


class StageTransferAndSummaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'
        app.LIBRARY = root / 'Artistas'
        self.root = root
        self.c = app.app.test_client()
        self.aid = self.c.post('/api/artistas', json={'nombre': 'Luna', 'tipo': 'Solista'}).json['id']
        self.album = self.c.post(f'/api/artistas/{self.aid}/discos', json={'nombre': 'Viento', 'tipo': 'EP'}).json['id']
        self.sid = self.c.post(f'/api/artistas/{self.aid}/canciones', json={'titulo': 'Mareas', 'disco_id': self.album, 'pista': '1'}).json['id']

    def tearDown(self):
        self.tmp.cleanup()

    def upload(self, stage, name, data):
        response = self.c.post(f'/api/produccion/{self.sid}/archivos/{stage}', data={'file': (io.BytesIO(data), name)})
        self.assertEqual(response.status_code, 201, response.data)
        return response.json['id']

    def test_mover_archivo_conserva_id_ruta_y_registra_evento(self):
        fid = self.upload('maqueta', 'maqueta.wav', wav_bytes())
        before = next(f for f in self.c.get(f'/api/produccion/{self.sid}').json['archivos'] if f['id'] == fid)
        r = self.c.post(f'/api/produccion/{self.sid}/trasladar', json={'tipo': 'archivo', 'id': fid, 'etapa': 'grabacion'})
        self.assertEqual(r.status_code, 200, r.data)
        ws = self.c.get(f'/api/produccion/{self.sid}').json
        after = next(f for f in ws['archivos'] if f['id'] == fid)
        self.assertEqual(after['etapa'], 'grabacion')
        self.assertEqual(after['ruta'], before['ruta'])
        self.assertTrue(any(e['tipo'] == 'Archivo movido de etapa' for e in ws['eventos']))

    def test_copiar_archivo_crea_copia_y_no_toca_original(self):
        data = wav_bytes()
        fid = self.upload('mezcla', 'mix.wav', data)
        r = self.c.post(f'/api/produccion/{self.sid}/trasladar', json={'tipo': 'archivo', 'id': fid, 'etapa': 'mastering', 'copiar': True})
        self.assertEqual(r.status_code, 201, r.data)
        ws = self.c.get(f'/api/produccion/{self.sid}').json
        original = next(f for f in ws['archivos'] if f['id'] == fid)
        copy = next(f for f in ws['archivos'] if f['id'] == r.json['id'])
        self.assertEqual(original['etapa'], 'mezcla')
        self.assertEqual(copy['etapa'], 'mastering')
        self.assertNotEqual(copy['ruta'], original['ruta'])
        self.assertEqual(Path(copy['ruta']).read_bytes(), data)
        self.assertEqual(Path(original['ruta']).read_bytes(), data)

    def test_mover_sesion_con_sus_archivos_y_copiar_proyecto_daw(self):
        project = self.root / 'externa' / 'Mareas.rpp'
        project.parent.mkdir()
        project.write_text('<REAPER_PROJECT>')
        session = self.c.post(f'/api/produccion/{self.sid}/sesiones', json={'nombre': 'Maqueta', 'etapa': 'maqueta', 'daw': 'Reaper', 'ruta': str(project)})
        self.assertEqual(session.status_code, 201, session.data)
        sid_session = session.json['id']
        self.c.post(f'/api/produccion/{self.sid}/vigente/{sid_session}', json={'activa': True})
        attached = self.c.post(f'/api/produccion/{self.sid}/archivos/maqueta',
                               data={'file': (io.BytesIO(b'x'), 'bounce.wav'), 'sesion_id': sid_session}).json['id']
        moved = self.c.post(f'/api/produccion/{self.sid}/trasladar', json={'tipo': 'sesion', 'id': sid_session, 'etapa': 'grabacion'})
        self.assertEqual(moved.status_code, 200, moved.data)
        ws = self.c.get(f'/api/produccion/{self.sid}').json
        s = next(x for x in ws['sesiones'] if x['id'] == sid_session)
        self.assertEqual(s['etapa'], 'grabacion')
        self.assertFalse(s['vigente'])
        self.assertEqual(next(f for f in ws['archivos'] if f['id'] == attached)['etapa'], 'grabacion')
        copied = self.c.post(f'/api/produccion/{self.sid}/trasladar', json={'tipo': 'sesion', 'id': sid_session, 'etapa': 'mezcla', 'copiar': True})
        self.assertEqual(copied.status_code, 201, copied.data)
        self.assertEqual(project.read_text(), '<REAPER_PROJECT>')
        self.assertTrue((project.parent / 'Mareas_V001.rpp').exists())
        ws = self.c.get(f'/api/produccion/{self.sid}').json
        self.assertEqual(next(x for x in ws['sesiones'] if x['id'] == copied.json['id'])['etapa'], 'mezcla')

    def test_rechaza_destino_invalido_y_elemento_ajeno(self):
        fid = self.upload('demo', 'demo.wav', wav_bytes())
        self.assertEqual(self.c.post(f'/api/produccion/{self.sid}/trasladar', json={'tipo': 'archivo', 'id': fid, 'etapa': 'historico'}).status_code, 400)
        other = self.c.post(f'/api/artistas/{self.aid}/canciones', json={'titulo': 'Otra'}).json['id']
        self.assertEqual(self.c.post(f'/api/produccion/{other}/trasladar', json={'tipo': 'archivo', 'id': fid, 'etapa': 'mezcla'}).status_code, 400)

    def test_resumenes_de_inicio_y_disco(self):
        self.upload('demo', 'demo.wav', wav_bytes())
        mix = self.upload('mezcla', 'Mix V2.wav', wav_bytes(2.0))
        self.c.post(f'/api/catalogo/{mix}', json={'favorito': True, 'clase': 'Mezcla', 'version': 'Mix V2', 'notas': '', 'grabacion_id': ''})
        songs = self.c.get(f'/api/discos/{self.album}/resumen').json
        self.assertEqual(songs[0]['etapa'], 'mezcla')
        self.assertEqual(songs[0]['referencia'], 'Mix V2')
        self.assertTrue(songs[0]['referencia_favorita'])
        self.assertEqual(songs[0]['duracion'], '0:02')
        home = self.c.get('/api/inicio').json
        self.assertEqual(home['recientes'][0]['titulo'], 'Mareas')
        self.assertEqual([s['total'] for s in home['etapas']], [0, 0, 0, 1, 0])
        self.assertEqual(home['discos'][0]['nombre'], 'Viento')


if __name__ == '__main__':
    unittest.main()
