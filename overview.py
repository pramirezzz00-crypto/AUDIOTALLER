"""Resúmenes para Inicio y Disco, y traslado de material entre etapas.

Mover conserva identificadores, rutas e historial. Copiar crea un registro nuevo
en la etapa de destino y nunca modifica el original.
"""
import json
import re
import uuid
import wave
from pathlib import Path
from flask import jsonify, request
from management import required_row
from migrations import LEGACY_STAGE
from daw_operations import ensure_revisions, group_key, file_date, copy_exclusive

AUDIO = ('.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.aif', '.aiff')
WORK_STAGES = ('demo', 'maqueta', 'grabacion', 'mezcla', 'mastering')


def wav_seconds(path):
    """Duración leída del encabezado WAV; otros formatos quedan sin dato."""
    try:
        if Path(path).suffix.lower() != '.wav':
            return None
        with wave.open(str(path), 'rb') as audio:
            rate = audio.getframerate()
            return audio.getnframes() / rate if rate else None
    except (OSError, wave.Error, EOFError):
        return None


def clock(seconds):
    if seconds is None:
        return ''
    seconds = int(round(seconds))
    return f'{seconds // 60}:{seconds % 60:02d}'


def song_summaries(db, where='', params=()):
    """Etapa actual, versión de referencia y devoluciones pendientes por canción."""
    songs = [dict(row) for row in db.execute(f'''SELECT c.id,c.titulo,c.artista_id,c.disco_id,a.nombre AS artista,
        d.nombre AS disco, x.datos AS detalle, e.estado, e.actualizado
        FROM canciones c JOIN artistas a ON a.id=c.artista_id LEFT JOIN discos d ON d.id=c.disco_id
        LEFT JOIN detalle_cancion x ON x.id=c.id LEFT JOIN estado_cancion e ON e.id=c.id {where}''', params)]
    if not songs:
        return []
    ids = [song['id'] for song in songs]
    marks = ','.join('?' * len(ids))
    stage_rank = {key: index for index, key in enumerate(WORK_STAGES)}
    reached = {}
    for row in db.execute(f'''SELECT cancion_id,etapa FROM archivos WHERE cancion_id IN ({marks})
                              UNION SELECT cancion_id,etapa FROM sesiones WHERE cancion_id IN ({marks})''', ids + ids):
        key = LEGACY_STAGE.get(row['etapa'], row['etapa'])
        if key in stage_rank:
            reached[row['cancion_id']] = max(reached.get(row['cancion_id'], -1), stage_rank[key])
    audios = {}
    for row in db.execute(f'''SELECT f.id,f.cancion_id,f.etapa,f.nombre,f.ruta,f.creado,ca.favorito,ca.version AS etiqueta
        FROM archivos f LEFT JOIN catalogo_audio ca ON ca.archivo_id=f.id
        WHERE f.cancion_id IN ({marks}) ORDER BY f.creado DESC,f.rowid DESC''', ids):
        if Path(row['nombre']).suffix.lower() in AUDIO:
            audios.setdefault(row['cancion_id'], []).append(dict(row))
    pending = {row['cancion_id']: row['total'] for row in db.execute(
        f'''SELECT cancion_id,COUNT(*) AS total FROM portal_devoluciones
            WHERE estado!='Resuelta' AND cancion_id IN ({marks}) GROUP BY cancion_id''', ids)}
    out = []
    for song in songs:
        details = json.loads(song.pop('detalle') or '{}')
        files = audios.get(song['id'], [])

        def rank(file):
            key = LEGACY_STAGE.get(file['etapa'], file['etapa'])
            return (bool(file['favorito']), stage_rank.get(key, -1))
        # La referencia es el favorito de la etapa más avanzada; si no hay, el último audio registrado.
        best = max(files, key=rank) if any(f['favorito'] for f in files) else (files[0] if files else None)
        index = reached.get(song['id'], -1)
        song.update(
            pista=details.get('pista'), bpm=details.get('bpm', ''), tonalidad=details.get('tonalidad', ''),
            etapa=WORK_STAGES[index] if index >= 0 else '', etapa_indice=index,
            referencia=(best['etiqueta'] or Path(best['nombre']).stem) if best else '',
            referencia_favorita=bool(best and best['favorito']),
            referencia_id=best['id'] if best else '',
            duracion=clock(wav_seconds(best['ruta'])) if best else '',
            pendientes=pending.get(song['id'], 0))
        out.append(song)
    return out


