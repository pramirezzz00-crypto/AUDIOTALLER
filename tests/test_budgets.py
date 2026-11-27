import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


class BudgetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.patch = mock.patch.dict(os.environ, {'HOME': str(base), 'XDG_DATA_HOME': str(base / 'd')})
        self.patch.start()
        import importlib, app
        self.A = importlib.reload(app)
        self.c = self.A.app.test_client()
        with self.A.db_open() as db:
            db.execute("INSERT INTO artistas(id,nombre,tipo,carpeta) VALUES('a1','Javier Araujo','Solista',?)", (str(base),))
            db.execute("INSERT INTO discos(id,artista_id,nombre,carpeta) VALUES('d1','a1','Bruma',?)", (str(base),))
            for i in range(3):
                db.execute("INSERT INTO canciones(id,artista_id,disco_id,titulo,carpeta) VALUES(?,?,?,?,?)", (f'c{i}', 'a1', 'd1', f'Tema {i}', str(base)))
            db.commit()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_perfil_y_saludo(self):
        self.assertFalse(self.c.get('/api/perfil').get_json()['configurado'])
        r = self.c.post('/api/perfil', json={'tipo': 'estudio', 'estudio': 'Estudio Bruma', 'nombre': 'Pedro', 'productores': [{'nombre': 'Nahuel'}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.get('/api/inicio').get_json()['usuario'], 'Pedro')
        self.assertEqual(self.c.post('/api/perfil', json={'tipo': 'estudio', 'nombre': 'X'}).status_code, 400)

    def test_presupuesto_del_ejemplo_suma_1610_usd_y_genera_pdf(self):
        bid = self.c.post('/api/presupuestos', json={'titulo': 'Vos Sabés'}).get_json()['id']
        doc = self.c.get(f'/api/presupuestos/{bid}').get_json()['presupuesto']
        doc['bloques'][2]['items'] += [dict(concepto='Violinista', valor=20, cantidad=3, unidad='hs'), dict(concepto='Violista', valor=20, cantidad=3, unidad='hs')]
        doc['bloques'][3]['items'].append(dict(concepto='Material virgen CD', valor=2, cantidad=10, unidad='UN'))
        r = self.c.post(f'/api/presupuestos/{bid}', json=doc).get_json()
        self.assertEqual(r['calculo']['total'], 1610)
        doc['alcance'] = {'tipo': 'disco', 'disco_id': 'd1'}
        doc['moneda_pdf'] = 'ARS'
        doc['cotizacion'] = 1000
        r = self.c.post(f'/api/presupuestos/{bid}', json=doc).get_json()
        self.assertEqual(r['canciones'], 3)
        self.assertEqual(r['calculo']['total'], 1610 + 600)  # el mastering va × canción
        pdf = self.c.get(f'/api/presupuestos/{bid}.pdf')
        self.assertTrue(pdf.data.startswith(b'%PDF'))
        self.assertIn(b'2.210.000 ARS', pdf.data)

    def test_rechaza_valores_invalidos(self):
        bid = self.c.post('/api/presupuestos', json={}).get_json()['id']
        doc = self.c.get(f'/api/presupuestos/{bid}').get_json()['presupuesto']
        doc['bloques'][0]['items'][0]['valor'] = -5
        self.assertEqual(self.c.post(f'/api/presupuestos/{bid}', json=doc).status_code, 400)


if __name__ == '__main__':
    unittest.main()
