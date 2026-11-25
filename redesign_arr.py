"""Rediseño 0.3: Arreglos y sesiones por buses.

- Versiones del arreglo: conjuntos de pistas crudas para escuchar y comparar.
- Perfiles de buses: reglas por palabra clave (editable y con aprendizaje).
- Crear la sesión del DAW como proyecto NUEVO (REAPER .rpp o DAWproject para
  Cubase 14.0.20+, Studio One y Bitwig). La sesión original no se toca y la
  nueva se registra como versión adicional de la etapa.
"""
import json
import re
import sys
import uuid
import wave
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr
from flask import jsonify, request
from management import required_row
from redesign import doc_get, doc_put, doc_list, short_text

DEFAULT_PROFILE = dict(nombre='Mezcla (predeterminado)', buses=[
    dict(nombre='Batería', color='#FF6B8B', palabras=['kick', 'bombo', 'bd', 'snare', 'sn', 'tambor', 'redo', 'hat', 'hh', 'hihat', 'tom', 'oh', 'overhead', 'room', 'ride', 'crash', 'drum', 'bateria', 'batería']),
    dict(nombre='Percusión', color='#FFB547', palabras=['perc', 'shaker', 'conga', 'bongo', 'pandero', 'cajon', 'cajón', 'clap', 'tamb']),
    dict(nombre='Bajo', color='#9B8CFF', palabras=['bajo', 'bass', 'contrabajo', 'sub']),
    dict(nombre='Guitarras', color='#5ED17E', palabras=['gtr', 'guit', 'guitarra', 'guitar', 'acust', 'acustica', 'eléctrica', 'electrica', 'charango']),
    dict(nombre='Teclados', color='#5AA7FF', palabras=['piano', 'keys', 'rhodes', 'synth', 'sinte', 'organo', 'órgano', 'pad', 'wurli']),
    dict(nombre='Cuerdas', color='#2FD8BF', palabras=['violin', 'violín', 'viola', 'cello', 'chelo', 'strings', 'cuerdas', 'vn']),
    dict(nombre='Vientos', color='#E5A35A', palabras=['brass', 'trompeta', 'trumpet', 'saxo', 'sax', 'trombon', 'trombón', 'flauta', 'flute', 'clarinete']),
    dict(nombre='Coros', color='#C9A7FF', palabras=['coro', 'coros', 'bvs', 'bv', 'backing', 'armonia', 'armonía', 'dobles']),
    dict(nombre='Voces', color='#FF8FA3', palabras=['vox', 'voz', 'lead', 'vocal', 'vocals', 'canto']),
], aprendidas={})


def tokens():
    return sys.modules['app'].take_tokens


def path_from_token(token):
    path = Path(tokens().loads(token))
    if not path.is_file():
        raise ValueError('Una de las pistas ya no está disponible.')
    return path


def words_of(name):
    return [w for w in re.split(r'[^a-z0-9áéíóúñ]+', Path(name).stem.lower()) if w]


def classify(name, profile):
    """Devuelve (bus, palabra que lo decidió). Primero lo aprendido, después las reglas del perfil."""
    words = words_of(name)
    stem = Path(name).stem.lower()
    for word in words:
        if word in profile.get('aprendidas', {}):
            return profile['aprendidas'][word], word
    for bus in profile['buses']:
        for keyword in bus['palabras']:
            if keyword in words or (len(keyword) > 3 and keyword in stem):
                return bus['nombre'], keyword
    return '', ''


def pair_info(name):
    stem = Path(name).stem.lower()
    if re.search(r'([_ .-])(l|left|izq)$', stem):
        return 'L'
    if re.search(r'([_ .-])(r|right|der)$', stem):
        return 'R'
    if re.search(r'\b(di)\b', stem.replace('_', ' ')):
        return 'DI'
    if re.search(r'\b(amp|ampli)\b', stem.replace('_', ' ')):
        return 'Amp'
    return ''


def audio_length(path):
    try:
        with wave.open(str(path), 'rb') as audio:
            return audio.getnframes() / audio.getframerate(), audio.getframerate(), audio.getnchannels()
    except Exception:
        return 0.0, 48000, 2


def reaper_color(hex_color):
    value = hex_color.lstrip('#')
    r, g, b = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    return 0x1000000 | (b << 16) | (g << 8) | r