def register_overview(app, connect):
    @app.get('/api/inicio')
    def home_summary():
        with connect() as db:
            songs = song_summaries(db)
            covers = {}
            for row in db.execute('SELECT id,datos FROM detalle_disco'):
                covers[row['id']] = json.loads(row['datos'] or '{}')
            recent = sorted([s for s in songs if s['actualizado']], key=lambda s: s['actualizado'], reverse=True)[:6]
            for song in recent:
                song['portada'] = covers.get(song['disco_id'], {}).get('portada', '')
            pipeline = []
            for index, key in enumerate(WORK_STAGES):
                inside = [s for s in songs if s['etapa_indice'] == index]
                inside.sort(key=lambda s: s['actualizado'] or '', reverse=True)
                pipeline.append(dict(etapa=key, total=len(inside),
                                     canciones=[dict(id=s['id'], titulo=s['titulo']) for s in inside[:4]]))
            feedback = [dict(row) for row in db.execute('''SELECT f.id,f.cancion_id,f.archivo_id,f.etiqueta,f.texto,
                f.segundo,f.estado,f.creado,c.titulo,a.nombre AS artista FROM portal_devoluciones f
                JOIN canciones c ON c.id=f.cancion_id JOIN artistas a ON a.id=c.artista_id
                WHERE f.estado!='Resuelta' ORDER BY f.creado DESC LIMIT 6''')]
            pending_total = db.execute("SELECT COUNT(*) FROM portal_devoluciones WHERE estado!='Resuelta'").fetchone()[0]
            albums = []
            for row in db.execute('''SELECT d.id,d.nombre,d.artista_id,a.nombre AS artista,x.actualizado
                FROM discos d JOIN artistas a ON a.id=d.artista_id LEFT JOIN detalle_disco x ON x.id=d.id
                ORDER BY x.actualizado DESC,d.rowid DESC LIMIT 8'''):
                info = covers.get(row['id'], {})
                albums.append(dict(id=row['id'], nombre=row['nombre'], artista_id=row['artista_id'], artista=row['artista'],
                                   tipo=info.get('tipo', 'Álbum'), portada=info.get('portada', '')))
            loose = sum(1 for s in songs if not s['disco_id'])
        return jsonify(recientes=recent, etapas=pipeline, devoluciones=feedback, devoluciones_total=pending_total,
                       discos=albums, sueltas=loose, canciones_activas=sum(1 for s in songs if s['etapa_indice'] >= 0))

    @app.get('/api/discos/<did>/resumen')
    def album_summary(did):
        with connect() as db:
            required_row(db, 'discos', did)
            songs = song_summaries(db, 'WHERE c.disco_id=?', (did,))
        songs.sort(key=lambda s: (s['pista'] is None, s['pista'] or 0, s['titulo'].casefold()))
        return jsonify(songs)

    @app.post('/api/produccion/<sid>/trasladar')
    def move_between_stages(sid):
        data = request.get_json() or {}
        kind, identity, target, copy = data.get('tipo'), data.get('id'), data.get('etapa'), bool(data.get('copiar'))
        if kind not in ('archivo', 'sesion') or not isinstance(identity, str) or target not in WORK_STAGES:
            raise ValueError('Indicá qué elemento trasladar y una etapa de destino válida.')
        created = None
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            song = required_row(db, 'canciones', sid)
            stage = db.execute('SELECT * FROM etapas WHERE clave=?', (target,)).fetchone()
            row = required_row(db, 'archivos' if kind == 'archivo' else 'sesiones', identity)
            if row['cancion_id'] != sid:
                raise ValueError('El elemento no pertenece a esta canción.')
            origin = LEGACY_STAGE.get(row['etapa'], row['etapa'])
            if origin == target and not copy:
                return jsonify(ok=True, id=identity)
            if kind == 'archivo':
                created = _file(db, song, stage, row, origin, copy)
            else:
                created = _session(db, song, stage, row, origin, copy)
        return jsonify(ok=True, id=created or identity), 201 if created else 200


def _event(db, sid, stage, kind, reference, detail):
    db.execute('INSERT INTO eventos(id,cancion_id,etapa,tipo,referencia,detalle) VALUES(?,?,?,?,?,?)',
               (uuid.uuid4().hex, sid, stage, kind, reference, detail))
    db.execute("""INSERT INTO estado_cancion(id) VALUES(?) ON CONFLICT(id)
                  DO UPDATE SET actualizado=CURRENT_TIMESTAMP""", (sid,))


def _managed(song, stage):
    root = Path(song['carpeta']).resolve()
    target = root / stage['carpeta'] / 'Adjuntos'
    if not target.resolve().is_relative_to(root):
        raise ValueError('La carpeta administrada apunta fuera de la canción.')
    return target


