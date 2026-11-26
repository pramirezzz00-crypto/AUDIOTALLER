"""Portal 0.3: respuestas al artista, versión que resuelve, web actualizada sola y errores legibles (sin Google real)."""
import io, json, math, struct, sys, tempfile, unittest, wave
from pathlib import Path
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
from cloud_auth import CloudError, google_message
from cloud_portal import Publisher, decode, fields, site_hash

CONFIG = dict(projectId='audiotaller-test', apiKey='AIza' + 'X' * 35, driveApiKey='AIza' + 'Y' * 35,
              siteId='audiotaller-test-portal', producerName='Mi estudio', color='#2FD8BF')


def tone():
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b''.join(struct.pack('<h', int(9000 * math.sin(i / 7))) for i in range(8000)))
    return buffer.getvalue()


class PortalRepliesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        root = Path(self.tmp.name).resolve(); app.DB = root / 'db.sqlite3'; app.LIBRARY = root / 'Artistas'
        self.c = app.app.test_client()
        aid = self.c.post('/api/artistas', json={'nombre': 'Artista'}).json['id']
        self.sid = self.c.post(f'/api/artistas/{aid}/canciones', json={'titulo': 'Tema'}).json['id']
        up = lambda name: self.c.post(f'/api/produccion/{self.sid}/archivos/mezcla', data={'file': (io.BytesIO(tone()), name)}).json['id']
        self.v2, self.v3 = up('Mix V2.wav'), up('Mix V3.wav')
        self.pid = self.c.post('/api/playlists', json={'nombre': 'Escucha', 'archivos': [self.v2]}).json['id']
        self.c.post('/api/portal/config', json=CONFIG)
        self.publisher = Publisher(app.db_open, Mock(token=lambda: 'TOKEN'), dict(CONFIG, siteHash=site_hash()))
        self.remote = {}

    def tearDown(self):
        self.tmp.cleanup()

    def patches(self, uploads):
        def get(identity): return self.remote.get(identity)
        def save(identity, payload, previous=None):
            self.remote[identity] = {'fields': fields(payload), 'updateTime': '2026-11-25T01:00:00Z'}
        def upload(audio, project, progress):
            uploads.append(audio['id']); return dict(id='drive-' + audio['id'][:6])
        return [patch.object(self.publisher, 'check_ready'), patch.object(self.publisher, 'get_document', side_effect=get),
                patch.object(self.publisher, 'save_document', side_effect=save), patch.object(self.publisher, 'upload_audio', side_effect=upload),
                patch('cloud_portal.http_request', return_value=(200, {}, dict(localId='artist-uid')))]

    def publish(self, uploads, **data):
        ps = self.patches(uploads)
        for p in ps: p.start()
        try:
            return self.publisher.publish(self.pid, dict(email='artista@example.com', dias=7, **data), lambda m: None)
        finally:
            for p in ps: p.stop()

    def add_note(self, publication):
        with app.db_open() as db:
            db.execute('''INSERT INTO portal_devoluciones(id,publicacion_id,playlist_id,email,archivo_id,cancion_id,drive_id,revision,etiqueta,texto,segundo,creado)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''', (publication + ':nota1', publication, self.pid, 'artista@example.com', self.v2, self.sid,
                                                     'drive-v2', 1, 'Tema · Mix V2', 'La voz está atrás', 37.0, '2026-11-24T10:00:00Z'))
        return publication + ':nota1'

    def test_publica_respuestas_y_sube_la_version_que_resuelve(self):
        uploads = []
        first = self.publish(uploads, password='Prueba123')
        note = self.add_note(first['id'])
        self.c.post('/api/portal/devoluciones/' + note, json={'estado': 'Resuelta', 'respuesta': 'Subí la voz 1 dB.', 'resuelve_archivo': self.v3})
        self.publish(uploads)
        doc = decode(self.remote[first['id']])
        replies = json.loads(doc['replies'])
        self.assertEqual(replies['nota1']['status'], 'Resuelta')
        self.assertEqual(replies['nota1']['reply'], 'Subí la voz 1 dB.')
        self.assertTrue(replies['nota1']['resolvedDriveId'].startswith('drive-'))
        self.assertIn(self.v3, uploads, 'la versión corregida se sube aunque no esté en la playlist')
        self.assertTrue(json.loads(doc['items'])[0]['peaks'], 'el portal recibe la forma de onda')

    def test_enviar_respuestas_solo_actualiza_respuestas(self):
        uploads = []
        first = self.publish(uploads, password='Prueba123')
        note = self.add_note(first['id'])
        self.c.post('/api/portal/devoluciones/' + note, json={'estado': 'Sin cambios', 'respuesta': 'La dejamos así.'})
        calls = []
        def google(url, method='GET', data=None, headers=None, raw=False):
            calls.append((url, method, data)); return 200, {}, {}
        with patch.object(self.publisher, 'check_ready'), patch.object(self.publisher, 'get_document',
                return_value=dict(self.remote[first['id']], updateTime='2026-11-25T01:00:00Z')), patch.object(self.publisher, 'google', side_effect=google):
            result = self.publisher.send_replies(first['id'], lambda m: None)
        self.assertEqual(result['respuestas'], 1)
        url, method, data = calls[-1]
        self.assertEqual(method, 'PATCH')
        self.assertIn('updateMask.fieldPaths=replies', url)
        self.assertEqual(set(data['fields']), {'replies', 'repliesUpdatedAt'}, 'no toca la playlist, el acceso ni el vencimiento')

    def test_la_web_del_portal_se_actualiza_sola_si_cambio(self):
        self.publisher.config['siteHash'] = 'vieja'
        with patch.object(self.publisher, 'deploy_site') as deploy:
            self.assertTrue(self.publisher.ensure_site_current(lambda m: None))
            deploy.assert_called_once()
        self.publisher.config['siteHash'] = site_hash()
        with patch.object(self.publisher, 'deploy_site') as deploy:
            self.assertFalse(self.publisher.ensure_site_current(lambda m: None))
            deploy.assert_not_called()

    def test_contrasena_distinta_al_actualizar_explica_que_hacer(self):
        uploads = []
        self.publish(uploads, password='Prueba123')
        ps = self.patches(uploads)
        for p in ps: p.start()
        try:
            with patch('cloud_portal.http_request', side_effect=CloudError('x', 400, 'INVALID_PASSWORD')):
                with self.assertRaises(ValueError) as error:
                    self.publisher.publish(self.pid, dict(email='artista@example.com', dias=7, password='OtraClave9'), lambda m: None)
        finally:
            for p in ps: p.stop()
        self.assertIn('dejá el campo de contraseña vacío', str(error.exception))

    def test_mensajes_de_google_dicen_que_fallo(self):
        drive = 'https://www.googleapis.com/drive/v3/files'
        self.assertIn('API de Google Drive no está habilitada', google_message(drive, 403, 'Google Drive API has not been used in project 1 before or it is disabled.'))
        self.assertIn('espacio', google_message(drive, 403, 'The user has exceeded their Drive storage quota storageQuotaExceeded'))
        self.assertIn('al menos 8', google_message('https://identitytoolkit.googleapis.com/v1/x', 400, 'WEAK_PASSWORD : Password should be at least 6 characters'))
        self.assertTrue(google_message('https://firestore.googleapis.com/v1/x', 400, 'Invalid value').startswith('Firestore rechazó la operación: Invalid value'))


if __name__ == '__main__':
    unittest.main()
