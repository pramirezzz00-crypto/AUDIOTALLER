import json
import os
import sqlite3
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import migration
import plugin_inventory


def make_db(path, rows):
    with sqlite3.connect(path) as db:
        db.executescript('''CREATE TABLE canciones(id TEXT PRIMARY KEY, titulo TEXT);
            CREATE TABLE sesiones(id TEXT PRIMARY KEY, cancion_id TEXT, ruta TEXT);
            CREATE TABLE rediseno_datos(tipo TEXT, id TEXT, datos TEXT);''')
        db.executemany('INSERT INTO sesiones VALUES(?,?,?)', rows['sesiones'])
        db.executemany('INSERT INTO canciones VALUES(?,?)', rows.get('canciones', []))
        db.executemany('INSERT INTO rediseno_datos VALUES(?,?,?)', rows.get('docs', []))


def wait(job):
    for _ in range(400):
        state = job.snapshot()
        if not state['activo']:
            return state
        time.sleep(0.05)
    raise AssertionError('la migración no terminó')


class MigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.old_home, self.new_home = base / 'vieja' / 'pedro', base / 'nueva' / 'juan'
        self.old_data, self.new_data = self.old_home / '.datos' / 'AudioTaller', self.new_home / '.datos' / 'AudioTaller'
        self.external = base / 'DiscoExterno' / 'Samples'
        project = self.old_home / 'Music' / 'Proyectos' / 'Tema 1 Project'
        (project / 'Samples').mkdir(parents=True)
        (project / 'Tema 1.als').write_bytes(b'ableton')
        (project / 'Samples' / 'kick.wav').write_bytes(b'RIFF' + b'0' * 5000)
        (self.old_home / 'Downloads').mkdir()
        (self.old_home / 'Downloads' / 'referencia.wav').write_bytes(b'RIFFref')
        self.external.mkdir(parents=True)
        (self.external / 'loop.wav').write_bytes(b'RIFFloop')
        (self.old_data / 'Artistas' / 'Banda').mkdir(parents=True)
        (self.old_data / 'Artistas' / 'Banda' / 'foto.png').write_bytes(b'png')
        (self.old_data / 'portal-google.dpapi').write_bytes(b'secreto')
        self.project = project
        make_db(self.old_data / 'audiotaller.sqlite3', dict(
            canciones=[('c1', 'Tema 1')],
            sesiones=[('s1', 'c1', str(project / 'Tema 1.als')), ('s2', 'c1', str(self.old_home / 'Downloads' / 'referencia.wav')),
                      ('s3', 'c1', str(self.external / 'loop.wav')), ('s4', 'c1', str(self.old_data / 'Artistas' / 'Banda' / 'foto.png')),
                      ('s5', 'c1', str(self.old_home / 'no-existe.wav'))],
            docs=[('audiovisual', 'd1', json.dumps({'archivo': str(project / 'Samples' / 'kick.wav'), 'otro': str(project) + ' 2'}))]))
        self.old_plugins, self.new_plugins = base / 'vieja-vst3', base / 'nueva-vst3'
        (self.old_plugins / 'FreeVerb.vst3' / 'Contents').mkdir(parents=True)
        (self.old_plugins / 'FreeVerb.vst3' / 'Contents' / 'plugin.bin').write_bytes(b'free')
        if os.name != 'nt':
            os.symlink('plugin.bin', self.old_plugins / 'FreeVerb.vst3' / 'Contents' / 'enlace')
        (self.old_plugins / 'Waves').mkdir()
        (self.old_plugins / 'Waves' / 'WaveShell1-VST3 14.vst3').write_bytes(b'waves')
        self.new_plugins.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def env(self, home, plugins):
        kind = lambda path: 'externo' if 'DiscoExterno' in str(path) else 'interno'
        return [mock.patch('pathlib.Path.home', return_value=home), mock.patch.object(migration, 'disk_kind', side_effect=kind),
                mock.patch.object(plugin_inventory, 'plugin_roots', return_value=[('vst3', 'VST3', plugins, 'user')])]

    def run_with(self, patches, function):
        for patch in patches:
            patch.start()
        try:
            return function()
        finally:
            for patch in reversed(patches):
                patch.stop()

    def test_plan_lleva_el_disco_interno_y_deja_afuera_lo_externo(self):
        def check():
            with sqlite3.connect(self.old_data / 'audiotaller.sqlite3') as db:
                return migration.build_plan(db, self.old_data, self.old_data / 'audiotaller.sqlite3')
        plan = self.run_with(self.env(self.old_home, self.old_plugins), check)
        routes = {Path(p['ruta']): p for p in plan['proyectos']}
        self.assertTrue(routes[self.project]['incluir'])
        self.assertTrue(routes[self.old_home / 'Downloads' / 'referencia.wav']['incluir'])
        self.assertFalse(routes[self.external / 'loop.wav']['incluir'])
        self.assertNotIn(self.old_data / 'Artistas' / 'Banda' / 'foto.png', routes)
        self.assertEqual(plan['faltan_total'], 2)
        by_name = {p['nombre']: p for p in plan['plugins']}
        self.assertTrue(by_name['FreeVerb']['copiar'])
        self.assertEqual(by_name['WaveShell1-VST3 14']['central'], 'Waves Central')
        self.assertFalse(by_name['WaveShell1-VST3 14']['copiable'])

    def test_exporta_e_importa_en_otra_computadora_con_rutas_nuevas(self):
        destination = Path(self.temp.name) / 'pendrive' / 'migracion.zip'
        destination.parent.mkdir()

        def do_export():
            with sqlite3.connect(self.old_data / 'audiotaller.sqlite3') as db:
                plan = migration.build_plan(db, self.old_data, self.old_data / 'audiotaller.sqlite3')
            job = migration.Job()
            job.start('exportar', lambda j: migration.export(j, self.old_data / 'audiotaller.sqlite3', destination,
                                                             [p['id'] for p in plan['proyectos'] if p['incluir']], [p['id'] for p in plan['plugins'] if p['copiar']]))
            return wait(job)
        state = self.run_with(self.env(self.old_home, self.old_plugins), do_export)
        self.assertEqual(state['fase'], 'Listo', state['error'])
        names = zipfile.ZipFile(destination).namelist()
        self.assertIn('datos/Artistas/Banda/foto.png', names)
        self.assertFalse(any(n.endswith('.dpapi') for n in names))
        self.assertTrue(any(n.endswith('Samples/kick.wav') for n in names))
        self.assertFalse(any('loop.wav' in n for n in names))
        self.assertTrue(any('FreeVerb.vst3/Contents/plugin.bin' in n for n in names))
        self.assertFalse(any('WaveShell' in n for n in names))
        self.assertTrue(any('Waves' in note for note in state['resultado']['avisos']))

        self.new_data.mkdir(parents=True)
        make_db(self.new_data / 'audiotaller.sqlite3', dict(sesiones=[], canciones=[('x', 'Canción de prueba')]))

        def do_import():
            preview = migration.inspect(destination, self.new_data / 'audiotaller.sqlite3')
            job = migration.Job()
            job.start('importar', lambda j: migration.import_archive(j, destination, self.new_data / 'audiotaller.sqlite3'))
            return preview, wait(job), migration.plugin_checklist(self.new_data)
        preview, state, checklist = self.run_with(self.env(self.new_home, self.new_plugins), do_import)
        self.assertEqual(preview['canciones_actuales'], 1)
        self.assertEqual(state['fase'], 'Listo', state['error'])
        new_project = self.new_home / 'Music' / 'Proyectos' / 'Tema 1 Project'
        self.assertEqual((new_project / 'Samples' / 'kick.wav').read_bytes()[:4], b'RIFF')
        with sqlite3.connect(self.new_data / 'audiotaller.sqlite3') as db:
            routes = dict(db.execute('SELECT id, ruta FROM sesiones'))
            doc = json.loads(db.execute('SELECT datos FROM rediseno_datos').fetchone()[0])
        self.assertEqual(Path(routes['s1']), new_project / 'Tema 1.als')
        self.assertEqual(Path(routes['s2']), self.new_home / 'Downloads' / 'referencia.wav')
        self.assertEqual(Path(routes['s3']), self.external / 'loop.wav')
        self.assertEqual(Path(routes['s4']), self.new_data / 'Artistas' / 'Banda' / 'foto.png')
        self.assertEqual(Path(doc['archivo']), new_project / 'Samples' / 'kick.wav')
        self.assertEqual(doc['otro'], str(new_project) + ' 2')
        self.assertTrue((self.new_data / 'Artistas' / 'Banda' / 'foto.png').exists())
        self.assertTrue(Path(state['resultado']['respaldo'], 'audiotaller.sqlite3').exists())
        self.assertTrue((self.new_plugins / 'FreeVerb.vst3' / 'Contents' / 'plugin.bin').exists())
        if os.name != 'nt':
            self.assertTrue((self.new_plugins / 'FreeVerb.vst3' / 'Contents' / 'enlace').is_symlink())
        groups = {g['central']: g for g in checklist['centrales']}
        self.assertEqual(groups['Waves Central']['instalados'], 0)
        self.assertEqual(groups['Copiados por AudioTaller']['instalados'], 1)

    def test_no_pisa_una_carpeta_que_ya_existe(self):
        folder = Path(self.temp.name) / 'ocupada'
        folder.mkdir()
        (folder / 'algo.txt').write_text('x')
        self.assertEqual(migration.available(folder).name, 'ocupada (migrado)')

    def test_rechaza_rutas_que_salen_de_la_carpeta(self):
        with self.assertRaises(ValueError):
            migration.safe_target(self.temp.name, '../afuera.txt')

    def test_clasifica_centrales_conocidas(self):
        self.assertEqual(plugin_inventory.classify('Pigments', 'Arturia', '')['central'], 'Arturia Software Center')
        self.assertEqual(plugin_inventory.classify('EchoBoy', '', '')['licencia'], 'ilok')
        self.assertEqual(plugin_inventory.classify('Pro-Q 3', '', 'FabFilter')['licencia'], 'clave')
        self.assertEqual(plugin_inventory.classify('Supermassive', 'Valhalla DSP, LLC', '')['licencia'], 'gratis')
        self.assertEqual(plugin_inventory.classify('Cosa Rara', '', '')['licencia'], 'desconocida')


if __name__ == '__main__':
    unittest.main()
