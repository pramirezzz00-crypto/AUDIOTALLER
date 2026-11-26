"""Rediseño 0.3: Producciones, Disco, Créditos y Exportar metadata.

Los datos nuevos viven en `rediseno_datos` (documentos JSON por tipo) y en las
tablas de registro existentes (obra, grabación, lanzamiento). Nada se borra.
"""
import json
import queue
import re
import threading
from pathlib import Path
from flask import jsonify, request, send_file
from management import required_row
from overview import song_summaries, WORK_STAGES
from publication import clean_fields, RECORDING_FIELDS

STATES = ('Borrador', 'En producción', 'Finalizado', 'Lanzado', 'En pausa')
LEGACY_STATES = {'Idea': 'Borrador', 'En preproducción': 'Borrador', 'Sin estado': 'Borrador', 'Finalizada': 'Finalizado'}
AUTHOR_ROLES = ('Letra', 'Música', 'Letra y música')


def state_of(value):
    value = value or 'En producción'
    return LEGACY_STATES.get(value, value if value in STATES else 'En producción')


def album_state(details, songs):
    if details.get('estado') in STATES:
        return details['estado']
    states = {state_of(s.get('estado')) for s in songs}
    if not states:
        return 'Borrador'
    for candidate in ('En producción', 'Borrador', 'En pausa'):
        if candidate in states:
            return candidate
    return 'Lanzado' if states == {'Lanzado'} else 'Finalizado'


def doc_get(db, kind, identity, default=None):
    row = db.execute('SELECT datos FROM rediseno_datos WHERE tipo=? AND id=?', (kind, identity)).fetchone()
    return json.loads(row['datos']) if row else (default if default is not None else {})


def doc_put(db, kind, identity, data):
    db.execute('''INSERT INTO rediseno_datos(tipo,id,datos) VALUES(?,?,?) ON CONFLICT(tipo,id)
        DO UPDATE SET datos=excluded.datos, actualizado=CURRENT_TIMESTAMP''', (kind, identity, json.dumps(data, ensure_ascii=False)))


def doc_list(db, kind):
    return {row['id']: json.loads(row['datos']) for row in db.execute('SELECT id,datos FROM rediseno_datos WHERE tipo=?', (kind,))}


def short_text(value, maximum=300):
    if value is None:
        return ''
    if not isinstance(value, (str, int, float)) or len(str(value)) > maximum:
        raise ValueError('Dato inválido o demasiado extenso.')
    return str(value).strip()


def clean_people(values, fields, maximum=60):
    if not isinstance(values, list) or len(values) > maximum:
        raise ValueError('Lista de personas inválida.')
    out = []
    for item in values:
        if not isinstance(item, dict):
            raise ValueError('Persona inválida.')
        row = {key: short_text(item.get(key, '')) for key in fields}
        if any(row.values()):
            out.append(row)
    return out


# ── Medición de sonoridad en segundo plano ──
class Meter:
    def __init__(self, connect):
        self.connect, self.jobs, self.busy, self.lock = connect, queue.Queue(), set(), threading.Lock()
        self.thread = None

    def request(self, file_id, path):
        with self.lock:
            if file_id in self.busy:
                return
            self.busy.add(file_id)
        self.jobs.put((file_id, path))
        if not self.thread or not self.thread.is_alive():
            self.thread = threading.Thread(target=self.work, daemon=True)
            self.thread.start()

    def work(self):
        from loudness import measure
        while True:
            try:
                file_id, path = self.jobs.get(timeout=5)
            except queue.Empty:
                return
            try:
                stat = Path(path).stat()
                result = measure(path)
                result.update(firma=f'{stat.st_size}:{stat.st_mtime_ns}')
            except Exception as error:
                result = dict(error=str(error)[:200])
            try:
                with self.connect() as db:
                    doc_put(db, 'medida', file_id, result)
            finally:
                with self.lock:
                    self.busy.discard(file_id)


def measurement(db, meter, file_id, path):
    if not path or not path.lower().endswith('.wav'):
        ext = Path(path or '').suffix.upper().lstrip('.')
        return dict(estado='no-wav', formato=ext)
    try:
        stat = Path(path).stat()
    except OSError:
        return dict(estado='no-disponible')
    cached = doc_get(db, 'medida', file_id)
    if cached and cached.get('firma') == f'{stat.st_size}:{stat.st_mtime_ns}':
        return dict(cached, estado='error' if cached.get('error') else 'ok')
    meter.request(file_id, path)
    return dict(estado='midiendo')


