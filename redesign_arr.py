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
