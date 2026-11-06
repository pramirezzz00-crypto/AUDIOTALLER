"""Copias reales de archivos temporales y lanzamiento simulado de aplicaciones DAW."""
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
import daw_operations


class DawOperationsTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.root=Path(self.temp.name).resolve()
        app.DB=self.root/'db.sqlite3'
        app.LIBRARY=self.root/'Artistas'
        self.c=app.app.test_client()
        aid=self.c.post('/api/artistas',json={'nombre':'Prueba'}).json['id']
        self.sid=self.c.post('/api/artistas/'+aid+'/canciones',json={'titulo':'Tema'}).json['id']
        self.url='/api/produccion/'+self.sid
        self.folder=self.root/'Cubase'
        (self.folder/'Audio').mkdir(parents=True)
        self.project=self.folder/'Mix.cpr'
        self.project.write_bytes(b'proyecto nativo de prueba')
        (self.folder/'Audio'/'toma.wav').write_bytes(b'medios de prueba')
        self.session=self.c.post(self.url+'/sesiones',json={'nombre':'Original','etapa':'mezcla','daw':'Cubase','ruta':str(self.project)}).json['id']

    def tearDown(self):
        self.temp.cleanup()

    def test_copia_versionada_preserva_original_y_notas(self):
        original=self.project.read_bytes()
        state=self.c.get(self.url).json
        self.assertEqual(state['sesiones'][0]['version'],1)
        # Un archivo no catalogado también ocupa su nombre.
        (self.folder/'Cambios_V002.cpr').write_bytes(b'previo')
        response=self.c.post(self.url+'/duplicar-sesion/'+self.session,json={'nombre':'Cambios','notas':'Bajar voz'})
        self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(response.json['version'],3)
        target=Path(response.json['ruta'])
        self.assertEqual(target.parent,self.project.parent)
        self.assertEqual(target.name,'Cambios_V003.cpr')
        self.assertEqual(target.read_bytes(),original)
        self.assertEqual(self.project.read_bytes(),original)
        session=next(row for row in self.c.get(self.url).json['sesiones'] if row['id']==response.json['id'])
        self.assertEqual(session['comentario'],'Bajar voz')
        self.assertEqual(session['version'],3)

    def test_sesion_nueva_reaper_y_cubase_con_plantilla(self):
        exe=self.root/'reaper.exe';exe.touch()
        daws=[dict(id='reaper',nombre='REAPER',ejecutable=str(exe),extension='.rpp',plantilla='',vacio=True,plantillas=[]),
              dict(id='cubase',nombre='Cubase',ejecutable=str(exe),extension='.cpr',plantilla='',vacio=False,plantillas=[])]
        with patch('daw_operations.installed_daws',return_value=daws),patch('daw_operations.subprocess.Popen') as launch:
            reaper=self.c.post(self.url+'/crear-en-daw',json={'nombre':'Grabación','etapa':'grabacion','daw_id':'reaper'})
            self.assertEqual(reaper.status_code,201,reaper.data)
            self.assertIn('<REAPER_PROJECT',Path(reaper.json['ruta']).read_text())
            launch.assert_called_once()
            self.assertEqual(self.c.post(self.url+'/crear-en-daw',json={'nombre':'Cubase','etapa':'mezcla','daw_id':'cubase'}).status_code,400)
            cubase=self.c.post(self.url+'/crear-en-daw',json={'nombre':'Cubase','etapa':'mezcla','daw_id':'cubase','plantilla':str(self.project)})
            self.assertEqual(cubase.status_code,201,cubase.data)
            self.assertEqual(Path(cubase.json['ruta']).read_bytes(),self.project.read_bytes())

    def wait_job(self,identity):
        for _ in range(200):
            job=self.c.get(self.url+'/copiar-produccion/'+identity).json
            if job['estado'] in ('completada','error'):
                return job
            time.sleep(.02)
        self.fail('La copia no terminó.')

    def test_copia_completa_cambia_vinculos_tras_verificar(self):
        original=self.project.read_bytes()
        before=self.c.get(self.url).json['sesiones'][0]['version']
        plan=self.c.post(self.url+'/copiar-produccion/plan',json={})
        self.assertEqual(plan.status_code,200,plan.data)
        self.assertEqual(plan.json['archivos'],2)
        identity=plan.json['id']
        self.assertEqual(self.c.post(self.url+'/copiar-produccion/'+identity+'/iniciar',json={}).status_code,202)
        job=self.wait_job(identity)
        self.assertEqual(job['estado'],'completada',job)
        session=self.c.get(self.url).json['sesiones'][0]
        target=Path(session['ruta'])
        self.assertNotEqual(target,self.project)
        self.assertEqual(target.read_bytes(),original)
        self.assertEqual((target.parent/'Audio'/'toma.wav').read_bytes(),b'medios de prueba')
        self.assertEqual(self.project.read_bytes(),original)
        self.assertEqual(session['version'],before)
        self.assertEqual(self.c.post(self.url+'/copiar-produccion/'+identity+'/iniciar',json={}).status_code,200)

    def test_archivo_cambiado_cancela_sin_reasociar(self):
        plan=self.c.post(self.url+'/copiar-produccion/plan',json={}).json
        self.project.write_bytes(b'cambio del DAW despues de la vista previa')
        identity=plan['id']
        self.c.post(self.url+'/copiar-produccion/'+identity+'/iniciar',json={})
        job=self.wait_job(identity)
        self.assertEqual(job['estado'],'error')
        self.assertEqual(self.c.get(self.url).json['sesiones'][0]['ruta'],str(self.project))


if __name__=='__main__':
    unittest.main()