def credits_bundle(db, sid):
    song = dict(required_row(db, 'canciones', sid))
    obra = json.loads((db.execute('SELECT datos FROM registro_obra WHERE id=?', (sid,)).fetchone() or {'datos': '{}'})['datos'])
    recordings = [dict(json.loads(r['datos']), id=r['id']) for r in db.execute(
        'SELECT * FROM registro_grabacion WHERE cancion_id=? ORDER BY rowid', (sid,))]
    data = doc_get(db, 'creditos', sid, {})
    legacy = [dict(r) for r in db.execute('''SELECT cr.rol,a.nombre FROM creditos cr JOIN artistas a ON a.id=cr.persona_id
        WHERE cr.cancion_id=? OR cr.disco_id=?''', (sid, song['disco_id'] or '-'))]
    ficha = json.loads((db.execute('SELECT datos FROM ficha_cancion WHERE id=?', (sid,)).fetchone() or {'datos': '{}'})['datos'])
    details = json.loads((db.execute('SELECT datos FROM detalle_cancion WHERE id=?', (sid,)).fetchone() or {'datos': '{}'})['datos'])
    state = db.execute('SELECT estado FROM estado_cancion WHERE id=?', (sid,)).fetchone()
    if not data and legacy:
        # Primera vez: se sugieren las personas ya cargadas como «Artistas y músicos».
        data = dict(interpretes=[dict(nombre=r['nombre'], instrumento=r['rol'], aadi='') for r in legacy])
    authors = data.get('autores', [])
    total = round(sum(float(a.get('porcentaje') or 0) for a in authors), 2)
    recording = recordings[0] if recordings else {}
    missing = []
    if not obra.get('iswc'):
        missing.append('ISWC')
    if not recording.get('isrc'):
        missing.append('ISRC')
    if not authors:
        missing.append('autoría')
    elif abs(total - 100) > 0.01:
        missing.append('reparto distinto de 100 %')
    for role in ('Mezcla', 'Mastering'):
        if not any(t.get('rol') == role and t.get('nombre') for t in data.get('tecnica', [])):
            missing.append('crédito de ' + role.lower())
    return dict(id=sid, titulo=song['titulo'], disco_id=song['disco_id'], pista=details.get('pista'),
                duracion=details.get('duracion', ''), estado=state_of(state['estado'] if state else ''),
                iswc=obra.get('iswc', ''), isrc=recording.get('isrc', ''), grabacion_id=recording.get('id', ''),
                idioma=obra.get('idioma', ''), genero=obra.get('genero', ''), explicito=recording.get('explicito', ''),
                letra=ficha.get('letra', ''), autores=authors, interpretes=data.get('interpretes', []),
                produccion=data.get('produccion', []), tecnica=data.get('tecnica', []), total_autoria=total, faltan=missing)



def export_data(db, scope, identity):
    if scope == 'disco':
        album = dict(required_row(db, 'discos', identity))
        ids = [r['id'] for r in db.execute('SELECT id FROM canciones WHERE disco_id=?', (identity,))]
        details = json.loads((db.execute('SELECT datos FROM detalle_disco WHERE id=?', (identity,)).fetchone() or {'datos': '{}'})['datos'])
        release = json.loads((db.execute('SELECT datos FROM registro_lanzamiento WHERE id=?', (identity,)).fetchone() or {'datos': '{}'})['datos'])
        title, kind, folder, artist_id = album['nombre'], details.get('tipo', 'Álbum'), album['carpeta'], album['artista_id']
        art = doc_get(db, 'arte', identity, {})
    else:
        song = dict(required_row(db, 'canciones', identity))
        ids = [identity]
        release, details, art = {}, {}, {}
        if song['disco_id']:
            release = json.loads((db.execute('SELECT datos FROM registro_lanzamiento WHERE id=?', (song['disco_id'],)).fetchone() or {'datos': '{}'})['datos'])
        title, kind, folder, artist_id = song['titulo'], 'Single', song['carpeta'], song['artista_id']
    artist = required_row(db, 'artistas', artist_id)['nombre']
    songs = sorted([credits_bundle(db, sid) for sid in ids], key=lambda s: (s['pista'] is None, s['pista'] or 0, s['titulo']))
    refs = {s['id']: s for s in song_summaries(db, 'WHERE c.id IN (%s)' % ','.join('?' * len(ids)), ids)} if ids else {}
    for index, song in enumerate(songs, 1):
        song['n'] = song['pista'] or index
        ref = refs.get(song['id'], {})
        song['duracion'] = song['duracion'] or ref.get('duracion', '')
        master = db.execute('''SELECT f.nombre FROM archivos f WHERE f.cancion_id=? AND f.etapa='mastering' AND f.eliminado_en=''
            ORDER BY f.creado DESC LIMIT 1''', (song['id'],)).fetchone()
        song['master'] = master['nombre'] if master else ''
    return dict(titulo=title, tipo=kind, artista=artist, carpeta=folder, lanzamiento=release, arte=art,
                portada=bool(details.get('portada')), canciones=songs)