def write_rpp(target, groups, tempo=120):
    """REAPER: una carpeta (bus) por grupo con sus pistas adentro; ítems en 0:00 sin efectos."""
    lines = [f'<REAPER_PROJECT 0.1 "7.0" 0', f'  TEMPO {tempo} 4 4', '  MASTER_NCH 2 2']
    for bus, color, items in groups:
        lines += ['  <TRACK', f'    NAME {json.dumps(bus, ensure_ascii=False)}', f'    PEAKCOL {reaper_color(color)}', '    ISBUS 1 1', '  >']
        for index, (path, name) in enumerate(items):
            length = audio_length(path)[0] or 1
            closing = '    ISBUS 2 -1' if index == len(items) - 1 else '    ISBUS 0 0'
            lines += ['  <TRACK', f'    NAME {json.dumps(name, ensure_ascii=False)}', f'    PEAKCOL {reaper_color(color)}', closing,
                      '    <ITEM', '      POSITION 0', f'      LENGTH {length:.6f}', f'      NAME {json.dumps(Path(path).name, ensure_ascii=False)}',
                      '      <SOURCE WAVE', f'        FILE {json.dumps(str(path), ensure_ascii=False)}', '      >', '    >', '  >']
    lines.append('>')
    target.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def write_dawproject(target, groups, title, tempo=120):
    """DAWproject 1.0: pistas de grupo (submix) con sus pistas de audio y clips que apuntan a los WAV originales."""
    ids = iter(range(1, 100000))
    nid = lambda prefix: f'{prefix}{next(ids)}'
    structure, lanes = [], []
    master = nid('id')
    for bus, color, items in groups:
        group_id, group_channel = nid('id'), nid('id')
        children = []
        for path, name in items:
            seconds, rate, channels = audio_length(path)
            track_id, channel_id = nid('id'), nid('id')
            children.append(f'<Track contentType="audio" loaded="true" id="{track_id}" name={quoteattr(name)} color="{color}">'
                            f'<Channel audioChannels="{channels}" destination="{group_channel}" role="regular" solo="false" id="{channel_id}">'
                            f'<Mute value="false" id="{nid("id")}" name="Mute"/><Pan max="1.0" min="0.0" unit="normalized" value="0.5" id="{nid("id")}" name="Pan"/>'
                            f'<Volume max="2.0" min="0.0" unit="linear" value="1.0" id="{nid("id")}" name="Volume"/></Channel></Track>')
            lanes.append(f'<Lanes track="{track_id}" id="{nid("id")}"><Clips id="{nid("id")}"><Clip time="0.0" duration="{seconds:.6f}" playStart="0.0" name={quoteattr(Path(path).name)}>'
                         f'<Audio algorithm="raw" channels="{channels}" duration="{seconds:.6f}" sampleRate="{rate}" id="{nid("id")}">'
                         f'<File external="true" path={quoteattr(str(path))}/></Audio></Clip></Clips></Lanes>')
        structure.append(f'<Track contentType="audio tracks" loaded="true" id="{group_id}" name={quoteattr(bus)} color="{color}">'
                         f'<Channel audioChannels="2" destination="{master}" role="submix" solo="false" id="{group_channel}">'
                         f'<Mute value="false" id="{nid("id")}" name="Mute"/><Volume max="2.0" min="0.0" unit="linear" value="1.0" id="{nid("id")}" name="Volume"/></Channel>'
                         + ''.join(children) + '</Track>')
    structure.append(f'<Track contentType="audio notes" loaded="true" id="{nid("id")}" name="Master"><Channel audioChannels="2" role="master" solo="false" id="{master}">'
                     f'<Volume max="2.0" min="0.0" unit="linear" value="1.0" id="{nid("id")}" name="Volume"/></Channel></Track>')
    project = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project version="1.0">'
               '<Application name="AudioTaller" version="0.3"/>'
               f'<Transport><Tempo max="999.0" min="20.0" unit="bpm" value="{tempo}" id="{nid("id")}" name="Tempo"/>'
               f'<TimeSignature denominator="4" numerator="4" id="{nid("id")}"/></Transport>'
               f'<Structure>{"".join(structure)}</Structure>'
               f'<Arrangement id="{nid("id")}"><Lanes timeUnit="seconds" id="{nid("id")}">{"".join(lanes)}</Lanes></Arrangement>'
               '<Scenes/></Project>')
    metadata = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<MetaData>'
                f'<Title>{escape(title)}</Title><Comment>Creado por AudioTaller a partir del arreglo. Pistas crudas sin efectos.</Comment></MetaData>')
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as package:
        package.writestr('project.xml', project)
        package.writestr('metadata.xml', metadata)


