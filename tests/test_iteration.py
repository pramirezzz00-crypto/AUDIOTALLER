import sys,tempfile,json,io,sqlite3
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
import unittest


class ProductionMigrationTest(unittest.TestCase):
    def test_preserva_historial_y_relaciones(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as tmp:
            root=Path(tmp)
            app.DB=root/'test.sqlite'
            app.LIBRARY=root/'Artistas'
            # Una base anterior con adjuntos y relaciones existentes antes de la migración.
            with sqlite3.connect(app.DB) as db:
                db.executescript("""
                CREATE TABLE artistas(id TEXT PRIMARY KEY,nombre TEXT,tipo TEXT,carpeta TEXT,imagen TEXT,creado TEXT);
                CREATE TABLE canciones(id TEXT PRIMARY KEY,artista_id TEXT,disco_id TEXT,titulo TEXT,metadata TEXT,carpeta TEXT,creado TEXT);
                CREATE TABLE sesiones(id TEXT PRIMARY KEY,cancion_id TEXT,etapa TEXT,daw TEXT,ruta TEXT,comentario TEXT,creado TEXT);
                """)
                db.execute('INSERT INTO artistas VALUES(?,?,?,?,?,?)',('old','Anterior','Artista',str(root/'old'),'','2024-01-01'))
                db.execute('INSERT INTO canciones VALUES(?,?,?,?,?,?,?)',('song','old','','Canción anterior','notas',str(root/'song'),'2024-01-01'))
                db.execute('INSERT INTO sesiones VALUES(?,?,?,?,?,?,?)',('session','song','Mezcla','Cubase',str(root/'externo'),'historial','2024-01-01'))
            db.close()
            historic=root/'song/01. DEMO/Adjuntos';historic.mkdir(parents=True)
            (historic/'anterior.wav').write_bytes(b'previous')
            c=app.app.test_client()
            assert c.get('/api/produccion/song').status_code==200
            ws=c.get('/api/produccion/song').json
            assert ws['archivos'][0]['nombre']=='anterior.wav'
            assert ws['sesiones'][0]['etapa']=='mezcla'
            assert len(list(root.glob('test.respaldo-*.sqlite3')))==1
            assert c.get('/api/produccion/song').status_code==200
            assert len(list(root.glob('test.respaldo-*.sqlite3')))==1
            musician=c.post('/api/artistas',json={'nombre':'Músico','tipo':'Músico','perfil':{'roles':['Músico','Arreglista'],'instrumentos':['Voz','Piano'],'especialidades':['Grabación']}})
            assert musician.status_code==201,musician.data
            mid=musician.json['id']
            band=c.post('/api/artistas',json={'nombre':'Banda','tipo':'Banda'}).json['id']
            assert c.post('/api/clasificaciones',json={'nombre':'Director musical'}).status_code==201
            assert c.post('/api/participaciones',json={'grupo_id':band,'persona_id':mid,'funcion':'Piano'}).status_code==200
            professional=c.get('/api/personas/'+mid).json
            assert professional['instrumentos']==['Piano','Voz'] or set(professional['instrumentos'])=={'Voz','Piano'}
            assert len(professional['participaciones'])==1
            album=c.post('/api/artistas/old/discos',json={'nombre':'Álbum'}).json['id']
            assert c.post('/api/canciones/song/editar',json={'titulo':'Actualizada','disco_id':album,'pista':2}).status_code==200
            assert c.get('/api/canciones/song').json['id']=='song'
            assert c.get('/api/canciones/song').json['carpeta']==str(root/'song')
            session=c.post('/api/produccion/song/sesiones',json={'nombre':'Demo nueva','etapa':'demo','daw':'Reaper'}).json['id']
            session2=c.post('/api/produccion/song/sesiones',json={'nombre':'Grabación externa','etapa':'grabacion','daw':'Cubase','ruta':str(root/'sin-conexion.cpr'),'principal':True})
            assert session2.status_code==201,session2.data
            assert not (root/'sin-conexion.cpr').exists()
            result=c.post('/api/produccion/song/archivos/demo',data={'file':(io.BytesIO(b'nuevo'),'voz.wav'),'sesion_id':session})
            assert result.status_code==201,result.data
            external=root/'original.wav';external.write_bytes(b'original')
            assert c.post('/api/produccion/song/vinculos',json={'etapa':'mezcla','ruta':str(external)}).status_code==201
            assert external.read_bytes()==b'original'
            assert c.post('/api/produccion/song/notas/mezcla',json={'texto':'Ajustar la voz'}).status_code==200
            ws=c.get('/api/produccion/song').json
            assert len(ws['archivos'])==3 and len(ws['sesiones'])==3
            assert ws['notas']['mezcla']=='Ajustar la voz'
            assert c.get('/api/produccion/song').json['archivos']==ws['archivos']
            assert c.post('/api/produccion/song/vinculos',json={'etapa':'../bad','ruta':str(external)}).status_code==400
            assert len(c.get('/api/proyectos').json['discos'])==1
            assert len(ws['eventos'])>=5
            version=c.post('/api/produccion/song/archivos/demo',data={'file':(io.BytesIO(b'otra'),'voz.wav'),'version_de':result.json['id']})
            assert version.status_code==201,version.data
            assert c.get('/api/produccion/song').json['eventos'][0]['tipo']=='Nueva versión registrada'
            assert external.read_bytes()==b'original'
            assert any(take['nombre']=='original.wav' for take in c.get('/api/arreglos/canciones/song/tomas').json['tomas'])
        


if __name__ == "__main__":
    unittest.main()
