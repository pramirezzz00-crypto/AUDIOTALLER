"""Personas reutilizables, clasificaciones y explorador global de producciones."""
import json
import uuid
from flask import jsonify, request

DEFAULT_ROLE = {'Artista': 'Solista', 'Grupo': 'Agrupación'}


def required_row(db, table, identity):
    # Los nombres de tabla provienen únicamente del código del servidor.
    row = db.execute(f'SELECT * FROM {table} WHERE id=?', (identity,)).fetchone()
    if not row:
        raise ValueError('El registro solicitado no existe.')
    return row


def labels(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError('Las etiquetas deben ser una lista de hasta 100 nombres.')
    if any(not isinstance(item, str) or not item.strip() or len(item) > 80 for item in value):
        raise ValueError('Las etiquetas deben contener nombres de hasta 80 caracteres.')
    return list(dict.fromkeys(item.strip() for item in value))


def save_roles(db, aid, profile, tipo):
    """Actualiza relaciones en la misma transacción que la ficha principal."""
    roles = labels(profile.get('roles', [DEFAULT_ROLE.get(tipo, tipo)]))
    instruments = labels(profile.get('instrumentos', []))
    specialties = labels(profile.get('especialidades', []))
    if not roles:
        raise ValueError('Seleccioná al menos una clasificación.')
    db.executemany('INSERT OR IGNORE INTO clasificaciones VALUES(?)', [(role,) for role in roles])
    db.execute('DELETE FROM roles_artista WHERE artista_id=?', (aid,))
    db.executemany('INSERT INTO roles_artista VALUES(?,?)', [(aid, role) for role in roles])
    db.execute('DELETE FROM etiquetas_artista WHERE artista_id=?', (aid,))
    for kind, values in [('instrumento', instruments), ('especialidad', specialties)]:
        db.executemany('INSERT INTO etiquetas_artista VALUES(?,?,?)', [(aid, kind, value) for value in values])


def person_data(db, aid):
    roles = [row[0] for row in db.execute('SELECT nombre FROM roles_artista WHERE artista_id=?', (aid,))]
    primary = db.execute('SELECT tipo FROM artistas WHERE id=?', (aid,)).fetchone()
    principal = DEFAULT_ROLE.get(primary['tipo'], primary['tipo']) if primary else ''
    roles.sort(key=lambda role: (role != principal, role))
    tags = db.execute('SELECT clase,nombre FROM etiquetas_artista WHERE artista_id=?', (aid,)).fetchall()
    memberships = [dict(row) for row in db.execute("""SELECT p.*, a.nombre AS persona, g.nombre AS grupo
        FROM participaciones p JOIN artistas a ON a.id=p.persona_id JOIN artistas g ON g.id=p.grupo_id
        WHERE p.grupo_id=? OR p.persona_id=? ORDER BY p.desde""", (aid, aid))]
    credits = [dict(row) for row in db.execute("""SELECT cr.*, COALESCE(d.nombre,c.titulo) AS nombre
        FROM creditos cr LEFT JOIN discos d ON cr.disco_id=d.id LEFT JOIN canciones c ON cr.cancion_id=c.id
        WHERE cr.persona_id=?""", (aid,))]
    return dict(roles=roles, instrumentos=[row['nombre'] for row in tags if row['clase']=='instrumento'],
                especialidades=[row['nombre'] for row in tags if row['clase']=='especialidad'],
                participaciones=memberships, creditos=credits)


def register_management(app, connect):
    @app.errorhandler(ValueError)
    def invalid_data(error):
        return jsonify(error=str(error)), 400

    @app.get('/api/clasificaciones')
    def categories():
        with connect() as db:
            return jsonify([row[0] for row in db.execute('SELECT nombre FROM clasificaciones ORDER BY nombre')])

    @app.post('/api/clasificaciones')
    def new_category():
        name = labels([(request.get_json() or {}).get('nombre', '')])[0]
        with connect() as db:
            db.execute('INSERT OR IGNORE INTO clasificaciones VALUES(?)', (name,))
        return jsonify(nombre=name), 201

    @app.get('/api/personas')
    def people():
        with connect() as db:
            rows = [dict(row) for row in db.execute("""SELECT a.*,
                (SELECT COUNT(*) FROM discos WHERE artista_id=a.id) AS discos,
                (SELECT COUNT(*) FROM canciones WHERE artista_id=a.id) AS canciones
                FROM artistas a ORDER BY a.nombre""")]
            for row in rows:
                row.update(person_data(db, row['id']))
        return jsonify(rows)

    @app.get('/api/personas/<aid>')
    def person(aid):
        with connect() as db:
            required_row(db, 'artistas', aid)
            return jsonify(person_data(db, aid))

    @app.post('/api/participaciones')
    def participation():
        data = request.get_json() or {}
        group, person = data.get('grupo_id'), data.get('persona_id')
        if group == person:
            raise ValueError('Una persona no puede ser integrante de sí misma.')
        start, end = data.get('desde', ''), data.get('hasta', '')
        from datetime import date
        for value in (start, end):
            if value:
                date.fromisoformat(value)
        if start and end and end < start:
            raise ValueError('La fecha de salida debe ser posterior a la incorporación.')
        state = data.get('estado', 'Activo')
        if state not in ('Activo', 'En pausa', 'Finalizado'):
            raise ValueError('Estado de participación inválido.')
        with connect() as db:
            required_row(db, 'artistas', group)
            required_row(db, 'artistas', person)
            identity = data.get('id') or uuid.uuid4().hex
            if data.get('id'):
                old = required_row(db, 'participaciones', identity)
                if old['grupo_id'] != group or old['persona_id'] != person:
                    raise ValueError('La relación original debe conservarse.')
                db.execute('UPDATE participaciones SET funcion=?,desde=?,hasta=?,estado=? WHERE id=?',
                           (data.get('funcion', ''), start, end, state, identity))
            else:
                duplicate = db.execute('SELECT 1 FROM participaciones WHERE grupo_id=? AND persona_id=? AND desde=?',
                                       (group, person, start)).fetchone()
                if duplicate:
                    raise ValueError('La participación ya está registrada. Editala para conservar su historial.')
                db.execute('INSERT INTO participaciones VALUES(?,?,?,?,?,?,?)',
                           (identity, group, person, data.get('funcion', ''), start, end, state))
        return jsonify(id=identity), 200

    @app.post('/api/creditos')
    def credit():
        data = request.get_json() or {}
        if bool(data.get('disco_id')) == bool(data.get('cancion_id')):
            raise ValueError('Elegí un disco o una canción.')
        role = data.get('rol', '').strip()
        if not role or len(role) > 150:
            raise ValueError('Indicá el rol en la producción.')
        with connect() as db:
            required_row(db, 'artistas', data.get('persona_id'))
            required_row(db, 'discos' if data.get('disco_id') else 'canciones',
                         data.get('disco_id') or data.get('cancion_id'))
            identity = uuid.uuid4().hex
            db.execute('INSERT INTO creditos VALUES(?,?,?,?,?)',
                       (identity, data['persona_id'], data.get('disco_id') or None, data.get('cancion_id') or None, role))
        return jsonify(id=identity), 201

    @app.get('/api/proyectos')
    def productions():
        with connect() as db:
            albums = [dict(row) for row in db.execute("""SELECT d.*, a.nombre AS artista, x.datos,x.creado,x.actualizado,
                (SELECT COUNT(*) FROM canciones WHERE disco_id=d.id) AS total
                FROM discos d JOIN artistas a ON d.artista_id=a.id LEFT JOIN detalle_disco x ON x.id=d.id""")]
            songs = [dict(row) for row in db.execute("""SELECT c.*, a.nombre AS artista, d.nombre AS disco, x.datos,
                e.estado, e.actualizado FROM canciones c JOIN artistas a ON c.artista_id=a.id
                LEFT JOIN discos d ON c.disco_id=d.id LEFT JOIN detalle_cancion x ON c.id=x.id
                LEFT JOIN estado_cancion e ON c.id=e.id""")]
        for row in albums + songs:
            row.update(json.loads(row.pop('datos') or '{}'))
        return jsonify(discos=albums, canciones=songs)

    @app.post('/api/canciones/<sid>/editar')
    def edit_song(sid):
        data = request.get_json() or {}
        title = data.get('titulo', '').strip()
        if not title or len(title) > 150:
            raise ValueError('Indicá un título de hasta 150 caracteres.')
        track = str(data.get('pista') or '').strip()
        if track and (not track.isascii() or not track.isdigit() or not 0 < int(track) < 100000):
            raise ValueError('Número de pista inválido.')
        state = data.get('estado', 'En producción')
        if state not in ('Idea', 'En preproducción', 'En producción', 'Finalizada', 'En pausa'):
            raise ValueError('Estado de canción inválido.')
        with connect() as db:
            song = required_row(db, 'canciones', sid)
            album_id = data.get('disco_id') or ''
            if album_id:
                album = required_row(db, 'discos', album_id)
                if album['artista_id'] != song['artista_id']:
                    raise ValueError('El disco debe pertenecer al mismo artista.')
            # Se cambia la asociación lógica, conservando todos los archivos en sus rutas.
            db.execute('UPDATE canciones SET titulo=?,metadata=?,disco_id=? WHERE id=?',
                       (title, data.get('metadata', song['metadata']), album_id, sid))
            old = db.execute('SELECT datos FROM detalle_cancion WHERE id=?', (sid,)).fetchone()
            details = json.loads(old['datos']) if old else {}
            details.update(pista=int(track) if track and album_id else None,
                           bpm=data.get('bpm', details.get('bpm', '')), tonalidad=data.get('tonalidad', details.get('tonalidad', '')))
            db.execute('INSERT OR REPLACE INTO detalle_cancion VALUES(?,?)', (sid, json.dumps(details)))
            db.execute("""INSERT INTO estado_cancion(id,estado) VALUES(?,?) ON CONFLICT(id)
                          DO UPDATE SET estado=excluded.estado,actualizado=CURRENT_TIMESTAMP""", (sid, state))
            db.execute('INSERT INTO eventos(id,cancion_id,tipo,detalle) VALUES(?,?,?,?)',
                       (uuid.uuid4().hex, sid, 'Canción editada', title + ' · ' + state))
        return jsonify(id=sid)
