import json
from contextlib import contextmanager
from migrations import migrate
from management import register_management, save_roles
from production import register_production
from flask import Flask, jsonify, request, send_file
from itsdangerous import BadSignature, URLSafeSerializer
from pathlib import Path
import os, re, sqlite3, uuid

app = Flask(__name__)
ROOT = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'AudioTaller'
LIBRARY = ROOT / 'Artistas'
DB = ROOT / 'audiotaller.sqlite3'
STAGES = ('01. DEMO', '02. MAQUETADO', '03. GRABACIÓN', '04. PRODUCCIÓN')
@contextmanager
def db_open():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript('''
    CREATE TABLE IF NOT EXISTS artistas(id TEXT PRIMARY KEY,nombre TEXT NOT NULL,tipo TEXT NOT NULL,carpeta TEXT NOT NULL,imagen TEXT DEFAULT '',creado TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS perfiles_artista(id TEXT PRIMARY KEY, datos TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS discos(id TEXT PRIMARY KEY,artista_id TEXT NOT NULL,nombre TEXT NOT NULL,carpeta TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS canciones(id TEXT PRIMARY KEY,artista_id TEXT NOT NULL,disco_id TEXT DEFAULT '',titulo TEXT NOT NULL,metadata TEXT DEFAULT '',carpeta TEXT NOT NULL,creado TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sesiones(id TEXT PRIMARY KEY,cancion_id TEXT NOT NULL,etapa TEXT NOT NULL,daw TEXT DEFAULT '',ruta TEXT NOT NULL,comentario TEXT DEFAULT '',creado TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS detalle_disco(id TEXT PRIMARY KEY, datos TEXT NOT NULL, creado TEXT, actualizado TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS detalle_cancion(id TEXT PRIMARY KEY, datos TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versiones(id TEXT PRIMARY KEY,sesion_id TEXT NOT NULL,ruta TEXT NOT NULL,comentario TEXT DEFAULT '',creado TEXT DEFAULT CURRENT_TIMESTAMP);
    ''')
    try:
        migrate(db, DB)
        with db:
            yield db
    finally:
        db.close()

def safe_name(value):
    return re.sub(r'[<>:"/\\|?*]', '', value).strip().rstrip('.') or 'Sin título'

@app.get('/')
def home():
    return app.send_static_file('audio.html')

@app.get('/api/biblioteca')
def biblioteca():
    q = '%' + request.args.get('q', '').strip() + '%'
    with db_open() as db:
        rows = db.execute('''SELECT DISTINCT a.*, (SELECT COUNT(*) FROM discos WHERE artista_id=a.id) AS discos, (SELECT COUNT(*) FROM canciones WHERE artista_id=a.id) AS canciones FROM artistas a LEFT JOIN discos d ON d.artista_id=a.id LEFT JOIN canciones c ON c.artista_id=a.id WHERE a.nombre LIKE ? OR d.nombre LIKE ? OR c.titulo LIKE ? ORDER BY a.nombre''', (q,q,q)).fetchall()
    return jsonify([dict(x) for x in rows])

@app.post('/api/artistas')
@app.post('/api/artistas/<aid>')
def guardar_artista(aid=None):
    data = request.get_json() or {}
    name = data.get('nombre', '').strip()
    tipo = data.get('tipo', 'Artista')
    imagen = data.get('imagen', '')
    if not name or len(name) > 150 or not isinstance(tipo, str) or not tipo.strip() or len(tipo) > 80:
        return jsonify(error='Ingresá un nombre válido y elegí el tipo de artista.'), 400
    if imagen and (len(imagen) > 2_800_000 or not re.fullmatch(r'data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+', imagen)):
        return jsonify(error='La imagen debe ser JPG o PNG de hasta 2 MB.'), 400

    # Editar cambia el perfil, conservando la carpeta y las relaciones existentes.
    editing = aid is not None
    with db_open() as db:
        if editing:
            result = db.execute('UPDATE artistas SET nombre=?, tipo=?, imagen=? WHERE id=?', (name, tipo, imagen, aid))
            if not result.rowcount:
                return jsonify(error='Artista no encontrado.'), 404
        else:
            aid = uuid.uuid4().hex
            folder = LIBRARY / f'{safe_name(name)[:80]}-{aid[:6]}'
            folder.mkdir(parents=True, exist_ok=False)
            db.execute('INSERT INTO artistas(id,nombre,tipo,carpeta,imagen) VALUES(?,?,?,?,?)',
                       (aid, name, tipo, str(folder), imagen))
        save_roles(db, aid, data.get('perfil', {}), tipo)
        db.execute('INSERT OR REPLACE INTO perfiles_artista VALUES(?,?)', (aid, json.dumps(data.get('perfil', {}))))
    return jsonify(id=aid), 200 if editing else 201


