"""Catálogo de audios y playlists referenciadas, sin duplicar los originales."""
import json
import math
import struct
import unicodedata
import uuid
from functools import lru_cache
from pathlib import Path
from flask import jsonify, request
from management import required_row
from song_hub import json_row, text

AUDIO_EXTENSIONS = {'.wav','.mp3','.flac','.ogg','.m4a','.aac','.opus','.aif','.aiff'}
CLASSES = ('Demo','Maqueta','Grabación','Mezcla','Master','Referencia','Otro')
STAGE_CLASS = {'demo':'Demo','maqueta':'Maqueta','grabacion':'Grabación','mezcla':'Mezcla','mastering':'Master'}


@lru_cache(maxsize=512)
def wav_header(path, size, modified):
    """Lee solo encabezados RIFF: también reconoce PCM float y extensible.

    No abre el DAW, no reescribe etiquetas ni recorre los bloques de audio.
    Formatos comprimidos no reconocidos mantienen los datos desconocidos vacíos.
    """
    try:
        with open(path, 'rb') as source:
            header = source.read(12)
            if header[:4] != b'RIFF' or header[8:] != b'WAVE':
                return {}
            fmt = None
            data_size = None
            for _ in range(256):
                chunk = source.read(8)
                if len(chunk) != 8:
                    break
                key, length = struct.unpack('<4sI', chunk)
                if source.tell()+length > size:
                    return {}
                if key == b'fmt ':
                    raw = source.read(min(length, 40))
                    if len(raw) < 16:
                        return {}
                    code, channels, rate, byte_rate, block, bits = struct.unpack('<HHIIHH',raw[:16])
                    if code == 65534 and len(raw) >= 40:
                        code = struct.unpack('<H',raw[24:26])[0]
                    fmt = (code,channels,rate,byte_rate,block,bits)
                    source.seek(length-len(raw),1)
                else:
                    if key == b'data':
                        data_size = length
                    source.seek(length,1)
                if fmt and data_size is not None:
                    break
                source.seek(length % 2,1)
            if not fmt or data_size is None:
                return {}
            code, channels, rate, byte_rate, block, bits = fmt
            if code not in (1,3) or not 1 <= channels <= 64 or rate <= 0 or block <= 0:
                return {}
            return dict(duracion=data_size/block/rate, canales=channels, frecuencia=rate, bits=bits,
                        codificacion='Float' if code == 3 else 'PCM')
    except (OSError, struct.error, OverflowError):
        return {}


def normalize(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '').lower()) if not unicodedata.combining(c))


