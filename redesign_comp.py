"""Rediseño 0.3: Composición (beats, letras por secciones, partituras) y Entidades.

Conserva las listas y colecciones de Composición existentes: solo agrega
metadatos (en `rediseno_datos`) y operaciones nuevas. Los archivos originales
nunca se mueven ni se modifican.
"""
import io
import json
import re
import shutil
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from flask import Response, jsonify, request, send_file
from management import required_row
from redesign import doc_get, doc_put, doc_list, short_text, export_bundle_for_song

KEYS = {'c': 'Do', 'c#': 'Do#', 'db': 'Re♭', 'd': 'Re', 'd#': 'Re#', 'eb': 'Mi♭', 'e': 'Mi', 'f': 'Fa', 'f#': 'Fa#', 'gb': 'Sol♭',
        'g': 'Sol', 'g#': 'Sol#', 'ab': 'La♭', 'a': 'La', 'a#': 'La#', 'bb': 'Si♭', 'b': 'Si'}
SECTION_WORDS = {'verso': 'verse', 'verse': 'verse', 'estrofa': 'verse', 'estribillo': 'chorus', 'coro': 'chorus', 'chorus': 'chorus',
                 'puente': 'bridge', 'bridge': 'bridge', 'pre': 'pre', 'precoro': 'pre', 'pre-estribillo': 'pre', 'pre-coro': 'pre',
                 'intro': 'intro', 'outro': 'outro', 'final': 'outro', 'interludio': 'inter', 'solo': 'inter'}
SECTION_KINDS = ('intro', 'verse', 'pre', 'chorus', 'bridge', 'inter', 'outro')
LYRIC_STATES = ('Borrador', 'En revisión', 'Final')
BEAT_STATES = ('Libre', 'Reservado', 'En uso')


def parse_beat_name(name):
    """BPM y tonalidad desde nombres como «Madrugada_76bpm_Cm.wav» o «Ruta 110 BPM F#m»."""
    stem = Path(name).stem
    bpm = re.search(r'(?<!\d)(\d{2,3})\s*-?\s*bpm', stem, re.I) or re.search(r'(?:^|[_\s-])(\d{2,3})(?:[_\s-]|$)', stem)
    key = re.search(r'(?:^|[_\s-])([A-G](?:#|b)?)(m|min|maj|M)?(?:[_\s-]|$)', stem)
    tonality = ''
    if key:
        root = KEYS.get(key.group(1).lower(), key.group(1))
        tonality = root + (' menor' if key.group(2) in ('m', 'min') else ' mayor')
    value = int(bpm.group(1)) if bpm else None
    return dict(bpm=value if value and 40 <= value <= 240 else None, tonalidad=tonality)


def clean_title(name):
    stem = re.sub(r'(?<!\d)\d{2,3}\s*-?\s*bpm', '', Path(name).stem, flags=re.I)
    stem = re.sub(r'(?:^|[_\s-])[A-G](?:#|b)?(?:m|min|maj)?(?=[_\s-]|$)', ' ', stem)
    return re.sub(r'[_\s-]+', ' ', stem).strip() or Path(name).stem


def detect_sections(text):
    """Divide un texto pegado en secciones: por encabezados ([Estribillo], «Verso 2:») o por estrofas."""
    blocks, current = [], None
    for raw in text.replace('\r\n', '\n').split('\n'):
        line = raw.rstrip()
        header = re.fullmatch(r'\s*[\[(]?\s*([A-Za-zÁÉÍÓÚáéíóúñ\- ]+?)\s*(\d+)?\s*[\])]?\s*:?\s*', line)
        word = header and header.group(1).strip().lower()
        if word in SECTION_WORDS:
            current = dict(tipo=SECTION_WORDS[word], variacion=False, lineas=[])
            blocks.append(current)
            continue
        if not line.strip():
            if current and current['lineas']:
                current = None
            continue
        if current is None:
            current = dict(tipo='', variacion=False, lineas=[])
            blocks.append(current)
        current['lineas'].append(line.strip())
    blocks = [b for b in blocks if b['lineas']]
    # Sin encabezados: la estrofa que se repite es el estribillo; el resto, versos.
    seen = {}
    for block in blocks:
        key = '\n'.join(block['lineas']).lower()
        seen[key] = seen.get(key, 0) + 1
    for block in blocks:
        if not block['tipo']:
            block['tipo'] = 'chorus' if seen['\n'.join(block['lineas']).lower()] > 1 else 'verse'
    return blocks