@app.get('/api/artistas/<aid>')
def artist_get(aid):
    with db_open() as db:
        row = db.execute('''SELECT a.*,
            (SELECT COUNT(*) FROM discos WHERE artista_id=a.id) AS discos,
            (SELECT COUNT(*) FROM canciones WHERE artista_id=a.id) AS canciones
            FROM artistas a WHERE a.id=?''', (aid,)).fetchone()
        profile = db.execute('SELECT datos FROM perfiles_artista WHERE id=?', (aid,)).fetchone()
    if not row:
        return jsonify(error='Artista no encontrado.'), 404
    return jsonify(**dict(row), perfil=json.loads(profile['datos']) if profile else {})


@app.get('/api/artistas/<aid>/contenido')
def artist_content(aid):
    # Los metadatos adicionales viven aparte para conservar las filas y rutas anteriores.
    with db_open() as db:
        albums = [dict(row) for row in db.execute(
            """SELECT d.*, x.datos, x.creado, x.actualizado FROM discos d
               LEFT JOIN detalle_disco x ON x.id=d.id WHERE d.artista_id=?""", (aid,))]
        songs = [dict(row) for row in db.execute(
            """SELECT c.*, x.datos, e.estado, e.actualizado FROM canciones c LEFT JOIN detalle_cancion x ON x.id=c.id
               LEFT JOIN estado_cancion e ON e.id=c.id
               WHERE c.artista_id=? ORDER BY c.creado, c.id""", (aid,))]
    for row in albums + songs:
        row.update(json.loads(row.pop('datos') or '{}'))
    return jsonify(discos=albums, canciones=songs, sueltas=[row for row in songs if not row['disco_id']])


@app.post('/api/artistas/<aid>/discos')
@app.post('/api/artistas/<aid>/discos/<did>')
def album_new(aid, did=None):
    data = request.get_json() or {}
    name = data.get('nombre', '').strip()
    tipo = data.get('tipo', 'Álbum')
    portada = data.get('portada', '')
    if not name or len(name) > 150 or tipo not in ('Álbum', 'EP', 'Single'):
        return jsonify(error='Ingresá un nombre y un tipo de disco válidos.'), 400
    if portada and (len(portada) > 2_800_000 or not re.fullmatch(r'data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+', portada)):
        return jsonify(error='Elegí una portada JPG o PNG de hasta 2 MB.'), 400
    details = json.dumps(dict(tipo=tipo, portada=portada, lanzamiento=data.get('lanzamiento', ''), notas=data.get('notas', '')))
    editing = did is not None
    with db_open() as db:
        if editing:
            result = db.execute('UPDATE discos SET nombre=? WHERE id=? AND artista_id=?', (name, did, aid))
            if not result.rowcount:
                return jsonify(error='Disco no encontrado.'), 404
            db.execute("""INSERT INTO detalle_disco(id,datos) VALUES(?,?)
                          ON CONFLICT(id) DO UPDATE SET datos=excluded.datos, actualizado=CURRENT_TIMESTAMP""",
                       (did, details))
        else:
            artist = db.execute('SELECT carpeta FROM artistas WHERE id=?', (aid,)).fetchone()
            if not artist:
                return jsonify(error='Artista no encontrado.'), 404
            did = uuid.uuid4().hex
            folder = Path(artist['carpeta']) / 'Discos' / f'{safe_name(name)[:80]}-{did[:6]}'
            folder.mkdir(parents=True, exist_ok=False)
            db.execute('INSERT INTO discos VALUES(?,?,?,?)', (did, aid, name, str(folder)))
            db.execute('INSERT INTO detalle_disco(id,datos,creado) VALUES(?,?,CURRENT_TIMESTAMP)', (did, details))
    return jsonify(id=did), 200 if editing else 201


