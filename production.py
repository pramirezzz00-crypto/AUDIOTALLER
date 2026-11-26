"""Sesiones, archivos importados o vinculados y eventos de producción."""
import json
import os
import shutil
import uuid
import wave
from audio_waveform import pcm_waveform
from pathlib import Path
from flask import jsonify, request, send_file
from management import required_row
from migrations import LEGACY_STAGE
from daw_operations import ensure_revisions
from runtime_paths import open_path


# Extensiones de proyecto. El lanzador solo abre archivos de estos tipos mediante Windows.
DAW_PROJECTS = {'.cpr':'Cubase', '.rpp':'Reaper', '.ptx':'Pro Tools', '.als':'Ableton Live',
                '.song':'Studio One', '.flp':'FL Studio', '.npr':'Nuendo', '.wpr':'WaveLab'}


def register_production(app, connect, safe_name):
    @app.before_request
    def validate_json_payload():
        if request.method != 'POST' or not request.is_json:
            return
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValueError('La solicitud debe contener un objeto de datos.')
        text_fields = ('nombre','titulo','tipo','imagen','portada','etapa','ruta','daw','notas',
                       'texto','rol','funcion','desde','hasta','estado','metadata','comentario','ejecutable','extension','plantilla','plantilla_manual','daw_id')
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
            ensure_revisions(db, sid)
            sessions = [dict(row) for row in db.execute("""SELECT s.*, i.nombre,i.principal,i.modo,r.numero AS version,r.fecha_archivo,r.criterio
                FROM sesiones s LEFT JOIN sesion_info i ON i.id=s.id LEFT JOIN revision_sesion r ON r.sesion_id=s.id
                WHERE s.cancion_id=? ORDER BY s.creado DESC,s.rowid DESC""", (sid,))]
            valid = {row['etapa']:row['sesion_id'] for row in db.execute(
                'SELECT etapa,sesion_id FROM sesion_vigente WHERE cancion_id=?', (sid,))}
            for session in sessions:
                session['etapa'] = stage_row(db, session['etapa'])['clave']
                session['vigente'] = valid.get(session['etapa']) == session['id']
                if Path(session['ruta']).suffix.lower() not in DAW_PROJECTS:
                    session['version'] = None
                    session['criterio'] = 'Sesión de trabajo sin archivo DAW disponible'
                session['abrible'] = Path(session['ruta']).suffix.lower() in DAW_PROJECTS and Path(session['ruta']).is_file()
                session['disponible'] = Path(session['ruta']).exists() if session['ruta'] else False
            files = [dict(row) for row in db.execute('''SELECT f.*, ca.favorito,ca.clase,ca.version AS version_audio
                FROM archivos f LEFT JOIN catalogo_audio ca ON ca.archivo_id=f.id
                WHERE f.cancion_id=? AND f.eliminado_en='' ORDER BY f.creado DESC''', (sid,))]
            shared = {}
            # Audios que el artista ya escuchó: están en una playlist publicada en el portal.
            for row in db.execute('''SELECT pi.archivo_id, p.nombre FROM playlist_items pi JOIN playlists p ON p.id=pi.playlist_id
                WHERE pi.archivo_id IN (SELECT id FROM archivos WHERE cancion_id=?)
                AND EXISTS(SELECT 1 FROM portal_publicaciones pp WHERE pp.playlist_id=p.id)''', (sid,)):
                shared.setdefault(row['archivo_id'], []).append(row['nombre'])
            for file in files:
                file['compartido'] = shared.get(file['id'], [])
                try:
                    stat = Path(file['ruta']).stat()
                    file.update(disponible=True, tamano=stat.st_size, modificado=stat.st_mtime_ns)
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

    def checked_session(db, sid, identity):
        row = required_row(db, 'sesiones', identity)
        if row['cancion_id'] != sid:
            raise ValueError('La sesión no pertenece a esta canción.')
        return row

    @app.post('/api/produccion/<sid>/vigente/<identity>')
    def valid_session(sid, identity):
        with connect() as db:
            session = checked_session(db, sid, identity)
            stage = stage_row(db, session['etapa'])['clave']
            active = (request.get_json() or {}).get('activa', True)
            if not isinstance(active, bool):
                raise ValueError('La marca de sesión válida debe ser verdadera o falsa.')
            if active:
                db.execute('INSERT OR REPLACE INTO sesion_vigente VALUES(?,?,?)', (sid, stage, identity))
                log(db, sid, stage, 'Sesión válida seleccionada', identity)
            else:
                deleted = db.execute('DELETE FROM sesion_vigente WHERE cancion_id=? AND etapa=? AND sesion_id=?',
                                     (sid, stage, identity))
                if deleted.rowcount:
                    log(db, sid, stage, 'Marca de sesión válida retirada', identity)
        return jsonify(ok=True)

    @app.post('/api/produccion/<sid>/sesiones/<identity>/notas')
    def session_notes(sid, identity):
        text = (request.get_json() or {}).get('texto', '')
        with connect() as db:
            session = checked_session(db, sid, identity)
            db.execute('UPDATE sesiones SET comentario=? WHERE id=?', (text, identity))
            log(db, sid, stage_row(db, session['etapa'])['clave'], 'Nota de sesión guardada', identity, text)
        return jsonify(ok=True)

    @app.post('/api/produccion/<sid>/sesiones/<identity>/abrir')
    def open_daw(sid, identity):
        with connect() as db:
            session = checked_session(db, sid, identity)
        path = local_path(session['ruta'])
        if path.suffix.lower() not in DAW_PROJECTS or not path.is_file():
            raise ValueError('Seleccioná un archivo de sesión DAW disponible, por ejemplo un .cpr.')
        # startfile usa la asociación de Windows y recibe una ruta, sin construir comandos.
        try:
            open_path(str(path.resolve()))
        except OSError as error:
            raise ValueError('No se pudo abrir la sesión. Revisá la asociación del archivo con su DAW en el sistema.') from error
        return jsonify(ok=True)

    def scan_daw_folder(folder, recursive):
        if not folder.is_dir():
            raise ValueError('La carpeta no está disponible. Revisá su ubicación o la unidad externa.')
        root = folder.resolve()
        results = []
        inaccessible = []

        def unreadable(error):
            inaccessible.append(str(error.filename or root))

        for directory, subdirs, files in os.walk(root, onerror=unreadable):
            current = Path(directory)
            subdirs[:] = [name for name in subdirs if not (current/name).is_symlink()
                          and not (current/name).is_junction()]
            if not recursive:
                subdirs.clear()
            for name in files:
                path = current/name
                daw = DAW_PROJECTS.get(path.suffix.lower())
                if not daw:
                    continue
                try:
                    path = path.resolve(strict=True)
                    if not path.is_relative_to(root) or not path.is_file():
                        continue
                    stat = path.stat()
                except OSError:
                    inaccessible.append(str(path))
                    continue
                results.append(dict(ruta=str(path), nombre=path.stem, daw=daw,
                                    modificado=stat.st_mtime, tamano=stat.st_size))
        results.sort(key=lambda item: (-item['modificado'], item['ruta'].casefold()))
        return results, inaccessible

    @app.post('/api/produccion/<sid>/buscar-sesiones')
    def discover_sessions(sid):
        data = request.get_json() or {}
        folder = local_path(data.get('ruta', ''))
        if not isinstance(data.get('recursivo', False), bool):
            raise ValueError('La opción de subcarpetas debe ser verdadera o falsa.')
        with connect() as db:
            required_row(db, 'canciones', sid)
            stage = stage_row(db, data.get('etapa'))['clave']
            existing = {str(Path(row['ruta']).resolve()).casefold():row['id'] for row in
                        db.execute('SELECT ruta,id,etapa FROM sesiones WHERE cancion_id=?', (sid,))
                        if stage_row(db, row['etapa'])['clave'] == stage}
        found, inaccessible = scan_daw_folder(folder, data.get('recursivo', False))
        for item in found:
            item['registrada'] = existing.get(item['ruta'].casefold())
        return jsonify(sesiones=found, inaccesibles=len(inaccessible))

    @app.post('/api/produccion/<sid>/vincular-sesiones')
    def register_discovered(sid):
        data = request.get_json() or {}
        folder = local_path(data.get('ruta', '')).resolve()
        paths = data.get('archivos')
        if not isinstance(paths, list) or not paths or not all(isinstance(path, str) for path in paths):
            raise ValueError('Seleccioná las sesiones que querés vincular.')
        # Revalida los archivos antes de escribir. Si uno dejó de existir, no registra un lote parcial.
        candidates = []
        for value in dict.fromkeys(paths):
            path = local_path(value).resolve()
            if not path.is_relative_to(folder) or not path.is_file() or path.suffix.lower() not in DAW_PROJECTS:
                raise ValueError('Una sesión ya no está disponible o no pertenece a la carpeta elegida. Volvé a buscar.')
            candidates.append(path)
        with connect() as db:
            required_row(db, 'canciones', sid)
            stage = stage_row(db, data.get('etapa'))['clave']
            # Reserva la escritura para que dos confirmaciones simultáneas no dupliquen sesiones.
            db.execute('BEGIN IMMEDIATE')
            existing = {str(Path(row['ruta']).resolve()).casefold():row['id'] for row in
                        db.execute('SELECT ruta,id,etapa FROM sesiones WHERE cancion_id=?', (sid,))
                        if stage_row(db, row['etapa'])['clave'] == stage}
            identities = []
            for path in candidates:
                key = str(path).casefold()
                if key in existing:
                    identities.append(existing[key])
                    continue
                identity = uuid.uuid4().hex
                db.execute('INSERT INTO sesiones(id,cancion_id,etapa,daw,ruta) VALUES(?,?,?,?,?)',
                           (identity, sid, stage, DAW_PROJECTS[path.suffix.lower()], str(path)))
                db.execute('INSERT INTO sesion_info(id,nombre,modo) VALUES(?,?,?)', (identity,path.stem,'vinculada'))
                log(db, sid, stage, 'Sesión DAW asociada', identity, str(path))
                existing[key] = identity
                identities.append(identity)
        return jsonify(ids=identities), 201

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

    @app.post('/api/produccion/<sid>/copias-audio/<stage_key>')
    def copy_linked_audio(sid, stage_key):
        data = request.get_json() or {}
        source = local_path(data.get('ruta', '')).resolve(strict=True)
        if not source.is_file() or source.suffix.lower() not in (
                '.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.aif', '.aiff'):
            raise ValueError('Seleccioná un archivo de audio compatible.')
        with connect() as db:
            song = required_row(db, 'canciones', sid)
            stage = stage_row(db, stage_key)
            session_id = session_validate(db, sid, stage['clave'], data.get('sesion_id'))
            previous_id = data.get('version_de', '')
            if previous_id:
                previous = required_row(db, 'archivos', previous_id)
                if previous['cancion_id'] != sid or previous['etapa'] != stage['clave']:
                    raise ValueError('La versión original debe pertenecer a esta etapa.')
            folder = managed_folder(song, stage)
            folder.mkdir(parents=True, exist_ok=True)
            identity = uuid.uuid4().hex
            target = folder / (identity + '-' + safe_name(source.name)[:150])
            try:
                with source.open('rb') as original, target.open('xb') as copied:
                    shutil.copyfileobj(original, copied)
                db.execute('INSERT INTO archivos(id,cancion_id,etapa,sesion_id,nombre,ruta,modo) VALUES(?,?,?,?,?,?,?)',
                           (identity, sid, stage['clave'], session_id, source.name, str(target), 'importado'))
                log(db, sid, stage['clave'], 'Archivo incorporado como copia', identity,
                    json.dumps(dict(nombre=source.name, ruta_origen=str(source), version_de=previous_id), ensure_ascii=False))
            except Exception:
                target.unlink(missing_ok=True)
                raise
        return jsonify(id=identity), 201

    @app.post('/api/produccion/<sid>/papelera/<identity>')
    def move_file_to_trash(sid, identity):
        with connect() as db:
            file = required_row(db, 'archivos', identity)
            if file['cancion_id'] != sid:
                raise ValueError('El archivo no pertenece a esta canción.')
            if file['eliminado_en']:
                raise ValueError('Este archivo ya está en la Papelera.')
            db.execute("UPDATE archivos SET eliminado_en=CURRENT_TIMESTAMP WHERE id=?", (identity,))
            log(db, sid, file['etapa'], 'Archivo enviado a Papelera', identity, file['nombre'])
        return jsonify(ok=True)

    @app.get('/api/papelera')
    def list_trash():
        with connect() as db:
            files = [dict(row) for row in db.execute('''SELECT f.id,f.nombre,f.modo,f.etapa,f.eliminado_en,
                    c.titulo,a.nombre AS artista,
                    (SELECT COUNT(*) FROM playlist_items pi WHERE pi.archivo_id=f.id) AS playlists,
                    (SELECT COUNT(DISTINCT pp.id) FROM playlist_items pi JOIN portal_publicaciones pp
                        ON pp.playlist_id=pi.playlist_id WHERE pi.archivo_id=f.id) AS publicaciones
                FROM archivos f JOIN canciones c ON c.id=f.cancion_id JOIN artistas a ON a.id=c.artista_id
                WHERE f.eliminado_en<>'' ORDER BY f.eliminado_en DESC,f.rowid DESC''')]
        return jsonify(files)

    @app.post('/api/papelera/<identity>/restaurar')
    def restore_file(identity):
        with connect() as db:
            file = required_row(db, 'archivos', identity)
            if not file['eliminado_en']:
                raise ValueError('Este archivo no está en la Papelera.')
            db.execute("UPDATE archivos SET eliminado_en='' WHERE id=?", (identity,))
            log(db, file['cancion_id'], file['etapa'], 'Archivo restaurado de Papelera', identity, file['nombre'])
        return jsonify(ok=True)

    @app.delete('/api/papelera/<identity>')
    def delete_file_permanently(identity):
        staged_path = None
        with connect() as db:
            file = required_row(db, 'archivos', identity)
            if not file['eliminado_en']:
                raise ValueError('Primero enviá el archivo a la Papelera.')
            song = required_row(db, 'canciones', file['cancion_id'])
            path = Path(file['ruta'])
            if file['modo'] == 'importado':
                try:
                    resolved = path.resolve(strict=True)
                    project_root = Path(song['carpeta']).resolve()
                    same_path = db.execute('SELECT 1 FROM archivos WHERE ruta=? AND id<>?',
                                           (file['ruta'], identity)).fetchone()
                    if resolved.is_file() and resolved.is_relative_to(project_root) and not same_path:
                        staged_path = resolved.with_name('.' + resolved.name + '.borrado-' + uuid.uuid4().hex)
                        os.replace(resolved, staged_path)
                except FileNotFoundError:
                    staged_path = None
            try:
                playlists = [row['playlist_id'] for row in db.execute(
                    'SELECT playlist_id FROM playlist_items WHERE archivo_id=?', (identity,))]
                db.execute('DELETE FROM playlist_items WHERE archivo_id=?', (identity,))
                for playlist_id in playlists:
                    db.execute('UPDATE playlists SET revision=revision+1,actualizado=CURRENT_TIMESTAMP WHERE id=?',
                               (playlist_id,))
                db.execute('DELETE FROM catalogo_audio WHERE archivo_id=?', (identity,))
                db.execute('DELETE FROM portal_drive WHERE archivo_id=?', (identity,))
                log(db, file['cancion_id'], file['etapa'], 'Archivo eliminado definitivamente', identity,
                    json.dumps(dict(nombre=file['nombre'], modo=file['modo']), ensure_ascii=False))
                db.execute('DELETE FROM archivos WHERE id=?', (identity,))
                db.commit()
            except Exception:
                db.rollback()
                if staged_path:
                    os.replace(staged_path, path)
                raise
        if staged_path:
            staged_path.unlink(missing_ok=True)
        return jsonify(ok=True, copia_eliminada=bool(staged_path))

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
            existing = db.execute('SELECT id,eliminado_en FROM archivos WHERE cancion_id=? AND etapa=? AND ruta=?',
                                  (sid, stage['clave'], str(path))).fetchone()
            if existing:
                if existing['eliminado_en']:
                    raise ValueError('Este archivo ya está en la Papelera. Restauralo antes de volver a vincularlo.')
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
            if file['eliminado_en']:
                raise ValueError('El archivo está en la Papelera. Restauralo para volver a usarlo.')
        path = Path(file['ruta'])
        if not path.is_file():
            return jsonify(error='Archivo no disponible. Revisá la unidad o ruta vinculada.'), 404
        # El usuario decide abrir o descargar. Los documentos arbitrarios no ejecutan HTML en la aplicación.
        audio = path.suffix.lower() in ('.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.aif', '.aiff')
        return send_file(path, as_attachment=not audio, download_name=file['nombre'], conditional=True)

    @app.get('/api/produccion/archivo/<identity>/onda')
    def waveform(identity):
        with connect() as db:
            file = required_row(db, 'archivos', identity)
            if file['eliminado_en']:
                raise ValueError('El audio está en la Papelera. Restauralo para volver a usarlo.')
        path = Path(file['ruta'])
        if not path.is_file():
            return jsonify(error='El audio no está disponible.'), 404
        if path.suffix.lower() != '.wav':
            return jsonify(error='Usar el decodificador del reproductor.'), 415
        try:
            return jsonify(pcm_waveform(path))
        except (wave.Error, EOFError, ValueError):
            return jsonify(error='Usar el decodificador del reproductor.'), 415

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
