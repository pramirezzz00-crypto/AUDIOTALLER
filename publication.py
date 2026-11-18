"""Datos opcionales para preparar entregas editoriales y discográficas.

Los códigos se transcriben de los registros del usuario: AudioTaller no los
emite ni consulta registros oficiales. Obra, grabación, lanzamiento y persona
son entidades diferentes aunque compartan un título o un nombre artístico.
"""
import json
import re
import uuid
from datetime import date
from flask import jsonify, request
from management import required_row

ENTITIES = {
    'persona': ('artistas', 'registro_persona', ('nombre_legal', 'ipn', 'ipi', 'isni', 'sociedad_autores', 'sociedad_interpretes', 'numero_socio', 'pais', 'notas')),
    'obra': ('canciones', 'registro_obra', ('titulo_original', 'iswc', 'idioma', 'genero', 'editorial', 'sociedad', 'registro_local', 'copyright', 'notas')),
    'lanzamiento': ('discos', 'registro_lanzamiento', ('upc_ean', 'sello', 'catalogo', 'distribuidora', 'fecha_lanzamiento', 'territorios', 'copyright', 'notas')),
}
RECORDING_FIELDS = ('nombre', 'version', 'isrc', 'titular_master', 'anio_fonograma', 'fecha_grabacion', 'idioma', 'explicito', 'notas')


def clean_fields(data, fields):
    """Valida formato básico; conservar ceros iniciales exige usar texto.

    Un formato correcto no acredita la asignación ni titularidad de un código.
    Se admite vacío en todos los identificadores.
    """
    if not isinstance(data, dict):
        raise ValueError('Los datos deben ser una ficha.')
    result = {}
    for key in fields:
        value = data.get(key, '')
        if not isinstance(value, str) or len(value) > (10000 if key == 'notas' else 1000):
            raise ValueError('Dato inválido o demasiado extenso: ' + key)
        result[key] = value.strip()
    patterns = {'ipi': (r'\d{11}', 'IPI Name: 11 dígitos'),
                'ipn': (r'\d{1,20}', 'IPN: solo dígitos'),
                'isni': (r'\d{15}[\dX]', 'ISNI: 16 caracteres'),
                'iswc': (r'T\d{10}', 'ISWC: T seguido de 10 dígitos'),
                'isrc': (r'[A-Z]{2}[A-Z0-9]{3}\d{7}', 'ISRC: 12 caracteres, por ejemplo ARABC2600001'),
                'upc_ean': (r'(?:\d{12}|\d{13})', 'UPC/EAN: 12 o 13 dígitos')}
    for key, (pattern, message) in patterns.items():
        if result.get(key):
            normalized = re.sub(r'[\s.\-]', '', result[key]).upper()
            if not re.fullmatch(pattern, normalized, flags=re.ASCII):
                raise ValueError(message + '. Podés dejarlo vacío si aún no lo tenés.')
            result[key] = normalized
    for key in ('fecha_lanzamiento', 'fecha_grabacion'):
        if result.get(key):
            date.fromisoformat(result[key])
    if result.get('anio_fonograma') and not re.fullmatch(r'\d{4}', result['anio_fonograma'], re.ASCII):
        raise ValueError('El año del fonograma debe tener cuatro dígitos.')
    if result.get('explicito') not in (None, '', 'Sí', 'No', 'Sin definir'):
        raise ValueError('Contenido explícito inválido.')
    return result


def validate_collaborators(db, values):
    if not isinstance(values, list) or len(values) > 100:
        raise ValueError('Los participantes deben ser una lista de hasta 100 personas.')
    for item in values:
        if not isinstance(item, dict):
            raise ValueError('Participante inválido.')
        required_row(db, 'artistas', item.get('persona_id'))
        role = item.get('rol', '')
        if not isinstance(role, str) or not role.strip() or len(role) > 150:
            raise ValueError('Indicá el rol de cada participante seleccionado.')


def add_collaborators(db, identity, kind, values):
    """Agrega créditos explícitos; no supone que todo integrante tocó cada tema."""
    for item in values:
        db.execute('INSERT INTO creditos VALUES(?,?,?,?,?)',
                   (uuid.uuid4().hex, item['persona_id'], identity if kind == 'disco' else None,
                    identity if kind == 'cancion' else None, item['rol'].strip()))


def validate_loose_songs(db, artist_id, songs):
    if not isinstance(songs, list) or len(songs) > 1000 or any(not isinstance(sid, str) for sid in songs):
        raise ValueError('Lista de canciones inválida.')
    if len(songs) != len(set(songs)):
        raise ValueError('La lista contiene canciones repetidas.')
    for sid in songs:
        song = required_row(db, 'canciones', sid)
        if song['artista_id'] != artist_id or song['disco_id']:
            raise ValueError('Solo se pueden incorporar canciones sueltas del mismo artista.')


def attach_songs(db, album_id, songs):
    """Asociación lógica: jamás mueve audios ni cambia rutas usadas por el DAW."""
    for sid in songs:
        db.execute('UPDATE canciones SET disco_id=? WHERE id=?', (album_id, sid))
        db.execute('INSERT INTO eventos(id,cancion_id,tipo,detalle) VALUES(?,?,?,?)',
                   (uuid.uuid4().hex, sid, 'Asociada a disco', album_id))


