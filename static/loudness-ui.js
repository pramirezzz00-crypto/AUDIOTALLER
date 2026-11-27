// Loudness Penalty: mide un master (ITU-R BS.1770: LUFS integrado y true peak) y muestra cuánto lo
// sube o baja cada plataforma al normalizar. Tocando una plataforma se escucha con esa ganancia.
// Todo se calcula en esta computadora: el audio no se sube a ningún lado.
const LP_PLATFORMS = [
    {id: 'youtube', nombre: 'YouTube', objetivo: -14, sube: false, nota: 'Solo baja los temas más fuertes.'},
    {id: 'spotify', nombre: 'Spotify', objetivo: -14, sube: true, nota: 'Normalización «Normal». Sube los temas bajos sin pasar de −1 dBTP.'},
    {id: 'tidal', nombre: 'TIDAL', objetivo: -14, sube: false, nota: 'Normaliza por álbum. Solo baja.'},
    {id: 'apple', nombre: 'Apple Music', objetivo: -16, sube: true, nota: 'Sound Check. Sube sin pasar de −1 dBTP.'},
    {id: 'amazon', nombre: 'Amazon Music', objetivo: -14, sube: false, nota: 'Solo baja.'},
    {id: 'deezer', nombre: 'Deezer', objetivo: -15, sube: false, nota: 'Solo baja.'},
    {id: 'soundcloud', nombre: 'SoundCloud', objetivo: null, sube: false, nota: 'No normaliza: suena tal cual lo subiste.'},
];
const lp = {name: '', buffer: null, result: null, sel: 'original', ctx: null, src: null, gain: null, startedAt: 0, offset: 0, playing: false, raf: 0, busy: false, lib: null, q: ''};

// ---------- Medición (BS.1770-4) ----------
function lpKFilter(fs) {
    // Filtro de ponderación K para cualquier frecuencia de muestreo (coeficientes de libebur128).
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
    const pb = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0];
    const pa = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs);
    const ra = [1, 2 * (K * K - 1) / (1 + K / Q + K * K), (1 - K / Q + K * K) / (1 + K / Q + K * K)];
    return {pb, pa, rb: [1, -2, 1], ra};
}
function lpWeighted(x, f) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, w1 = 0, w2 = 0;
    const [b0, b1, b2] = f.pb, a1 = f.pa[1], a2 = f.pa[2], c1 = f.ra[1], c2 = f.ra[2];
    for (let i = 0; i < x.length; i++) {
        const v = x[i], s = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = v;
        const o = s - 2 * y1 + y2 - c1 * w1 - c2 * w2;
        y2 = y1; y1 = s; w2 = w1; w1 = o; y[i] = o;
    }
    return y;
}
function lpBlocks(channels, fs, seconds, stepSeconds) {
    // Potencia media por bloque (suma de canales, peso 1 para L y R).
    const n = Math.round(seconds * fs), step = Math.round(stepSeconds * fs), len = channels[0].length, out = [];
    const cum = channels.map(ch => { const c = new Float64Array(ch.length + 1); for (let i = 0; i < ch.length; i++) c[i + 1] = c[i] + ch[i] * ch[i]; return c; });
    for (let start = 0; start + n <= len; start += step) {
        let z = 0;
        for (const c of cum) z += (c[start + n] - c[start]) / n;
        out.push(z);
    }
    return out;
}
const lpLufs = z => -0.691 + 10 * Math.log10(z);
function lpIntegrated(blocks) {
    const abs = blocks.filter(z => z > 0 && lpLufs(z) > -70);
    if (!abs.length) return -Infinity;
    const rel = lpLufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter(z => lpLufs(z) > rel);
    return lpLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}
