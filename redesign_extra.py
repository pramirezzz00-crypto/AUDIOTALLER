"""Rediseño 0.3: Lanzamientos (campañas), Audiovisual y Asistente Claude.

Todo se guarda localmente en `rediseno_datos`. El asistente usa la clave de
API propia del productor (Claude Console); la clave se guarda cifrada con el
mismo almacén de credenciales del portal, nunca en SQLite.
"""
import json
import re
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta
from pathlib import Path
from flask import jsonify, request, send_file
from management import required_row
from redesign import doc_get, doc_put, doc_list, short_text

STAGE_KINDS = ('Single', 'EP', 'Disco completo', 'Focus track', 'Videoclip')
AV_ORIGINS = ('cancion', 'independiente', 'audio_desde_video')
AV_TEMPLATES = {
    'Videoclip': ['Desarrollo', 'Preproducción', 'Rodaje', 'Postproducción', 'Entregas', 'Distribución'],
    'Sesión en vivo / Recital': ['Preproducción', 'Rodaje', 'Postproducción', 'Entregas', 'Distribución'],
    'Lyric video / Visualizer': ['Desarrollo', 'Postproducción', 'Entregas', 'Distribución'],
    'Entrevista / Documental': ['Desarrollo', 'Rodaje', 'Postproducción', 'Entregas'],
    'Personalizado': ['Desarrollo', 'Preproducción', 'Rodaje', 'Postproducción', 'Entregas', 'Distribución'],
}
AV_TASKS = {'Desarrollo': ['Idea y referencias', 'Presupuesto'], 'Preproducción': ['Locaciones', 'Plan de rodaje', 'Pista de playback'],
            'Rodaje': ['Jornadas', 'Tomas calificadas'], 'Postproducción': ['Armado', 'Corte final', 'Color', 'Sonido'],
            'Entregas': ['Master de archivo', 'YouTube 16:9', 'Short / Reel 9:16', 'Spotify Canvas'], 'Distribución': ['Estreno', 'Redes']}
DELIVERY_PROFILES = ['Master de archivo', 'YouTube 16:9', 'Short / Reel / TikTok 9:16', 'Spotify Canvas 9:16 (3–8 s, sin audio)', 'Teaser']


def iso(value):
    try:
        return date.fromisoformat(value).isoformat() if value else ''
    except ValueError:
        raise ValueError('Fecha inválida (AAAA-MM-DD).')


def campaign_view(db, cid, doc):
    songs = {r['id']: dict(r) for r in db.execute('SELECT c.id,c.titulo,c.disco_id FROM canciones c')}
    stages = []
    for stage in doc.get('etapas', []):
        release = stage.get('fecha', '')
        deadlines = {}
        if release:
            day = date.fromisoformat(release)
            deadlines = dict(distribuidora=(day - timedelta(days=28)).isoformat(), pitch=(day - timedelta(days=7)).isoformat())
        checklist = stage.get('chequeo', {})
        stages.append(dict(stage, canciones_det=[dict(id=s, titulo=songs.get(s, {}).get('titulo', '¿?')) for s in stage.get('canciones', [])],
                           limites=deadlines, lista=all(checklist.get(k) for k in ('portada', 'audio', 'metadata', 'perfiles', 'pitch'))))
    upcoming = sorted([s for s in stages if s.get('fecha') and s.get('estado') != 'Publicada'], key=lambda s: s['fecha'])
    album = db.execute('SELECT nombre FROM discos WHERE id=?', (doc.get('disco_id', ''),)).fetchone()
    return dict(doc, id=cid, etapas=stages, disco=album['nombre'] if album else '', proximo=upcoming[0] if upcoming else None)