def catalog_rows(db):
    rows = []
    for raw in db.execute('''SELECT f.*,c.titulo,c.artista_id,c.disco_id,a.nombre AS artista,d.nombre AS disco,
            si.nombre AS sesion,r.numero AS version_sesion,ca.favorito,ca.clase,ca.version,ca.notas AS notas_audio,ca.grabacion_id
            FROM archivos f JOIN canciones c ON c.id=f.cancion_id JOIN artistas a ON a.id=c.artista_id
            LEFT JOIN discos d ON d.id=c.disco_id LEFT JOIN sesion_info si ON si.id=f.sesion_id
            LEFT JOIN revision_sesion r ON r.sesion_id=f.sesion_id LEFT JOIN catalogo_audio ca ON ca.archivo_id=f.id
            ORDER BY f.creado DESC,f.rowid DESC'''):
        row = dict(raw)
        if Path(row['nombre']).suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        row['clase'] = row['clase'] or STAGE_CLASS.get(row['etapa'],'Otro')
        row['favorito'] = bool(row['favorito'])
        row['version'] = row['version'] or ('Sesión V%03d' % row['version_sesion'] if row['version_sesion'] else '')
        row['notas_audio'] = row['notas_audio'] or ''
        details = json_row(db, 'detalle_cancion', row['cancion_id'])
        work = json_row(db, 'registro_obra', row['cancion_id'])
        extra = json_row(db, 'ficha_cancion', row['cancion_id'])
        state = db.execute('SELECT estado FROM estado_cancion WHERE id=?', (row['cancion_id'],)).fetchone()
        row.update(bpm=details.get('bpm',''), tonalidad=details.get('tonalidad',''), genero=work.get('genero',''),
                   idioma=work.get('idioma',''), anio=extra.get('anio',''), etiquetas=extra.get('etiquetas',[]),
                   con_enlace=any(extra.get('links',{}).get(key) for key in ('spotify','youtube','ama')),
                   estado=state['estado'] if state else 'En producción')
        recording=db.execute('SELECT datos FROM registro_grabacion WHERE id=?',(row['grabacion_id'],)).fetchone()
        row['isrc']=json.loads(recording['datos']).get('isrc','') if recording else ''
        row['_busqueda'] = ' '.join(str(value) for value in [row['nombre'],row['titulo'],row['artista'],row['disco'],
            row['clase'],row['version'],row['genero'],row['tonalidad'],row['idioma'],row['notas_audio'],
            row['etiquetas'],extra.get('letra',''),extra.get('campos',{})])
        row['_busqueda'] += ' '+ ' '.join(row['nombre']+' '+row['rol'] for row in db.execute('''SELECT a.nombre,cr.rol
            FROM creditos cr JOIN artistas a ON a.id=cr.persona_id WHERE cr.cancion_id=?''',(row['cancion_id'],)))
        row['tecnica'] = {}
        try:
            stat = Path(row['ruta']).stat()
            row.update(disponible=Path(row['ruta']).is_file(),tamano=stat.st_size,modificado=stat.st_mtime_ns)
            if Path(row['ruta']).suffix.lower() == '.wav':
                row['tecnica'] = wav_header(row['ruta'],stat.st_size,stat.st_mtime_ns)
        except OSError:
            row.update(disponible=False,tamano=None,modificado=None)
        rows.append(row)
    return rows


def audio_row(db, identity):
    file = required_row(db,'archivos',identity)
    if Path(file['nombre']).suffix.lower() not in AUDIO_EXTENSIONS:
        raise ValueError('Seleccioná un archivo de audio.')
    return file


def playlist_data(db, pid):
    playlist = dict(required_row(db, 'playlists', pid))
    by_id = {row['id']:row for row in catalog_rows(db)}
    items = []
    for row in db.execute('SELECT archivo_id FROM playlist_items WHERE playlist_id=? ORDER BY posicion', (pid,)):
        if row['archivo_id'] in by_id:
            audio = by_id[row['archivo_id']]
            audio.pop('_busqueda',None)
            items.append(audio)
    playlist['audios'] = items
    playlist['duracion'] = sum(item['tecnica'].get('duracion',0) for item in items)
    return playlist


