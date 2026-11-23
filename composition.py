"""Composición de Zharelly (7931e84), integrada sin sustituir las playlists del portal.

Las colecciones referencian originales: quitarlas no elimina archivos del equipo.
"""
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from flask import jsonify, request, send_file, Response


def create_composition_schema(db):
    db.execute('CREATE TABLE IF NOT EXISTS composition_playlists(\n        id TEXT PRIMARY KEY,nombre TEXT NOT NULL,posicion INTEGER NOT NULL DEFAULT 0,\n        creado TEXT DEFAULT CURRENT_TIMESTAMP\n    )')
    db.execute("CREATE TABLE IF NOT EXISTS composition_beats(\n        id TEXT PRIMARY KEY,nombre TEXT NOT NULL,ruta TEXT NOT NULL,\n        creado TEXT DEFAULT CURRENT_TIMESTAMP,posicion INTEGER NOT NULL DEFAULT 0,\n        playlist_id TEXT NOT NULL DEFAULT 'default' REFERENCES composition_playlists(id),\n        UNIQUE(playlist_id,ruta)\n    )")
    db.execute('CREATE TABLE IF NOT EXISTS composition_score_collections(\n        id TEXT PRIMARY KEY,nombre TEXT NOT NULL,posicion INTEGER NOT NULL DEFAULT 0,\n        creado TEXT DEFAULT CURRENT_TIMESTAMP\n    )')
    db.execute('CREATE TABLE IF NOT EXISTS composition_scores(\n        id TEXT PRIMARY KEY,nombre TEXT NOT NULL,ruta TEXT NOT NULL,\n        creado TEXT DEFAULT CURRENT_TIMESTAMP,posicion INTEGER NOT NULL DEFAULT 0,\n        collection_id TEXT NOT NULL REFERENCES composition_score_collections(id),\n        UNIQUE(collection_id,ruta)\n    )')
    db.execute('CREATE TABLE IF NOT EXISTS composition_lyric_collections(id TEXT PRIMARY KEY,nombre TEXT NOT NULL,posicion INTEGER NOT NULL DEFAULT 0,creado TEXT DEFAULT CURRENT_TIMESTAMP)')
    db.execute('CREATE TABLE IF NOT EXISTS composition_lyrics(id TEXT PRIMARY KEY,nombre TEXT NOT NULL,ruta TEXT NOT NULL,creado TEXT DEFAULT CURRENT_TIMESTAMP,posicion INTEGER NOT NULL DEFAULT 0,collection_id TEXT NOT NULL REFERENCES composition_lyric_collections(id),UNIQUE(collection_id,ruta))')
    db.execute("INSERT INTO composition_playlists(id,nombre,posicion) VALUES('default','Mi lista',0)")