def register_arrangements_redesign(app, connect):
    def profiles(db):
        stored = doc_list(db, 'perfil_buses')
        if not stored:
            stored = {'mezcla': DEFAULT_PROFILE}
        return stored

    @app.get('/api/buses/perfiles')
    def ra_profiles():
        with connect() as db:
            return jsonify(profiles(db))

    @app.post('/api/buses/perfiles/<pid>')
    def ra_profile_save(pid):
        if not re.fullmatch(r'[a-z0-9-]{1,40}', pid):
            raise ValueError('Identificador de perfil inválido.')
        data = request.get_json() or {}
        buses = data.get('buses', [])
        if not isinstance(buses, list) or not 0 < len(buses) <= 40:
            raise ValueError('El perfil necesita entre 1 y 40 buses.')
        clean = []
        for bus in buses:
            color = str(bus.get('color', '#8A8A94'))
            if not re.fullmatch(r'#[0-9A-Fa-f]{6}', color):
                raise ValueError('Color inválido.')
            words = [short_text(w, 30).lower() for w in bus.get('palabras', []) if short_text(w, 30)]
            clean.append(dict(nombre=short_text(bus.get('nombre', ''), 40) or 'Bus', color=color, palabras=words[:80]))
        learned = data.get('aprendidas', {})
        if not isinstance(learned, dict) or len(learned) > 500:
            raise ValueError('Palabras aprendidas inválidas.')
        with connect() as db:
            doc_put(db, 'perfil_buses', pid, dict(nombre=short_text(data.get('nombre', ''), 60) or 'Perfil', buses=clean,
                                                  aprendidas={short_text(k, 30).lower(): short_text(v, 40) for k, v in learned.items()}))
        return jsonify(ok=True)

    @app.post('/api/arreglos/<sid>/clasificar')
    def ra_classify(sid):
        data = request.get_json() or {}
        with connect() as db:
            required_row(db, 'canciones', sid)
            profile = profiles(db).get(data.get('perfil_id', 'mezcla')) or DEFAULT_PROFILE
        out = []
        for take in data.get('pistas', [])[:500]:
            name = short_text(take.get('nombre', ''), 300)
            bus, word = classify(name, profile)
            out.append(dict(token=take.get('token', ''), nombre=name, bus=bus, palabra=word, par=pair_info(name)))
        return jsonify(pistas=out, buses=[dict(nombre=b['nombre'], color=b['color']) for b in profile['buses']])

    @app.get('/api/arreglos/<sid>/versiones')
    def ra_versions(sid):
        with connect() as db:
            required_row(db, 'canciones', sid)
            doc = doc_get(db, 'arreglo', sid, {})
        versions = []
        for version in doc.get('versiones', []):
            tracks = []
            for path in version.get('pistas', []):
                if Path(path).is_file():
                    tracks.append(dict(nombre=Path(path).name, token=tokens().dumps(path)))
            versions.append(dict(nombre=version['nombre'], pistas=tracks, faltan=len(version.get('pistas', [])) - len(tracks)))
        return jsonify(versions)

    @app.post('/api/arreglos/<sid>/versiones')
    def ra_versions_save(sid):
        data = request.get_json() or {}
        name = short_text(data.get('nombre', ''), 60)
        if not name:
            raise ValueError('Poné un nombre al arreglo (p. ej. «Arreglo de cuerdas»).')
        paths = [str(path_from_token(t)) for t in data.get('pistas', [])[:300]]
        with connect() as db:
            required_row(db, 'canciones', sid)
            doc = doc_get(db, 'arreglo', sid, {})
            versions = [v for v in doc.get('versiones', []) if v['nombre'] != name]
            if data.get('borrar'):
                doc['versiones'] = versions
            else:
                doc['versiones'] = versions + [dict(nombre=name, pistas=paths)]
            doc_put(db, 'arreglo', sid, doc)
        return jsonify(ok=True)

    @app.post('/api/arreglos/<sid>/crear-sesion')
    def ra_create_session(sid):
        data = request.get_json() or {}
        daw = data.get('daw')
        if daw not in ('reaper', 'dawproject'):
            raise ValueError('Elegí REAPER o DAWproject (Cubase 14.0.20+, Studio One, Bitwig). Pro Tools requiere el SDK de scripting de Avid.')
        items = data.get('pistas', [])
        if not isinstance(items, list) or not 0 < len(items) <= 300:
            raise ValueError('Elegí las pistas del arreglo.')
        stage_key = data.get('etapa', 'mezcla')
        name = short_text(data.get('nombre', ''), 80) or 'Arreglo'
        with connect() as db:
            song = dict(required_row(db, 'canciones', sid))
            stage = db.execute('SELECT * FROM etapas WHERE clave=?', (stage_key,)).fetchone()
            if not stage:
                raise ValueError('Etapa no reconocida.')
            all_profiles = profiles(db)
            pid = data.get('perfil_id', 'mezcla')
            profile = all_profiles.get(pid) or DEFAULT_PROFILE
            colors = {b['nombre']: b['color'] for b in profile['buses']}
            order = [b['nombre'] for b in profile['buses']]
            learn = data.get('aprender', {})
            if isinstance(learn, dict) and learn:
                profile = dict(profile, aprendidas={**profile.get('aprendidas', {}), **{short_text(k, 30).lower(): short_text(v, 40) for k, v in learn.items()}})
                doc_put(db, 'perfil_buses', pid if pid in all_profiles else 'mezcla', profile)
        grouped = {}
        for item in items:
            path = path_from_token(item.get('token', ''))
            bus = short_text(item.get('bus', ''), 40) or 'Otros'
            clean = re.sub(r'[_]+', ' ', Path(path).stem).strip()
            grouped.setdefault(bus, []).append((path, clean))
        groups = sorted(grouped.items(), key=lambda kv: order.index(kv[0]) if kv[0] in order else 999)
        groups = [(bus, colors.get(bus, '#8A8A94'), sorted(tracks, key=lambda t: t[1].lower())) for bus, tracks in groups]
        folder = Path(song['carpeta']) / stage['carpeta'] / 'Sesiones AudioTaller'
        folder.mkdir(parents=True, exist_ok=True)
        base = re.sub(r'[<>:"/\\|?*]+', '', f"{song['titulo']} - {name}").strip() or 'Sesion'
        suffix = '.rpp' if daw == 'reaper' else '.dawproject'
        number = 1
        while (folder / f'{base}_V{number:03d}{suffix}').exists():
            number += 1
        target = folder / f'{base}_V{number:03d}{suffix}'
        tempo = data.get('tempo') or 120
        try:
            tempo = max(20, min(400, float(tempo)))
        except (TypeError, ValueError):
            tempo = 120
        if daw == 'reaper':
            write_rpp(target, groups, tempo)
        else:
            write_dawproject(target, groups, song['titulo'], tempo)
        identity = uuid.uuid4().hex
        with connect() as db:
            db.execute('INSERT INTO sesiones(id,cancion_id,etapa,daw,ruta,comentario) VALUES(?,?,?,?,?,?)',
                       (identity, sid, stage['clave'], 'Reaper' if daw == 'reaper' else 'DAWproject', str(target),
                        f'Creada por AudioTaller desde el arreglo «{name}»: {sum(len(t) for _, _, t in groups)} pistas en {len(groups)} buses.'))
            db.execute('INSERT INTO sesion_info VALUES(?,?,?,?)', (identity, target.stem, 0, 'vinculada'))
            db.execute('INSERT INTO eventos(id,cancion_id,etapa,tipo,referencia,detalle) VALUES(?,?,?,?,?,?)',
                       (uuid.uuid4().hex, sid, stage['clave'], 'Sesión creada desde un arreglo', identity, target.name))
            db.execute('INSERT INTO estado_cancion(id) VALUES(?) ON CONFLICT(id) DO UPDATE SET actualizado=CURRENT_TIMESTAMP', (sid,))
        return jsonify(ok=True, id=identity, ruta=str(target), nombre=target.name, buses=len(groups)), 201


