"""Herramientas de sesiones de la vista de producción: validadas, notas con adjuntos y renombrado estandarizado."""
import re
import uuid
from datetime import datetime
from pathlib import Path
from flask import jsonify, request
from management import required_row
from redesign import doc_get, doc_put, short_text
from runtime_paths import open_path

INVALID = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def session_meta(db, identity):
    return doc_get(db, 'sesion_meta', identity, {})


def register_session_tools(app, connect):
    def checked(db, sid, identity):
        row = required_row(db, 'sesiones', identity)
        if row['cancion_id'] != sid:
            raise ValueError('La sesión no pertenece a esta canción.')
        return row

    def event(db, sid, stage, kind, reference, detail=''):
        db.execute('INSERT INTO eventos(id,cancion_id,etapa,tipo,referencia,detalle) VALUES(?,?,?,?,?,?)',
                   (uuid.uuid4().hex, sid, stage, kind, reference, detail))

    @app.post('/api/produccion/<sid>/sesiones/<identity>/validada')
    def session_validated(sid, identity):
        active = (request.get_json() or {}).get('activa', True)
        if not isinstance(active, bool):
            raise ValueError('La marca debe ser verdadera o falsa.')
        with connect() as db:
            row = checked(db, sid, identity)
            meta = session_meta(db, identity)
            meta['validada'] = active
            doc_put(db, 'sesion_meta', identity, meta)
            event(db, sid, row['etapa'], 'Sesión validada' if active else 'Validación de sesión retirada', identity)
        return jsonify(ok=True)

    # ── Notas por línea con adjuntos ──
    def notes_payload(db, row):
        meta = session_meta(db, row['id'])
        notes = list(meta.get('notas', []))
        legacy = (row['comentario'] or '').strip()
        if legacy and not meta.get('legado_migrado'):
            notes.insert(0, dict(id='legado', fecha=row['creado'] or '', texto=legacy, adjuntos=[], legado=True))
        for note in notes:
            for item in note.get('adjuntos', []):
                item['disponible'] = Path(item['ruta']).exists()
        return notes

    @app.get('/api/produccion/<sid>/sesiones/<identity>/bitacora')
    def session_log(sid, identity):
        with connect() as db:
            row = checked(db, sid, identity)
            return jsonify(notas=notes_payload(db, row))

    def clean_attachments(values):
        if not isinstance(values, list) or len(values) > 20:
            raise ValueError('Podés adjuntar hasta 20 archivos por nota.')
        out = []
        for value in values:
            path = Path(short_text(value, 1000)).expanduser()
            if not path.is_absolute() or not path.exists():
                raise ValueError('No encuentro el archivo adjunto: ' + str(path))
            out.append(dict(nombre=path.name, ruta=str(path.resolve())))
        return out

    @app.post('/api/produccion/<sid>/sesiones/<identity>/bitacora')
    def session_log_add(sid, identity):
        data = request.get_json() or {}
        text = short_text(data.get('texto', ''), 8000)
        attachments = clean_attachments(data.get('adjuntos', []))
        if not text and not attachments:
            raise ValueError('Escribí una nota o adjuntá un archivo.')
        with connect() as db:
            row = checked(db, sid, identity)
            meta = session_meta(db, identity)
            notes = meta.setdefault('notas', [])
            if len(notes) >= 500:
                raise ValueError('La sesión llegó al máximo de 500 notas.')
            note = dict(id=uuid.uuid4().hex[:12], fecha=datetime.now().strftime('%Y-%m-%d %H:%M'), texto=text, adjuntos=attachments)
            notes.append(note)
            doc_put(db, 'sesion_meta', identity, meta)
            event(db, sid, row['etapa'], 'Nota de sesión agregada', identity, text[:200])
            return jsonify(nota=note, notas=notes_payload(db, row)), 201

    @app.post('/api/produccion/<sid>/sesiones/<identity>/bitacora/<nid>')
    def session_log_edit(sid, identity, nid):
        data = request.get_json() or {}
        with connect() as db:
            row = checked(db, sid, identity)
            meta = session_meta(db, identity)
            notes = meta.setdefault('notas', [])
            if nid == 'legado':
                # La nota anterior (un solo texto) pasa a ser una nota más de la bitácora.
                if data.get('borrar'):
                    db.execute("UPDATE sesiones SET comentario='' WHERE id=?", (identity,))
                else:
                    notes.insert(0, dict(id=uuid.uuid4().hex[:12], fecha=(row['creado'] or '')[:16], texto=short_text(data.get('texto', row['comentario']), 8000),
                                         adjuntos=clean_attachments(data.get('adjuntos', []))))
                    db.execute("UPDATE sesiones SET comentario='' WHERE id=?", (identity,))
                meta['legado_migrado'] = True
            else:
                note = next((n for n in notes if n['id'] == nid), None)
                if not note:
                    raise ValueError('La nota ya no existe.')
                if data.get('borrar'):
                    notes.remove(note)
                else:
                    if 'texto' in data:
                        note['texto'] = short_text(data['texto'], 8000)
                    if 'adjuntos' in data:
                        note['adjuntos'] = clean_attachments(data['adjuntos'])
                    note['editada'] = datetime.now().strftime('%Y-%m-%d %H:%M')
            doc_put(db, 'sesion_meta', identity, meta)
            return jsonify(notas=notes_payload(db, dict(row, comentario='' if meta.get('legado_migrado') else row['comentario'])))

    @app.post('/api/produccion/<sid>/sesiones/<identity>/bitacora/abrir')
    def session_log_open(sid, identity):
        target = str((request.get_json() or {}).get('ruta', ''))
        with connect() as db:
            checked(db, sid, identity)
            meta = session_meta(db, identity)
        known = {a['ruta'] for n in meta.get('notas', []) for a in n.get('adjuntos', [])}
        if target not in known:
            raise ValueError('Ese archivo no está adjunto a esta sesión.')
        if not Path(target).exists():
            raise ValueError('El archivo adjunto ya no está en ' + target)
        open_path(target)
        return jsonify(ok=True)

    # ── Renombrado estandarizado ──
    @app.get('/api/preferencias/nombres-sesion')
    def naming_get():
        with connect() as db:
            return jsonify(doc_get(db, 'preferencia', 'nombres-sesion', dict(bloques=['fecha', 'cancion', 'version'], separador='-', texto='', formato_fecha='AAAA-MM-DD')))

    @app.post('/api/preferencias/nombres-sesion')
    def naming_put():
        data = request.get_json() or {}
        allowed = {'fecha', 'cancion', 'artista', 'disco', 'etapa', 'version', 'daw', 'texto'}
        blocks = [b for b in data.get('bloques', []) if b in allowed][:8]
        separator = data.get('separador', '-')
        if separator not in ('-', '_', ' - ', ' ', '.'):
            raise ValueError('Separador inválido.')
        fmt = data.get('formato_fecha', 'AAAA-MM-DD')
        if fmt not in ('AAAA-MM-DD', 'AAAAMMDD', 'DD-MM-AAAA'):
            raise ValueError('Formato de fecha inválido.')
        clean = dict(bloques=blocks or ['cancion', 'version'], separador=separator, texto=short_text(data.get('texto', ''), 40), formato_fecha=fmt)
        with connect() as db:
            doc_put(db, 'preferencia', 'nombres-sesion', clean)
        return jsonify(clean)

    @app.post('/api/produccion/<sid>/renombrar-sesiones')
    def rename_sessions(sid):
        data = request.get_json() or {}
        changes = data.get('cambios', [])
        on_disk = bool(data.get('archivo'))
        if not isinstance(changes, list) or not 0 < len(changes) <= 200:
            raise ValueError('Elegí entre 1 y 200 sesiones para renombrar.')
        done, skipped = [], []
        clean = []
        for change in changes:
            name = short_text(change.get('nombre', ''), 120).strip().rstrip('.')
            if not name or INVALID.search(name) or name in ('.', '..'):
                raise ValueError(f'Nombre inválido: «{name}». Evitá \\ / : * ? " < > |')
            clean.append((change.get('id'), name))
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            rows = {identity: checked(db, sid, identity) for identity, _ in clean}
            for identity, name in clean:
                row = rows[identity]
                old_name = (db.execute('SELECT nombre FROM sesion_info WHERE id=?', (identity,)).fetchone() or {'nombre': ''})['nombre']
                path = Path(row['ruta']) if row['ruta'] else None
                new_path = None
                if on_disk and path and path.is_file():
                    candidate = path.with_name(name + path.suffix)
                    if candidate != path:
                        if candidate.exists():
                            skipped.append(dict(id=identity, motivo=f'Ya existe {candidate.name} en esa carpeta'))
                            continue
                        path.rename(candidate)  # mismo directorio, sin pisar nada
                        new_path = candidate
                if db.execute('SELECT 1 FROM sesion_info WHERE id=?', (identity,)).fetchone():
                    db.execute('UPDATE sesion_info SET nombre=? WHERE id=?', (name, identity))
                else:
                    db.execute("INSERT INTO sesion_info(id,nombre,modo) VALUES(?,?,'vinculada')", (identity, name))
                if new_path:
                    db.execute('UPDATE sesiones SET ruta=? WHERE id=?', (str(new_path), identity))
                    db.execute('UPDATE versiones SET ruta=? WHERE ruta=?', (str(new_path), str(path)))
                event(db, sid, row['etapa'], 'Sesión renombrada', identity,
                      f'{old_name or path.stem if path else old_name} → {name}' + (f' (archivo: {path.name} → {new_path.name})' if new_path else ''))
                done.append(dict(id=identity, nombre=name, ruta=str(new_path) if new_path else row['ruta']))
        return jsonify(renombradas=done, omitidas=skipped)
