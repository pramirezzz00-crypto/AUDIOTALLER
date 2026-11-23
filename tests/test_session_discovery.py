"""Regresiones de exploración de carpetas y sesión vigente; nunca abre un DAW real."""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class SessionDiscoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.root = Path(self.temp.name).resolve()
        app.DB = self.root/'audio.sqlite3'
        app.LIBRARY = self.root/'artists'
        self.client = app.app.test_client()
        self.artist = self.client.post('/api/artistas', json={'nombre':'Artista'}).json['id']
        self.song = self.client.post('/api/artistas/'+self.artist+'/canciones', json={'titulo':'Tema'}).json['id']
        self.url = '/api/produccion/'+self.song
        self.folder = self.root/'Cubase'
        self.folder.mkdir()
        (self.folder/'Mix V1.cpr').write_bytes(b'cubase uno')
        (self.folder/'Mix V2.cpr').write_bytes(b'cubase dos')
        (self.folder/'Mix V2.csh').write_bytes(b'auxiliar')
        (self.folder/'Audio').mkdir()
        (self.folder/'Audio'/'Backup.cpr').write_bytes(b'subcarpeta')

    def tearDown(self):
        self.temp.cleanup()

    def discover(self, recursive=False):
        response = self.client.post(self.url+'/buscar-sesiones', json={
            'ruta':str(self.folder), 'etapa':'mezcla', 'recursivo':recursive})
        self.assertEqual(response.status_code, 200, response.data)
        return response.json['sesiones']

    def register(self, files):
        response = self.client.post(self.url+'/vincular-sesiones', json={
            'ruta':str(self.folder), 'etapa':'mezcla', 'archivos':[file['ruta'] for file in files]})
        self.assertEqual(response.status_code, 201, response.data)
        return response.json['ids']

    def test_vinculos_idempotentes_vigencia_notas_y_apertura(self):
        found = self.discover()
        self.assertEqual(len(found), 2)
        ids = self.register(found)
        self.assertEqual(self.register(found), ids)
        self.assertTrue(all(file['registrada'] for file in self.discover()))
        self.assertEqual(len(self.discover(True)), 3)
        self.assertEqual(self.client.post(self.url+'/vigente/'+ids[0], json={}).status_code, 200)
        self.assertEqual(self.client.post(self.url+'/vigente/'+ids[1], json={}).status_code, 200)
        self.assertEqual(self.client.post(self.url+'/sesiones/'+ids[1]+'/notas', json={'texto':'Esta es la aprobada'}).status_code, 200)
        state = self.client.get(self.url).json
        self.assertEqual([row['id'] for row in state['sesiones'] if row['vigente']], [ids[1]])
        self.assertEqual(next(row for row in state['sesiones'] if row['id']==ids[1])['comentario'], 'Esta es la aprobada')
        self.assertEqual(self.client.post(self.url+'/vigente/'+ids[1], json={'activa':False}).status_code, 200)
        self.assertFalse(any(row['vigente'] for row in self.client.get(self.url).json['sesiones']))
        self.client.post(self.url+'/vigente/'+ids[1], json={'activa':True})
        with patch('production.open_path') as launch:
            response = self.client.post(self.url+'/sesiones/'+ids[1]+'/abrir', json={})
            self.assertEqual(response.status_code, 200)
            launch.assert_called_once_with(str(Path(found[1]['ruta']).resolve()))
        self.assertEqual((self.folder/'Mix V1.cpr').read_bytes(), b'cubase uno')
        self.assertEqual((self.folder/'Mix V2.cpr').read_bytes(), b'cubase dos')
        Path(found[1]['ruta']).unlink()
        state = self.client.get(self.url).json
        missing = next(row for row in state['sesiones'] if row['id']==ids[1])
        self.assertTrue(missing['vigente'])
        self.assertFalse(missing['disponible'])
        self.assertEqual(self.client.post(self.url+'/sesiones/'+ids[1]+'/abrir', json={}).status_code, 400)

    def test_rechaza_lote_fuera_de_carpeta_y_sesion_de_otra_cancion(self):
        outside = self.root/'Other.cpr'
        outside.touch()
        response = self.client.post(self.url+'/vincular-sesiones', json={
            'ruta':str(self.folder), 'etapa':'mezcla',
            'archivos':[str(self.folder/'Mix V1.cpr'), str(outside)]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get(self.url).json['sesiones'], [])
        ids = self.register(self.discover())
        other = self.client.post('/api/artistas/'+self.artist+'/canciones', json={'titulo':'Otra'}).json['id']
        self.assertEqual(self.client.post('/api/produccion/'+other+'/vigente/'+ids[0], json={}).status_code, 400)

    def test_respalda_al_actualizar_desde_version_uno(self):
        with app.db_open() as db:
            db.execute('DROP TABLE sesion_vigente')
            db.execute('DROP TABLE revision_sesion')
            db.execute('DROP TABLE preferencias_daw')
            db.execute('DROP TABLE operaciones_archivo')
            # Simula una base antigua sin los módulos agregados posteriormente.
            for table in ('composition_beats','composition_playlists','composition_scores','composition_score_collections','composition_lyrics','composition_lyric_collections','portal_devoluciones','portal_publicaciones','portal_drive','portal_config','entregas_playlist','playlist_items','playlists','catalogo_audio','ficha_cancion',
                          'registro_persona','registro_obra','registro_lanzamiento','registro_grabacion'):
                db.execute('DROP TABLE '+table)
            db.execute('UPDATE schema_audio SET version=1')
        before = len(list(self.root.glob('*.respaldo-sesiones-*.sqlite3')))
        with app.db_open() as db:
            self.assertEqual(db.execute('SELECT version FROM schema_audio').fetchone()[0], 9)
        self.assertEqual(len(list(self.root.glob('*.respaldo-sesiones-*.sqlite3'))), before+1)
        with app.db_open() as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        self.assertEqual(len(list(self.root.glob('*.respaldo-sesiones-*.sqlite3'))), before+1)


if __name__ == '__main__':
    unittest.main()