function lpRange(shortTerm) {
    // Rango de loudness (EBU Tech 3342): percentiles 10 y 95 de los bloques de 3 s con compuerta −20 LU.
    const abs = shortTerm.filter(z => z > 0 && lpLufs(z) > -70);
    if (abs.length < 2) return 0;
    const rel = lpLufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 20;
    const vals = abs.map(lpLufs).filter(v => v > rel).sort((a, b) => a - b);
    if (vals.length < 2) return 0;
    const at = p => vals[Math.min(vals.length - 1, Math.round(p * (vals.length - 1)))];
    return at(0.95) - at(0.10);
}
let lpTaps = null;
function lpTruePeak(x) {
    // Sobremuestreo ×4 con un filtro sinc enventanado de 48 coeficientes (12 por fase).
    if (!lpTaps) {
        lpTaps = [0, 1, 2, 3].map(ph => {
            const t = [];
            for (let k = 0; k < 12; k++) {
                const n = k * 4 + ph, m = n - 23.5, w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (n + 0.5) / 48);
                t.push(m === 0 ? 1 : Math.sin(Math.PI * m / 4) / (Math.PI * m / 4) * w);
            }
            return t;
        });
    }
    let peak = 0;
    for (let i = 0; i < x.length; i++) {
        const a = x[i] < 0 ? -x[i] : x[i];
        if (a > peak) peak = a;
    }
    // Ventana deslizante en variables locales: mucho más rápido que indexar el arreglo 48 veces.
    const T = lpTaps.map(t => Float64Array.from(t));
    const [t0, t1, t2, t3] = T;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0, s8 = 0, s9 = 0, s10 = 0, s11 = 0;
    for (let i = 0; i < x.length; i++) {
        s11 = s10; s10 = s9; s9 = s8; s8 = s7; s7 = s6; s6 = s5; s5 = s4; s4 = s3; s3 = s2; s2 = s1; s1 = s0; s0 = x[i];
        for (let ph = 0; ph < 4; ph++) {
            const t = ph === 0 ? t0 : ph === 1 ? t1 : ph === 2 ? t2 : t3;
            let v = t[0] * s0 + t[1] * s1 + t[2] * s2 + t[3] * s3 + t[4] * s4 + t[5] * s5 + t[6] * s6 + t[7] * s7 + t[8] * s8 + t[9] * s9 + t[10] * s10 + t[11] * s11;
            if (v < 0) v = -v;
            if (v > peak) peak = v;
        }
    }
    return peak;
}
function lpMeasure(buffer) {
    const fs = buffer.sampleRate, raw = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) raw.push(buffer.getChannelData(c));
    const f = lpKFilter(fs), weighted = raw.map(ch => lpWeighted(ch, f));
    const momentary = lpBlocks(weighted, fs, 0.4, 0.1), shortTerm = lpBlocks(weighted, fs, 3, 1);
    let sample = 0;
    for (const ch of raw) for (let i = 0; i < ch.length; i++) { const a = ch[i] < 0 ? -ch[i] : ch[i]; if (a > sample) sample = a; }
    const tp = Math.max(...raw.map(lpTruePeak));
    const db = v => v > 0 ? 20 * Math.log10(v) : -Infinity;
    const integrated = lpIntegrated(momentary);
    return {integrado: integrated, truePeak: db(tp), picoMuestra: db(sample), cortoMax: shortTerm.length ? Math.max(...shortTerm.filter(z => z > 0).map(lpLufs)) : integrated,
        rango: lpRange(shortTerm), duracion: buffer.duration, canales: buffer.numberOfChannels, fs};
}
function lpPenalties(r) {
    return LP_PLATFORMS.map(p => {
        if (p.objetivo === null || !Number.isFinite(r.integrado)) return {...p, ganancia: 0};
        let g = p.objetivo - r.integrado;
        if (g > 0) g = p.sube ? Math.max(0, Math.min(g, -1 - r.truePeak)) : 0;
        return {...p, ganancia: Math.round(g * 10) / 10};
    });
}

// ---------- Pantalla ----------
function renderLoudnessPane() {
    if (lp.playing) lpPause();
    paintLoudness();
    if (!lp.result && !lp.busy && !lp.restored) { lp.restored = true; lpRestore().catch(() => {}); }
}