@app.get('/api/discos/<did>')
def album_get(did):
    with db_open() as db:r=db.execute('SELECT * FROM discos WHERE id=?',(did,)).fetchone()
    return (jsonify(dict(r)),200) if r else (jsonify(error='Disco no encontrado.'),404)

@app.post('/api/artistas/<aid>/canciones')
def song_new(aid):
    data=request.get_json() or {};title=data.get('titulo','').strip()
    if not title:return jsonify(error='Ingresá el título de la canción.'),400
    with db_open() as db:
        artist=db.execute('SELECT * FROM artistas WHERE id=?',(aid,)).fetchone()
        if not artist:return jsonify(error='Artista no encontrado.'),404
        album=db.execute('SELECT * FROM discos WHERE id=? AND artista_id=?',(data.get('disco_id',''),aid)).fetchone() if data.get('disco_id') else None
        if data.get('disco_id') and not album:
            return jsonify(error='Disco no encontrado para este artista.'), 404
        pista = str(data.get('pista', '')).strip() if album else ''
        if pista and (not pista.isascii() or not pista.isdigit() or len(pista) > 5 or int(pista) < 1):
            return jsonify(error='Ingresá un número de pista válido.'), 400
        parent=Path(album['carpeta']) if album else Path(artist['carpeta'])/'Canciones sueltas'
        sid=uuid.uuid4().hex;folder=parent/f'{safe_name(title)}-{sid[:6]}';folder.mkdir(parents=True,exist_ok=False)
        for stage in STAGES: (folder/stage).mkdir()
        (folder/'metadata.txt').write_text(data.get('metadata',''),encoding='utf-8')
        db.execute('INSERT INTO canciones(id,artista_id,disco_id,titulo,metadata,carpeta) VALUES(?,?,?,?,?,?)',(sid,aid,data.get('disco_id',''),title,data.get('metadata',''),str(folder)))
        db.execute('INSERT INTO detalle_cancion VALUES(?,?)', (sid, json.dumps(
            dict(pista=int(pista) if pista else None, bpm=data.get('bpm', ''), tonalidad=data.get('tonalidad', '')))))
        if album:
            db.execute("""INSERT INTO detalle_disco(id,datos) VALUES(?, '{}')
                          ON CONFLICT(id) DO UPDATE SET actualizado=CURRENT_TIMESTAMP""", (album['id'],))
    return jsonify(id=sid),201

@app.get('/api/discos/<did>/canciones')
def album_songs(did):
    with db_open() as db:rows=db.execute('SELECT * FROM canciones WHERE disco_id=? ORDER BY titulo',(did,)).fetchall()
    return jsonify([dict(x) for x in rows])

@app.get('/api/canciones/<sid>')
def song_get(sid):
    with db_open() as db:r=db.execute('SELECT * FROM canciones WHERE id=?',(sid,)).fetchone()
    return (jsonify(dict(r)),200) if r else (jsonify(error='Canción no encontrada.'),404)

@app.get('/api/canciones/<sid>/etapas')
def song_stages(sid):
    keys={'01. DEMO':'demo','02. MAQUETADO':'maqueta','03. GRABACIÓN':'grabacion','04. PRODUCCIÓN':'produccion'}
    with db_open() as db:
        song=db.execute('SELECT * FROM canciones WHERE id=?',(sid,)).fetchone()
        if not song:return jsonify(error='Canción no encontrada.'),404
        sessions=db.execute('SELECT * FROM sesiones WHERE cancion_id=? ORDER BY creado DESC',(sid,)).fetchall()
    result=[]
    for stage,key in keys.items():
        labelstage=('Mezcla','Mastering') if key=='produccion' else (stage,)
        result.extend({'etapa':label,'key':key,'adjuntos':label.lower() if key=='produccion' else key,'sesiones':[dict(x) for x in sessions if x['etapa']==label]} for label in labelstage)
    return jsonify(result)

# Arreglos reproduce los archivos de audio existentes, sin interpretar sesiones del DAW.
AUDIO_TYPES = {
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac',
    '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4',
    '.aac': 'audio/aac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
    '.wma': 'audio/x-ms-wma',
}
take_tokens = URLSafeSerializer(os.urandom(32), salt='audio-take')


