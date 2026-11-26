import io, sqlite3, struct, sys, tempfile, unittest, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
from feedback_markers import midi_markers, csv_markers, next_version_path


def wav_bytes():
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
        audio.writeframes(struct.pack('<h', 1000) * 8000)
    return buffer.getvalue()


class FeedbackRedesignTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        root = Path(self.tmp.name)
        app.DB = root / 'test.sqlite'; app.LIBRARY = root / 'Artistas'; self.root = root
        self.c = app.app.test_client()
        aid = self.c.post('/api/artistas', json={'nombre': 'Luna', 'tipo': 'Solista'}).json['id']
        self.sid = self.c.post(f'/api/artistas/{aid}/canciones', json={'titulo': 'Mareas'}).json['id']
        up = lambda name: self.c.post(f'/api/produccion/{self.sid}/archivos/mezcla', data={'file': (io.BytesIO(wav_bytes()), name)},
                                      content_type='multipart/form-data').json['id']
        self.v2, self.v3 = up('Mareas_Mix_V2.wav'), up('Mareas_Mix_V3.wav')
        db = sqlite3.connect(app.DB)
        db.execute("INSERT INTO playlists(id,nombre) VALUES('p','Escucha 1')")
        db.execute("INSERT INTO playlist_items VALUES('p',?,1)", (self.v2,))
        db.execute("INSERT INTO portal_publicaciones(id,playlist_id,proyecto,email) VALUES('pub','p','x','a@b.co')")
        for ident, second in (('n1', 37), ('n2', 0)):
            db.execute("""INSERT INTO portal_devoluciones(id,publicacion_id,playlist_id,email,archivo_id,cancion_id,drive_id,revision,
                etiqueta,texto,segundo,creado) VALUES(?,'pub','p','a@b.co',?,?,'',1,'V2','Subir la voz',?,'2026-11-20')""",
                (ident, self.v2, self.sid, second))
        db.commit(); db.close()

    def tearDown(self):
        self.tmp.cleanup()

    def test_estados_respuesta_y_version_con_el_cambio(self):
        bad = self.c.post('/api/portal/devoluciones/n1', json={'estado': 'Sin cambios'})
        self.assertEqual(bad.status_code, 400)
        ok = self.c.post('/api/portal/devoluciones/n1', json={'estado': 'Resuelta', 'respuesta': 'Listo', 'resuelve_archivo': self.v3,
                                                             'bucle_inicio': 20, 'bucle_fin': 50})
        self.assertEqual(ok.status_code, 200)
        note = next(n for n in self.c.get('/api/portal/devoluciones').json if n['id'] == 'n1')
        self.assertEqual((note['estado'], note['respuesta'], note['resuelve_nombre'], note['bucle_fin']), ('Resuelta', 'Listo', 'Mareas_Mix_V3.wav', 50))
        self.assertEqual(self.c.get('/api/inicio').json['devoluciones_total'], 1)
        shared = {f['id']: f['compartido'] for f in self.c.get(f'/api/produccion/{self.sid}').json['archivos']}
        self.assertEqual(shared[self.v2], ['Escucha 1'])

    def test_marcadores_midi_csv_y_rpp_nuevo(self):
        notes = [dict(segundo=37, estado='Pendiente', texto='Subir la voz')]
        data = midi_markers(notes)
        self.assertTrue(data.startswith(b'MThd') and b'\xff\x06' in data and b'0:37' in data)
        self.assertIn('0:37 · Pendiente · Subir la voz', csv_markers(notes))
        session = self.root / 'Mareas_V001.rpp'
        session.write_text('<REAPER_PROJECT 0.1\n>\n')
        self.assertEqual(next_version_path(session).name, 'Mareas_V002.rpp')
        sid = self.c.post(f'/api/produccion/{self.sid}/sesiones', json={'etapa': 'mezcla', 'ruta': str(session), 'daw': 'Reaper', 'nombre': 'Mareas_V001'}).json['id']
        result = self.c.post('/api/portal/devoluciones/marcadores', json={'archivo_id': self.v2, 'sesion_id': sid, 'reaper': True}).json
        self.assertEqual(len(result['archivos']), 3)
        self.assertEqual(session.read_text(), '<REAPER_PROJECT 0.1\n>\n')
        self.assertIn('MARKER 1 37.000000', (self.root / 'Mareas_V002.rpp').read_text())
        self.assertEqual(self.c.get(f'/api/portal/devoluciones/marcadores.mid?archivo_id={self.v2}').status_code, 200)


if __name__ == '__main__':
    unittest.main()
