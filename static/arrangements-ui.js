// Arreglos · escuchar las pistas crudas de la canción (multipista con M/S y versiones del arreglo)
// y armar una sesión nueva del DAW organizada por buses según un perfil editable.
const arr = {songs: [], song: '', tab: 'listen', tracks: [], buses: [], versions: [], version: 'Base', muted: new Set(), solo: new Set(),
    playing: false, loading: false, raf: 0, profiles: {}, profile: 'mezcla', meta: null, result: null, q: '', ab: false};
const ARR_MAX = 32;

async function openArrangements() {
    go('arrangements');
    await renderArrangementsPane();
}
async function renderArrangementsPane() {
    if (!arr.songs.length) arr.songs = await api('/api/arreglos/canciones').catch(() => []);
    if (!Object.keys(arr.profiles).length) arr.profiles = await api('/api/buses/perfiles').catch(() => ({}));
    paintArrangements();
}
async function pickArrangementSong(id) {
    arrStop();
    arr.song = id; arr.tracks = []; arr.result = null; arr.version = 'Base'; arr.muted.clear(); arr.solo.clear();
    paintArrangements();
    const [takes, meta, versions] = await Promise.all([api('/api/arreglos/canciones/' + id + '/tomas'), api('/api/creditos/' + id).catch(() => null),
        api('/api/arreglos/' + id + '/versiones').catch(() => [])]);
    arr.meta = meta; arr.versions = versions;
    let audio = takes.tomas.filter(t => /\.(wav|aif|aiff|flac)$/i.test(t.nombre));
    // Las pistas crudas salen de las carpetas de sesión; las mezclas de la carpeta de la canción no son pistas del arreglo.
    if (audio.some(t => t.origen !== 'Carpeta de la canción')) audio = audio.filter(t => t.origen !== 'Carpeta de la canción');
    const classified = await api('/api/arreglos/' + id + '/clasificar', body({perfil_id: arr.profile, pistas: audio}));
    arr.tracks = classified.pistas.map((t, i) => ({...t, origen: audio[i]?.origen || '', carpeta: audio[i]?.carpeta || ''}));
    arr.buses = classified.buses;
    paintArrangements();
}
function arrBusColor(name) { return arr.buses.find(b => b.nombre === name)?.color || '#8A8A94'; }
function paintArrangements() {
    const root = $('arrangements');
    const song = arr.songs.find(s => s.id === arr.song);
    if (!song) {
        root.innerHTML = `<header class="mk-head"><h1>Arreglos</h1><p class="muted">Escuchá las pistas crudas de cada canción sin abrir el DAW y armá una sesión nueva organizada por buses.</p></header>
          <div class="mk-tools"><label class="mk-search"><input id="arrQ" type="search" placeholder="Buscar canción, artista o disco" value="${esc(arr.q)}"></label></div>
          <div class="arr-pick">${arr.songs.filter(s => !arr.q || [s.titulo, s.artista, s.disco].join(' ').toLowerCase().includes(arr.q.toLowerCase())).map(s => `<button class="arr-song" onclick="pickArrangementSong('${s.id}').catch(report)">
            <span class="arr-cover" style="${placeholderArt(s.id, 'grabacion')}"></span><strong>${esc(s.titulo)}</strong><small>${esc([s.disco || 'Canción suelta', s.artista].join(' · '))}</small></button>`).join('') || '<p class="muted">No hay canciones.</p>'}</div>`;
        const input = $('arrQ');
        input.oninput = () => { arr.q = input.value; const pos = input.selectionStart; paintArrangements(); $('arrQ').focus(); $('arrQ').setSelectionRange(pos, pos); };
        return;
    }
    const m = arr.meta;
    const origins = [...new Set(arr.tracks.map(t => t.origen))];
    root.innerHTML = `<section class="arr-hero"><span class="arr-cover big" style="${placeholderArt(song.id, 'grabacion')}"></span>
        <div class="arr-title"><span class="eyebrow">Arreglos · grabaciones originales</span><h1>${esc(song.titulo)}</h1>
          <p class="muted">${esc([song.disco || 'Canción suelta', song.artista].join(' · '))}${m?.duracion ? ' · <span class="mono">' + esc(m.duracion) + '</span>' : ''}</p>
          ${m ? `<div class="arr-chips"><span class="mono ${m.iswc ? '' : 'warn'}">ISWC ${esc(m.iswc || 'falta')}</span><span class="mono ${m.isrc ? '' : 'warn'}">ISRC ${esc(m.isrc || 'falta')}</span>
            <span>Autoría: ${m.autores.length ? esc(m.autores.map(a => `${a.nombre} ${formatDecimal(a.porcentaje, 2)} %`).join(' · ')) : 'sin cargar'}</span>
            <span class="${Math.abs(m.total_autoria - 100) < 0.01 && !m.faltan.length ? 'ok' : 'warn'}">Créditos ${formatDecimal(Math.round((5 - Math.min(5, m.faltan.length)) / 5 * 100), 0)} %</span></div>` : ''}</div>
        <div class="arr-source"><label>Pistas tomadas de <select onchange="arr.origin=this.value;paintArrangements()"><option value="">Todas las sesiones</option>${origins.map(o => `<option ${arr.origin === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
          <small class="muted">Archivos crudos completos: sin efectos, sin recortes ni fundidos</small>
          <button class="link" onclick="arrStop();arr.song='';paintArrangements()">Cambiar de canción</button></div></section>
      <nav class="arr-tabs">${[['listen', 'Escuchar arreglos'], ['buses', 'Buses y sesión del DAW']].map(([id, label]) => `<button class="${arr.tab === id ? 'is-on' : ''}" onclick="arr.tab='${id}';paintArrangements()">${label}</button>`).join('')}</nav>
      ${!arr.tracks.length ? '<p class="muted arr-empty">Buscando pistas… Si no aparece ninguna, vinculá la sesión de grabación o de mezcla en la canción.</p>' : arr.tab === 'listen' ? arrListen() : `<div class="arr-pad">${arrBuses()}</div>`}`;
    if (arr.tab === 'listen') arrDrawWaves();
}
function arrSongView() { return ''; }
function arrVersionSet(name) {
    if (name === 'Base' || name === 'Todo lo grabado') return null;
    const version = arr.versions.find(v => v.nombre === name);
    return version ? new Set(version.pistas.map(p => p.nombre)) : null;
}
function arrInVersion(track) { const set = arrVersionSet(arr.ab ? 'Base' : arr.version); return !set || set.has(track.nombre); }
function arrAudible(track) {
    if (!arrInVersion(track)) return false;
    if (arr.solo.size) return arr.solo.has(track.token);
    return !arr.muted.has(track.token);
}
const arrLabel = name => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
function arrListen() {
    const order = arr.buses.map(b => b.nombre);
    const tracks = arr.tracks.filter(t => !arr.origin || t.origen === arr.origin).slice(0, ARR_MAX);
    const groups = {};
    tracks.forEach(t => (groups[t.bus || 'Sin reconocer'] ||= []).push(t));
    const sorted = Object.entries(groups).sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
    const versions = [['Base', 'Base · grabación', 'Lo que se grabó', tracks.length], ...arr.versions.map(v => [v.nombre, v.nombre, 'Arreglo guardado', v.pistas.length]), ['Todo lo grabado', 'Todo lo grabado', 'Todas las pistas de la sesión', arr.tracks.length]];
    const sounding = tracks.filter(arrAudible).length;
    return `<div class="arr-body"><aside class="arr-versions"><span class="eyebrow">Versiones del arreglo</span>
        ${versions.map(([id, name, desc, n]) => `<button class="arr-ver ${arr.version === id && !arr.ab ? 'is-on' : ''}" onclick="arr.version='${esc(id)}';arr.ab=false;arrApplyMix();paintArrangements()"><strong>${esc(name)}</strong><small>${esc(desc)}</small><small>${countLabel(n, 'pista', 'pistas')}</small></button>`).join('')}
        <button class="arr-save" onclick="saveArrangementVersion().catch(report)">+ Guardar la mezcla actual como arreglo</button>
        <div class="arr-compare"><strong>Comparar</strong><div class="seg"><button class="${arr.ab ? 'is-on' : ''}" onclick="arr.ab=true;arrApplyMix();paintArrangements()">A · Base</button><button class="${arr.ab ? '' : 'is-on'}" onclick="arr.ab=false;arrApplyMix();paintArrangements()">B · ${esc(arr.version)}</button></div>
          <small class="muted">Cambia entre arreglos sin cortar la reproducción.</small></div></aside>
      <section class="arr-tracks"><div class="arr-transport2"><button class="mk-bigplay" onclick="arrToggle()" aria-label="${arr.playing ? 'Pausar' : 'Reproducir'}">${arr.playing ? '❚❚' : '▶'}</button>
          <span class="arr-clock mono"><b id="arrClock">0:00</b> / <span id="arrTotal">—</span></span>
          <span>Sonando: <b>${esc(arr.ab ? 'Base' : arr.version)}</b> · ${sounding} de ${tracks.length} pistas</span><span class="spacer"></span>
          ${arr.solo.size ? '<button class="mk-btn" onclick="arr.solo.clear();arrApplyMix();paintArrangements()">Quitar solos</button>' : ''}</div>
        ${sorted.map(([bus, list]) => `<div class="arr-bus" style="--c:${arrBusColor(bus)}"><span class="arr-bus-name">${esc(bus)}</span>
          ${list.map(t => `<div class="arr-row ${arrAudible(t) ? '' : 'is-off'}"><i class="arr-bar"></i><span class="arr-name"><strong>${esc(arrLabel(t.nombre))}</strong><small class="mono">${esc(t.nombre)}</small></span>
            <button class="ms ${arr.muted.has(t.token) ? 'on-m' : ''}" onclick="arrMS('m','${t.token}')" aria-pressed="${arr.muted.has(t.token)}">M</button>
            <button class="ms ${arr.solo.has(t.token) ? 'on-s' : ''}" onclick="arrMS('s','${t.token}')" aria-pressed="${arr.solo.has(t.token)}">S</button>
            <canvas class="arr-wave" data-wave="${t.token}" onclick="arrSeekWave(event)"></canvas>${arrInVersion(t) ? '<span></span>' : '<small class="muted arr-out">fuera del arreglo</small>'}</div>`).join('')}</div>`).join('')}
      </section></div>`;
}
const arrPeaks = new Map();

// ── Motor multipista ──
// Cada pista se lee por tramos cortos (pedidos HTTP con rango) y se programa en Web Audio sobre un único reloj.
// Así las pistas quedan alineadas al sample, silenciar o hacer solo no corta nada y no se agotan las conexiones:
// con un <audio> por pista el navegador cargaba 6 a la vez, el resto quedaba mudo y las correcciones de
// desfase trababan el sonido y la ventana. Los archivos originales solo se leen.
const ARR_CHUNK = 3, ARR_AHEAD = 6, ARR_HEAD_BYTES = 262144;
const mt = {ctx: null, tracks: new Map(), origin: 0, offset: 0, timer: 0, session: 0};

function arrCtx() {
    if (!mt.ctx) mt.ctx = new (window.AudioContext || window.webkitAudioContext)();
    return mt.ctx;
}
function arrActiveTracks() { return arr.tracks.filter(t => !arr.origin || t.origen === arr.origin).slice(0, ARR_MAX); }
async function arrRange(url, from, to) {
    const response = await fetch(url, {headers: {Range: `bytes=${from}-${to}`}});
    if (!response.ok) throw Error('No se pudo leer la pista.');
    const total = Number((response.headers.get('Content-Range') || '').split('/')[1]) || 0;
    const buf = await response.arrayBuffer();
    // Si el servidor ignorara el rango devolvería el archivo entero: se recorta acá.
    return response.status === 206 ? {buf, total} : {buf: buf.slice(from, to + 1), total: buf.byteLength};
}
function arrFourCC(view, at) { return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3)); }
function arrExtended(view, at) {   // frecuencia de muestreo de AIFF (coma flotante de 80 bits)
    const exp = (view.getUint16(at) & 0x7FFF) - 16383;
    return Math.round(view.getUint32(at + 2) * Math.pow(2, exp - 31));
}
// Lee el encabezado WAV (PCM, coma flotante, extensible, RF64) o AIFF/AIFC; null si hay que decodificar entero.
function arrParseHeader(buf, fileSize) {
    const v = new DataView(buf);
    if (buf.byteLength < 12) return null;
    const kind = arrFourCC(v, 0), form = arrFourCC(v, 8);
    const wav = (kind === 'RIFF' || kind === 'RF64') && form === 'WAVE', aiff = kind === 'FORM' && (form === 'AIFF' || form === 'AIFC');
    if (!wav && !aiff) return null;
    let pos = 12, fmt = null;
    while (pos + 8 <= buf.byteLength) {
        const id = arrFourCC(v, pos), size = v.getUint32(pos + 4, wav), body = pos + 8;
        if (wav && id === 'fmt ' && body + 16 <= buf.byteLength) {
            let code = v.getUint16(body, true);
            if (code === 0xFFFE && size >= 26) code = v.getUint16(body + 24, true);
            fmt = {code, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true), little: true, signed8: false};
        } else if (aiff && id === 'COMM' && body + 18 <= buf.byteLength) {
            let code = 1, little = false;
            if (form === 'AIFC') {
                const c = arrFourCC(v, body + 18);
                if (c === 'sowt') little = true; else if (c === 'fl32' || c === 'FL32') code = 3; else if (c !== 'NONE') return null;
            }
            fmt = {code, channels: v.getUint16(body), bits: v.getUint16(body + 6), rate: arrExtended(v, body + 8), little, signed8: true};
        } else if (fmt && (wav ? id === 'data' : id === 'SSND')) {
            const skip = wav ? 0 : 8 + v.getUint32(body);
            const start = body + skip, available = Math.max(0, fileSize - start);
            const declared = wav && (size === 0 || size === 0xFFFFFFFF) ? available : size - (wav ? 0 : 8 + v.getUint32(body));
            const bytes = Math.min(declared, available), frameBytes = fmt.bits / 8 * fmt.channels;
            const ok = fmt.channels >= 1 && fmt.rate >= 3000 && fmt.rate <= 768000 &&
                (fmt.code === 1 && [8, 16, 24, 32].includes(fmt.bits) || fmt.code === 3 && [32, 64].includes(fmt.bits));
            return ok ? {...fmt, start, frames: Math.floor(bytes / frameBytes)} : null;
        }
        pos = body + size + (size % 2);
    }
    return null;
}
function arrDecode(h, raw) {
    const w = h.bits / 8, frames = Math.floor(raw.byteLength / (w * h.channels));
    const out = arrCtx().createBuffer(h.channels, Math.max(1, frames), h.rate);
    const v = new DataView(raw), le = h.little;
    const chans = Array.from({length: h.channels}, (_, c) => out.getChannelData(c));
    for (let f = 0, p = 0; f < frames; f++) {
        for (let c = 0; c < h.channels; c++, p += w) {
            let s;
            if (h.code === 3) s = w === 4 ? v.getFloat32(p, le) : v.getFloat64(p, le);
            else if (w === 2) s = v.getInt16(p, le) / 32768;
            else if (w === 3) {
                const n = le ? v.getUint8(p) | v.getUint8(p + 1) << 8 | v.getUint8(p + 2) << 16 : v.getUint8(p) << 16 | v.getUint8(p + 1) << 8 | v.getUint8(p + 2);
                s = (n << 8 >> 8) / 8388608;
            } else if (w === 4) s = v.getInt32(p, le) / 2147483648;
            else s = h.signed8 ? v.getInt8(p) / 128 : (v.getUint8(p) - 128) / 128;
            chans[c][f] = s;
        }
    }
    return out;
}
function arrTrackState(track) {
    let s = mt.tracks.get(track.token);
    if (!s) {
        const ctx = arrCtx(), gain = ctx.createGain();
        gain.gain.value = arrAudible(track) ? 1 : 0;
        gain.connect(ctx.destination);
        s = {url: '/api/arreglos/audio/' + encodeURIComponent(track.token), gain, head: null, whole: null, duration: 0,
             frame: 0, pos: null, busy: false, failed: false, sources: new Set()};
        s.ready = arrLoadHeader(s);
        mt.tracks.set(track.token, s);
    }
    return s;
}
async function arrLoadHeader(s) {
    try {
        const {buf, total} = await arrRange(s.url, 0, ARR_HEAD_BYTES - 1);
        s.head = arrParseHeader(buf, total || buf.byteLength);
        if (s.head) { s.duration = s.head.frames / s.head.rate; return; }
        // FLAC u otro formato comprimido: se decodifica una vez entero (no se puede leer por tramos).
        const full = await (await fetch(s.url)).arrayBuffer();
        s.whole = await arrCtx().decodeAudioData(full);
        s.duration = s.whole.duration;
    } catch { s.failed = true; }
}
function arrPlace(s, t) {
    s.pos = Math.min(t, s.duration);
    if (s.head) s.frame = Math.min(s.head.frames, Math.floor(s.pos * s.head.rate));
}
async function arrFetch(s) {
    if (s.busy || s.failed || s.pos == null || s.pos >= s.duration) return null;
    s.busy = true;
    const session = mt.session;
    try {
        if (s.whole) { const from = s.pos; s.pos = s.duration; return {buffer: s.whole, from, skip: from, len: s.duration - from}; }
        const h = s.head, frameBytes = h.bits / 8 * h.channels;
        const f0 = s.frame, f1 = Math.min(h.frames, f0 + Math.round(ARR_CHUNK * h.rate));
        s.frame = f1; s.pos = f1 / h.rate;
        const {buf} = await arrRange(s.url, h.start + f0 * frameBytes, h.start + f1 * frameBytes - 1);
        if (session !== mt.session) return null;
        return {buffer: arrDecode(h, buf), from: f0 / h.rate, skip: 0, len: (f1 - f0) / h.rate};
    } catch { s.failed = true; return null; } finally { s.busy = false; }
}
function arrSchedule(s, chunk) {
    const ctx = mt.ctx, when = mt.origin + chunk.from, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = chunk.buffer; src.connect(s.gain);
    // Un tramo que llega tarde entra en su lugar exacto (se saltea lo ya pasado): nunca se desfasa.
    if (when >= now) src.start(when, chunk.skip);
    else if (now - when < chunk.len) src.start(now, chunk.skip + (now - when));
    else { src.disconnect(); return; }
    s.sources.add(src);
    src.onended = () => { s.sources.delete(src); src.disconnect(); };
}
function arrSilence() {
    mt.session++;
    clearInterval(mt.timer);
    for (const s of mt.tracks.values()) {
        s.sources.forEach(src => { try { src.stop(); } catch {} src.disconnect(); });
        s.sources.clear(); s.pos = null;
    }
}
function arrNow() { return arr.playing && !arr.loading && mt.ctx ? Math.max(0, mt.ctx.currentTime - mt.origin) : mt.offset; }
function arrTotal() {
    // Solo las pistas de la canción abierta (las ondas de otras canciones quedan guardadas en arrPeaks).
    let total = 0;
    for (const t of arrActiveTracks()) total = Math.max(total, mt.tracks.get(t.token)?.duration || 0, arrPeaks.get(t.token)?.done?.duration || 0);
    return total;
}
async function arrPlayFrom(t) {
    const ctx = arrCtx();
    arrSilence();
    const session = mt.session;
    mt.offset = t; arr.playing = true; arr.loading = true;
    await ctx.resume();
    const states = arrActiveTracks().map(arrTrackState);
    await Promise.all(states.map(s => s.ready));
    if (session !== mt.session) return;
    states.forEach(s => arrPlace(s, t));
    // Se espera el primer tramo de todas las pistas para que arranquen juntas.
    const first = await Promise.all(states.map(arrFetch));
    if (session !== mt.session) return;
    mt.origin = ctx.currentTime + 0.05 - t;
    arr.loading = false;
    states.forEach((s, i) => first[i] && arrSchedule(s, first[i]));
    mt.timer = setInterval(arrPump, 250);
    arrTick();
}
function arrPump() {
    if (!arr.playing || arr.loading) return;
    const now = arrNow(), session = mt.session;
    for (const t of arrActiveTracks()) {
        const s = arrTrackState(t);
        // Pista que se suma mientras suena (p. ej. al cambiar de sesión de origen): entra en el punto actual.
        if (s.pos == null) { s.ready.then(() => { if (s.pos == null && session === mt.session) arrPlace(s, arrNow()); }); continue; }
        if (s.pos < now + ARR_AHEAD) arrFetch(s).then(chunk => chunk && session === mt.session && arrSchedule(s, chunk));
    }
    const total = arrTotal();
    if (total && now >= total) { arrSilence(); arr.playing = false; mt.offset = total; arrDrawWaves(); paintArrangements(); }
}
async function arrDrawWaves() {
    if (arr.drawing) return;   // un solo dibujo a la vez: con 32 pistas los dibujos superpuestos trababan la ventana
    arr.drawing = true;
    try {
        const canvases = [...document.querySelectorAll('canvas[data-wave]')];
        const data = await Promise.all(canvases.map(canvas => {
            const token = canvas.dataset.wave;
            if (!arrPeaks.has(token)) {
                const entry = api('/api/arreglos/onda/' + encodeURIComponent(token)).catch(() => ({peaks: []}));
                entry.then(d => { entry.done = d; });
                arrPeaks.set(token, entry);
            }
            return arrPeaks.get(token);
        }));
        const total = arrTotal(), progress = total ? arrNow() / total : 0;
        canvases.forEach((canvas, n) => {
            if (!canvas.isConnected) return;
            const box = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
            if (canvas.width !== Math.round(box.width * ratio)) { canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio); }
            const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, box.width, box.height);
            const color = getComputedStyle(canvas.closest('.arr-bus')).getPropertyValue('--c').trim() || '#8A8A94';
            const peaks = data[n].peaks || [], max = Math.max(...peaks, 0.01);
            // Cada pista ocupa el ancho que le corresponde por su duración: una toma corta se ve corta.
            const span = total && data[n].duration ? Math.min(1, data[n].duration / total) : 1;
            const bars = Math.max(1, Math.floor(box.width * span / 6));
            const off = canvas.closest('.arr-row').classList.contains('is-off');
            ctx.globalAlpha = off ? 0.18 : 1; ctx.fillStyle = color;
            for (let i = 0; i < bars; i++) {
                const v = peaks.length ? peaks[Math.floor(i / bars * peaks.length)] / max : 0.3;
                const h = Math.max(3, v * (box.height - 4));
                ctx.fillRect(i * 6, (box.height - h) / 2, 4, h);
            }
            if (progress) { ctx.globalAlpha = 1; ctx.fillStyle = '#EDEDF0'; ctx.fillRect(progress * box.width, 0, 1.5, box.height); }
        });
    } finally { arr.drawing = false; }
}
function arrSeekTo(t) {
    if (arr.playing) arrPlayFrom(t).catch(report);
    else { mt.offset = t; arrTick(); arrDrawWaves(); }
}
function arrSeekWave(event) {
    const total = arrTotal();
    if (!total) { arrToggle(); return; }
    const box = event.currentTarget.getBoundingClientRect();
    arrSeekTo(Math.max(0, Math.min(total, (event.clientX - box.left) / box.width * total)));
}
function arrMS(kind, token) {
    const set = kind === 'm' ? arr.muted : arr.solo;
    set.has(token) ? set.delete(token) : set.add(token);
    arrApplyMix(); paintArrangements();
}
function arrApplyMix() {
    if (!mt.ctx) return;
    for (const t of arr.tracks) {
        const s = mt.tracks.get(t.token);
        if (s) s.gain.gain.setTargetAtTime(arrAudible(t) ? 1 : 0, mt.ctx.currentTime, 0.015);
    }
}
function arrToggle() {
    if (arr.playing) { mt.offset = arrNow(); arrSilence(); arr.playing = false; arr.loading = false; cancelAnimationFrame(arr.raf); }
    else {
        const total = arrTotal();
        // Al terminar, volver a reproducir arranca desde el principio.
        arrPlayFrom(total && mt.offset >= total - 0.05 ? 0 : mt.offset).catch(error => { arr.playing = false; report(error); });
        arrApplyMix();
    }
    paintArrangements();
}
function arrTick() {
    const now = arrNow(), total = arrTotal();
    if ($('arrClock')) $('arrClock').textContent = clockText(now);
    if ($('arrTotal') && total) $('arrTotal').textContent = clockText(total);
    arr.frame = (arr.frame || 0) + 1; if (arr.frame % 30 === 0) arrDrawWaves();
    cancelAnimationFrame(arr.raf);   // un único bucle aunque se salte en la onda mientras suena
    if (arr.playing) arr.raf = requestAnimationFrame(arrTick);
}
function arrSeek(event) {
    const total = arrTotal(); if (!total) return;
    const box = event.currentTarget.getBoundingClientRect();
    arrSeekTo(Math.max(0, (event.clientX - box.left) / box.width * total));
}
function arrStop() {
    // Además de parar, se sueltan los tramos en memoria y se libera la salida de audio.
    arrSilence();
    mt.tracks.forEach(s => s.gain.disconnect());
    mt.tracks.clear(); mt.offset = 0;
    arr.playing = false; arr.loading = false; cancelAnimationFrame(arr.raf);
    mt.ctx?.suspend().catch(() => {});
}
async function saveArrangementVersion() {
    const name = prompt('Nombre del arreglo (p. ej. «Arreglo de cuerdas», «Acústica»):');
    if (!name) return;
    const tokens = arr.tracks.slice(0, ARR_MAX).filter(arrAudible).map(t => t.token);
    await api('/api/arreglos/' + arr.song + '/versiones', body({nombre: name, pistas: tokens}));
    arr.versions = await api('/api/arreglos/' + arr.song + '/versiones');
    arr.version = name; arr.muted.clear(); arr.solo.clear();
    paintArrangements(); notify(`Arreglo «${name}» guardado con ${countLabel(tokens.length, 'pista', 'pistas')}.`);
}

// ── Sesión por buses ──
function arrBuses() {
    const profile = arr.profiles[arr.profile];
    const busNames = arr.buses.map(b => b.nombre);
    const versions = ['Todo lo grabado', ...arr.versions.map(v => v.nombre)];
    const set = arrVersionSet(arr.busVersion || 'Todo lo grabado');
    const list = arr.tracks.filter(t => !set || set.has(t.nombre));
    const unknown = list.filter(t => !t.bus).length;
    const bpm = arr.songs.find(s => s.id === arr.song)?.bpm;
    return `<div class="arr-buses">
      <div class="card arr-config">
        <div class="cr-grid"><label>Perfil<select onchange="arr.profile=this.value;pickArrangementSong(arr.song)">${Object.entries(arr.profiles).map(([id, p]) => `<option value="${id}" ${id === arr.profile ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
          <label>Desde el arreglo<select onchange="arr.busVersion=this.value;paintArrangements()">${versions.map(v => `<option ${v === (arr.busVersion || 'Todo lo grabado') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label>Etapa<select id="arrStage">${STAGE_ORDER.map(k => `<option value="${k}" ${k === 'mezcla' ? 'selected' : ''}>${esc(stageName(k))}</option>`).join('')}</select></label>
          <label>Nombre<input id="arrName" value="${esc(arr.busVersion && arr.busVersion !== 'Todo lo grabado' ? arr.busVersion : 'Arreglo')}"></label>
          <label>Tempo (BPM)<input id="arrTempo" inputmode="decimal" value="${esc(bpm || '120')}"></label></div>
        <span class="insp-label">DAW</span>
        <div class="daw-choice">
          <label><input type="radio" name="arrDaw" value="dawproject" checked><span><b>Cubase 14.0.20+ / Studio One / Bitwig</b><small>Archivo DAWproject · en Cubase: Archivo › Importar › DAWproject (Pro y Artist; no Elements)</small></span></label>
          <label><input type="radio" name="arrDaw" value="reaper"><span><b>REAPER</b><small>Proyecto .rpp con una carpeta por bus</small></span></label>
          <label class="is-disabled"><input type="radio" name="arrDaw" value="protools" disabled><span><b>Pro Tools</b><small>Necesita el Scripting SDK (PTSL) de Avid, gratuito: se habilita cuando esté instalado</small></span></label>
        </div>
        <span class="insp-help">Siempre se crea un proyecto NUEVO junto a la sesión: la original no se toca. Pistas crudas con nombre limpio, color y orden por bus; sin plugins. Queda registrada como versión adicional de la etapa.</span>
        ${unknown ? `<span class="warn-amber">${countLabel(unknown, 'pista sin reconocer', 'pistas sin reconocer')}: elegí su bus abajo (se aprende para la próxima).</span>` : ''}
        <button class="btn-primary" onclick="createBusSession().catch(report)">Crear sesión</button>
        ${arr.result ? `<div class="ok-green">✓ ${esc(arr.result.nombre)} creada con ${arr.result.buses} buses. <button class="link" onclick="openSong('${arr.song}').catch(report)">Ver en la canción</button></div>` : ''}
      </div>
      <div class="card"><div class="bus-head"><span>Pista</span><span>Bus</span><span>Detectado por</span></div>
        ${list.map(t => `<div class="bus-row ${t.bus ? '' : 'is-unknown'}" style="--c:${arrBusColor(t.bus)}"><span><strong>${esc(t.nombre)}</strong>${t.par ? `<span class="tag">${esc(t.par)}</span>` : ''}</span>
          <select data-bus="${t.token}" onchange="arrSetBus('${t.token}',this.value)"><option value="">¿A qué bus va?</option>${busNames.map(b => `<option ${b === t.bus ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
          <span class="muted">${t.palabra ? '«' + esc(t.palabra) + '»' : t.bus ? 'elegido a mano' : '—'}</span></div>`).join('')}
        <p class="insp-help">Perfil «${esc(profile?.nombre || '')}»: ${esc((profile?.buses || []).map(b => b.nombre).join(' · '))}. Reconoce pares L/R, DI + amplificador y multimicrófono por el nombre.</p></div>
    </div>`;
}
function arrSetBus(token, bus) {
    const t = arr.tracks.find(x => x.token === token);
    t.learned = !t.palabra && bus ? true : t.learned;
    t.bus = bus; paintArrangements();
}
async function createBusSession() {
    const daw = document.querySelector('[name=arrDaw]:checked').value;
    const set = arrVersionSet(arr.busVersion || 'Todo lo grabado');
    const list = arr.tracks.filter(t => !set || set.has(t.nombre));
    const missing = list.filter(t => !t.bus);
    if (missing.length && !confirm(`${countLabel(missing.length, 'pista no tiene bus', 'pistas no tienen bus')}: irán a «Otros». ¿Seguir?`)) return;
    const learn = {};
    for (const t of list.filter(t => t.learned && t.bus)) { const word = t.nombre.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-z0-9áéíóúñ]+/).filter(w => w.length > 2)[0]; if (word) learn[word] = t.bus; }
    arr.result = await api('/api/arreglos/' + arr.song + '/crear-sesion', body({daw, perfil_id: arr.profile, etapa: $('arrStage').value, nombre: $('arrName').value,
        tempo: $('arrTempo').value, pistas: list.map(t => ({token: t.token, bus: t.bus})), aprender: learn}));
    paintArrangements();
}