// ---------- Memoria local: el último análisis queda guardado en la carpeta de datos de AudioTaller ----------
// Sobrevive a cerrar la app. Un análisis nuevo lo reemplaza y «Reiniciar» lo borra.
async function lpRestore() {
    const saved = await api('/api/loudness/ultimo');
    if (!saved.hay || lp.result || lp.busy) return;
    const res = await fetch('/api/loudness/ultimo/audio');
    if (!res.ok) return;
    const bytes = await res.arrayBuffer();
    lp.ctx = lp.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await lp.ctx.decodeAudioData(bytes);
    if (lp.result || lp.busy) return;
    lp.buffer = buffer; lp.name = saved.nombre; lp.result = saved.resultado; lp.offset = 0; lp.sel = 'original';
    if (!$('loudnessPane').hidden) paintLoudness();
}
function lpSave(name, bytes, result) {
    const safe = JSON.stringify(result, (k, v) => typeof v === 'number' && !Number.isFinite(v) ? null : v);
    return fetch('/api/loudness/ultimo?nombre=' + encodeURIComponent(name), {method: 'POST', body: bytes,
        headers: {'Content-Type': 'application/octet-stream', 'X-Resultado': encodeURIComponent(safe)}});
}
async function lpReset() {
    lpStop();
    lp.buffer = null; lp.result = null; lp.name = ''; lp.sel = 'original';
    await api('/api/loudness/ultimo/borrar', body({})).catch(() => {});
    paintLoudness();
    notify('Listo: se borró el análisis. Soltá otro audio para empezar.');
}
const lpFmt = v => Number.isFinite(v) ? v.toFixed(1).replace('-', '−') : '—';
const lpSigned = v => v === 0 ? '0.0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1);
function paintLoudness() {
    const r = lp.result, root = $('loudnessPane');
    const pens = r ? lpPenalties(r) : [];
    root.innerHTML = `<header class="prod-head"><div><div class="eyebrow">Herramientas</div><h1>Loudness Penalty</h1>
        <p class="muted">Subí un master y mirá cuánto lo baja (o sube) cada plataforma al normalizar. Tocá una plataforma para escucharlo como va a sonar ahí. El análisis se hace en esta computadora: el audio no se sube a ningún lado.</p></div>
        ${r ? `<div class="row-tight"><button class="mk-btn" onclick="lpReset().catch(report)" title="Borra este análisis y vuelve a la pantalla inicial">↺ Reiniciar</button><button class="mk-btn" onclick="lpPickLibrary().catch(report)">De tus producciones…</button><button class="btn-primary" onclick="$('lpFile').click()">Analizar otro audio…</button></div>` : ''}</header>
      <div class="lp-overlay" aria-hidden="true"><div><b>Soltá el audio para analizarlo</b><span>${r ? 'Reemplaza el análisis actual' : 'WAV, AIFF, FLAC, MP3 o M4A'}</span></div></div>
      <input type="file" id="lpFile" accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a,.ogg" hidden>
      ${lp.busy ? `<div class="card mig-wait"><span class="spin"></span> Midiendo «${esc(lp.name)}»…</div>` : r ? lpResults(r, pens) : lpDrop()}`;
    const file = $('lpFile');
    file.onchange = () => { if (file.files[0]) lpLoadFile(file.files[0]).catch(lpFail); };
    // Arrastrar y soltar funciona en toda la sección, haya un análisis o no.
    if (!root.dataset.dnd) {
        root.dataset.dnd = '1';
        let depth = 0;
        const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
        root.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; root.classList.add('lp-dragging'); $('lpDrop')?.classList.add('is-over'); });
        root.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        root.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; root.classList.remove('lp-dragging'); $('lpDrop')?.classList.remove('is-over'); } });
        root.addEventListener('drop', e => {
            if (!hasFiles(e)) return;
            e.preventDefault(); depth = 0; root.classList.remove('lp-dragging');
            const f = e.dataTransfer.files[0];
            if (f && !lp.busy) lpLoadFile(f).catch(lpFail);
        });
    }
    lpPaintProgress();
}
function lpDrop() {
    return `<div class="lp-drop" id="lpDrop"><div class="lp-drop-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4"/></svg></div>
        <h2>Soltá acá tu master</h2><p class="muted lp-drop-hint">Podés soltar un audio en cualquier parte de esta sección, también cuando ya hay un análisis.</p><p class="muted">WAV, AIFF, FLAC, MP3 o M4A. Mejor si es el archivo final, sin limitador de monitoreo.</p>
        <div class="row-tight"><button class="btn-primary" onclick="$('lpFile').click()">Elegir archivo…</button><button class="mk-btn" onclick="lpPickLibrary().catch(report)">De tus producciones…</button></div></div>
      <p class="insp-help">Valores de referencia que publican las plataformas o que se miden en la práctica (YouTube, Spotify, TIDAL, Amazon −14 LUFS · Deezer −15 · Apple Music −16). Pueden cambiar y dependen de la configuración de cada oyente.</p>`;
}
function lpResults(r, pens) {
    const worst = Math.min(...pens.map(p => p.ganancia));
    const tpWarn = r.truePeak > -1;
    const over = -14 - r.integrado;
    const verdict = worst <= -3 ? `Está ${Math.abs(over).toFixed(1)} LU por encima de −14 LUFS: casi todas las plataformas lo bajan, y el volumen extra que ganaste comprimiendo se pierde.`
        : worst < 0 ? 'Está cerca del objetivo: las plataformas lo bajan poco.'
        : 'No lo bajan: en las plataformas que solo bajan va a sonar más despacio que temas más fuertes.';
    return `<section class="card lp-sum"><div class="lp-file"><b>${esc(lp.name)}</b><small class="mono">${Math.floor(r.duracion / 60)}:${String(Math.round(r.duracion % 60)).padStart(2, '0')} · ${r.canales === 1 ? 'mono' : 'estéreo'} · ${(r.fs / 1000).toFixed(1)} kHz</small></div>
        <div class="mig-summary lp-meters">${[['LUFS integrado', lpFmt(r.integrado), ''], ['True peak', (r.truePeak > 0 ? '+' : '') + lpFmt(r.truePeak) + ' dBTP', tpWarn ? 'is-warn' : ''], ['Short-term máx.', lpFmt(r.cortoMax) + ' LUFS', ''], ['Rango (LRA)', lpFmt(r.rango) + ' LU', '']]
            .map(([l, v, c]) => `<div class="${c}"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
        <p class="lp-verdict">${verdict}${tpWarn ? ' <span class="lp-warn">El true peak pasa de −1 dBTP: al convertirlo a MP3 o AAC puede saturar.</span>' : ''}</p></section>
      <h2 class="lp-h">Resultados <small class="muted">(en dB) · tocá una plataforma para escucharla</small></h2>
      <div class="lp-grid">
        <button class="lp-card ${lp.sel === 'original' ? 'is-on' : ''}" onclick="lpSelect('original')"><span class="lp-play">${lp.sel === 'original' && lp.playing ? '❚❚' : '▶'}</span><b class="lp-val zero">0.0</b><strong>Original</strong><small>Tu archivo, sin normalizar</small></button>
        ${pens.map(p => `<button class="lp-card ${lp.sel === p.id ? 'is-on' : ''}" title="${esc(p.nota)}" onclick="lpSelect('${p.id}')"><span class="lp-play">${lp.sel === p.id && lp.playing ? '❚❚' : '▶'}</span>
          <b class="lp-val ${p.ganancia < 0 ? 'neg' : p.ganancia > 0 ? 'pos' : 'zero'}">${lpSigned(p.ganancia)}</b><strong>${esc(p.nombre)}</strong>
          <small>${p.objetivo === null ? 'Sin normalización' : `Objetivo ${String(p.objetivo).replace('-', '−')} LUFS`}</small></button>`).join('')}
      </div>
      <div class="card lp-player"><button class="mk-bigplay" id="lpPlay" aria-label="${lp.playing ? 'Pausar' : 'Reproducir'}" onclick="lp.playing?lpPause():lpPlay()">${lp.playing ? '❚❚' : '▶'}</button>
        <div class="lp-track"><div class="lp-now">Escuchando: <b id="lpNow">${esc(lpSelLabel(pens))}</b></div>
          <div class="lp-bar" id="lpBar" onclick="lpSeek(event)"><i id="lpFill"></i></div></div>
        <span class="mono lp-time" id="lpTime">0:00 / 0:00</span></div>
      <p class="insp-help">Las plataformas que suben el volumen no pasan de −1 dBTP. Valores de referencia: pueden cambiar y dependen de la configuración de cada oyente (por ejemplo, Spotify «Fuerte» usa −11 LUFS con limitador).</p>`;
}
function lpSelLabel(pens) {
    if (lp.sel === 'original') return 'Original (0.0 dB)';
    const p = pens.find(x => x.id === lp.sel);
    return p ? `${p.nombre} (${lpSigned(p.ganancia)} dB)` : '';
}
function lpFail(error) {
    lp.busy = false; paintLoudness();
    report(new Error('No pude leer ese audio. Probá con WAV, AIFF, FLAC o MP3. (' + (error.message || error) + ')'));
}
async function lpLoadFile(file) {
    await lpAnalyze(file.name, await file.arrayBuffer());
}
async function lpAnalyze(name, bytes) {
    lpStop();
    lp.name = name; lp.busy = true; lp.result = null; paintLoudness();
    lp.ctx = lp.ctx || new (window.AudioContext || window.webkitAudioContext)();
    lp.bytes = bytes.slice(0);  // decodeAudioData consume el original; esta copia se guarda como último análisis
    const buffer = await lp.ctx.decodeAudioData(bytes);
    await new Promise(r => setTimeout(r, 30));
    lp.buffer = buffer; lp.result = lpMeasure(buffer); lp.busy = false; lp.offset = 0; lp.sel = 'original'; lp.restored = true;
    paintLoudness();
    lpSave(name, lp.bytes, lp.result).catch(() => {}); lp.bytes = null;
}
async function lpPickLibrary() {
    if (!lp.lib) lp.lib = (await api('/api/catalogo?limit=500')).audios || [];
    const list = lp.lib;
    formDialog('Elegir de tus producciones', `<input id="lpLibQ" placeholder="Buscar por canción, artista o archivo" autocomplete="off">
        <div class="lp-lib" id="lpLib"></div>`, async () => {
            const pick = $('iterationForm').querySelector('input[name=lpa]:checked');
            if (!pick) throw Error('Elegí un audio.');
            const a = list.find(x => String(x.id) === pick.value);
            const res = await fetch('/api/produccion/archivo/' + encodeURIComponent(a.id));
            if (!res.ok) throw Error('No encuentro el archivo en el disco.');
            lpAnalyze(lpAudioName(a), await res.arrayBuffer()).catch(lpFail);
        }, () => {
            $('iterationSubmit').textContent = 'Analizar';
            const paint = () => {
                const q = ($('lpLibQ').value || '').toLowerCase();
                const rows = list.filter(a => !q || JSON.stringify([a.nombre, a.cancion, a.artista, a.archivo]).toLowerCase().includes(q)).slice(0, 200);
                $('lpLib').innerHTML = rows.map(a => `<label class="chk"><input type="radio" name="lpa" value="${esc(String(a.id))}"> <span><b>${esc(lpAudioName(a))}</b><small class="muted">${esc([a.artista, a.etapa, a.disponible === false ? 'no está en el disco' : ''].filter(Boolean).join(' · '))}</small></span></label>`).join('')
                    || '<p class="muted">No hay audios que coincidan.</p>';
            };
            $('lpLibQ').oninput = paint; paint();
        });
}
const lpAudioName = a => [a.cancion || a.titulo, a.nombre || a.archivo].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join(' · ') || 'Audio';

// ---------- Escucha ----------
function lpGainFor(id) {
    if (id === 'original' || !lp.result) return 0;
    return lpPenalties(lp.result).find(p => p.id === id)?.ganancia || 0;
}
function lpSelect(id) {
    if (lp.sel === id && lp.playing) { lpPause(); return; }
    lp.sel = id;
    if (lp.gain) lp.gain.gain.setTargetAtTime(Math.pow(10, lpGainFor(id) / 20), lp.ctx.currentTime, 0.03);
    if (!lp.playing) lpPlay(); else paintLoudness();
}
function lpPlay() {
    if (!lp.buffer) return;
    // Otros reproductores de la app se pausan para no sonar encima.
    document.querySelectorAll('audio').forEach(a => a.pause());
    if (typeof comp !== 'undefined') comp.audio.pause();
    if (typeof plAudio !== 'undefined') plAudio.pause();
    lp.ctx.resume();
    lp.gain = lp.ctx.createGain(); lp.gain.gain.value = Math.pow(10, lpGainFor(lp.sel) / 20); lp.gain.connect(lp.ctx.destination);
    lp.src = lp.ctx.createBufferSource(); lp.src.buffer = lp.buffer; lp.src.connect(lp.gain);
    if (lp.offset >= lp.buffer.duration) lp.offset = 0;
    lp.src.start(0, lp.offset); lp.startedAt = lp.ctx.currentTime - lp.offset; lp.playing = true;
    const src = lp.src;
    src.onended = () => { if (lp.src === src && lp.playing) { lp.playing = false; lp.offset = 0; paintLoudness(); } };
    paintLoudness(); lpTick();
}
function lpPause() {
    if (!lp.playing) return;
    lp.offset = lp.ctx.currentTime - lp.startedAt; lp.playing = false;
    try { lp.src.stop(); } catch {}
    cancelAnimationFrame(lp.raf); paintLoudness();
}
function lpStop() {
    if (lp.playing) { try { lp.src.stop(); } catch {} }
    lp.playing = false; lp.offset = 0; cancelAnimationFrame(lp.raf);
}
function lpSeek(event) {
    if (!lp.buffer) return;
    const box = event.currentTarget.getBoundingClientRect(), t = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * lp.buffer.duration;
    const was = lp.playing;
    if (was) { lp.playing = false; try { lp.src.stop(); } catch {} }
    lp.offset = t;
    if (was) lpPlay(); else lpPaintProgress();
}
function lpPaintProgress() {
    if (!lp.buffer || !$('lpFill')) return;
    const t = lp.playing ? lp.ctx.currentTime - lp.startedAt : lp.offset, d = lp.buffer.duration;
    $('lpFill').style.width = Math.min(100, t / d * 100) + '%';
    $('lpTime').textContent = clockText(Math.min(t, d)) + ' / ' + clockText(d);
}
function lpTick() {
    cancelAnimationFrame(lp.raf);
    if (!lp.playing) return;
    if ($('loudnessPane')?.hidden) { lpPause(); return; }
    lpPaintProgress();
    lp.raf = requestAnimationFrame(lpTick);
}