@app.get('/api/arreglos/canciones')
def arrangements_songs():
    with db_open() as db:
        songs = db.execute("""SELECT c.id, c.titulo, a.nombre AS artista, d.nombre AS disco
            FROM canciones c JOIN artistas a ON a.id=c.artista_id
            LEFT JOIN discos d ON d.id=c.disco_id ORDER BY c.titulo COLLATE NOCASE""")
        return jsonify([dict(song) for song in songs])


def arrangement_folders(sid):
    with db_open() as db:
        song = db.execute('SELECT carpeta FROM canciones WHERE id=?', (sid,)).fetchone()
        if not song:
            return None
        sessions = db.execute('SELECT ruta, etapa, daw FROM sesiones WHERE cancion_id=?', (sid,)).fetchall()
        linked_files = db.execute("SELECT ruta, etapa FROM archivos WHERE cancion_id=? AND modo='vinculado'", (sid,)).fetchall()
        versions = db.execute("""SELECT v.ruta, s.etapa, s.daw FROM versiones v
            JOIN sesiones s ON s.id=v.sesion_id WHERE s.cancion_id=?""", (sid,)).fetchall()
    folders = [(row['ruta'], ' · '.join(filter(None, (row['etapa'], row['daw']))))
               for row in [*sessions, *versions] if row['ruta']]
    folders.extend((row['ruta'], 'Archivo vinculado · ' + row['etapa'])
                   for row in linked_files if Path(row['ruta']).suffix.lower() in AUDIO_TYPES)
    if song['carpeta']:
        folders.append((song['carpeta'], 'Carpeta de la canción'))
    return folders


@app.get('/api/arreglos/canciones/<sid>/tomas')
def arrangements_takes(sid):
    folders = arrangement_folders(sid)
    if folders is None:
        return jsonify(error='Canción no encontrada.'), 404
    takes, seen_files, seen_dirs, missing = [], set(), set(), set()

    def unavailable(error):
        missing.add(error.filename or 'Carpeta inaccesible')

    for stored, label in folders:
        try:
            root = Path(stored).resolve(strict=True)
            # Algunas sesiones vinculadas guardan el archivo del DAW, no su carpeta.
            if root.is_file():
                if root.suffix.lower() in AUDIO_TYPES:
                    if root not in seen_files:
                        seen_files.add(root)
                        takes.append(dict(nombre=root.name, origen=label, carpeta='.',
                                          token=take_tokens.dumps(str(root))))
                    continue
                root = root.parent
            if not root.is_dir():
                missing.add(stored)
                continue
        except (OSError, RuntimeError):
            missing.add(stored)
            continue

        # Los archivos repetidos entre una sesión y la carpeta de la canción aparecen una vez.
        for directory, subdirs, filenames in os.walk(root, onerror=unavailable):
            current = Path(directory)
            if current in seen_dirs:
                subdirs.clear()
                continue
            seen_dirs.add(current)
            subdirs[:] = [name for name in subdirs if not (current / name).is_symlink()
                          and not (current / name).is_junction()]
            for name in filenames:
                path = current / name
                if path.suffix.lower() not in AUDIO_TYPES:
                    continue
                try:
                    path = path.resolve(strict=True)
                    if not path.is_relative_to(root) or path in seen_files or not path.is_file():
                        continue
                except (OSError, RuntimeError):
                    continue
                seen_files.add(path)
                takes.append(dict(nombre=name, origen=label, carpeta=str(path.parent.relative_to(root)),
                                  token=take_tokens.dumps(str(path))))
    takes.sort(key=lambda take: (take['origen'].casefold(), take['carpeta'].casefold(), take['nombre'].casefold()))
    return jsonify(tomas=takes, carpetas_inaccesibles=len(missing))


@app.get('/api/arreglos/audio/<token>')
def arrangements_audio(token):
    # Solo se sirven archivos autorizados al explorar las carpetas vinculadas.
    try:
        path = Path(take_tokens.loads(token))
        mimetype = AUDIO_TYPES.get(path.suffix.lower())
        if mimetype and path.resolve(strict=True) == path and path.is_file():
            return send_file(path, mimetype=mimetype, conditional=True, max_age=0)
    except (BadSignature, OSError, RuntimeError):
        pass
    return jsonify(error='El archivo ya no está disponible.'), 404


register_management(app, db_open)
register_production(app, db_open, safe_name)

if __name__ == '__main__':
    app.run(host='127.0.0.1',port=5000,debug=False)