def save_registration(db, kind, identity, data):
    """Guarda la ficha dentro de la transacción del llamador, sin perder vínculos de audio."""
    parent, table, fields = ENTITIES[kind]
    required_row(db, parent, identity)
    values = clean_fields(data.get('datos', {}), fields)
    # Validar toda la lista antes de reemplazarla evita pérdidas parciales.
    recordings = data.get('grabaciones', []) if kind == 'obra' else []
    if not isinstance(recordings, list) or len(recordings) > 100:
        raise ValueError('Máximo 100 grabaciones por obra.')
    normalized = []
    identifiers = set()
    for recording in recordings:
        values_recording = clean_fields(recording, RECORDING_FIELDS)
        if not values_recording['nombre']:
            raise ValueError('Cada grabación necesita un nombre identificatorio.')
        rid = recording.get('id')
        if rid is not None:
            if not isinstance(rid, str) or not re.fullmatch('[a-f0-9]{32}', rid) or rid in identifiers:
                raise ValueError('Identificador de grabación inválido o repetido.')
            existing = db.execute('SELECT cancion_id FROM registro_grabacion WHERE id=?', (rid,)).fetchone()
            if not existing or existing['cancion_id'] != identity:
                raise ValueError('La grabación no pertenece a esta obra.')
            identifiers.add(rid)
        normalized.append(values_recording)
    db.execute(f'INSERT INTO {table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos',
               (identity, json.dumps(values, ensure_ascii=False)))
    if kind == 'obra':
        # No son sesiones del DAW: cada fila representa un fonograma publicable.
        keep = [r.get('id') for r in recordings if r.get('id')]
        for old in db.execute('SELECT id FROM registro_grabacion WHERE cancion_id=?', (identity,)).fetchall():
            if old['id'] not in keep:
                db.execute('DELETE FROM registro_grabacion WHERE id=?', (old['id'],))
        for recording, values_recording in zip(recordings, normalized):
            rid = recording.get('id')
            db.execute('INSERT INTO registro_grabacion VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos',
                       (rid or uuid.uuid4().hex, identity, json.dumps(values_recording, ensure_ascii=False)))


def register_publication(app, connect):
    @app.route('/api/registro/<kind>/<identity>', methods=['GET', 'POST'])
    def registration(kind, identity):
        if kind not in ENTITIES:
            raise ValueError('Tipo de ficha inválido.')
        parent, table, fields = ENTITIES[kind]
        with connect() as db:
            required_row(db, parent, identity)
            if request.method == 'POST':
                save_registration(db, kind, identity, request.get_json() or {})
            row = db.execute(f'SELECT datos FROM {table} WHERE id=?', (identity,)).fetchone()
            recordings = [dict(json.loads(row['datos']), id=row['id']) for row in db.execute(
                'SELECT * FROM registro_grabacion WHERE cancion_id=? ORDER BY rowid', (identity,))] if kind == 'obra' else []
            return jsonify(datos=json.loads(row['datos']) if row else {}, grabaciones=recordings)

    @app.post('/api/discos/<did>/incorporar-canciones')
    def associate(did):
        with connect() as db:
            album = required_row(db, 'discos', did)
            db.execute('BEGIN IMMEDIATE')
            songs = (request.get_json() or {}).get('canciones', [])
            validate_loose_songs(db, album['artista_id'], songs)
            attach_songs(db, did, songs)
            db.execute('UPDATE detalle_disco SET actualizado=CURRENT_TIMESTAMP WHERE id=?', (did,))
        return jsonify(id=did, incorporadas=len(songs))

    @app.route('/api/produccion-creditos/<kind>/<identity>', methods=['GET', 'POST'])
    def credits(kind, identity):
        if kind not in ('disco', 'cancion'):
            raise ValueError('Producción inválida.')
        column = 'disco_id' if kind == 'disco' else 'cancion_id'
        with connect() as db:
            required_row(db, 'discos' if kind == 'disco' else 'canciones', identity)
            if request.method == 'POST':
                data = request.get_json() or {}
                additions, removed = data.get('agregar', []), data.get('quitar', [])
                validate_collaborators(db, additions)
                if not isinstance(removed, list) or len(removed) > 1000:
                    raise ValueError('Lista de créditos inválida.')
                for cid in removed:
                    if not isinstance(cid, str):
                        raise ValueError('Crédito inválido.')
                    credit = required_row(db, 'creditos', cid)
                    if credit[column] != identity:
                        raise ValueError('Ese crédito corresponde a otra producción.')
                for cid in removed:
                    db.execute('DELETE FROM creditos WHERE id=?', (cid,))
                add_collaborators(db, identity, kind, additions)
            return jsonify([dict(row) for row in db.execute(f'''SELECT cr.*, a.nombre AS persona
                FROM creditos cr JOIN artistas a ON a.id=cr.persona_id WHERE cr.{column}=?''', (identity,))])

    @app.delete('/api/creditos/<cid>')
    def delete_credit(cid):
        with connect() as db:
            required_row(db, 'creditos', cid)
            db.execute('DELETE FROM creditos WHERE id=?', (cid,))
        return jsonify(id=cid)