def _file(db, song, stage, row, origin, copy):
    target = stage['clave']
    if not copy:
        # La sesión de origen pertenece a la otra etapa: el archivo queda sin sesión asociada.
        db.execute('UPDATE archivos SET etapa=?,sesion_id=NULL WHERE id=?', (target, row['id']))
        _event(db, song['id'], target, 'Archivo movido de etapa', row['id'], f'{row["nombre"]}: {origin} → {target}')
        return None
    new_id = uuid.uuid4().hex
    if row['modo'] == 'vinculado':
        exists = db.execute('SELECT id FROM archivos WHERE cancion_id=? AND etapa=? AND ruta=?',
                            (song['id'], target, row['ruta'])).fetchone()
        if exists:
            raise ValueError('Ese archivo ya está vinculado en la etapa de destino.')
        db.execute('INSERT INTO archivos(id,cancion_id,etapa,sesion_id,nombre,ruta,modo) VALUES(?,?,?,?,?,?,?)',
                   (new_id, song['id'], target, None, row['nombre'], row['ruta'], 'vinculado'))
    else:
        source = Path(row['ruta'])
        if not source.is_file():
            raise ValueError('El archivo original no está disponible para copiarlo.')
        folder = _managed(song, stage)
        folder.mkdir(parents=True, exist_ok=True)
        destination = folder / (new_id + '-' + re.sub(r'[<>:"/\\|?*]', '', row['nombre'])[:150])
        copy_exclusive(source, destination)
        try:
            db.execute('INSERT INTO archivos(id,cancion_id,etapa,sesion_id,nombre,ruta,modo) VALUES(?,?,?,?,?,?,?)',
                       (new_id, song['id'], target, None, row['nombre'], str(destination), 'importado'))
        except Exception:
            destination.unlink(missing_ok=True)
            raise
    _event(db, song['id'], target, 'Archivo copiado desde otra etapa', new_id, f'{row["nombre"]}: {origin} → {target}')
    return new_id


def _session(db, song, stage, row, origin, copy):
    from production import DAW_PROJECTS
    target = stage['clave']
    name = db.execute('SELECT nombre FROM sesion_info WHERE id=?', (row['id'],)).fetchone()
    label = name['nombre'] if name else Path(row['ruta']).stem
    if not copy:
        db.execute('UPDATE sesiones SET etapa=? WHERE id=?', (target, row['id']))
        # Sus archivos asociados viajan con ella; la marca de vigente y el número de versión se recalculan.
        db.execute('UPDATE archivos SET etapa=? WHERE sesion_id=?', (target, row['id']))
        db.execute('DELETE FROM sesion_vigente WHERE sesion_id=?', (row['id'],))
        db.execute('DELETE FROM revision_sesion WHERE sesion_id=?', (row['id'],))
        ensure_revisions(db, song['id'])
        _event(db, song['id'], target, 'Sesión movida de etapa', row['id'], f'{label}: {origin} → {target}')
        return None
    source = Path(row['ruta'])
    if not source.is_file() or source.suffix.lower() not in DAW_PROJECTS:
        raise ValueError('Solo se puede copiar una sesión con archivo de proyecto DAW disponible. Podés moverla.')
    ensure_revisions(db, song['id'])
    group = group_key(song['id'], target, source)
    number = db.execute('SELECT COALESCE(MAX(numero),0)+1 FROM revision_sesion WHERE grupo=?', (group,)).fetchone()[0]
    base = re.sub(r'(?i)[ _-]V\d+$', '', source.stem).strip() or source.stem
    destination = None
    while destination is None:
        candidate = source.with_name(f'{base}_V{number:03d}{source.suffix}')
        try:
            copy_exclusive(source, candidate)
            destination = candidate
        except FileExistsError:
            number += 1
    try:
        new_id = uuid.uuid4().hex
        db.execute('INSERT INTO sesiones(id,cancion_id,etapa,daw,ruta,comentario) VALUES(?,?,?,?,?,?)',
                   (new_id, song['id'], target, row['daw'], str(destination), f'Copia de {label} ({origin}).'))
        db.execute('INSERT INTO sesion_info(id,nombre,modo) VALUES(?,?,?)', (new_id, destination.stem, 'vinculada'))
        date, criterion = file_date(destination)
        db.execute('INSERT INTO revision_sesion VALUES(?,?,?,?,?,?)', (new_id, number, group, row['id'], date, criterion))
        db.execute('INSERT INTO versiones(id,sesion_id,ruta,comentario) VALUES(?,?,?,?)',
                   (new_id, row['id'], str(destination), f'Copiada a {target}'))
        _event(db, song['id'], target, 'Sesión copiada a otra etapa', new_id, f'{source} → {destination}')
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return new_id