def export_bundle_for_song(db, sid):
    return export_data(db, 'cancion', sid)


def register_redesign(app, connect):
    meter = Meter(connect)
    app.config['AT_METER'] = meter

    # ── Producciones ──
    @app.get('/api/producciones')
    def rd_productions():
        with connect() as db:
            songs = song_summaries(db)
            details = {row['id']: json.loads(row['datos'] or '{}') for row in db.execute('SELECT id,datos FROM detalle_disco')}
            releases = {row['id']: json.loads(row['datos'] or '{}') for row in db.execute('SELECT id,datos FROM registro_lanzamiento')}
            campaigns = doc_list(db, 'campana')
            videos = doc_list(db, 'audiovisual')
            albums = [dict(row) for row in db.execute('''SELECT d.id,d.nombre,d.artista_id,a.nombre AS artista,x.actualizado
                FROM discos d JOIN artistas a ON a.id=d.artista_id LEFT JOIN detalle_disco x ON x.id=d.id
                WHERE NOT EXISTS (SELECT 1 FROM entidades_papelera p WHERE (p.tipo='artista' AND p.id=a.id) OR (p.tipo='disco' AND p.id=d.id))''')]
        with_video = {song for v in videos.values() for song in v.get('canciones', [])}
        for song in songs:
            song['estado'] = state_of(song.get('estado'))
            song['video'] = song['id'] in with_video
        out = []
        for album in albums:
            info = details.get(album['id'], {})
            inside = sorted([s for s in songs if s['disco_id'] == album['id']], key=lambda s: (s['pista'] is None, s['pista'] or 0))
            campaign = next((dict(id=k, nombre=c.get('nombre', ''), fecha=c.get('fecha', '')) for k, c in campaigns.items()
                             if c.get('disco_id') == album['id']), None)
            out.append(dict(album, tipo='disco', formato=info.get('tipo', 'Álbum'), portada=info.get('portada', ''),
                            estado=album_state(info, inside), canciones=inside, campana=campaign,
                            fecha=(campaign or {}).get('fecha') or releases.get(album['id'], {}).get('fecha_lanzamiento', ''),
                            actualizado=max([s['actualizado'] or '' for s in inside] + [album['actualizado'] or '']),
                            video=any(s['video'] for s in inside), pendientes=sum(s['pendientes'] for s in inside)))
        for song in songs:
            if not song['disco_id']:
                out.append(dict(id=song['id'], nombre=song['titulo'], artista=song['artista'], artista_id=song['artista_id'],
                                tipo='cancion', formato='Canción suelta', portada='', estado=song['estado'], canciones=[song],
                                actualizado=song['actualizado'] or '', video=song['video'], pendientes=song['pendientes'],
                                campana=None, fecha=''))
        return jsonify(out)

    @app.post('/api/discos/<did>/estado')
    def rd_album_state_save(did):
        state = (request.get_json() or {}).get('estado')
        if state not in STATES and state != '':
            raise ValueError('Estado inválido.')
        with connect() as db:
            required_row(db, 'discos', did)
            row = db.execute('SELECT datos FROM detalle_disco WHERE id=?', (did,)).fetchone()
            data = json.loads(row['datos']) if row else {}
            if state:
                data['estado'] = state
            else:
                data.pop('estado', None)
            db.execute('''INSERT INTO detalle_disco(id,datos) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos,
                actualizado=CURRENT_TIMESTAMP''', (did, json.dumps(data, ensure_ascii=False)))
        return jsonify(ok=True)

    # ── Disco: medidas técnicas de la versión de referencia ──
    @app.get('/api/discos/<did>/medidas')
    def rd_album_measures(did):
        with connect() as db:
            required_row(db, 'discos', did)
            songs = song_summaries(db, 'WHERE c.disco_id=?', (did,))
            result = {}
            for song in songs:
                if not song['referencia_id']:
                    continue
                path = db.execute('SELECT ruta FROM archivos WHERE id=?', (song['referencia_id'],)).fetchone()['ruta']
                result[song['id']] = dict(measurement(db, meter, song['referencia_id'], path), archivo_id=song['referencia_id'])
        return jsonify(result)

    @app.get('/api/archivos/<fid>/medida')
    def rd_file_measure(fid):
        with connect() as db:
            row = required_row(db, 'archivos', fid)
            return jsonify(measurement(db, meter, fid, row['ruta']))

    # ── Créditos ──
    @app.get('/api/creditos/<sid>')
    def rd_credits_get(sid):
        with connect() as db:
            return jsonify(credits_bundle(db, sid))

    @app.post('/api/creditos/<sid>')
    def rd_credits_save(sid):
        data = request.get_json() or {}
        authors = clean_people(data.get('autores', []), ('nombre', 'rol', 'porcentaje', 'sociedad', 'ipi'))
        for author in authors:
            if author['rol'] and author['rol'] not in AUTHOR_ROLES:
                raise ValueError('Rol de autoría inválido.')
            try:
                value = float(str(author['porcentaje'] or 0).replace(',', '.'))
            except ValueError:
                raise ValueError('El porcentaje debe ser un número.')
            if not 0 <= value <= 100:
                raise ValueError('Cada porcentaje debe estar entre 0 y 100.')
            author['porcentaje'] = value
        doc = dict(autores=authors,
                   interpretes=clean_people(data.get('interpretes', []), ('nombre', 'instrumento', 'aadi')),
                   produccion=clean_people(data.get('produccion', []), ('nombre', 'rol')),
                   tecnica=clean_people(data.get('tecnica', []), ('rol', 'nombre', 'estudio')))
        with connect() as db:
            required_row(db, 'canciones', sid)
            doc_put(db, 'creditos', sid, doc)
            obra_row = db.execute('SELECT datos FROM registro_obra WHERE id=?', (sid,)).fetchone()
            obra = json.loads(obra_row['datos']) if obra_row else {}
            for key in ('iswc', 'idioma', 'genero'):
                if key in data:
                    obra[key] = short_text(data[key], 100)
            obra = dict(obra, **clean_fields({k: obra.get(k, '') for k in ('iswc',)}, ('iswc',)))
            db.execute('INSERT INTO registro_obra VALUES(?,?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos',
                       (sid, json.dumps(obra, ensure_ascii=False)))
            if 'isrc' in data or 'explicito' in data:
                row = db.execute('SELECT id,datos FROM registro_grabacion WHERE cancion_id=? ORDER BY rowid LIMIT 1', (sid,)).fetchone()
                rec = json.loads(row['datos']) if row else dict(nombre='Versión principal')
                rec['isrc'] = short_text(data.get('isrc', rec.get('isrc', '')), 20)
                rec['explicito'] = short_text(data.get('explicito', rec.get('explicito', '')), 20)
                rec = dict(rec, **clean_fields({k: rec.get(k, '') for k in RECORDING_FIELDS}, RECORDING_FIELDS))
                if row:
                    db.execute('UPDATE registro_grabacion SET datos=? WHERE id=?', (json.dumps(rec, ensure_ascii=False), row['id']))
                else:
                    import uuid
                    db.execute('INSERT INTO registro_grabacion VALUES(?,?,?)', (uuid.uuid4().hex, sid, json.dumps(rec, ensure_ascii=False)))
            return jsonify(credits_bundle(db, sid))

    @app.get('/api/discos/<did>/creditos')
    def rd_album_credits(did):
        with connect() as db:
            album = dict(required_row(db, 'discos', did))
            ids = [r['id'] for r in db.execute('SELECT c.id FROM canciones c LEFT JOIN detalle_cancion x ON x.id=c.id WHERE c.disco_id=?', (did,))]
            songs = sorted([credits_bundle(db, sid) for sid in ids], key=lambda s: (s['pista'] is None, s['pista'] or 0, s['titulo']))
            art = doc_get(db, 'arte', did, {})
            release = json.loads((db.execute('SELECT datos FROM registro_lanzamiento WHERE id=?', (did,)).fetchone() or {'datos': '{}'})['datos'])
            details = json.loads((db.execute('SELECT datos FROM detalle_disco WHERE id=?', (did,)).fetchone() or {'datos': '{}'})['datos'])
            artist = required_row(db, 'artistas', album['artista_id'])['nombre']
        return jsonify(disco=dict(album, artista=artist, tipo=details.get('tipo', 'Álbum'), portada=details.get('portada', ''),
                                  lanzamiento=release), canciones=songs, arte=art)

    @app.post('/api/discos/<did>/creditos/tecnica')
    def rd_album_apply_technical(did):
        """«Aplicar a todo el disco»: copia un rol técnico a todas las canciones sin pisar otros roles."""
        data = request.get_json() or {}
        role, name, studio = short_text(data.get('rol'), 80), short_text(data.get('nombre'), 150), short_text(data.get('estudio', ''), 150)
        if not role or not name:
            raise ValueError('Indicá el rol y la persona.')
        with connect() as db:
            required_row(db, 'discos', did)
            for row in db.execute('SELECT id FROM canciones WHERE disco_id=?', (did,)).fetchall():
                doc = doc_get(db, 'creditos', row['id'], {})
                tech = [t for t in doc.get('tecnica', []) if t.get('rol') != role] + [dict(rol=role, nombre=name, estudio=studio)]
                doc['tecnica'] = tech
                doc_put(db, 'creditos', row['id'], doc)
        return jsonify(ok=True)

    @app.post('/api/discos/<did>/arte')
    def rd_album_art(did):
        data = request.get_json() or {}
        fields = ('autor', 'licencia', 'pago', 'porcentaje', 'monto', 'vigencia', 'contrato', 'notas', 'archivo')
        doc = {key: short_text(data.get(key, ''), 2000) for key in fields}
        if doc['licencia'] and doc['licencia'] not in ('Cesión total', 'Licencia exclusiva', 'Licencia no exclusiva', 'Creative Commons', 'Propia'):
            raise ValueError('Tipo de licencia inválido.')
        if doc['pago'] and doc['pago'] not in ('Pago único', 'Porcentaje de regalías', 'Sin pago'):
            raise ValueError('Forma de pago inválida.')
        with connect() as db:
            required_row(db, 'discos', did)
            doc_put(db, 'arte', did, doc)
        return jsonify(ok=True)

    @app.post('/api/discos/<did>/lanzamiento')
    def rd_album_release(did):
        data = request.get_json() or {}
        keys = ('upc_ean', 'sello', 'catalogo', 'distribuidora', 'fecha_lanzamiento', 'territorios', 'copyright', 'notas')
        with connect() as db:
            required_row(db, 'discos', did)
            row = db.execute('SELECT datos FROM registro_lanzamiento WHERE id=?', (did,)).fetchone()
            current = json.loads(row['datos']) if row else {}
            current.update({k: data[k] for k in keys if k in data})
            current = clean_fields({k: current.get(k, '') for k in keys}, keys)
            db.execute('INSERT INTO registro_lanzamiento VALUES(?,?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos',
                       (did, json.dumps(current, ensure_ascii=False)))
        return jsonify(ok=True)

    # ── Exportar metadata ──
    @app.get('/api/exportar/vista')
    def rd_export_preview():
        scope, identity = request.args.get('alcance', 'disco'), request.args.get('id', '')
        if scope not in ('disco', 'cancion'):
            raise ValueError('Alcance inválido.')
        with connect() as db:
            data = export_data(db, scope, identity)
        data.pop('carpeta', None)
        return jsonify(data)

    @app.get('/api/exportar/archivo')
    def rd_export_file():
        import io
        from metadata_export import build
        args = request.args
        scope, identity, fmt = args.get('alcance', 'disco'), args.get('id', ''), args.get('formato', 'xlsx')
        options = dict(destino=args.get('destino', 'generica'), logo=args.get('logo') == '1', letras=args.get('letras') == '1')
        with connect() as db:
            data = export_data(db, scope, identity)
        name, payload, mime = build(data, fmt, options)
        if args.get('guardar') == '1':
            folder = Path(data['carpeta']) / 'Entregas'
            folder.mkdir(parents=True, exist_ok=True)
            target = folder / name
            n = 2
            while target.exists():
                target = folder / f'{Path(name).stem}_{n}{Path(name).suffix}'
                n += 1
            target.write_bytes(payload)
            return jsonify(ok=True, ruta=str(target), nombre=target.name)
        return send_file(io.BytesIO(payload), mimetype=mime, as_attachment=True, download_name=name)