def read_docx(data):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        root = ET.fromstring(package.read('word/document.xml'))
    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    lines = []
    for paragraph in root.iter(ns + 'p'):
        lines.append(''.join(node.text or '' for node in paragraph.iter() if node.tag in (ns + 't',)) +
                     ''.join('\n' for node in paragraph.iter(ns + 'br')))
    return '\n'.join(lines)


def read_pdf_text(data):
    """Texto de PDFs generados por procesadores de texto (no escaneados). Sin dependencias."""
    import zlib
    chunks = []
    for match in re.finditer(rb'stream\r?\n(.*?)\r?\nendstream', data, re.S):
        raw = match.group(1)
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            pass
        for block in re.findall(rb'BT(.*?)ET', raw, re.S):
            parts = []
            for op in re.finditer(rb'\((.*?)(?<!\\)\)\s*Tj|\[(.*?)\]\s*TJ|(T\*|\'|Td|TD)', block, re.S):
                if op.group(1) is not None:
                    parts.append(op.group(1))
                elif op.group(2) is not None:
                    parts.extend(re.findall(rb'\((.*?)(?<!\\)\)', op.group(2), re.S))
                elif op.group(3) in (b'T*', b"'", b'Td', b'TD') and parts and parts[-1] != b'\n':
                    parts.append(b'\n')
            text = b''.join(parts).replace(b'\\(', b'(').replace(b'\\)', b')').replace(b'\\\\', b'\\')
            chunks.append(text.decode('cp1252', errors='ignore'))
    text = '\n'.join(chunk.strip() for chunk in chunks if chunk.strip())
    # Números de página y pies repetidos no son parte de la letra.
    return '\n'.join(line for line in text.split('\n') if not re.search(r'\b(p[aá]gina|page)\s*\d+\b|^\s*\d+\s*$', line, re.I))


def lyric_text(doc):
    out = []
    names = section_names(doc)
    for block, name in zip(doc.get('secciones', []), names):
        out.append(f'[{name}]')
        out.extend(block.get('lineas', []))
        out.append('')
    return '\n'.join(out).strip()


def section_names(doc):
    scheme = doc.get('esquema', 'pop')
    counters, letters, names = {}, {}, []
    labels = {'intro': 'Intro', 'verse': 'Verso', 'pre': 'Pre-estribillo', 'chorus': 'Estribillo', 'bridge': 'Puente', 'inter': 'Interludio', 'outro': 'Final'}
    for block in doc.get('secciones', []):
        kind = block.get('tipo', 'verse')
        if scheme == 'letras':
            if kind not in letters:
                letters[kind] = chr(65 + len(letters))
            names.append(letters[kind] + ('′' if block.get('variacion') else ''))
        elif scheme == 'propio' and block.get('nombre'):
            names.append(block['nombre'])
        else:
            counters[kind] = counters.get(kind, 0) + 1
            names.append(labels.get(kind, 'Sección') + (f' {counters[kind]}' if kind == 'verse' else ''))
    return names