def register_composition(app, db_open, AUDIO_TYPES):
    @app.get('/api/beats/playlists')
    def beats_playlists():
        with db_open() as db:
            rows = db.execute('SELECT p.id,p.nombre,p.posicion,p.creado,COUNT(b.id) AS cantidad FROM composition_playlists p LEFT JOIN composition_beats b ON b.playlist_id=p.id GROUP BY p.id ORDER BY p.posicion,p.creado,p.nombre COLLATE NOCASE').fetchall()
        return jsonify(listas=[dict(row) for row in rows])

    @app.post('/api/beats/playlists')
    def beats_playlist_create():
        data = request.get_json() or {}
        name = data.get('nombre', '').strip() if isinstance(data.get('nombre', ''), str) else ''
        if not name or len(name) > 80:
            return (jsonify(error='Ingresá un nombre de lista de entre 1 y 80 caracteres.'), 400)
        playlist_id = uuid.uuid4().hex
        with db_open() as db:
            next_position = db.execute('SELECT COALESCE(MAX(posicion),-1)+1 FROM composition_playlists').fetchone()[0]
            db.execute('INSERT INTO composition_playlists(id,nombre,posicion) VALUES(?,?,?)', (playlist_id, name, next_position))
        return (jsonify(id=playlist_id, nombre=name), 201)

    @app.patch('/api/beats/playlists/<pid>')
    def beats_playlist_rename(pid):
        data = request.get_json() or {}
        name = data.get('nombre', '').strip() if isinstance(data.get('nombre', ''), str) else ''
        if not name or len(name) > 80:
            return (jsonify(error='Ingresá un nombre de lista de entre 1 y 80 caracteres.'), 400)
        with db_open() as db:
            cursor = db.execute('UPDATE composition_playlists SET nombre=? WHERE id=?', (name, pid))
        if not cursor.rowcount:
            return (jsonify(error='No se encontró la lista seleccionada.'), 404)
        return jsonify(ok=True, nombre=name)

    @app.delete('/api/beats/playlists/<pid>')
    def beats_playlist_delete(pid):
        with db_open() as db:
            playlist = db.execute('SELECT id,nombre FROM composition_playlists WHERE id=?', (pid,)).fetchone()
            if not playlist:
                return (jsonify(error='No se encontró la lista seleccionada.'), 404)
            count = db.execute('SELECT COUNT(*) FROM composition_beats WHERE playlist_id=?', (pid,)).fetchone()[0]
            db.execute('DELETE FROM composition_beats WHERE playlist_id=?', (pid,))
            db.execute('DELETE FROM composition_playlists WHERE id=?', (pid,))
        return jsonify(ok=True, eliminados=count, nombre=playlist['nombre'])

    @app.get('/api/beats')
    def beats_list():
        playlist_id = request.args.get('playlist_id', 'default')
        with db_open() as db:
            exists = db.execute('SELECT 1 FROM composition_playlists WHERE id=?', (playlist_id,)).fetchone()
            if not exists:
                return (jsonify(error='No se encontró la lista seleccionada.'), 404)
            rows = db.execute('SELECT id,nombre,ruta,creado FROM composition_beats\n                             WHERE playlist_id=? ORDER BY posicion,id', (playlist_id,)).fetchall()
        audios = []
        for row in rows:
            path = Path(row['ruta'])
            available = path.is_file()
            audios.append(dict(id=row['id'], nombre=row['nombre'], formato=path.suffix[1:].upper(), disponible=available, creado=row['creado']))
        return jsonify(audios=audios, playlist_id=playlist_id)

    @app.post('/api/beats')
    def beats_add():
        data = request.get_json() or {}
        paths = data.get('paths', [])
        playlist_id = data.get('playlist_id', 'default')
        if not isinstance(paths, list) or not paths or len(paths) > 200:
            return (jsonify(error='Seleccioná entre 1 y 200 archivos de audio.'), 400)
        added = skipped = 0
        with db_open() as db:
            if not db.execute('SELECT 1 FROM composition_playlists WHERE id=?', (playlist_id,)).fetchone():
                return (jsonify(error='No se encontró la lista seleccionada.'), 404)
            for raw in paths:
                if not isinstance(raw, str) or len(raw) > 32767:
                    skipped += 1
                    continue
                try:
                    path = Path(raw).resolve(strict=True)
                    if not path.is_file() or path.suffix.lower() not in AUDIO_TYPES:
                        skipped += 1
                        continue
                    next_position = db.execute('SELECT COALESCE(MAX(posicion),-1)+1 FROM composition_beats WHERE playlist_id=?', (playlist_id,)).fetchone()[0]
                    cursor = db.execute('INSERT OR IGNORE INTO composition_beats(id,nombre,ruta,posicion,playlist_id)\n                                       VALUES(?,?,?,?,?)', (uuid.uuid4().hex, path.name, str(path), next_position, playlist_id))
                    added += cursor.rowcount
                    if not cursor.rowcount:
                        skipped += 1
                except (OSError, RuntimeError, ValueError):
                    skipped += 1
        return (jsonify(agregados=added, omitidos=skipped), 201)

    @app.put('/api/beats/orden')
    def beats_reorder():
        data = request.get_json() or {}
        ids = data.get('ids')
        playlist_id = data.get('playlist_id', 'default')
        if not isinstance(ids, list) or len(ids) > 10000 or any((not isinstance(item, str) for item in ids)):
            return (jsonify(error='La lista de posiciones no es válida.'), 400)
        if len(ids) != len(set(ids)):
            return (jsonify(error='La lista contiene audios repetidos.'), 400)
        with db_open() as db:
            current_ids = {row['id'] for row in db.execute('SELECT id FROM composition_beats WHERE playlist_id=?', (playlist_id,))}
            if set(ids) != current_ids:
                return (jsonify(error='La lista cambió. Actualizá Beats e intentá nuevamente.'), 409)
            db.executemany('UPDATE composition_beats SET posicion=? WHERE id=? AND playlist_id=?', [(i, bid, playlist_id) for i, bid in enumerate(ids)])
        return jsonify(ok=True)

    @app.delete('/api/beats/<bid>')
    def beats_remove(bid):
        with db_open() as db:
            cursor = db.execute('DELETE FROM composition_beats WHERE id=?', (bid,))
        if not cursor.rowcount:
            return (jsonify(error='El audio no está en la lista.'), 404)
        return jsonify(ok=True)

    @app.get('/api/beats/<bid>/audio')
    def beats_audio(bid):
        with db_open() as db:
            row = db.execute('SELECT ruta FROM composition_beats WHERE id=?', (bid,)).fetchone()
        if not row:
            return (jsonify(error='El audio ya no está en la lista.'), 404)
        try:
            path = Path(row['ruta']).resolve(strict=True)
            mimetype = AUDIO_TYPES.get(path.suffix.lower())
            if mimetype and path.is_file():
                return send_file(path, mimetype=mimetype, conditional=True, max_age=0)
        except (OSError, RuntimeError):
            pass
        return (jsonify(error='El archivo ya no está disponible en su ubicación original.'), 404)
    SCORE_TYPES = {'.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                   # Archivos de editores de partituras: se guardan y se abren con su programa.
                   '.mscz': 'application/octet-stream', '.sib': 'application/octet-stream', '.dorico': 'application/octet-stream',
                   '.musx': 'application/octet-stream', '.mus': 'application/octet-stream', '.musicxml': 'application/vnd.recordare.musicxml+xml',
                   '.mxl': 'application/vnd.recordare.musicxml', '.xml': 'application/xml'}

    @app.get('/api/scores/collections')
    def scores_collections():
        with db_open() as db:
            rows = db.execute('SELECT c.id,c.nombre,c.posicion,c.creado,COUNT(s.id) AS cantidad\n            FROM composition_score_collections c LEFT JOIN composition_scores s ON s.collection_id=c.id\n            GROUP BY c.id ORDER BY c.posicion,c.creado,c.nombre COLLATE NOCASE').fetchall()
        return jsonify(colecciones=[dict(row) for row in rows])

    @app.post('/api/scores/collections')
    def scores_collection_create():
        data = request.get_json() or {}
        name = data.get('nombre', '').strip() if isinstance(data.get('nombre', ''), str) else ''
        if not name or len(name) > 80:
            return (jsonify(error='Ingresá un nombre de colección de entre 1 y 80 caracteres.'), 400)
        cid = uuid.uuid4().hex
        with db_open() as db:
            pos = db.execute('SELECT COALESCE(MAX(posicion),-1)+1 FROM composition_score_collections').fetchone()[0]
            db.execute('INSERT INTO composition_score_collections(id,nombre,posicion) VALUES(?,?,?)', (cid, name, pos))
        return (jsonify(id=cid, nombre=name), 201)

    @app.patch('/api/scores/collections/<cid>')
    def scores_collection_rename(cid):
        data = request.get_json() or {}
        name = data.get('nombre', '').strip() if isinstance(data.get('nombre', ''), str) else ''
        if not name or len(name) > 80:
            return (jsonify(error='Ingresá un nombre de colección de entre 1 y 80 caracteres.'), 400)
        with db_open() as db:
            cur = db.execute('UPDATE composition_score_collections SET nombre=? WHERE id=?', (name, cid))
        if not cur.rowcount:
            return (jsonify(error='No se encontró la colección.'), 404)
        return jsonify(ok=True, nombre=name)

    @app.delete('/api/scores/collections/<cid>')
    def scores_collection_delete(cid):
        with db_open() as db:
            collection = db.execute('SELECT id,nombre FROM composition_score_collections WHERE id=?', (cid,)).fetchone()
            if not collection:
                return (jsonify(error='No se encontró la colección.'), 404)
            count = db.execute('SELECT COUNT(*) FROM composition_scores WHERE collection_id=?', (cid,)).fetchone()[0]
            db.execute('DELETE FROM composition_scores WHERE collection_id=?', (cid,))
            db.execute('DELETE FROM composition_score_collections WHERE id=?', (cid,))
        return jsonify(ok=True, eliminados=count, nombre=collection['nombre'])

    @app.get('/api/scores')
    def scores_list():
        cid = request.args.get('collection_id', '')
        with db_open() as db:
            if not db.execute('SELECT 1 FROM composition_score_collections WHERE id=?', (cid,)).fetchone():
                return (jsonify(error='No se encontró la colección seleccionada.'), 404)
            rows = db.execute('SELECT id,nombre,ruta,creado FROM composition_scores WHERE collection_id=? ORDER BY posicion,id', (cid,)).fetchall()
        result = []
        for row in rows:
            path = Path(row['ruta'])
            result.append(dict(id=row['id'], nombre=row['nombre'], formato=path.suffix[1:].upper(), disponible=path.is_file(), creado=row['creado']))
        return jsonify(partituras=result, collection_id=cid)

    @app.post('/api/scores')
    def scores_add():
        data = request.get_json() or {}
        paths = data.get('paths', [])
        cid = data.get('collection_id', '')
        if not isinstance(paths, list) or not paths or len(paths) > 200:
            return (jsonify(error='Seleccioná entre 1 y 200 archivos de partituras.'), 400)
        added = skipped = 0
        with db_open() as db:
            if not db.execute('SELECT 1 FROM composition_score_collections WHERE id=?', (cid,)).fetchone():
                return (jsonify(error='No se encontró la colección seleccionada.'), 404)
            for raw in paths:
                if not isinstance(raw, str) or len(raw) > 32767:
                    skipped += 1
                    continue
                try:
                    path = Path(raw).resolve(strict=True)
                    if not path.is_file() or path.suffix.lower() not in SCORE_TYPES:
                        skipped += 1
                        continue
                    pos = db.execute('SELECT COALESCE(MAX(posicion),-1)+1 FROM composition_scores WHERE collection_id=?', (cid,)).fetchone()[0]
                    cur = db.execute('INSERT OR IGNORE INTO composition_scores(id,nombre,ruta,posicion,collection_id) VALUES(?,?,?,?,?)', (uuid.uuid4().hex, path.name, str(path), pos, cid))
                    added += cur.rowcount
                    skipped += int(not cur.rowcount)
                except (OSError, RuntimeError, ValueError):
                    skipped += 1
        return (jsonify(agregados=added, omitidos=skipped), 201)

    @app.put('/api/scores/orden')
    def scores_reorder():
        data = request.get_json() or {}
        ids = data.get('ids')
        cid = data.get('collection_id', '')
        if not isinstance(ids, list) or len(ids) > 10000 or any((not isinstance(x, str) for x in ids)) or (len(ids) != len(set(ids))):
            return (jsonify(error='La lista de posiciones no es válida.'), 400)
        with db_open() as db:
            current = {r['id'] for r in db.execute('SELECT id FROM composition_scores WHERE collection_id=?', (cid,))}
            if set(ids) != current:
                return (jsonify(error='La lista cambió. Actualizá Partituras e intentá nuevamente.'), 409)
            db.executemany('UPDATE composition_scores SET posicion=? WHERE id=? AND collection_id=?', [(i, sid, cid) for i, sid in enumerate(ids)])
        return jsonify(ok=True)

    @app.delete('/api/scores/<sid>')
    def scores_remove(sid):
        with db_open() as db:
            cur = db.execute('DELETE FROM composition_scores WHERE id=?', (sid,))
        if not cur.rowcount:
            return (jsonify(error='La partitura no está en la colección.'), 404)
        return jsonify(ok=True)

    @app.get('/api/scores/<sid>/file')
    def scores_file(sid):
        with db_open() as db:
            row = db.execute('SELECT ruta FROM composition_scores WHERE id=?', (sid,)).fetchone()
        if not row:
            return (jsonify(error='La partitura ya no está en la colección.'), 404)
        try:
            path = Path(row['ruta']).resolve(strict=True)
            mime = SCORE_TYPES.get(path.suffix.lower())
            if mime and path.is_file():
                return send_file(path, mimetype=mime, conditional=True, max_age=0)
        except (OSError, RuntimeError):
            pass
        return (jsonify(error='El archivo ya no está disponible en su ubicación original.'), 404)
    LYRIC_TYPES = {'.txt', '.docx'}

    @app.get('/api/lyrics/collections')
    def lyrics_collections():
        with db_open() as db:
            rows = db.execute('SELECT c.id,c.nombre,c.posicion,c.creado,COUNT(l.id) AS cantidad FROM composition_lyric_collections c LEFT JOIN composition_lyrics l ON l.collection_id=c.id GROUP BY c.id ORDER BY c.posicion,c.creado,c.nombre COLLATE NOCASE').fetchall()
        return jsonify(colecciones=[dict(row) for row in rows])

    @app.post('/api/lyrics/collections')
    def lyrics_collection_create():
        data = request.get_json() or {}
        name = data.get('nombre', '').strip() if isinstance(data.get('nombre', ''), str) else ''
        if not name or len(name) > 80:
            return (jsonify(error='Ingresá un nombre de colección de entre 1 y 80 caracteres.'), 400)
        cid = uuid.uuid4().hex
        with db_open() as db:
            pos = db.execute('SELECT COALESCE(MAX(posicion),-1)+1 FROM composition_lyric_collections').fetchone()[0]
            db.execute('INSERT INTO composition_lyric_collections(id,nombre,posicion) VALUES(?,?,?)', (cid, name, pos))
        return (jsonify(id=cid, nombre=name), 201)

    @app.patch('/api/lyrics/collections/<cid>')
    def lyrics_collection_rename(cid):
        data = request.get_json() or {}
        name = data.get('nombre', '').strip() if isinstance(data.get('nombre', ''), str) else ''
        if not name or len(name) > 80:
            return (jsonify(error='Ingresá un nombre de colección de entre 1 y 80 caracteres.'), 400)
        with db_open() as db:
            cur = db.execute('UPDATE composition_lyric_collections SET nombre=? WHERE id=?', (name, cid))
        if not cur.rowcount:
            return (jsonify(error='No se encontró la colección.'), 404)
        return jsonify(ok=True, nombre=name)

    @app.delete('/api/lyrics/collections/<cid>')
    def lyrics_collection_delete(cid):
        with db_open() as db:
            row = db.execute('SELECT id,nombre FROM composition_lyric_collections WHERE id=?', (cid,)).fetchone()
            if not row:
                return (jsonify(error='No se encontró la colección.'), 404)
            count = db.execute('SELECT COUNT(*) FROM composition_lyrics WHERE collection_id=?', (cid,)).fetchone()[0]
            db.execute('DELETE FROM composition_lyrics WHERE collection_id=?', (cid,))
            db.execute('DELETE FROM composition_lyric_collections WHERE id=?', (cid,))
        return jsonify(ok=True, eliminados=count, nombre=row['nombre'])

    @app.get('/api/lyrics')
    def lyrics_list():
        cid = request.args.get('collection_id', '')
        with db_open() as db:
            if not db.execute('SELECT 1 FROM composition_lyric_collections WHERE id=?', (cid,)).fetchone():
                return (jsonify(error='No se encontró la colección seleccionada.'), 404)
            rows = db.execute('SELECT id,nombre,ruta,creado FROM composition_lyrics WHERE collection_id=? ORDER BY posicion,id', (cid,)).fetchall()
        items = []
        for row in rows:
            path = Path(row['ruta'])
            items.append(dict(id=row['id'], nombre=row['nombre'], formato=path.suffix[1:].upper(), disponible=path.is_file(), creado=row['creado']))
        return jsonify(letras=items, collection_id=cid)

    @app.post('/api/lyrics')
    def lyrics_add():
        data = request.get_json() or {}
        paths = data.get('paths', [])
        cid = data.get('collection_id', '')
        if not isinstance(paths, list) or not paths or len(paths) > 200:
            return (jsonify(error='Seleccioná entre 1 y 200 archivos de letras.'), 400)
        added = skipped = 0
        with db_open() as db:
            if not db.execute('SELECT 1 FROM composition_lyric_collections WHERE id=?', (cid,)).fetchone():
                return (jsonify(error='No se encontró la colección seleccionada.'), 404)
            for raw in paths:
                if not isinstance(raw, str) or len(raw) > 32767:
                    skipped += 1
                    continue
                try:
                    path = Path(raw).resolve(strict=True)
                    if not path.is_file() or path.suffix.lower() not in LYRIC_TYPES:
                        skipped += 1
                        continue
                    pos = db.execute('SELECT COALESCE(MAX(posicion),-1)+1 FROM composition_lyrics WHERE collection_id=?', (cid,)).fetchone()[0]
                    cur = db.execute('INSERT OR IGNORE INTO composition_lyrics(id,nombre,ruta,posicion,collection_id) VALUES(?,?,?,?,?)', (uuid.uuid4().hex, path.stem, str(path), pos, cid))
                    added += cur.rowcount
                    skipped += int(not cur.rowcount)
                except (OSError, RuntimeError, ValueError):
                    skipped += 1
        return (jsonify(agregados=added, omitidos=skipped), 201)

    @app.put('/api/lyrics/orden')
    def lyrics_reorder():
        data = request.get_json() or {}
        ids = data.get('ids')
        cid = data.get('collection_id', '')
        if not isinstance(ids, list) or len(ids) > 10000 or any((not isinstance(x, str) for x in ids)) or (len(ids) != len(set(ids))):
            return (jsonify(error='La lista de posiciones no es válida.'), 400)
        with db_open() as db:
            current = {r['id'] for r in db.execute('SELECT id FROM composition_lyrics WHERE collection_id=?', (cid,))}
            if set(ids) != current:
                return (jsonify(error='La lista cambió. Actualizá Letras e intentá nuevamente.'), 409)
            db.executemany('UPDATE composition_lyrics SET posicion=? WHERE id=? AND collection_id=?', [(i, lid, cid) for i, lid in enumerate(ids)])
        return jsonify(ok=True)

    @app.delete('/api/lyrics/<lid>')
    def lyrics_remove(lid):
        with db_open() as db:
            cur = db.execute('DELETE FROM composition_lyrics WHERE id=?', (lid,))
        if not cur.rowcount:
            return (jsonify(error='La letra no está en la colección.'), 404)
        return jsonify(ok=True)

    def read_docx_text(path):
        with zipfile.ZipFile(path) as archive:
            info = archive.getinfo('word/document.xml')
            if info.file_size > 8*1024*1024:
                raise ValueError('La letra es demasiado extensa para la vista previa.')
            xml = archive.read(info)
        root = ET.fromstring(xml)
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        paragraphs = []
        for paragraph in root.findall('.//w:p', ns):
            parts = []
            for node in paragraph.iter():
                if node.tag.endswith('}t') and node.text:
                    parts.append(node.text)
                elif node.tag.endswith('}tab'):
                    parts.append('\t')
            paragraphs.append(''.join(parts))
        return '\n'.join(paragraphs)

    @app.get('/api/lyrics/<lid>/file')
    def lyrics_file(lid):
        with db_open() as db:
            row = db.execute('SELECT ruta FROM composition_lyrics WHERE id=?', (lid,)).fetchone()
        if not row:
            return (jsonify(error='La letra ya no está en la colección.'), 404)
        try:
            path = Path(row['ruta']).resolve(strict=True)
            if not path.is_file() or path.suffix.lower() not in LYRIC_TYPES:
                raise OSError('Tipo no permitido')
            if path.stat().st_size > 16*1024*1024:
                raise ValueError('El archivo es demasiado grande para la vista previa.')
            if path.suffix.lower() == '.txt':
                content = None
                for encoding in ('utf-8-sig', 'cp1252', 'latin-1'):
                    try:
                        content = path.read_text(encoding=encoding)
                        break
                    except UnicodeDecodeError:
                        continue
                return Response(content or '', mimetype='text/plain; charset=utf-8')
            return Response(read_docx_text(path), mimetype='text/plain; charset=utf-8')
        except (OSError, RuntimeError, KeyError, zipfile.BadZipFile, ET.ParseError, ValueError):
            return (jsonify(error='No se pudo leer el archivo. Comprobá que siga disponible y que sea un TXT o DOCX válido.'), 404)