# ── Artistas, Catálogo y Playlists (rediseño) ──
PROJECT_TYPES = ('Solista', 'Banda', 'Dúo', 'Agrupación / colectivo', 'Ensamble / orquesta', 'Proyecto o alias')
RELATIONS = ('Del estudio', 'Cliente', 'Colaborador')
PERSON_ROLES = ('Intérprete', 'Autor/a de letra', 'Autor/a de música', 'Producción / arreglos')
PLATFORMS = ('spotify', 'apple', 'youtube', 'instagram', 'tiktok', 'bandcamp', 'soundcloud', 'web')


def register_people_redesign(app, connect):
    @app.get('/api/artistas-rediseno')
    def rp_artists():
        from overview import song_summaries
        with connect() as db:
            artists = [dict(r) for r in db.execute("""SELECT id,nombre,tipo,imagen,creado FROM artistas a
                WHERE NOT EXISTS (SELECT 1 FROM entidades_papelera p WHERE p.tipo='artista' AND p.id=a.id)
                ORDER BY nombre COLLATE NOCASE""")]
            docs = doc_list(db, 'artista')
            songs = song_summaries(db)
            albums = [dict(r) for r in db.execute("""SELECT d.id,d.nombre,d.artista_id FROM discos d
                WHERE NOT EXISTS (SELECT 1 FROM entidades_papelera p WHERE (p.tipo='artista' AND p.id=d.artista_id) OR (p.tipo='disco' AND p.id=d.id))""")]
            deleted = {(r['tipo'],r['id']) for r in db.execute('SELECT tipo,id FROM entidades_papelera')}
            videos = {key:value for key,value in doc_list(db,'audiovisual').items()
                      if ('audiovisual',key) not in deleted and ('artista',value.get('artista_id','')) not in deleted}
            profiles = {r['id']: json.loads(r['datos'] or '{}') for r in db.execute('SELECT id,datos FROM perfiles_artista')}
        out = []
        for artist in artists:
            doc = docs.get(artist['id'], {})
            mine = [s for s in songs if s['artista_id'] == artist['id']]
            people = doc.get('personas', [])
            alerts = []
            for person in people:
                roles = person.get('roles', [])
                if any(r.startswith('Autor') for r in roles) and not person.get('sadaic') and person.get('sadaic_estado') != 'No':
                    alerts.append(f"{person.get('nombre', 'Integrante')}: sin n.º de SADAIC")
                if 'Intérprete' in roles and not person.get('aadi') and person.get('aadi_estado') != 'No':
                    alerts.append(f"{person.get('nombre', 'Integrante')}: sin n.º de AADI")
            pending = sum(s['pendientes'] for s in mine)
            if pending:
                alerts.append(f'{pending} devoluciones abiertas')
            legacy = profiles.get(artist['id'], {})
            out.append(dict(artist, imagen=artist['imagen'] or '', tipo_proyecto=doc.get('tipo_proyecto') or ('Solista' if artist['tipo'] in ('Solista', 'Artista', 'Músico') else 'Banda'),
                            relacion=doc.get('relacion', 'Cliente'), personas=people, plataformas=doc.get('plataformas', {}),
                            contacto=doc.get('contacto') or dict(email=str(legacy.get('correos', '') if not isinstance(legacy.get('correos'), list) else ', '.join(legacy['correos'])),
                                                                 telefono=str(legacy.get('telefonos', ''))),
                            portal=doc.get('portal', ''), portal_activo=doc.get('portal_activo', True), genero=doc.get('genero', ''), ciudad=doc.get('ciudad', ''),
                            sello=doc.get('sello', ''), bio=doc.get('bio', ''), primer_lanzamiento=doc.get('primer_lanzamiento', False), discos=[dict(id=a['id'], nombre=a['nombre']) for a in albums if a['artista_id'] == artist['id']],
                            canciones=len(mine), videos=sum(1 for v in videos.values() if v.get('artista_id') == artist['id']),
                            alertas=alerts, completo=bool(people) and not [a for a in alerts if 'SADAIC' in a or 'AADI' in a]))
        return jsonify(out)

    @app.post('/api/artistas-rediseno/<aid>')
    def rp_artist_save(aid):
        data = request.get_json() or {}
        tipo = data.get('tipo_proyecto', 'Solista')
        relation = data.get('relacion', 'Cliente')
        if tipo not in PROJECT_TYPES or relation not in RELATIONS:
            raise ValueError('Tipo o relación inválidos.')
        people = data.get('personas', [])
        if not isinstance(people, list) or len(people) > 40:
            raise ValueError('Hasta 40 personas por proyecto.')
        clean = []
        for person in people:
            roles = [r for r in person.get('roles', []) if r in PERSON_ROLES]
            row = {k: short_text(person.get(k, ''), 150) for k in ('nombre', 'nombre_legal', 'sadaic', 'ipi', 'aadi', 'instrumentos', 'email', 'telefono', 'cuit', 'nacionalidad')}
            for key in ('sadaic_estado', 'aadi_estado'):
                value = short_text(person.get(key, ''), 20)
                row[key] = value if value in ('', 'Sí', 'No', 'En trámite', 'No sé') else ''
            if row['ipi'] and not re.fullmatch(r'\d{9,11}', row['ipi'].replace(' ', '')):
                raise ValueError('El IPI tiene 9 a 11 dígitos.')
            if row['nombre']:
                clean.append(dict(row, roles=roles))
        platforms = {k: short_text(v, 300) for k, v in (data.get('plataformas') or {}).items() if k in PLATFORMS and short_text(v, 300)}
        contact = {k: short_text((data.get('contacto') or {}).get(k, ''), 200) for k in ('email', 'telefono', 'whatsapp', 'nombre')}
        image = data.get('imagen')
        if image is not None and image != '' and (not isinstance(image, str) or len(image) > 2_800_000
                                                   or not re.fullmatch(r'data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+', image)):
            raise ValueError('La foto debe ser JPG o PNG de hasta 2 MB.')
        name = short_text(data.get('nombre', ''), 150).strip()
        with connect() as db:
            required_row(db, 'artistas', aid)
            if name:
                db.execute('UPDATE artistas SET nombre=? WHERE id=?', (name, aid))
            if image is not None:
                db.execute('UPDATE artistas SET imagen=? WHERE id=?', (image, aid))
            doc_put(db, 'artista', aid, dict(tipo_proyecto=tipo, relacion=relation, personas=clean, plataformas=platforms, contacto=contact,
                                             portal=short_text(data.get('portal', ''), 200), portal_activo=bool(data.get('portal_activo', True)),
                                             genero=short_text(data.get('genero', ''), 100), ciudad=short_text(data.get('ciudad', ''), 150),
                                             sello=short_text(data.get('sello', ''), 150), bio=short_text(data.get('bio', ''), 2000),
                                             primer_lanzamiento=bool(data.get('primer_lanzamiento'))))
        return jsonify(ok=True)

    @app.get('/api/papelera-entidades')
    def rp_entity_trash_list():
        with connect() as db:
            rows = [dict(row) for row in db.execute('''SELECT tipo,id,grupo,eliminado_en FROM entidades_papelera
                WHERE tipo IN ('artista','disco','cancion','audiovisual') ORDER BY eliminado_en DESC''')]
            out = []
            seen = set()
            for row in rows:
                if row['grupo'] in seen:
                    continue
                seen.add(row['grupo'])
                root = next((item for item in rows if item['grupo'] == row['grupo'] and item['id'] == row['grupo'].split(':', 1)[-1]), row)
                tipo, identity = root['tipo'], root['id']
                if tipo == 'artista':
                    found = db.execute('SELECT nombre FROM artistas WHERE id=?', (identity,)).fetchone()
                    name = found['nombre'] if found else 'Artista'
                    children = db.execute('SELECT COUNT(*) FROM discos WHERE artista_id=?', (identity,)).fetchone()[0] + db.execute('SELECT COUNT(*) FROM canciones WHERE artista_id=?', (identity,)).fetchone()[0]
                elif tipo == 'disco':
                    found = db.execute('SELECT nombre FROM discos WHERE id=?', (identity,)).fetchone()
                    name = found['nombre'] if found else 'Disco'
                    children = db.execute('SELECT COUNT(*) FROM canciones WHERE disco_id=?', (identity,)).fetchone()[0]
                elif tipo == 'cancion':
                    found = db.execute('SELECT titulo FROM canciones WHERE id=?', (identity,)).fetchone()
                    name = found['titulo'] if found else 'Canción'
                    children = 0
                else:
                    found = db.execute("SELECT datos FROM rediseno_datos WHERE tipo='audiovisual' AND id=?", (identity,)).fetchone()
                    name = json.loads(found['datos']).get('nombre', 'Producción audiovisual') if found else 'Producción audiovisual'
                    children = 0
                out.append(dict(tipo=tipo,id=identity,grupo=root['grupo'],nombre=name,elementos=children,eliminado_en=row['eliminado_en']))
        return jsonify(out)

    @app.post('/api/papelera-entidades/<tipo>/<identity>')
    def rp_entity_trash_move(tipo, identity):
        if tipo not in ('artista','disco','cancion','audiovisual'):
            raise ValueError('Tipo de elemento no compatible con la Papelera.')
        with connect() as db:
            if tipo == 'artista':
                row = db.execute('SELECT id FROM artistas WHERE id=?', (identity,)).fetchone()
            elif tipo == 'disco':
                row = db.execute('SELECT id FROM discos WHERE id=?', (identity,)).fetchone()
            elif tipo == 'cancion':
                row = db.execute('SELECT id FROM canciones WHERE id=?', (identity,)).fetchone()
            else:
                row = db.execute("SELECT id FROM rediseno_datos WHERE tipo='audiovisual' AND id=?", (identity,)).fetchone()
            if not row:
                raise ValueError('No se encontró el elemento.')
            group = f'{tipo}:{identity}'
            if tipo == 'disco':
                db.execute('INSERT OR IGNORE INTO entidades_papelera(tipo,id,grupo) SELECT \'cancion\',id,? FROM canciones WHERE disco_id=?', (group, identity))
            db.execute('INSERT OR IGNORE INTO entidades_papelera(tipo,id,grupo) VALUES(?,?,?)', (tipo,identity,group))
        return jsonify(ok=True,grupo=group)

    @app.post('/api/papelera-entidades/<grupo>/restaurar')
    def rp_entity_trash_restore(grupo):
        with connect() as db:
            result = db.execute('DELETE FROM entidades_papelera WHERE grupo=?', (grupo,))
            if not result.rowcount:
                raise ValueError('El elemento ya no está en la Papelera.')
        return jsonify(ok=True)

    @app.delete('/api/papelera-entidades/<grupo>')
    def rp_entity_trash_delete(grupo):
        def delete_ids(db, table, column, ids):
            ids = list(set(ids))
            if not ids:
                return
            marks = ','.join('?' for _ in ids)
            db.execute(f'DELETE FROM {table} WHERE {column} IN ({marks})', ids)

        with connect() as db:
            archived = [dict(row) for row in db.execute('SELECT tipo,id FROM entidades_papelera WHERE grupo=?', (grupo,))]
            if not archived:
                raise ValueError('El elemento ya no está en la Papelera.')
            root = next((row for row in archived if grupo == f"{row['tipo']}:{row['id']}"), archived[0])
            kind, identity = root['tipo'], root['id']
            artist_ids, album_ids, song_ids, audiovisual_ids = [], [], [], []
            if kind == 'artista':
                artist_ids = [identity]
                album_ids = [r['id'] for r in db.execute('SELECT id FROM discos WHERE artista_id=?', (identity,))]
                song_ids = [r['id'] for r in db.execute('SELECT id FROM canciones WHERE artista_id=?', (identity,))]
            elif kind == 'disco':
                album_ids = [identity]
                song_ids = [r['id'] for r in db.execute('SELECT id FROM canciones WHERE disco_id=?', (identity,))]
            elif kind == 'cancion':
                song_ids = [identity]
            elif kind == 'audiovisual':
                audiovisual_ids = [identity]
            else:
                raise ValueError('Tipo de elemento no compatible con la Papelera.')

            # Un audiovisual que usa una canción eliminada también sale de la Papelera
            # junto con ella; se mantienen todos sus archivos en la ubicación original.
            if song_ids or artist_ids:
                songs_set = set(song_ids)
                for row in db.execute("SELECT id,datos FROM rediseno_datos WHERE tipo='audiovisual'"):
                    doc = json.loads(row['datos'] or '{}')
                    if (doc.get('artista_id') in artist_ids or songs_set.intersection(doc.get('canciones', []))):
                        audiovisual_ids.append(row['id'])

            campaign_ids = []
            for row in db.execute("SELECT id,datos FROM rediseno_datos WHERE tipo='campana'"):
                if json.loads(row['datos'] or '{}').get('disco_id') in album_ids:
                    campaign_ids.append(row['id'])

            file_ids = [r['id'] for r in db.execute('SELECT id FROM archivos WHERE cancion_id IN (%s)' %
                       ','.join('?' for _ in song_ids), song_ids)] if song_ids else []
            session_ids = [r['id'] for r in db.execute('SELECT id FROM sesiones WHERE cancion_id IN (%s)' %
                          ','.join('?' for _ in song_ids), song_ids)] if song_ids else []
            playlist_ids = [r['playlist_id'] for r in db.execute('SELECT DISTINCT playlist_id FROM playlist_items WHERE archivo_id IN (%s)' %
                            ','.join('?' for _ in file_ids), file_ids)] if file_ids else []

            db.execute('BEGIN IMMEDIATE')
            delete_ids(db, 'portal_devoluciones', 'cancion_id', song_ids)
            delete_ids(db, 'playlist_items', 'archivo_id', file_ids)
            for playlist_id in playlist_ids:
                db.execute('UPDATE playlists SET revision=revision+1,actualizado=CURRENT_TIMESTAMP WHERE id=?', (playlist_id,))
            delete_ids(db, 'portal_drive', 'archivo_id', file_ids)
            delete_ids(db, 'catalogo_audio', 'archivo_id', file_ids)
            delete_ids(db, 'eventos', 'cancion_id', song_ids)
            delete_ids(db, 'notas_etapa', 'cancion_id', song_ids)
            delete_ids(db, 'estado_cancion', 'id', song_ids)
            delete_ids(db, 'ficha_cancion', 'id', song_ids)
            delete_ids(db, 'registro_obra', 'id', song_ids)
            delete_ids(db, 'registro_grabacion', 'cancion_id', song_ids)
            delete_ids(db, 'sesion_vigente', 'cancion_id', song_ids)
            delete_ids(db, 'revision_sesion', 'sesion_id', session_ids)
            delete_ids(db, 'revision_sesion', 'original_id', session_ids)
            delete_ids(db, 'sesion_info', 'id', session_ids)
            delete_ids(db, 'archivos', 'id', file_ids)
            delete_ids(db, 'sesiones', 'id', session_ids)
            delete_ids(db, 'operaciones_archivo', 'cancion_id', song_ids)
            delete_ids(db, 'creditos', 'cancion_id', song_ids)
            delete_ids(db, 'creditos', 'disco_id', album_ids)
            delete_ids(db, 'creditos', 'persona_id', artist_ids)
            delete_ids(db, 'detalle_cancion', 'id', song_ids)
            delete_ids(db, 'detalle_disco', 'id', album_ids)
            delete_ids(db, 'registro_lanzamiento', 'id', album_ids)
            delete_ids(db, 'rediseno_datos', 'id', song_ids + album_ids + artist_ids + audiovisual_ids + campaign_ids)
            if song_ids:
                marks = ','.join('?' for _ in song_ids)
                db.execute(f"DELETE FROM rediseno_datos WHERE tipo IN ('arreglo','creditos','letra','tramites') AND id IN ({marks})", song_ids)
            if artist_ids:
                delete_ids(db, 'participaciones', 'grupo_id', artist_ids)
                delete_ids(db, 'participaciones', 'persona_id', artist_ids)
                delete_ids(db, 'roles_artista', 'artista_id', artist_ids)
                delete_ids(db, 'etiquetas_artista', 'artista_id', artist_ids)
                delete_ids(db, 'perfiles_artista', 'id', artist_ids)
                delete_ids(db, 'registro_persona', 'id', artist_ids)
            delete_ids(db, 'canciones', 'id', song_ids)
            delete_ids(db, 'discos', 'id', album_ids)
            delete_ids(db, 'artistas', 'id', artist_ids)
            db.execute('DELETE FROM entidades_papelera WHERE grupo=?', (grupo,))
        return jsonify(ok=True,archivos_conservados=len(file_ids),carpetas_conservadas=True)

    @app.get('/api/catalogo/extra')
    def rp_catalog_extra():
        from redesign import measurement
        ids = [i for i in request.args.get('ids', '').split(',') if re.fullmatch(r'[a-f0-9]{32}', i)][:50]
        out = {}
        with connect() as db:
            meter = app.config['AT_METER']
            for fid in ids:
                row = db.execute("SELECT ruta FROM archivos WHERE id=? AND eliminado_en=''", (fid,)).fetchone()
                if not row:
                    continue
                lists = [r['nombre'] for r in db.execute('SELECT p.nombre FROM playlist_items i JOIN playlists p ON p.id=i.playlist_id WHERE i.archivo_id=?', (fid,))]
                out[fid] = dict(measurement(db, meter, fid, row['ruta']), playlists=lists)
        return jsonify(out)

    @app.get('/api/playlists/<pid>/novedades')
    def rp_playlist_news(pid):
        """Audios más nuevos de la misma canción y etapa que los de la playlist (versión más reciente disponible)."""
        with connect() as db:
            required_row(db, 'playlists', pid)
            items = [dict(r) for r in db.execute('''SELECT f.id,f.nombre,f.cancion_id,f.etapa,f.creado FROM playlist_items i
                JOIN archivos f ON f.id=i.archivo_id WHERE i.playlist_id=? AND f.eliminado_en='' ''', (pid,))]
            inside = {i['id'] for i in items}
            news = []
            for item in items:
                newer = db.execute('''SELECT id,nombre,creado FROM archivos WHERE cancion_id=? AND etapa=? AND creado>? AND eliminado_en='' AND id NOT IN (%s)
                    ORDER BY creado DESC LIMIT 1''' % ','.join('?' * len(inside)), (item['cancion_id'], item['etapa'], item['creado'], *inside)).fetchone()
                if newer and Path(newer['nombre']).suffix.lower() in ('.wav', '.mp3', '.flac', '.aif', '.aiff', '.m4a', '.ogg'):
                    news.append(dict(actual=item['id'], actual_nombre=item['nombre'], nuevo=newer['id'], nuevo_nombre=newer['nombre']))
            publication = db.execute('SELECT url,estado,actualizado FROM portal_publicaciones WHERE playlist_id=? ORDER BY actualizado DESC LIMIT 1', (pid,)).fetchone()
        return jsonify(novedades=news, publicacion=dict(publication) if publication else None)