def register_composition_redesign(app, connect):
    # ── Beats ──
    @app.get('/api/composicion/beats')
    def rc_beats():
        meta = None
        with connect() as db:
            rows = [dict(r) for r in db.execute('''SELECT b.id,b.nombre,b.ruta,b.creado,b.playlist_id,p.nombre AS lista
                FROM composition_beats b JOIN composition_playlists p ON p.id=b.playlist_id ORDER BY p.posicion,b.posicion''')]
            meta = doc_list(db, 'beat')
            songs = {r['id']: r['titulo'] for r in db.execute('SELECT id,titulo FROM canciones')}
            lists = [dict(r) for r in db.execute('SELECT id,nombre FROM composition_playlists ORDER BY posicion')]
        out = []
        for row in rows:
            path = Path(row['ruta'])
            info = meta.get(row['id'], {})
            guess = parse_beat_name(row['nombre'])
            out.append(dict(id=row['id'], nombre=info.get('titulo') or clean_title(row['nombre']), archivo=row['nombre'], ruta=row['ruta'],
                            lista=row['lista'], lista_id=row['playlist_id'], disponible=path.is_file(), formato=path.suffix[1:].upper(),
                            bpm=info.get('bpm', guess['bpm']), tonalidad=info.get('tonalidad', guess['tonalidad']),
                            etiquetas=info.get('etiquetas', []), estado=info.get('estado', 'Libre'), para=info.get('para', ''),
                            cancion_id=info.get('cancion_id', ''), cancion=songs.get(info.get('cancion_id', ''), ''),
                            segmentos=info.get('segmentos', []), stems=info.get('stems_texto', ''), creado=row['creado']))
        return jsonify(beats=out, listas=lists)

    @app.post('/api/composicion/beats/<bid>')
    def rc_beat_save(bid):
        data = request.get_json() or {}
        with connect() as db:
            required_row(db, 'composition_beats', bid)
            doc = doc_get(db, 'beat', bid, {})
            if 'bpm' in data:
                bpm = data['bpm']
                if bpm not in (None, '') and (not str(bpm).isdigit() or not 20 <= int(bpm) <= 300):
                    raise ValueError('BPM entre 20 y 300.')
                doc['bpm'] = int(bpm) if bpm not in (None, '') else None
            for key, size in (('titulo', 150), ('tonalidad', 40), ('para', 150), ('cancion_id', 64), ('stems_texto', 80)):
                if key in data:
                    doc[key] = short_text(data[key], size)
            if 'estado' in data:
                if data['estado'] not in BEAT_STATES:
                    raise ValueError('Estado de beat inválido.')
                doc['estado'] = data['estado']
            if 'etiquetas' in data:
                tags = data['etiquetas']
                if not isinstance(tags, list) or len(tags) > 30:
                    raise ValueError('Etiquetas inválidas.')
                doc['etiquetas'] = list(dict.fromkeys(short_text(t, 40).lower() for t in tags if short_text(t, 40)))
            if 'segmentos' in data:
                segs = data['segmentos']
                if not isinstance(segs, list) or len(segs) > 30:
                    raise ValueError('Segmentos inválidos.')
                clean = []
                for seg in segs:
                    start, end = float(seg.get('inicio', 0)), float(seg.get('fin', 0))
                    if not 0 <= start < end <= 3600:
                        raise ValueError('Cada segmento necesita inicio y fin válidos.')
                    clean.append(dict(nombre=short_text(seg.get('nombre', ''), 40) or 'Segmento', inicio=round(start, 2), fin=round(end, 2)))
                doc['segmentos'] = clean
            doc_put(db, 'beat', bid, doc)
        return jsonify(ok=True)

    @app.get('/api/composicion/beats/<bid>/onda')
    def rc_beat_wave(bid):
        from audio_waveform import pcm_waveform
        with connect() as db:
            row = required_row(db, 'composition_beats', bid)
        try:
            return jsonify(pcm_waveform(row['ruta'], bins=200))
        except Exception:
            return jsonify(peaks=[], duration=0)

    @app.post('/api/composicion/beats/escanear')
    def rc_beats_scan():
        data = request.get_json() or {}
        folder = Path(str(data.get('carpeta', ''))).expanduser()
        if not folder.is_dir():
            raise ValueError('Elegí una carpeta que exista.')
        audio = {'.wav', '.mp3', '.flac', '.aif', '.aiff', '.ogg', '.m4a'}
        pattern = '**/*' if data.get('recursivo') else '*'
        found = []
        with connect() as db:
            known = {r['ruta'] for r in db.execute('SELECT ruta FROM composition_beats')}
        for path in sorted(folder.glob(pattern)):
            if len(found) >= 200:
                break
            if not path.is_file() or path.suffix.lower() not in audio or any(part.lower().endswith('stems') or part.lower() == 'stems' for part in path.relative_to(folder).parts[:-1]):
                continue
            guess = parse_beat_name(path.name)
            stem_dirs, seen_dirs = [], set()
            for d in (path.parent / 'Stems', path.parent / 'stems', path.parent / (path.stem + '_stems'), path.parent / (path.stem + ' stems')):
                # En macOS y Windows «Stems» y «stems» son la misma carpeta: se cuenta una sola vez.
                if d.is_dir() and (ident := (d.stat().st_dev, d.stat().st_ino)) not in seen_dirs:
                    seen_dirs.add(ident)
                    stem_dirs.append(d)
            stems = sum(1 for d in stem_dirs for f in d.iterdir() if f.suffix.lower() in audio) if data.get('stems', True) else 0
            found.append(dict(ruta=str(path), archivo=path.name, titulo=clean_title(path.name), bpm=guess['bpm'], tonalidad=guess['tonalidad'],
                              stems=stems, ya=str(path.resolve()) in known))
        return jsonify(archivos=found, carpeta=str(folder))

    @app.post('/api/composicion/beats/importar')
    def rc_beats_import():
        data = request.get_json() or {}
        items, list_id = data.get('archivos', []), data.get('lista_id') or 'default'
        tags = [short_text(t, 40).lower() for t in data.get('etiquetas', []) if short_text(t, 40)][:20]
        if not isinstance(items, list) or not 0 < len(items) <= 200:
            raise ValueError('Elegí entre 1 y 200 beats.')
        added = 0
        with connect() as db:
            required_row(db, 'composition_playlists', list_id)
            for item in items:
                path = Path(str(item.get('ruta', ''))).resolve()
                if not path.is_file():
                    continue
                pos = db.execute('SELECT COALESCE(MAX(posicion),-1)+1 FROM composition_beats WHERE playlist_id=?', (list_id,)).fetchone()[0]
                bid = uuid.uuid4().hex
                cur = db.execute('INSERT OR IGNORE INTO composition_beats(id,nombre,ruta,posicion,playlist_id) VALUES(?,?,?,?,?)',
                                 (bid, path.name, str(path), pos, list_id))
                if cur.rowcount:
                    added += 1
                    bpm = item.get('bpm')
                    doc_put(db, 'beat', bid, dict(titulo=short_text(item.get('titulo', ''), 150), bpm=int(bpm) if str(bpm or '').isdigit() else None,
                                                  tonalidad=short_text(item.get('tonalidad', ''), 40), etiquetas=list(dict.fromkeys(['nuevo'] + tags)),
                                                  estado='Libre', stems_texto=f"{item['stems']} stems" if item.get('stems') else ''))
        return jsonify(agregados=added), 201

    # ── Letras por secciones ──
    @app.get('/api/composicion/letras')
    def rc_lyrics():
        with connect() as db:
            docs = doc_list(db, 'letra')
            rows = [dict(r) for r in db.execute('''SELECT c.id,c.titulo,c.artista_id,a.nombre AS artista,d.nombre AS disco,f.datos AS ficha
                FROM canciones c JOIN artistas a ON a.id=c.artista_id LEFT JOIN discos d ON d.id=c.disco_id
                LEFT JOIN ficha_cancion f ON f.id=c.id ORDER BY a.nombre,d.nombre,c.titulo''')]
        out = []
        for row in rows:
            doc = docs.get(row['id'])
            legacy = json.loads(row.pop('ficha') or '{}').get('letra', '')
            out.append(dict(row, estado=(doc or {}).get('estado', 'Borrador' if legacy else ''), version=(doc or {}).get('version', 1 if legacy else 0),
                            secciones=len((doc or {}).get('secciones', [])) or (len(detect_sections(legacy)) if legacy else 0),
                            instrumental=(doc or {}).get('instrumental', False)))
        return jsonify(out)

    @app.get('/api/composicion/letras/<sid>')
    def rc_lyric_get(sid):
        with connect() as db:
            song = dict(required_row(db, 'canciones', sid))
            doc = doc_get(db, 'letra', sid, {})
            ficha = json.loads((db.execute('SELECT datos FROM ficha_cancion WHERE id=?', (sid,)).fetchone() or {'datos': '{}'})['datos'])
            credits = doc_get(db, 'creditos', sid, {})
            obra = json.loads((db.execute('SELECT datos FROM registro_obra WHERE id=?', (sid,)).fetchone() or {'datos': '{}'})['datos'])
        if not doc and ficha.get('letra'):
            doc = dict(esquema='pop', secciones=detect_sections(ficha['letra']), estado='Borrador', version=1)
        doc.setdefault('esquema', 'pop'); doc.setdefault('secciones', []); doc.setdefault('estado', 'Borrador'); doc.setdefault('version', 1)
        doc['nombres'] = section_names(doc)
        letristas = [a for a in credits.get('autores', []) if a.get('rol') in ('Letra', 'Letra y música')]
        return jsonify(cancion=dict(id=sid, titulo=song['titulo']), letra=doc, autoria=letristas, idioma=obra.get('idioma', ''))

    @app.post('/api/composicion/letras/<sid>')
    def rc_lyric_save(sid):
        data = request.get_json() or {}
        sections = data.get('secciones', [])
        if not isinstance(sections, list) or len(sections) > 80:
            raise ValueError('Demasiadas secciones.')
        clean = []
        for block in sections:
            kind = block.get('tipo', 'verse')
            if kind not in SECTION_KINDS:
                raise ValueError('Tipo de sección inválido.')
            lines = block.get('lineas', [])
            if not isinstance(lines, list) or len(lines) > 200:
                raise ValueError('Sección demasiado larga.')
            times = block.get('tiempos', [])
            clean.append(dict(tipo=kind, variacion=bool(block.get('variacion')), nombre=short_text(block.get('nombre', ''), 40),
                              lineas=[short_text(line, 500) for line in lines],
                              tiempos=[t if isinstance(t, (int, float)) and 0 <= t < 3600 else None for t in times][:len(lines)] if isinstance(times, list) else []))
        scheme = data.get('esquema', 'pop')
        if scheme not in ('pop', 'letras', 'propio'):
            raise ValueError('Estilo de nombres inválido.')
        state = data.get('estado', 'Borrador')
        if state not in LYRIC_STATES:
            raise ValueError('Estado de la letra inválido.')
        with connect() as db:
            required_row(db, 'canciones', sid)
            previous = doc_get(db, 'letra', sid, {})
            version = previous.get('version', 0)
            if data.get('nueva_version') or not previous:
                version += 1
            doc = dict(esquema=scheme, secciones=clean, estado=state, version=max(1, version), instrumental=bool(data.get('instrumental')),
                       explicito=short_text(data.get('explicito', previous.get('explicito', '')), 20))
            if previous and data.get('nueva_version'):
                history = previous.get('historial', [])[-19:]
                history.append(dict(version=previous.get('version'), estado=previous.get('estado'), texto=lyric_text(previous)))
                doc['historial'] = history
            else:
                doc['historial'] = previous.get('historial', [])
            doc_put(db, 'letra', sid, doc)
            # La ficha de la canción guarda el texto plano: viaja a la exportación y al portal.
            row = db.execute('SELECT datos FROM ficha_cancion WHERE id=?', (sid,)).fetchone()
            ficha = json.loads(row['datos']) if row else {}
            ficha['letra'] = lyric_text(doc)
            db.execute('INSERT INTO ficha_cancion(id,datos) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos, actualizado=CURRENT_TIMESTAMP',
                       (sid, json.dumps(ficha, ensure_ascii=False)))
            if 'idioma' in data:
                obra_row = db.execute('SELECT datos FROM registro_obra WHERE id=?', (sid,)).fetchone()
                obra = json.loads(obra_row['datos']) if obra_row else {}
                obra['idioma'] = short_text(data['idioma'], 60)
                db.execute('INSERT INTO registro_obra VALUES(?,?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos', (sid, json.dumps(obra, ensure_ascii=False)))
        doc['nombres'] = section_names(doc)
        return jsonify(ok=True, letra=doc)

    @app.post('/api/composicion/letras/importar')
    def rc_lyric_import():
        upload = request.files.get('file')
        text = request.form.get('texto', '')
        if upload:
            data = upload.read(16 * 1024 * 1024 + 1)
            if len(data) > 16 * 1024 * 1024:
                raise ValueError('El archivo supera los 16 MB.')
            suffix = Path(upload.filename or '').suffix.lower()
            if suffix == '.docx':
                text = read_docx(data)
            elif suffix == '.pdf':
                text = read_pdf_text(data)
                if not text.strip():
                    raise ValueError('No se encontró texto en el PDF. Si es un escaneo, no se puede leer: copiá el texto a mano.')
            elif suffix in ('.txt', '.lrc', ''):
                for encoding in ('utf-8-sig', 'cp1252', 'latin-1'):
                    try:
                        text = data.decode(encoding)
                        break
                    except UnicodeDecodeError:
                        continue
                text = re.sub(r'^\[\d+:\d+(?:\.\d+)?\]', '', text, flags=re.M)
            else:
                raise ValueError('Formato no soportado: usá Word (.docx), PDF o texto.')
        if len(text) > 100000:
            raise ValueError('La letra es demasiado larga.')
        return jsonify(secciones=detect_sections(text))

    @app.get('/api/composicion/letras/<sid>.<fmt>')
    def rc_lyric_export(sid, fmt):
        with connect() as db:
            song = dict(required_row(db, 'canciones', sid))
            doc = doc_get(db, 'letra', sid, {})
        if fmt == 'txt':
            payload = (song['titulo'] + '\n\n' + lyric_text(doc)).encode('utf-8')
            mime = 'text/plain; charset=utf-8'
        elif fmt == 'lrc':
            lines = [f'[ti:{song["titulo"]}]']
            for block in doc.get('secciones', []):
                for line, time in zip(block.get('lineas', []), block.get('tiempos', []) + [None] * len(block.get('lineas', []))):
                    if time is not None:
                        lines.append(f'[{int(time // 60):02d}:{time % 60:05.2f}]{line}')
            if len(lines) == 1:
                raise ValueError('La letra todavía no está sincronizada con el audio.')
            payload, mime = '\n'.join(lines).encode('utf-8'), 'text/plain; charset=utf-8'
        else:
            raise ValueError('Formato inválido.')
        safe = re.sub(r'[^\w-]+', '_', song['titulo'])
        return send_file(io.BytesIO(payload), mimetype=mime, as_attachment=True, download_name=f'{safe}.{fmt}')

    # ── Partituras asociadas ──
    @app.get('/api/composicion/partituras')
    def rc_scores():
        with connect() as db:
            rows = [dict(r) for r in db.execute('''SELECT s.id,s.nombre,s.ruta,s.creado,c.nombre AS coleccion FROM composition_scores s
                JOIN composition_score_collections c ON c.id=s.collection_id ORDER BY c.posicion,s.posicion''')]
            meta = doc_list(db, 'partitura')
            songs = {r['id']: r['titulo'] for r in db.execute('SELECT id,titulo FROM canciones')}
        out = []
        for row in rows:
            info = meta.get(row['id'], {})
            path = Path(row['ruta'])
            out.append(dict(row, formato=path.suffix[1:].upper(), disponible=path.is_file(), cancion_id=info.get('cancion_id', ''),
                            cancion=songs.get(info.get('cancion_id', ''), ''), arreglo=info.get('arreglo', ''), instrumento=info.get('instrumento', ''),
                            version=info.get('version', 1), vigente=info.get('vigente', True), titulo=info.get('titulo') or Path(row['nombre']).stem))
        return jsonify(out)

    @app.post('/api/composicion/partituras/<pid>')
    def rc_score_save(pid):
        data = request.get_json() or {}
        with connect() as db:
            required_row(db, 'composition_scores', pid)
            doc = doc_get(db, 'partitura', pid, {})
            for key, size in (('titulo', 150), ('cancion_id', 64), ('arreglo', 150), ('instrumento', 80)):
                if key in data:
                    doc[key] = short_text(data[key], size)
            if 'version' in data:
                doc['version'] = max(1, int(data['version'] or 1))
            if 'vigente' in data:
                doc['vigente'] = bool(data['vigente'])
                if doc['vigente'] and doc.get('cancion_id'):
                    # Una sola versión vigente por canción, arreglo e instrumento.
                    for other_id, other in doc_list(db, 'partitura').items():
                        if other_id != pid and (other.get('cancion_id'), other.get('arreglo'), other.get('instrumento')) == (doc.get('cancion_id'), doc.get('arreglo'), doc.get('instrumento')):
                            other['vigente'] = False
                            doc_put(db, 'partitura', other_id, other)
            doc_put(db, 'partitura', pid, doc)
        return jsonify(ok=True)

    # ── Entidades: estado de registro por canción, guías y carpeta del trámite ──
    @app.get('/api/entidades')
    def rc_entities():
        from entity_guides import entities_payload
        return jsonify(entities_payload())

    @app.get('/api/entidades/estado')
    def rc_entities_state():
        with connect() as db:
            rows = [dict(r) for r in db.execute('''SELECT c.id,c.titulo,a.nombre AS artista,COALESCE(d.nombre,'') AS disco FROM canciones c
                JOIN artistas a ON a.id=c.artista_id LEFT JOIN discos d ON d.id=c.disco_id ORDER BY a.nombre,d.nombre,c.titulo''')]
            manual = doc_list(db, 'tramites')
            obras = {r['id']: json.loads(r['datos']) for r in db.execute('SELECT id,datos FROM registro_obra')}
            isrc = {}
            for r in db.execute('SELECT cancion_id,datos FROM registro_grabacion ORDER BY rowid'):
                isrc.setdefault(r['cancion_id'], json.loads(r['datos']).get('isrc', ''))
            credits = doc_list(db, 'creditos')
        for row in rows:
            m = manual.get(row['id'], {})
            perf = credits.get(row['id'], {}).get('interpretes', [])
            row.update(dnda_obra=m.get('dnda_obra', 'pendiente'), sadaic='ok' if obras.get(row['id'], {}).get('iswc') else m.get('sadaic', 'pendiente'),
                       isrc='ok' if isrc.get(row['id']) else m.get('isrc', 'pendiente'), dnda_fono=m.get('dnda_fono', 'no-aplica'),
                       aadi='ok' if perf and all(p.get('aadi') for p in perf) else m.get('aadi', 'pendiente' if perf else 'no-aplica'))
        return jsonify(rows)

    @app.post('/api/entidades/estado/<sid>')
    def rc_entities_state_save(sid):
        data = request.get_json() or {}
        allowed = ('ok', 'tramite', 'pendiente', 'no-aplica')
        with connect() as db:
            required_row(db, 'canciones', sid)
            doc = doc_get(db, 'tramites', sid, {})
            for key in ('dnda_obra', 'sadaic', 'isrc', 'dnda_fono', 'aadi'):
                if key in data:
                    if data[key] not in allowed:
                        raise ValueError('Estado de trámite inválido.')
                    doc[key] = data[key]
            doc_put(db, 'tramites', sid, doc)
        return jsonify(ok=True)

    @app.get('/api/entidades/guia/<proc>.pdf')
    def rc_entities_guide(proc):
        from entity_guides import GUIDES, guide_pdf
        if proc not in GUIDES:
            raise ValueError('Guía inexistente.')
        return send_file(io.BytesIO(guide_pdf(proc)), mimetype='application/pdf', as_attachment=True, download_name=f'Guia_{proc}.pdf')

    @app.post('/api/entidades/preparar')
    def rc_entities_prepare():
        """Arma la carpeta del trámite con la ficha (PDF), la letra y una copia del audio de referencia."""
        from metadata_export import build
        data = request.get_json() or {}
        entity, sid = short_text(data.get('entidad', ''), 20), short_text(data.get('cancion_id', ''), 64)
        if entity not in ('dnda', 'sadaic', 'aadi', 'capif', 'inamu', 'ama'):
            raise ValueError('Entidad inválida.')
        with connect() as db:
            song = dict(required_row(db, 'canciones', sid))
            bundle = export_bundle_for_song(db, sid)
            ref = db.execute('''SELECT ruta,nombre FROM archivos WHERE cancion_id=? AND (etapa='mastering' OR etapa='mezcla')
                ORDER BY CASE etapa WHEN 'mastering' THEN 0 ELSE 1 END, creado DESC LIMIT 1''', (sid,)).fetchone()
        title = re.sub(r'[<>:"/\\|?*]', '', song['titulo'])
        folder = Path(song['carpeta']) / 'Trámites' / f'{entity.upper()} · {title}'
        folder.mkdir(parents=True, exist_ok=True)
        name, payload, _ = build(bundle, 'pdf', dict(destino='registros', logo=True, letras=True))
        (folder / name).write_bytes(payload)
        written = [name]
        lyric = bundle['canciones'][0]['letra'] if bundle['canciones'] else ''
        if lyric.strip():
            (folder / 'Letra.txt').write_text(song['titulo'] + '\n\n' + lyric, encoding='utf-8')
            written.append('Letra.txt')
        if ref and Path(ref['ruta']).is_file() and entity in ('dnda', 'capif', 'ama'):
            target = folder / ref['nombre']
            if not target.exists():
                shutil.copy2(ref['ruta'], target)
            written.append(ref['nombre'])
        return jsonify(ok=True, carpeta=str(folder), archivos=written)