def register_catalog(app, connect):
    @app.get('/api/catalogo')
    def catalog():
        with connect() as db:
            rows = catalog_rows(db)
        args = request.args
        query = normalize(args.get('q',''))
        def match(row):
            if query and query not in normalize(row['_busqueda']):
                return False
            for key in ('cancion_id','artista_id','disco_id','clase','etapa','estado','genero','idioma','tonalidad','anio'):
                if args.get(key) and normalize(row.get(key,'')) != normalize(args[key]):
                    return False
            if args.get('favoritos') == '1' and not row['favorito']:
                return False
            if args.get('enlaces') in ('1','0') and bool(row['con_enlace']) != (args['enlaces']=='1'):
                return False
            for key, operator in [('bpm_min',lambda a,b:a>=b),('bpm_max',lambda a,b:a<=b)]:
                if args.get(key):
                    try:
                        limit, bpm = float(args[key]),float(row['bpm'])
                        if not math.isfinite(limit) or not math.isfinite(bpm) or not operator(bpm,limit):
                            return False
                    except (TypeError,ValueError):
                        return False
            return True
        visible = [row for row in rows if match(row)]
        try:
            offset, limit = max(0,int(args.get('offset',0))), min(500,max(1,int(args.get('limit',20))))
        except ValueError:
            raise ValueError('Página inválida.')
        for row in visible:
            row.pop('_busqueda',None)
        return jsonify(audios=visible[offset:offset+limit],total=len(visible),
            opciones={key:sorted({str(row.get(key,'')) for row in rows if row.get(key)},key=normalize)
                      for key in ('genero','idioma','tonalidad','anio')})

    @app.route('/api/catalogo/<identity>', methods=['GET','POST'])
    def audio_metadata(identity):
        data = request.get_json(silent=True) or {}
        with connect() as db:
            file = audio_row(db,identity)
            if request.method == 'GET':
                row=next(row for row in catalog_rows(db) if row['id']==identity)
                row.pop('_busqueda',None)
                return jsonify(row)
            old = db.execute('SELECT * FROM catalogo_audio WHERE archivo_id=?',(identity,)).fetchone()
            values = dict(old) if old else dict(favorito=False,clase='',version='',notas='',grabacion_id=None)
            for key in ('clase','version','notas'):
                if key in data:
                    values[key] = text(data[key],10000 if key=='notas' else 150)
            if values['clase'] and values['clase'] not in CLASSES:
                raise ValueError('Clasificación de audio inválida.')
            if 'favorito' in data:
                if not isinstance(data['favorito'],bool):
                    raise ValueError('Favorito debe ser verdadero o falso.')
                values['favorito'] = data['favorito']
            if 'grabacion_id' in data:
                rid = data['grabacion_id'] or None
                if rid and required_row(db,'registro_grabacion',rid)['cancion_id'] != file['cancion_id']:
                    raise ValueError('La grabación debe corresponder a esta canción.')
                values['grabacion_id'] = rid
            db.execute('''INSERT INTO catalogo_audio VALUES(?,?,?,?,?,?) ON CONFLICT(archivo_id) DO UPDATE SET
                favorito=excluded.favorito,clase=excluded.clase,version=excluded.version,notas=excluded.notas,grabacion_id=excluded.grabacion_id''',
                (identity,int(values['favorito']),values['clase'],values['version'],values['notas'],values['grabacion_id']))
        return jsonify(ok=True,**values)

    @app.get('/api/playlists')
    def playlists():
        with connect() as db:
            return jsonify([dict(row) for row in db.execute('''SELECT p.*,
                (SELECT COUNT(*) FROM playlist_items WHERE playlist_id=p.id) AS total FROM playlists p ORDER BY p.actualizado DESC,p.rowid DESC''')])

    @app.get('/api/playlists/<pid>')
    def playlist(pid):
        with connect() as db:
            return jsonify(playlist_data(db,pid))

    @app.post('/api/playlists')
    @app.post('/api/playlists/<pid>')
    def save_playlist(pid=None):
        data = request.get_json() or {}
        name = text(data.get('nombre',''),150)
        if not name:
            raise ValueError('Ingresá el nombre de la playlist.')
        notes = text(data.get('notas',''),10000)
        ids = data.get('archivos',[])
        if not isinstance(ids,list) or len(ids)>500 or any(not isinstance(i,str) for i in ids) or len(set(ids))!=len(ids):
            raise ValueError('Elegí hasta 500 audios distintos, en el orden deseado.')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if pid:
                old = required_row(db,'playlists',pid)
                if data.get('revision') != old['revision']:
                    raise ValueError('La playlist cambió. Volvé a abrirla antes de guardar.')
            for identity in ids:
                audio_row(db,identity)
            if pid:
                db.execute('UPDATE playlists SET nombre=?,notas=?,revision=revision+1,actualizado=CURRENT_TIMESTAMP WHERE id=?',(name,notes,pid))
                db.execute('DELETE FROM playlist_items WHERE playlist_id=?',(pid,))
            else:
                pid=uuid.uuid4().hex
                db.execute('INSERT INTO playlists(id,nombre,notas) VALUES(?,?,?)',(pid,name,notes))
            db.executemany('INSERT INTO playlist_items VALUES(?,?,?)',[(pid,identity,index) for index,identity in enumerate(ids)])
            return jsonify(playlist_data(db,pid))