def register_playlist_options(app, connect):
    @app.get('/api/playlists/<pid>/opciones')
    def rp_playlist_options(pid):
        with connect() as db:
            required_row(db, 'playlists', pid)
            doc = doc_get(db, 'playlist_opc', pid, {})
            stats = db.execute('''SELECT COUNT(*) AS total, SUM(estado IN ('Pendiente','En revisión')) AS abiertas
                FROM portal_devoluciones WHERE playlist_id=?''', (pid,)).fetchone()
            publication = db.execute('SELECT url,estado,actualizado FROM portal_publicaciones WHERE playlist_id=? ORDER BY actualizado DESC LIMIT 1', (pid,)).fetchone()
        result = dict(vence='30', devoluciones=True, descarga=False, mostrar_version=True)
        result.update(doc, devoluciones_total=stats['total'] or 0, devoluciones_abiertas=stats['abiertas'] or 0,
                      publicacion=dict(publication) if publication else None)
        return jsonify(result)

    @app.post('/api/playlists/<pid>/opciones')
    def rp_playlist_options_save(pid):
        data = request.get_json() or {}
        if str(data.get('vence', '30')) not in ('7', '15', '30', '60', '0'):
            raise ValueError('Vencimiento inválido.')
        with connect() as db:
            required_row(db, 'playlists', pid)
            doc_put(db, 'playlist_opc', pid, dict(vence=str(data.get('vence', '30')), devoluciones=bool(data.get('devoluciones', True)),
                                                  descarga=bool(data.get('descarga')), mostrar_version=bool(data.get('mostrar_version', True))))
        return jsonify(ok=True)


def register_arrangement_waves(app):
    @app.get('/api/arreglos/onda/<path:token>')
    def ra_wave(token):
        from audio_waveform import pcm_waveform
        path = path_from_token(token)
        try:
            data = pcm_waveform(path, bins=160)
        except Exception:
            data = dict(peaks=[], duration=0)
        return jsonify(data)
