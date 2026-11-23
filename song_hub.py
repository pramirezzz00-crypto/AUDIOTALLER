"""Ficha unificada y exportación editorial sin alterar archivos de audio.

El guardado incluye canción, obra, grabaciones y créditos en una transacción.
La revisión evita pisar cambios hechos desde otra ficha mientras se edita.
"""
import csv
import hashlib
import io
import json
import math
import uuid
import zipfile
from urllib.parse import urlparse
from flask import jsonify, request, send_file
from management import required_row
from publication import save_registration, clean_fields, ENTITIES, validate_collaborators

STATES = ('Borrador', 'En producción', 'Finalizado', 'Lanzado', 'En pausa', 'Idea', 'En preproducción', 'Finalizada')


def json_row(db, table, identity):
    row = db.execute(f'SELECT datos FROM {table} WHERE id=?', (identity,)).fetchone()
    return json.loads(row['datos']) if row else {}


def text(value, maximum=1000):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError('Texto inválido o demasiado extenso.')
    return value.strip()


def song_bundle(db, sid):
    song = dict(required_row(db, 'canciones', sid))
    song.update(json_row(db, 'detalle_cancion', sid))
    state = db.execute('SELECT estado FROM estado_cancion WHERE id=?', (sid,)).fetchone()
    song['estado'] = state['estado'] if state else 'En producción'
    credits = [dict(row) for row in db.execute('''SELECT cr.*, a.nombre AS persona FROM creditos cr
        JOIN artistas a ON a.id=cr.persona_id WHERE cr.cancion_id=? ORDER BY cr.rowid''', (sid,))]
    recordings = [dict(json.loads(row['datos']), id=row['id']) for row in db.execute(
        'SELECT * FROM registro_grabacion WHERE cancion_id=? ORDER BY rowid', (sid,))]
    result = dict(cancion=song, obra=json_row(db, 'registro_obra', sid), grabaciones=recordings,
                  creditos=credits, ficha=json_row(db, 'ficha_cancion', sid))
    result['revision'] = hashlib.sha256(json.dumps(result, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return result


def save_song_bundle(db, sid, data):
    current = song_bundle(db, sid)
    if data.get('revision') != current['revision']:
        raise ValueError('La canción cambió mientras editabas. Cerrá y volvé a abrir la ficha para cargar los cambios actuales.')
    song = data.get('cancion', {})
    if not isinstance(song, dict):
        raise ValueError('Ficha de canción inválida.')
    title = text(song.get('titulo', ''), 150)
    if not title:
        raise ValueError('Indicá el título de la canción.')
    album_id = text(song.get('disco_id', ''), 64)
    if album_id and required_row(db, 'discos', album_id)['artista_id'] != current['cancion']['artista_id']:
        raise ValueError('El disco debe pertenecer al mismo artista principal.')
    state = song.get('estado', 'En producción')
    if state not in STATES:
        raise ValueError('Estado inválido.')
    track = str(song.get('pista') or '').strip()
    if track and (not track.isascii() or not track.isdigit() or not 0 < int(track) < 100000):
        raise ValueError('Número de pista inválido.')
    bpm = text(str(song.get('bpm') or ''), 20)
    if bpm:
        try:
            if not math.isfinite(float(bpm)) or not 0 < float(bpm) <= 1000:
                raise ValueError()
        except ValueError:
            raise ValueError('BPM debe ser un número entre 0 y 1000.')
    details = json_row(db, 'detalle_cancion', sid)
    details.update(pista=int(track) if track and album_id else None, bpm=bpm,
                   tonalidad=text(song.get('tonalidad', ''), 80), duracion=text(song.get('duracion', ''), 30))
    extra = data.get('ficha', {})
    if not isinstance(extra, dict):
        raise ValueError('Datos adicionales inválidos.')
    # Se conservan extensiones desconocidas de versiones anteriores.
    ficha = dict(current['ficha'])
    for key, maximum in [('letra', 100000), ('notas', 50000), ('descripcion_youtube', 20000), ('anio', 4)]:
        ficha[key] = text(extra.get(key, ficha.get(key, '')), maximum)
    if ficha['anio'] and (not ficha['anio'].isascii() or not ficha['anio'].isdigit() or len(ficha['anio']) != 4):
        raise ValueError('El año debe tener cuatro dígitos.')
    tags = extra.get('etiquetas', [])
    if not isinstance(tags, list) or len(tags) > 100:
        raise ValueError('Máximo 100 etiquetas.')
    ficha['etiquetas'] = list(dict.fromkeys(text(tag, 80) for tag in tags if text(tag, 80)))
    custom = extra.get('campos', {})
    if not isinstance(custom, dict) or len(custom) > 100:
        raise ValueError('Los campos propios deben ser un objeto con hasta 100 entradas.')
    ficha['campos'] = {text(key, 100): text(value, 2000) for key, value in custom.items() if text(key, 100)}
    ficha['publicacion'] = clean_fields(extra.get('publicacion', {}), ENTITIES['lanzamiento'][2])
    ficha['links'] = {}
    if not isinstance(extra.get('links', {}),dict):
        raise ValueError('Los enlaces deben ser una ficha de direcciones web.')
    for key in ('spotify', 'youtube', 'ama'):
        value = text(extra.get('links', {}).get(key, ''), 2000)
        if value and (urlparse(value).scheme not in ('http', 'https') or not urlparse(value).netloc):
            raise ValueError('Los enlaces deben empezar con https:// o http://.')
        ficha['links'][key] = value
    credits = data.get('creditos', [])
    validate_collaborators(db, credits)
    seen = set()
    for credit in credits:
        cid = credit.get('id')
        if cid:
            old = required_row(db, 'creditos', cid)
            if old['cancion_id'] != sid or cid in seen:
                raise ValueError('Crédito ajeno o repetido.')
            seen.add(cid)
    # Todo queda dentro de la misma transacción, incluidas las validaciones de códigos.
    save_registration(db, 'obra', sid, dict(datos=data.get('obra', {}), grabaciones=data.get('grabaciones', [])))
    db.execute('UPDATE canciones SET titulo=?,disco_id=?,metadata=? WHERE id=?',
               (title, album_id, text(song.get('metadata', ''), 50000), sid))
    db.execute('INSERT INTO detalle_cancion VALUES(?,?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos',
               (sid, json.dumps(details, ensure_ascii=False)))
    db.execute('''INSERT INTO estado_cancion(id,estado) VALUES(?,?) ON CONFLICT(id)
        DO UPDATE SET estado=excluded.estado,actualizado=CURRENT_TIMESTAMP''', (sid, state))
    for old in current['creditos']:
        if old['id'] not in seen:
            db.execute('DELETE FROM creditos WHERE id=?', (old['id'],))
    for credit in credits:
        db.execute('''INSERT INTO creditos VALUES(?,?,?,?,?) ON CONFLICT(id)
            DO UPDATE SET persona_id=excluded.persona_id,rol=excluded.rol''',
            (credit.get('id') or uuid.uuid4().hex, credit['persona_id'], None, sid, credit['rol'].strip()))
    db.execute('''INSERT INTO ficha_cancion(id,datos) VALUES(?,?) ON CONFLICT(id)
        DO UPDATE SET datos=excluded.datos,actualizado=CURRENT_TIMESTAMP''', (sid, json.dumps(ficha, ensure_ascii=False)))
    db.execute('INSERT INTO eventos(id,cancion_id,tipo,detalle) VALUES(?,?,?,?)',
               (uuid.uuid4().hex, sid, 'Ficha de canción actualizada', title))


def register_song_hub(app, connect):
    @app.route('/api/canciones/<sid>/ficha', methods=['GET', 'POST'])
    def song_card(sid):
        with connect() as db:
            if request.method == 'POST':
                db.execute('BEGIN IMMEDIATE')
                save_song_bundle(db, sid, request.get_json() or {})
            return jsonify(song_bundle(db, sid))

    @app.get('/api/canciones/<sid>/entrega-editorial')
    def editorial_export(sid):
        with connect() as db:
            card = song_bundle(db, sid)
            song = card['cancion']
            artist = required_row(db, 'artistas', song['artista_id'])
            album = db.execute('SELECT nombre FROM discos WHERE id=?', (song['disco_id'],)).fetchone()
            release = json_row(db, 'registro_lanzamiento', song['disco_id']) if album else card['ficha'].get('publicacion', {})
            credits = []
            for credit in card['creditos']:
                professional = json_row(db, 'registro_persona', credit['persona_id'])
                credits.append(dict(nombre=credit['persona'], rol=credit['rol'],
                    **{key:professional.get(key, '') for key in ('nombre_legal','ipi','ipn','isni')}))
        # Exportación explícita de información editorial; excluye rutas, tokens,
        # notas internas y datos de contacto personales.
        payload = dict(titulo=song['titulo'], artista=artist['nombre'], disco=album['nombre'] if album else '',
            pista=song.get('pista'), bpm=song.get('bpm'), tonalidad=song.get('tonalidad'),
            obra={key:value for key,value in card['obra'].items() if key != 'notas'},
            grabaciones=[{key:value for key,value in record.items() if key not in ('notas','id')} for record in card['grabaciones']],
            lanzamiento={key:value for key,value in release.items() if key != 'notas'}, creditos=credits,
            letra=card['ficha'].get('letra',''), links=card['ficha'].get('links', {}))
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as output:
            output.writestr('ficha.json', json.dumps(payload, ensure_ascii=False, indent=2))
            csv_text = io.StringIO(newline='')
            writer = csv.writer(csv_text)
            writer.writerow(['Título','Artista','Disco','ISWC','Grabación','Versión','ISRC','Idioma','Género'])
            for recording in card['grabaciones'] or [{}]:
                values = [song['titulo'],artist['nombre'],payload['disco'],card['obra'].get('iswc',''),
                          recording.get('nombre',''),recording.get('version',''),recording.get('isrc',''),
                          card['obra'].get('idioma',''),card['obra'].get('genero','')]
                # Evita que una planilla interprete títulos o nombres como fórmulas.
                writer.writerow(["'"+str(value) if str(value).startswith(('=','+','-','@','\t','\r','\n')) else value for value in values])
            output.writestr('metadata.csv', '\ufeff'+csv_text.getvalue())
            output.writestr('letra.txt', payload['letra'])
            output.writestr('descripcion-youtube.txt', card['ficha'].get('descripcion_youtube') or
                            song['titulo']+' — '+artist['nombre']+'\n\n'+payload['letra'])
            output.writestr('LEEME.txt', 'Paquete de preparación editorial. No es una carga automática ni un formato DDEX.\n'
                'Verificá los requisitos vigentes de tu distribuidora. Revisá códigos, créditos, derechos, portada y máster.\n'
                'No se incluyen audios. Para Spotify/YouTube Music la entrega se gestiona mediante distribuidora.\n')
        buffer.seek(0)
        return send_file(buffer, mimetype='application/zip', as_attachment=True, download_name='Ficha-'+sid[:8]+'.zip')
