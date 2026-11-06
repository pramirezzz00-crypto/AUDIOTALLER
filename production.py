"""Sesiones, archivos importados o vinculados y eventos de producción."""
import json
import os
import uuid
from pathlib import Path
from flask import jsonify, request, send_file
from management import required_row
from migrations import LEGACY_STAGE


def register_production(app, connect, safe_name):
    @app.before_request
    def validate_json_payload():
        if request.method != 'POST' or not request.is_json:
            return
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValueError('La solicitud debe contener un objeto de datos.')
        text_fields = ('nombre','titulo','tipo','imagen','portada','etapa','ruta','daw','notas',
                       'texto','rol','funcion','desde','hasta','estado','metadata','comentario')
        if any(key in data and not isinstance(data[key], str) for key in text_fields):
            raise ValueError('Los campos de texto deben contener texto.')
        if 'perfil' in data and not isinstance(data['perfil'], dict):
            raise ValueError('El perfil debe ser un objeto de datos.')

    def stage_row(db, key):
        key = LEGACY_STAGE.get(key, key)
        row = db.execute('SELECT * FROM etapas WHERE clave=?', (key,)).fetchone()
        if not row:
            raise ValueError('Etapa no reconocida.')
        return row

    def log(db, sid, stage, kind, reference=None, detail=''):
        db.execute('INSERT INTO eventos(id,cancion_id,etapa,tipo,referencia,detalle) VALUES(?,?,?,?,?,?)',
                   (uuid.uuid4().hex, sid, stage, kind, reference, detail))
        db.execute("""INSERT INTO estado_cancion(id) VALUES(?) ON CONFLICT(id)
                      DO UPDATE SET actualizado=CURRENT_TIMESTAMP""", (sid,))

    def local_path(value):
        if not isinstance(value, str) or not value.strip():
            raise ValueError('Indicá una ruta local absoluta.')
        path = Path(value.strip()).expanduser()
        if not path.is_absolute():
            raise ValueError('Usá una ruta absoluta de archivo o carpeta.')
        return path

    def session_validate(db, sid, stage, identity):
        if not identity:
            return None
        session = required_row(db, 'sesiones', identity)
        if session['cancion_id'] != sid or stage_row(db, session['etapa'])['clave'] != stage:
            raise ValueError('La sesión debe pertenecer a esta canción y etapa.')
        return identity

    def managed_folder(song, stage):
        root = Path(song['carpeta']).resolve()
        target = root / stage['carpeta'] / 'Adjuntos'
        # Aun una carpeta administrada puede contener enlaces creados por el usuario.
        if not target.resolve().is_relative_to(root):
            raise ValueError('La carpeta administrada apunta fuera de la canción.')
        return target

    @app.get('/api/produccion/<sid>')
    def workspace(sid):
        with connect() as db:
            song = dict(required_row(db, 'canciones', sid))
            artist = required_row(db, 'artistas', song['artista_id'])
            album = db.execute('SELECT * FROM discos WHERE id=?', (song['disco_id'],)).fetchone()
            album_details = db.execute('SELECT datos FROM detalle_disco WHERE id=?', (song['disco_id'],)).fetchone()
            details = db.execute('SELECT datos FROM detalle_cancion WHERE id=?', (sid,)).fetchone()
            if details:
                song.update(json.loads(details['datos']))
            state = db.execute('SELECT * FROM estado_cancion WHERE id=?', (sid,)).fetchone()
            song.update(artista=artist['nombre'], disco=album['nombre'] if album else '',
                        portada=json.loads(album_details['datos']).get('portada', '') if album_details else '',
                        estado=state['estado'] if state else 'En producción',
                        actualizado=state['actualizado'] if state else None)
            sessions = [dict(row) for row in db.execute("""SELECT s.*, i.nombre,i.principal,i.modo
                FROM sesiones s LEFT JOIN sesion_info i ON i.id=s.id
                WHERE s.cancion_id=? ORDER BY s.creado DESC,s.rowid DESC""", (sid,))]
            for session in sessions:
                session['etapa'] = stage_row(db, session['etapa'])['clave']
                session['disponible'] = Path(session['ruta']).exists() if session['ruta'] else False
            files = [dict(row) for row in db.execute('SELECT * FROM archivos WHERE cancion_id=? ORDER BY creado DESC', (sid,))]
            for file in files:
                try:
                    stat = Path(file['ruta']).stat()
                    file.update(disponible=True, tamano=stat.st_size)
                except OSError:
                    file.update(disponible=False, tamano=None)
            notes = {row['etapa']: row['texto'] for row in db.execute('SELECT * FROM notas_etapa WHERE cancion_id=?', (sid,))}
            stages = [dict(row) for row in db.execute('SELECT * FROM etapas ORDER BY rowid')]
            events = [dict(row) for row in db.execute('SELECT * FROM eventos WHERE cancion_id=? ORDER BY creado DESC,rowid DESC', (sid,))]
        return jsonify(cancion=song, sesiones=sessions, archivos=files, etapas=stages, notas=notes, eventos=events)

    @app.post('/api/produccion/<sid>/sesiones')
    def create_session(sid):
        data = request.get_json() or {}
        name = data.get('nombre', '').strip()
        daw = data.get('daw', '').strip()
        if not name or len(name) > 150 or len(daw) > 100:
            raise ValueError('Indicá un nombre de sesión de hasta 150 caracteres.')
        with connect() as db:
            song = required_row(db, 'canciones', sid)
            stage = stage_row(db, data.get('etapa'))
            identity = uuid.uuid4().hex
            linked = bool(data.get('ruta', '').strip())
            if linked:
                path = local_path(data['ruta'])
            else:
                root = Path(song['carpeta']).resolve()
                path = root / stage['carpeta'] / 'Sesiones' / identity
                if not path.resolve().is_relative_to(root):
                    raise ValueError('La carpeta de sesiones apunta fuera de la canción.')
                path.mkdir(parents=True, exist_ok=False)
            try:
                db.execute('INSERT INTO sesiones(id,cancion_id,etapa,daw,ruta,comentario) VALUES(?,?,?,?,?,?)',
                           (identity, sid, stage['clave'], daw, str(path), data.get('notas', '')))
                principal = bool(data.get('principal'))
                if principal:
                    db.execute('UPDATE sesion_info SET principal=0 WHERE id IN (SELECT id FROM sesiones WHERE cancion_id=?)', (sid,))
                db.execute('INSERT INTO sesion_info VALUES(?,?,?,?)',
                           (identity, name, int(principal), 'vinculada' if linked else 'administrada'))
                log(db, sid, stage['clave'], 'Sesión DAW asociada' if linked else 'Sesión creada', identity, name)
            except Exception:
                if not linked:
                    path.rmdir()
                raise
        return jsonify(id=identity), 201

    # Conserva la entrada anterior, utilizando la misma lógica para el alta.
    app.add_url_rule('/api/canciones/<sid>/sesiones', 'session_new', create_session, methods=['POST'])

    @app.post('/api/produccion/<sid>/principal/<identity>')
    def main_session(sid, identity):
        with connect() as db:
            session = required_row(db, 'sesiones', identity)
            if session['cancion_id'] != sid:
                raise ValueError('La sesión no pertenece a la canción.')
            db.execute('UPDATE sesion_info SET principal=0 WHERE id IN (SELECT id FROM sesiones WHERE cancion_id=?)', (sid,))
            db.execute('UPDATE sesion_info SET principal=1 WHERE id=?', (identity,))
            log(db, sid, stage_row(db, session['etapa'])['clave'], 'DAW principal seleccionado', identity)
        return jsonify(ok=True)

    @app.post('/api/produccion/<sid>/archivos/<stage_key>')
    def upload(sid, stage_key):
        file = request.files.get('file')
        if not file or not file.filename:
            raise ValueError('Seleccioná un archivo.')
        with connect() as db:
            song = required_row(db, 'canciones', sid)
            stage = stage_row(db, stage_key)
            session_id = session_validate(db, sid, stage['clave'], request.form.get('sesion_id'))
            previous_id = request.form.get('version_de')
            if previous_id:
                previous = required_row(db, 'archivos', previous_id)
                if previous['cancion_id'] != sid or previous['etapa'] != stage['clave']:
                    raise ValueError('La versión original debe pertenecer a esta etapa.')
            folder = managed_folder(song, stage)
            folder.mkdir(parents=True, exist_ok=True)
            identity = uuid.uuid4().hex
            target = folder / (identity + '-' + safe_name(Path(file.filename).name)[:150])
            try:
                # El nombre único y el modo exclusivo evitan reemplazar archivos.
                with target.open('xb') as output:
                    file.save(output)
                db.execute('INSERT INTO archivos(id,cancion_id,etapa,sesion_id,nombre,ruta,modo) VALUES(?,?,?,?,?,?,?)',
                           (identity, sid, stage['clave'], session_id, Path(file.filename).name, str(target), 'importado'))
                log(db, sid, stage['clave'], 'Nueva versión registrada' if previous_id else 'Archivo incorporado',
                    identity, json.dumps(dict(nombre=file.filename, version_de=previous_id,
                    comentario=request.form.get('comentario', '')), ensure_ascii=False))
            except Exception:
                target.unlink(missing_ok=True)
                raise
        return jsonify(id=identity), 201

    # El flujo viejo de adjuntos también crea catálogo e historial.
    app.add_url_rule('/api/canciones/<sid>/adjuntos/<path:stage>', 'attachment',
                     lambda sid, stage: upload(sid, stage), methods=['POST'])

    @app.post('/api/produccion/<sid>/vinculos')
    def link(sid):
        data = request.get_json() or {}
        path = local_path(data.get('ruta', ''))
        if path.exists() and not path.is_file():
            raise ValueError('Para archivos elegí un archivo. Para carpetas utilizá Vincular sesión DAW.')
        with connect() as db:
            required_row(db, 'canciones', sid)
            stage = stage_row(db, data.get('etapa'))
            session_id = session_validate(db, sid, stage['clave'], data.get('sesion_id'))
            existing = db.execute('SELECT id FROM archivos WHERE cancion_id=? AND etapa=? AND ruta=?',
                                  (sid, stage['clave'], str(path))).fetchone()
            if existing:
                return jsonify(id=existing['id'])
            identity = uuid.uuid4().hex
            db.execute('INSERT INTO archivos(id,cancion_id,etapa,sesion_id,nombre,ruta,modo) VALUES(?,?,?,?,?,?,?)',
                       (identity, sid, stage['clave'], session_id, path.name, str(path), 'vinculado'))
            log(db, sid, stage['clave'], 'Archivo vinculado', identity, str(path))
        return jsonify(id=identity), 201

    @app.get('/api/produccion/archivo/<identity>')
    def download(identity):
        with connect() as db:
            file = required_row(db, 'archivos', identity)
        path = Path(file['ruta'])
        if not path.is_file():
            return jsonify(error='Archivo no disponible. Revisá la unidad o ruta vinculada.'), 404
        # El usuario decide abrir o descargar. Los documentos arbitrarios no ejecutan HTML en la aplicación.
        audio = path.suffix.lower() in ('.wav', '.mp3', '.flac', '.ogg', '.m4a')
        return send_file(path, as_attachment=not audio, download_name=file['nombre'], conditional=True)

    @app.post('/api/produccion/<sid>/notas/<stage_key>')
    def note(sid, stage_key):
        text = (request.get_json() or {}).get('texto', '')
        if not isinstance(text, str):
            raise ValueError('La nota debe contener texto.')
        with connect() as db:
            required_row(db, 'canciones', sid)
            stage = stage_row(db, stage_key)
            db.execute('INSERT OR REPLACE INTO notas_etapa VALUES(?,?,?)', (sid, stage['clave'], text))
            log(db, sid, stage['clave'], 'Nota agregada', detail=text)
        return jsonify(ok=True)

    @app.post('/api/sesiones/<identity>/versiones')
    def session_version(identity):
        data = request.get_json() or {}
        with connect() as db:
            original = required_row(db, 'sesiones', identity)
            stage = stage_row(db, original['etapa'])
            song = required_row(db, 'canciones', original['cancion_id'])
            new_id = uuid.uuid4().hex
            folder = managed_folder(song, stage).parent / 'Sesiones' / new_id
            folder.mkdir(parents=True, exist_ok=False)
            try:
                db.execute('INSERT INTO sesiones(id,cancion_id,etapa,daw,ruta,comentario) VALUES(?,?,?,?,?,?)',
                           (new_id, song['id'], stage['clave'], original['daw'], str(folder), data.get('comentario', '')))
                db.execute('INSERT INTO sesion_info(id,nombre) VALUES(?,?)', (new_id, 'Nueva sesión · ' + new_id[:6]))
                db.execute('INSERT INTO versiones(id,sesion_id,ruta,comentario) VALUES(?,?,?,?)',
                           (new_id, identity, str(folder), data.get('comentario', '')))
                log(db, song['id'], stage['clave'], 'Nueva versión de trabajo registrada', new_id, identity)
            except Exception:
                folder.rmdir()
                raise
        return jsonify(id=new_id), 201

    @app.errorhandler(OSError)
    def filesystem_error(error):
        app.logger.warning('Error de acceso a archivo: %s', error)
        return jsonify(error='No se pudo acceder a la ruta. Revisá la unidad, permisos y espacio disponible.'), 400