def register_extra(app, connect, data_folder):
    # ── Campañas de lanzamiento ──
    @app.get('/api/campanas')
    def rx_campaigns():
        with connect() as db:
            return jsonify(sorted([campaign_view(db, k, v) for k, v in doc_list(db, 'campana').items()],
                                  key=lambda c: c.get('fecha') or '9999'))

    @app.post('/api/campanas')
    @app.post('/api/campanas/<cid>')
    def rx_campaign_save(cid=None):
        data = request.get_json() or {}
        name = short_text(data.get('nombre', ''), 120)
        if not name:
            raise ValueError('Poné un nombre a la campaña.')
        stages = data.get('etapas', [])
        if not isinstance(stages, list) or len(stages) > 20:
            raise ValueError('Hasta 20 etapas por campaña.')
        clean = []
        for stage in stages:
            kind = stage.get('tipo', 'Single')
            if kind not in STAGE_KINDS:
                raise ValueError('Tipo de etapa inválido.')
            songs = [s for s in stage.get('canciones', []) if isinstance(s, str)][:40]
            state = stage.get('estado', 'Planificada')
            if state not in ('Planificada', 'En preparación', 'Enviada', 'Publicada'):
                raise ValueError('Estado de etapa inválido.')
            check = {k: bool(v) for k, v in (stage.get('chequeo') or {}).items() if k in ('portada', 'audio', 'metadata', 'perfiles', 'pitch', 'ama')}
            clean.append(dict(id=stage.get('id') or uuid.uuid4().hex[:8], nombre=short_text(stage.get('nombre', ''), 80) or kind, tipo=kind,
                              fecha=iso(stage.get('fecha', '')), distribuidora=short_text(stage.get('distribuidora', 'AMA'), 60),
                              canciones=songs, estado=state, chequeo=check, condicion=short_text(stage.get('condicion', ''), 300),
                              enlaces={k: short_text(v, 300) for k, v in (stage.get('enlaces') or {}).items()}))
        with connect() as db:
            if data.get('disco_id'):
                required_row(db, 'discos', data['disco_id'])
            cid = cid or uuid.uuid4().hex
            doc = dict(nombre=name, disco_id=short_text(data.get('disco_id', ''), 64), artista=short_text(data.get('artista', ''), 150),
                       fecha=max((s['fecha'] for s in clean if s['fecha']), default=''), etapas=clean, notas=short_text(data.get('notas', ''), 4000))
            doc_put(db, 'campana', cid, doc)
            return jsonify(campaign_view(db, cid, doc))

    @app.post('/api/campanas/<cid>/borrar')
    def rx_campaign_delete(cid):
        with connect() as db:
            db.execute("DELETE FROM rediseno_datos WHERE tipo='campana' AND id=?", (cid,))
        return jsonify(ok=True)

    @app.get('/api/discos/<did>/campana-sugerida')
    def rx_campaign_suggest(did):
        """Borrador según cantidad de canciones: ≤3 un single; 4–6 dos singles cada 5 semanas; 7+ tres singles y EP."""
        from overview import song_summaries
        with connect() as db:
            album = dict(required_row(db, 'discos', did))
            songs = song_summaries(db, 'WHERE c.disco_id=?', (did,))
        start = date.fromisoformat(request.args.get('fecha')) if request.args.get('fecha') else date.today() + timedelta(days=70)
        ready = sorted(songs, key=lambda s: -s['etapa_indice'])
        singles = 1 if len(songs) <= 3 else 2 if len(songs) <= 6 else 3
        stages = []
        for i in range(singles):
            pick = ready[i] if i < len(ready) else None
            stages.append(dict(nombre=f"Single {pick['titulo'] if pick else i + 1}", tipo='Single', fecha=(start - timedelta(weeks=5 * (singles - i))).isoformat(),
                               canciones=[pick['id']] if pick else [], distribuidora='AMA'))
        stages.append(dict(nombre=album['nombre'], tipo='EP' if len(songs) <= 6 else 'Disco completo', fecha=start.isoformat(),
                           canciones=[s['id'] for s in songs], distribuidora='AMA'))
        return jsonify(nombre=f"Lanzamiento {album['nombre']}", disco_id=did, etapas=stages)

    @app.get('/api/campanas/<cid>/pdf')
    def rx_campaign_pdf(cid):
        import io
        from metadata_export import render_pdf
        with connect() as db:
            doc = doc_get(db, 'campana', cid, None)
            if doc is None:
                raise ValueError('Campaña inexistente.')
            view = campaign_view(db, cid, doc)
        fmt = lambda d: date.fromisoformat(d).strftime('%d/%m/%Y') if d else 'sin fecha'
        blocks = [('kicker', 'Campaña de lanzamiento'), ('title', view['nombre']), ('p', view.get('disco') or '')]
        for stage in view['etapas']:
            blocks.append(('h', f"{stage['nombre']} · {stage['tipo']}"))
            blocks.append(('kv', [('Salida', fmt(stage['fecha'])), ('Subir a la distribuidora', fmt(stage['limites'].get('distribuidora', ''))),
                                  ('Pitch a editores', fmt(stage['limites'].get('pitch', ''))), ('Distribuidora', stage['distribuidora']),
                                  ('Canciones', ', '.join(s['titulo'] for s in stage['canciones_det']) or '—'), ('Estado', stage['estado']),
                                  ('Condición para avanzar', stage.get('condicion') or '—')]))
        return send_file(io.BytesIO(render_pdf(blocks, view['nombre'])), mimetype='application/pdf', as_attachment=True,
                         download_name=re.sub(r'[^\w-]+', '_', view['nombre']) + '.pdf')

    # ── Audiovisual ──
    @app.get('/api/audiovisual')
    def rx_av_list():
        with connect() as db:
            items = doc_list(db, 'audiovisual')
            songs = {r['id']: r['titulo'] for r in db.execute('SELECT id,titulo FROM canciones')}
        return jsonify([dict(v, id=k, canciones_det=[dict(id=s, titulo=songs.get(s, '¿?')) for s in v.get('canciones', [])]) for k, v in items.items()])

    @app.get('/api/audiovisual/opciones')
    def rx_av_options():
        return jsonify(plantillas=list(AV_TEMPLATES), entregas=DELIVERY_PROFILES)

    @app.post('/api/audiovisual')
    @app.post('/api/audiovisual/<vid>')
    def rx_av_save(vid=None):
        data = request.get_json() or {}
        with connect() as db:
            doc = doc_get(db, 'audiovisual', vid, {}) if vid else {}
            if not vid:
                origin = data.get('origen', 'cancion')
                template = data.get('plantilla', 'Videoclip')
                if origin not in AV_ORIGINS or template not in AV_TEMPLATES:
                    raise ValueError('Origen o plantilla inválidos.')
                doc = dict(origen=origin, plantilla=template, estado='En desarrollo', creado=date.today().isoformat(),
                           etapas=[dict(nombre=s, tareas=[dict(nombre=t, hecha=False) for t in AV_TASKS.get(s, [])]) for s in AV_TEMPLATES[template]],
                           secciones=[], planos=[], tomas=[], versiones=[], entregas={p: False for p in DELIVERY_PROFILES}, generadas=[])
            for key, size in (('nombre', 150), ('cliente', 150), ('responsable', 150), ('proyecto_editor', 1000), ('estreno', 10), ('estado', 40), ('notas', 4000), ('artista_id', 64)):
                if key in data:
                    doc[key] = iso(data[key]) if key == 'estreno' else short_text(data[key], size)
            for key in ('etapas', 'secciones', 'planos', 'tomas', 'versiones'):
                if key in data:
                    if not isinstance(data[key], list) or len(data[key]) > 500:
                        raise ValueError('Lista demasiado larga.')
                    doc[key] = json.loads(json.dumps(data[key]))[:500]
            if 'entregas' in data and isinstance(data['entregas'], dict):
                doc['entregas'] = {k: bool(v) for k, v in data['entregas'].items() if k in DELIVERY_PROFILES}
            if 'canciones' in data:
                songs = [s for s in data['canciones'] if isinstance(s, str)][:40]
                for sid in songs:
                    required_row(db, 'canciones', sid)
                doc['canciones'] = songs
                if songs and not doc.get('master'):
                    master = db.execute("SELECT id,nombre FROM archivos WHERE cancion_id=? AND etapa='mastering' ORDER BY creado DESC LIMIT 1", (songs[0],)).fetchone()
                    if master:
                        doc['master'] = dict(id=master['id'], nombre=master['nombre'])
            if not doc.get('nombre'):
                raise ValueError('Poné un nombre al audiovisual.')
            vid = vid or uuid.uuid4().hex
            doc_put(db, 'audiovisual', vid, doc)
        return jsonify(dict(doc, id=vid))

    @app.get('/api/audiovisual/<vid>/master')
    def rx_av_master(vid):
        """Avisa si el audio usado en el video ya no es el master vigente de la canción."""
        with connect() as db:
            doc = doc_get(db, 'audiovisual', vid, {})
            if not doc.get('canciones'):
                return jsonify(estado='sin-cancion')
            latest = db.execute("SELECT id,nombre FROM archivos WHERE cancion_id=? AND etapa='mastering' ORDER BY creado DESC LIMIT 1", (doc['canciones'][0],)).fetchone()
        if not latest:
            return jsonify(estado='sin-master')
        used = doc.get('master', {})
        return jsonify(estado='al-dia' if used.get('id') == latest['id'] else 'nuevo', usado=used, vigente=dict(latest))

    @app.post('/api/audiovisual/<vid>/desprender')
    def rx_av_split(vid):
        """«Desprender música»: crea canciones con los audios del rodaje en la etapa Mezcla, vinculadas al video."""
        data = request.get_json() or {}
        items = data.get('canciones', [])
        if not isinstance(items, list) or not 0 < len(items) <= 30:
            raise ValueError('Indicá entre 1 y 30 canciones.')
        artist_id = short_text(data.get('artista_id', ''), 64)
        created = []
        client = app.test_client()
        with connect() as db:
            required_row(db, 'artistas', artist_id)
            doc = doc_get(db, 'audiovisual', vid, None)
            if doc is None:
                raise ValueError('Audiovisual inexistente.')
        for item in items:
            title = short_text(item.get('titulo', ''), 150)
            path = Path(short_text(item.get('ruta', ''), 1000))
            if not title or not path.is_file():
                raise ValueError(f'Revisá el título y el archivo de «{title or "sin título"}».')
            response = client.post(f'/api/artistas/{artist_id}/canciones', json={'titulo': title, 'disco_id': data.get('disco_id', '')})
            if response.status_code >= 400:
                raise ValueError(response.get_json().get('error', 'No se pudo crear la canción.'))
            sid = response.get_json()['id']
            linked = client.post(f'/api/produccion/{sid}/vinculos', json={'etapa': 'mezcla', 'ruta': str(path)})
            if linked.status_code >= 400:
                raise ValueError(linked.get_json().get('error', 'No se pudo vincular el audio.'))
            created.append(dict(id=sid, titulo=title))
        with connect() as db:
            doc = doc_get(db, 'audiovisual', vid, {})
            doc['canciones'] = list(dict.fromkeys(doc.get('canciones', []) + [c['id'] for c in created]))
            doc['generadas'] = doc.get('generadas', []) + [c['id'] for c in created]
            doc_put(db, 'audiovisual', vid, doc)
        return jsonify(ok=True, canciones=created)

    # ── Asistente Claude ──
    def vault():
        from cloud_auth import CredentialStore
        return CredentialStore(Path(data_folder()) / 'asistente.dpapi')

    @app.get('/api/asistente/config')
    def rx_assistant_config():
        with connect() as db:
            config = doc_get(db, 'config', 'asistente', {})
        try:
            has_key = bool(vault().read().get('api_key'))
        except Exception:
            has_key = False
        result = dict(modelo='claude-sonnet-5-5', nivel='leer', tope_tokens=2_000_000, usados=0, mes='', confirmar=True, compartir_audio=False)
        result.update(config, clave=has_key)
        return jsonify(result)

    @app.post('/api/asistente/config')
    def rx_assistant_config_save():
        data = request.get_json() or {}
        with connect() as db:
            config = doc_get(db, 'config', 'asistente', {})
            if data.get('nivel') in ('leer', 'sugerir', 'actuar'):
                config['nivel'] = data['nivel']
            if isinstance(data.get('modelo'), str) and re.fullmatch(r'claude-[a-z0-9.-]{3,60}', data['modelo']):
                config['modelo'] = data['modelo']
            if 'tope_tokens' in data:
                config['tope_tokens'] = max(0, min(100_000_000, int(data['tope_tokens'] or 0)))
            for key in ('confirmar', 'compartir_audio'):
                if key in data:
                    config[key] = bool(data[key])
            doc_put(db, 'config', 'asistente', config)
        if 'api_key' in data:
            key = str(data['api_key']).strip()
            if key and not re.fullmatch(r'sk-ant-[A-Za-z0-9_-]{20,200}', key):
                raise ValueError('La clave de API empieza con «sk-ant-». Copiala desde la Claude Console.')
            store = vault()
            current = store.read() if hasattr(store, 'read') else {}
            current['api_key'] = key
            store.write(current)
        return jsonify(ok=True)

    @app.post('/api/asistente/mensaje')
    def rx_assistant_message():
        data = request.get_json() or {}
        messages = data.get('mensajes', [])
        if not isinstance(messages, list) or not messages or len(messages) > 40:
            raise ValueError('Conversación inválida.')
        clean = [dict(role='user' if m.get('rol') == 'user' else 'assistant', content=short_text(m.get('texto', ''), 20000)) for m in messages]
        with connect() as db:
            config = doc_get(db, 'config', 'asistente', {})
        month = date.today().strftime('%Y-%m')
        if config.get('mes') != month:
            config.update(mes=month, usados=0)
        if config.get('usados', 0) >= config.get('tope_tokens', 2_000_000):
            raise ValueError('Se alcanzó el tope mensual de uso del asistente. Podés subirlo en Configuración › Claude.')
        key = vault().read().get('api_key', '')
        if not key:
            raise ValueError('Falta la clave de API: cargala en Configuración › Claude.')
        system = ('Sos el asistente de AudioTaller, una app de gestión de producción musical en Argentina. Respondé en español rioplatense, '
                  'breve y concreto. Contexto de la pantalla actual: ' + short_text(data.get('contexto', ''), 6000) +
                  '. Nivel de permisos: ' + config.get('nivel', 'leer') + '. No inventes datos; si algo no está en el contexto, decilo. '
                  'Nunca envíes mensajes por WhatsApp: solo redactás el texto para que el productor lo envíe.')
        payload = json.dumps(dict(model=config.get('modelo', 'claude-sonnet-5-5'), max_tokens=1200, system=system, messages=clean)).encode()
        req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=payload, method='POST',
                                     headers={'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                result = json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = json.loads(error.read() or b'{}').get('error', {}).get('message', '')
            raise ValueError(f'Claude respondió con un error ({error.code}). {detail}'.strip())
        except urllib.error.URLError:
            raise ValueError('No hay conexión con Claude. Revisá Internet e intentá de nuevo.')
        usage = result.get('usage', {})
        config['usados'] = config.get('usados', 0) + usage.get('input_tokens', 0) + usage.get('output_tokens', 0)
        with connect() as db:
            doc_put(db, 'config', 'asistente', config)
        text = ''.join(block.get('text', '') for block in result.get('content', []) if block.get('type') == 'text')
        return jsonify(texto=text, usados=config['usados'], tope=config.get('tope_tokens'))
