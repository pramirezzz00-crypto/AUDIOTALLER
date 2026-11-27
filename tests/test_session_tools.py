import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


class SessionToolsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.patch = mock.patch.dict(os.environ, {'HOME': str(base), 'XDG_DATA_HOME': str(base / 'd')})
        self.patch.start()
        import importlib, app
        self.A = importlib.reload(app)
        self.c = self.A.app.test_client()
        self.project = base / 'Proyecto'
        self.project.mkdir()
        (self.project / 'vieja.cpr').write_text('x')
        (self.project / 'otra.cpr').write_text('x')
        with self.A.db_open() as db:
            db.execute("INSERT INTO artistas(id,nombre,tipo,carpeta) VALUES('a1','Artista','Solista',?)", (str(base),))
            db.execute("INSERT INTO canciones(id,artista_id,disco_id,titulo,carpeta) VALUES('c1','a1','','Tema',?)", (str(base),))
            for sid, name in (('s1', 'vieja'), ('s2', 'otra')):
                db.execute("INSERT INTO sesiones(id,cancion_id,etapa,daw,ruta) VALUES(?,?,?,?,?)", (sid, 'c1', 'mezcla', 'Cubase', str(self.project / f'{name}.cpr')))
                db.execute("INSERT INTO sesion_info(id,nombre,modo) VALUES(?,?,'vinculada')", (sid, name))
            db.commit()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_validada_y_notas_con_adjunto(self):
        self.assertEqual(self.c.post('/api/produccion/c1/sesiones/s1/validada', json={'activa': True}).status_code, 200)
        attachment = Path(self.temp.name) / 'ref.pdf'
        attachment.write_text('pdf')
        r = self.c.post('/api/produccion/c1/sesiones/s1/bitacora', json={'texto': 'Subir voz\nRevisar bajo', 'adjuntos': [str(attachment)]})
        self.assertEqual(r.status_code, 201)
        data = self.c.get('/api/produccion/c1').get_json()
        s1 = next(s for s in data['sesiones'] if s['id'] == 's1')
        self.assertTrue(s1['validada'])
        self.assertEqual(s1['notas_total'], 1)
        notes = self.c.get('/api/produccion/c1/sesiones/s1/bitacora').get_json()['notas']
        self.assertEqual(notes[0]['adjuntos'][0]['nombre'], 'ref.pdf')
        nid = notes[0]['id']
        self.assertEqual(self.c.post(f'/api/produccion/c1/sesiones/s1/bitacora/{nid}', json={'borrar': True}).get_json()['notas'], [])

    def test_renombra_sin_pisar_archivos(self):
        r = self.c.post('/api/produccion/c1/renombrar-sesiones', json={'archivo': True, 'cambios': [
            {'id': 's1', 'nombre': '2026-11-26-Tema-V001'}, {'id': 's2', 'nombre': 'vieja'}]}).get_json()
        self.assertTrue((self.project / '2026-11-26-Tema-V001.cpr').exists())
        self.assertTrue((self.project / 'vieja.cpr').exists())  # s1 liberó ese nombre y s2 lo tomó, sin pisar nada
        self.assertFalse((self.project / 'otra.cpr').exists())
        self.assertEqual(len(r['renombradas']), 2)
        with self.A.db_open() as db:
            self.assertTrue(db.execute("SELECT ruta FROM sesiones WHERE id='s1'").fetchone()[0].endswith('2026-11-26-Tema-V001.cpr'))

    def test_rechaza_nombres_invalidos_sin_tocar_nada(self):
        r = self.c.post('/api/produccion/c1/renombrar-sesiones', json={'archivo': True, 'cambios': [
            {'id': 's1', 'nombre': 'bien'}, {'id': 's2', 'nombre': 'mal/nombre'}]})
        self.assertEqual(r.status_code, 400)
        self.assertTrue((self.project / 'vieja.cpr').exists())


class PluginManagerTest(unittest.TestCase):
    def test_instala_desactiva_y_restaura(self):
        import zipfile
        import plugin_inventory
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            roots = [('vst3-user', 'VST3', base / 'vst3', 'user'), ('clap-user', 'CLAP', base / 'clap', 'user')]
            with zipfile.ZipFile(base / 'SPAN.zip', 'w') as z:
                z.writestr('SPAN/SPAN.vst3/Contents/x', 'x')
            with mock.patch.object(plugin_inventory, 'plugin_roots', return_value=roots), \
                 mock.patch('plugin_manager.sys.platform', 'linux'), mock.patch.dict(os.environ, {'XDG_DATA_HOME': str(base / 'd'), 'HOME': str(base)}):
                import importlib, app
                A = importlib.reload(app)
                c = A.app.test_client()
                r = c.post('/api/plugins/instalar', json={'rutas': [str(base / 'SPAN.zip')]}).get_json()
                self.assertEqual(r['instalados'][0]['nombre'], 'SPAN')
                self.assertTrue((base / 'vst3' / 'SPAN.vst3').is_dir())
                again = c.post('/api/plugins/instalar', json={'rutas': [str(base / 'SPAN.zip')]}).get_json()
                self.assertIn('no lo reemplazo', again['omitidos'][0]['motivo'])
                listed = c.get('/api/plugins').get_json()
                self.assertTrue(any(i['instalado'] for s in listed['sugeridos'] for g in s['grupos'] for i in g['items'] if i['nombre'] == 'SPAN'))
                c.post('/api/plugins/desactivar', json={'id': 'vst3-user:SPAN.vst3'})
                self.assertFalse((base / 'vst3' / 'SPAN.vst3').exists())
                uid = c.get('/api/plugins').get_json()['desactivados'][0]['uid']
                c.post('/api/plugins/restaurar', json={'uid': uid})
                self.assertTrue((base / 'vst3' / 'SPAN.vst3').is_dir())


if __name__ == '__main__':
    unittest.main()
