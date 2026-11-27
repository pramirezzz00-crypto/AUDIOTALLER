// Composición · Beats, Letras y Partituras en una sola pantalla.
// La vista de trabajo es la segunda pantalla de cada sección.
// Las listas y colecciones (páginas 'beats', 'lyrics', 'scores') se abren con compLists().
const comp = {tab: 'beats', beats: [], lists: [], q: '', bpmMin: '', bpmMax: '', beatState: '', beat: '', panel: false, scan: null,
    songs: [], song: '', lyric: null, collapsed: new Set(), lyricDirty: false, sync: null, scores: [], audio: new Audio(), playing: ''};
const SECTION_LABELS = {intro: 'Intro', verse: 'Verso', pre: 'Pre-estribillo', chorus: 'Estribillo', bridge: 'Puente', inter: 'Interludio', outro: 'Final'};
const SECTION_COLORS = {intro: '#8A8A94', verse: '#5AA7FF', pre: '#9B8CFF', chorus: '#2FD8BF', bridge: '#FFB547', inter: '#FF6B8B', outro: '#8A8A94'};
const BEAT_COLORS = {Libre: '#5ED17E', Reservado: '#FFB547', 'En uso': '#5AA7FF'};

async function renderCompositionPane() {
    const root = $('composition');
    if (!root) return;
    try {
        if (comp.tab === 'beats') { const [data, songs] = await Promise.all([api('/api/composicion/beats'), api('/api/composicion/letras')]); comp.beats = data.beats; comp.lists = data.listas; comp.songs = songs; }
        if (comp.tab === 'lyrics') { comp.songs = await api('/api/composicion/letras'); if (!comp.song) comp.song = comp.songs.find(s => s.version)?.id || comp.songs[0]?.id || ''; if (comp.song && comp.lyric?.cancion?.id !== comp.song) await loadLyricDoc(comp.song); }
        if (comp.tab === 'scores') [comp.scores, comp.songs] = await Promise.all([api('/api/composicion/partituras'), api('/api/composicion/letras')]);
    } catch (error) { report(error); }
    paintComposition();
}
function paintComposition() {
    const root = $('composition');
    const cta = {beats: '+ Importar carpeta de beats', lyrics: '+ Nueva letra', scores: '+ Cargar partitura'}[comp.tab];
    root.innerHTML = `
      <header class="prod-head mk-comp-head"><div><h1>${{beats: 'Beats', lyrics: 'Letras', scores: 'Partituras'}[comp.tab]}</h1>
        <p class="muted">${{beats: 'Tu banco de beats: organizados, segmentados y listos para llevar al DAW',
          lyrics: 'Las letras de tus canciones, con versiones y listas para publicar',
          scores: 'Partituras y particellas con versiones, asociadas a canciones y arreglos'}[comp.tab]}</p></div>
        <button class="btn-primary" onclick="compNew()">${cta}</button></header>
      <div id="compPanel"></div>
      <div id="compBody">${comp.tab === 'beats' ? beatsView() : comp.tab === 'lyrics' ? lyricsView() : scoresView()}</div>
      <p class="insp-help comp-old">¿Buscás tus listas y colecciones? <button class="link" onclick="compLists('${comp.tab}')">${comp.tab === 'beats' ? 'Ver mis listas de beats' : comp.tab === 'lyrics' ? 'Ver mis colecciones de letras' : 'Ver mis colecciones de partituras'}</button></p>`;
    if (comp.panel) paintCompPanel();
    if (comp.tab === 'lyrics') bindLyricEditor();
    if (comp.tab === 'beats') drawBeatWaves();
    ['sideBeats', 'sideLyrics', 'sideScores'].forEach((id, k) => $(id)?.setAttribute('aria-current', ['beats', 'lyrics', 'scores'][k] === comp.tab ? 'page' : 'false'));
}
function compTab(tab) {
    if (comp.lyricDirty && !confirm('Hay cambios sin guardar en la letra. ¿Salir igual?')) return;
    if (tab !== 'beats') comp.audio.pause();
    comp.tab = tab; comp.panel = false; comp.lyricDirty = false; renderCompositionPane();
}
function compNew() { comp.panel = !comp.panel; comp.scan = null; paintComposition(); }

// ── Beats ──
function beatsView() {
    const q = comp.q.trim().toLowerCase();
    const ranges = {'': [0, 999], lt90: [0, 89.99], mid: [90, 120], gt120: [120.01, 999]};
    const [lo, hi] = ranges[comp.bpmRange || ''];
    const list = comp.beats.filter(b => (!q || [b.nombre, b.archivo, b.tonalidad, b.lista, ...b.etiquetas].join(' ').toLowerCase().includes(q))
        && (!comp.bpmRange || (b.bpm && b.bpm >= lo && b.bpm <= hi)) && (!comp.beatState || b.estado === comp.beatState));
    const count = st => comp.beats.filter(b => b.estado === st).length;
    return `<div class="mk-tools"><label class="mk-search"><input id="beatQ" type="search" placeholder="Buscar por nombre, etiqueta o tonalidad" value="${esc(comp.q)}"></label>
        ${[['', 'Todos los BPM'], ['lt90', '< 90'], ['mid', '90 – 120'], ['gt120', '120 +']].map(([id, l]) => `<button class="mk-chip ${(comp.bpmRange || '') === id ? 'is-on' : ''}" onclick="comp.bpmRange='${id}';paintComposition()">${l}</button>`).join('')}</div>
      <div class="mk-chips"><button class="mk-chip ${!comp.beatState ? 'is-on' : ''}" onclick="comp.beatState='';paintComposition()">Todos <span>${comp.beats.length}</span></button>
        ${Object.entries(BEAT_COLORS).map(([st, c]) => `<button class="mk-chip ${comp.beatState === st ? 'is-on' : ''}" onclick="comp.beatState='${st}';paintComposition()"><i style="background:${c}"></i>${st} <span>${count(st)}</span></button>`).join('')}</div>
      <div class="beat-cards">${list.map(b => { const playing = comp.playing === b.id && !comp.audio.paused; return `<article class="beat-card ${b.id === comp.beat ? 'is-on' : ''} ${b.disponible ? '' : 'is-missing'}" onclick="if(!event.target.closest('button,a,input,select,label,canvas'))comp.beat=comp.beat==='${b.id}'?'':'${b.id}',paintComposition()">
          <div class="beat-top"><button data-beat-play="${b.id}" data-beat-name="${esc(b.nombre)}" class="mk-play big ${playing ? 'is-on' : ''}" aria-label="${playing ? 'Pausar' : 'Escuchar'} ${esc(b.nombre)}" onclick="beatPlay('${b.id}')">${playing ? '❚❚' : '▶'}</button>
            <span class="beat-name"><strong>${esc(b.nombre)}</strong><small class="mono">${[b.bpm ? b.bpm + ' BPM' : '', b.tonalidad].filter(Boolean).map(esc).join(' · ') || 'sin BPM'}</small></span>
            <canvas class="beat-wave" data-beat-wave="${b.id}" onclick="beatSeek(event,'${b.id}')" onpointermove="beatHover(event)" onpointerleave="beatHover(event,true)"></canvas>
            <span class="beat-state"><b style="color:${BEAT_COLORS[b.estado]}">${esc(b.estado)}${b.estado !== 'Libre' && (b.cancion || b.para) ? ' · ' + esc(b.cancion || b.para) : ''}</b>
              <span>${b.etiquetas.map(t => `<span class="beat-tag">${esc(t)}</span>`).join('')}</span></span></div>
          <div class="beat-bottom"><button class="beat-drag" draggable="${b.disponible}" ondragstart="beatDrag(event,'${b.id}')" title="Arrastralo a una pista del DAW">⠿ Arrastrar al DAW</button>
            <button class="mk-btn" onclick="openBeatFolder('${b.id}')">Mostrar en carpeta</button><button class="mk-btn" onclick="copyPath(${JSON.stringify(b.ruta).replace(/"/g, '&quot;')})">Copiar ruta</button>
            <span class="muted">${esc(b.stems || 'sin stems')}</span><span class="spacer"></span><span class="mono beat-path">${esc(b.ruta)}</span></div>
          ${b.id === comp.beat ? beatDetail(b) : ''}</article>`; }).join('') || `<p class="muted">${comp.beats.length ? 'Ningún beat coincide con los filtros.' : 'Todavía no hay beats. Importá una carpeta.'}</p>`}</div>
      <p class="insp-help">Las marcas sobre la onda son los segmentos (intro, loop, drop): se pueden exportar sueltos. AudioTaller guarda la ruta, no mueve los archivos.</p>`;
}
const beatPeaks = new Map();
const beatWaveData = new WeakMap();
const beatHoverPositions = new WeakMap();
async function drawBeatWaves() {
    for (const canvas of document.querySelectorAll('canvas[data-beat-wave]')) {
        if (!canvas.isConnected) continue;
        const id = canvas.dataset.beatWave;
        if (!beatPeaks.has(id)) beatPeaks.set(id, api('/api/composicion/beats/' + id + '/onda').catch(() => { beatPeaks.delete(id); return {peaks: []}; }));
        const data = await beatPeaks.get(id);
        if (!canvas.isConnected) continue;
        beatWaveData.set(canvas, data);
        paintBeatWave(canvas);
    }
}
function paintBeatWave(canvas) {
    const id = canvas.dataset.beatWave, data = beatWaveData.get(canvas) || {};
    const beat = comp.beats.find(b => b.id === id);
    const box = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
    if (!box.width || !box.height) return;
    const w = Math.round(box.width * ratio), hpx = Math.round(box.height * ratio);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== hpx) canvas.height = hpx;
    const ctx = canvas.getContext('2d'); ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,box.width,box.height);
    const active = comp.playing === id, peaks = data.peaks || [], max = Math.max(...peaks, 0.01), bars = Math.max(1,Math.floor(box.width / 7));
    const duration = active && Number.isFinite(comp.audio.duration) ? comp.audio.duration : data.duration;
    const progress = active && duration > 0 ? comp.audio.currentTime / duration : 0;
    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue('--at-accent').trim() || '#2FD8BF';
    const neutral = styles.getPropertyValue('--at-text3').trim() || '#8A8A94';
    for (let k = 0; k < bars; k++) {
        const v = peaks.length ? peaks[Math.floor(k / bars * peaks.length)] / max : 0.3;
        const h = Math.max(3, v * (box.height - 28));
        ctx.fillStyle = active && k / bars < progress ? accent : neutral;
        ctx.fillRect(k * 7, 12 + (box.height - 26 - h) / 2, 5, h);
    }
    ctx.font = '10px Inter, sans-serif';
    if (duration > 0) for (const seg of beat?.segmentos || []) {
        const x0 = seg.inicio / duration * box.width, x1 = seg.fin / duration * box.width;
        ctx.fillStyle = neutral; ctx.fillRect(x0,1,Math.max(0,x1-x0-2),1.5); ctx.fillText(seg.nombre,x0+1,10);
    }
    if (active && duration > 0) {
        ctx.fillStyle = accent; ctx.fillRect(Math.min(box.width-1,progress*box.width),12,1,box.height-25);
        ctx.fillText(clockText(comp.audio.currentTime) + ' / ' + clockText(duration), 0, box.height-2);
    }
    const hover = beatHoverPositions.get(canvas);
    if (hover !== undefined) {
        const x = Math.min(box.width-1,hover*box.width);
        ctx.fillStyle = accent; ctx.fillRect(x,12,1,box.height-25);
        if (duration > 0) {
            const label = clockText(hover*duration), tw = ctx.measureText(label).width;
            const tx = Math.max(0,Math.min(box.width-tw-4,x-tw/2));
            ctx.fillStyle = styles.getPropertyValue('--at-panel').trim() || '#fff';
            ctx.fillRect(tx,box.height-13,tw+4,13);
            ctx.fillStyle = accent; ctx.fillText(label,tx+2,box.height-2);
        }
    }
}
function beatFraction(event) {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.max(0,Math.min(1,(event.clientX-box.left)/Math.max(1,box.width)));
}
function beatHover(event, leave = false) {
    const canvas = event.currentTarget;
    if (leave) beatHoverPositions.delete(canvas); else beatHoverPositions.set(canvas,beatFraction(event));
    paintBeatWave(canvas);
}
let pendingBeatSeek = null;
function applyBeatSeek() {
    if (pendingBeatSeek !== null && Number.isFinite(comp.audio.duration) && comp.audio.duration > 0) {
        comp.audio.currentTime = pendingBeatSeek * comp.audio.duration;
        pendingBeatSeek = null;
    }
}
function beatSeek(event, id) {
    const fraction = beatFraction(event);
    if (comp.playing !== id) return beatPlay(id, fraction);
    pendingBeatSeek = fraction; applyBeatSeek(); updateBeatPlayback();
}
function updateBeatPlayback() {
    if (comp.tab !== 'beats' || $('composition')?.hidden) return;
    for (const button of document.querySelectorAll('[data-beat-play]')) {
        const playing = button.dataset.beatPlay === comp.playing && !comp.audio.paused && !comp.audio.ended;
        button.classList.toggle('is-on',playing);
        button.textContent = playing ? '❚❚' : '▶';
        button.setAttribute('aria-label',(playing ? 'Pausar ' : 'Escuchar ') + button.dataset.beatName);
    }
    for (const canvas of document.querySelectorAll('canvas[data-beat-wave]')) paintBeatWave(canvas);
}
comp.audio.addEventListener('loadedmetadata', () => { applyBeatSeek(); updateBeatPlayback(); });
for (const event of ['play','pause','ended','seeked']) comp.audio.addEventListener(event,updateBeatPlayback);
comp.audio.addEventListener('timeupdate', () => {
    if (comp.tab !== 'beats' || $('composition')?.hidden) return;
    for (const canvas of document.querySelectorAll('canvas[data-beat-wave]')) if (canvas.dataset.beatWave === comp.playing) paintBeatWave(canvas);
});
function beatDetail(b) {
    return `<div class="beat-edit"><div class="cr-grid"><label class="fld">Nombre<input value="${esc(b.nombre)}" onchange="saveBeat('${b.id}',{titulo:this.value})"></label>
        <label class="fld">BPM<input value="${b.bpm || ''}" inputmode="numeric" onchange="saveBeat('${b.id}',{bpm:this.value})"></label>
        <label class="fld">Tonalidad<input value="${esc(b.tonalidad)}" onchange="saveBeat('${b.id}',{tonalidad:this.value})"></label>
        <label class="fld">Etiquetas<input value="${esc(b.etiquetas.join(', '))}" onchange="saveBeat('${b.id}',{etiquetas:this.value.split(',')})"></label>
        <label class="fld">Estado<select onchange="saveBeat('${b.id}',{estado:this.value})">${Object.keys(BEAT_COLORS).map(s => `<option ${b.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        ${b.estado === 'Reservado' ? `<label class="fld">Reservado para<input value="${esc(b.para)}" onchange="saveBeat('${b.id}',{para:this.value})"></label>` : ''}
        ${b.estado === 'En uso' ? `<label class="fld">En la canción<select onchange="saveBeat('${b.id}',{cancion_id:this.value})"><option value="">Elegir…</option>${comp.songs.map(s => `<option value="${s.id}" ${s.id === b.cancion_id ? 'selected' : ''}>${esc(s.titulo)}</option>`).join('')}</select></label>` : ''}</div>
      <div class="row-tight"><span class="insp-label">Segmentos</span>${b.segmentos.map((g, k) => `<span class="beat-tag">${esc(g.nombre)} ${clockText(g.inicio)}–${clockText(g.fin)} <button class="link" onclick="removeSegment('${b.id}',${k})">✕</button></span>`).join('') || '<span class="muted">Escuchá y marcá intro, loop o drop.</span>'}
        <input id="segName" placeholder="Loop A" style="width:100px;margin:0"><button class="mk-btn" onclick="markSegment('${b.id}','inicio')">Marcar inicio</button><button class="mk-btn" onclick="markSegment('${b.id}','fin')">Marcar fin y guardar</button></div></div>`;
}
function bindBeatFilters() {
    const q = $('beatQ');
    if (!q) return;
    q.oninput = () => { comp.q = q.value; const pos = q.selectionStart; paintComposition(); $('beatQ').focus(); $('beatQ').setSelectionRange(pos, pos); };
}
const _paintComposition = paintComposition;
paintComposition = function () { _paintComposition(); if (comp.tab === 'beats') bindBeatFilters(); };
async function saveBeat(id, changes) {
    await api('/api/composicion/beats/' + id, body(changes)).catch(report);
    await renderCompositionPane();
}
function beatPlay(id, fraction = null) {
    $('beatPlayer')?.pause();
    if (comp.playing === id && !comp.audio.paused && fraction === null) { comp.audio.pause(); return; }
    if (comp.playing !== id) {
        comp.playing = id; pendingBeatSeek = fraction;
        comp.audio.src = '/api/beats/' + encodeURIComponent(id) + '/audio';
    } else if (fraction !== null) { pendingBeatSeek = fraction; applyBeatSeek(); }
    comp.audio.play().catch(error => { if (error.name !== 'AbortError') report(error); updateBeatPlayback(); });
    updateBeatPlayback();
}
function beatDrag(event, id) {
    const beat = comp.beats.find(b => b.id === id);
    if (!beat) return;
    const url = 'file:///' + beat.ruta.replace(/\\/g, '/').replace(/^\/+/, '');
    event.dataTransfer.setData('text/uri-list', url);
    event.dataTransfer.setData('text/plain', beat.ruta);
    event.dataTransfer.effectAllowed = 'copy';
}
async function copyPath(path) {
    try {
        if (window.pywebview?.api?.copy_text && await window.pywebview.api.copy_text(path)) return notify('Ruta copiada: ' + path);
        await navigator.clipboard.writeText(path); notify('Ruta copiada: ' + path);
    } catch { prompt('Copiá la ruta:', path); }
}
let segStart = null;
async function markSegment(id, which) {
    const b = comp.beats.find(x => x.id === id);
    const now = comp.playing === id ? comp.audio.currentTime : 0;
    if (which === 'inicio') { segStart = now; notify('Inicio marcado en ' + clockText(now) + '. Seguí escuchando y marcá el fin.'); return; }
    if (segStart === null || now <= segStart) return report(Error('Marcá primero el inicio y reproducí hasta el fin del segmento.'));
    await saveBeat(id, {segmentos: [...b.segmentos, {nombre: $('segName').value || 'Segmento', inicio: segStart, fin: now}]});
    segStart = null;
}
async function removeSegment(id, index) {
    const b = comp.beats.find(x => x.id === id);
    await saveBeat(id, {segmentos: b.segmentos.filter((_, i) => i !== index)});
}

// ── Panel «nuevo» según la pestaña ──
function paintCompPanel() {
    const holder = $('compPanel');
    if (!holder) return;
    if (comp.tab === 'beats') {
        holder.innerHTML = `<section class="card new-panel"><div class="cr-sub"><strong>Importar beats</strong><button class="btn-ghost" onclick="compNew()">✕</button></div>
          <div class="cr-grid"><label>Carpeta<span class="row-tight"><input id="scanFolder" value="${esc(comp.scan?.carpeta || '')}" placeholder="D:\\Beats\\2026"><button onclick="pickBeatFolder()">Elegir…</button></span></label>
            <label>Lista<select id="scanList">${comp.lists.map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}</select></label>
            <label>Etiquetas para todos<input id="scanTags" placeholder="Ej.: nuevo, folk"></label></div>
          <label class="check"><input type="checkbox" id="scanDeep"> Buscar también en subcarpetas</label>
          <label class="check"><input type="checkbox" id="scanStems" checked> Contar stems en subcarpetas «Stems»</label>
          <span class="insp-help">BPM y tonalidad se leen del nombre del archivo (p. ej. «Madrugada_76bpm_Cm.wav») y se pueden corregir. Los archivos quedan donde están.</span>
          <button onclick="scanBeats().catch(report)">Buscar audios</button>
          ${comp.scan ? `<div class="scan-list">${comp.scan.archivos.map((f, i) => `<label class="check"><input type="checkbox" data-scan="${i}" ${f.ya ? 'disabled' : 'checked'}>
            <span class="mono">${esc(f.archivo)}</span> · <input data-scan-bpm="${i}" value="${f.bpm || ''}" placeholder="BPM" style="width:60px"> · <input data-scan-key="${i}" value="${esc(f.tonalidad)}" placeholder="Tonalidad" style="width:110px">${f.stems ? ` · ${f.stems} stems` : ''}${f.ya ? ' · <span class="muted">ya importado</span>' : ''}</label>`).join('') || '<span class="muted">No se encontraron audios en esa carpeta.</span>'}</div>
            <button class="btn-primary" onclick="importBeats().catch(report)">Importar seleccionados</button>` : ''}</section>`;
    } else if (comp.tab === 'lyrics') {
        holder.innerHTML = `<section class="card new-panel"><div class="cr-sub"><strong>Nueva letra</strong><button class="btn-ghost" onclick="compNew()">✕</button></div>
          <div class="cr-grid"><label>Canción<select id="newLyricSong">${comp.songs.map(s => `<option value="${s.id}" ${s.version ? '' : ''}>${esc(s.titulo)} · ${esc(s.disco || 'suelta')}${s.version ? ' (ya tiene letra)' : ''}</option>`).join('')}</select></label>
            <label>Idioma<input id="newLyricLang" value="Español"></label>
            <label>Importar Word, PDF o texto<input id="newLyricFile" type="file" accept=".docx,.pdf,.txt,.lrc"></label></div>
          <label>O pegá la letra<textarea id="newLyricText" rows="6" placeholder="[Verso 1]\nPrimera línea…\n\n[Estribillo]\n…"></textarea></label>
          <span class="insp-help">Las secciones se detectan solas: por encabezados como [Estribillo] o por estrofas (la que se repite es el estribillo). Los PDF escaneados no se pueden leer.</span>
          <button class="btn-primary" onclick="createLyric().catch(report)">Crear letra</button></section>`;
    } else {
        holder.innerHTML = `<section class="card new-panel"><div class="cr-sub"><strong>Cargar partitura</strong><button class="btn-ghost" onclick="compNew()">✕</button></div>
          <span class="muted">PDF, imagen, MuseScore, Sibelius, Dorico, Finale o MusicXML. Se guarda la ruta: el archivo queda en su carpeta.</span>
          <button class="btn-primary" onclick="uploadScores().catch(report)">Elegir archivos…</button></section>`;
    }
}
async function pickBeatFolder() {
    if (!window.pywebview?.api?.choose_path) return report(Error('Elegir carpetas requiere la aplicación de escritorio: escribí la ruta.'));
    const path = await window.pywebview.api.choose_path(true);
    if (path) $('scanFolder').value = path;
}
async function scanBeats() {
    comp.scan = await api('/api/composicion/beats/escanear', body({carpeta: $('scanFolder').value, recursivo: $('scanDeep').checked, stems: $('scanStems').checked}));
    const tags = $('scanTags').value, list = $('scanList').value;
    paintComposition();
    $('scanTags').value = tags; $('scanList').value = list;
}
async function importBeats() {
    const items = [...document.querySelectorAll('[data-scan]:checked')].map(box => {
        const i = box.dataset.scan, f = comp.scan.archivos[i];
        return {...f, bpm: document.querySelector(`[data-scan-bpm="${i}"]`).value, tonalidad: document.querySelector(`[data-scan-key="${i}"]`).value};
    });
    const result = await api('/api/composicion/beats/importar', body({archivos: items, lista_id: $('scanList').value, etiquetas: $('scanTags').value.split(',')}));
    comp.panel = false; comp.scan = null;
    await renderCompositionPane();
    notify(`${countLabel(result.agregados, 'beat importado', 'beats importados')}: quedan como «Libre» con la etiqueta «nuevo».`);
}

// ── Letras ──
async function loadLyricDoc(id) {
    comp.lyric = await api('/api/composicion/letras/' + id);
    comp.collapsed.clear(); comp.lyricDirty = false; comp.sync = null;
}
function lyricsView() {
    const doc = comp.lyric?.letra;
    const stateClass = st => st === 'Final' ? 'ok-green' : st === 'En revisión' ? 'warn-amber' : 'muted';
    return `<div class="lyr-layout"><aside class="lyr-songs">
        ${comp.songs.map(s => `<button class="lyr-song ${s.id === comp.song ? 'is-on' : ''}" onclick="pickLyricSong('${s.id}')"><strong>${esc(s.titulo)}</strong><small>${esc(s.disco || 'Canción suelta · ' + s.artista)}</small>
          <small class="${s.instrumental ? 'info' : s.version ? stateClass(s.estado) : 'muted'}"><b>${s.instrumental ? 'Instrumental' : s.version ? esc(s.estado) + (s.sincronizada ? ' · sincronizada' : '') : 'Sin letra'}</b></small></button>`).join('')}</aside>
      <div class="lyr-main">${doc ? lyricEditor(doc) + publishCard(doc) : '<p class="muted">Elegí una canción o creá una letra nueva.</p>'}</div></div>`;
}
function publishCard(doc) {
    const autores = comp.lyric.autoria;
    const synced = doc.secciones.some(b => (b.tiempos || []).some(t => t !== null && t !== undefined));
    return `<section class="card lyr-publish"><strong>Para publicar</strong>
      ${[['Idioma', esc(comp.lyric.idioma || '—')], ['Contenido explícito', esc(doc.explicito || 'No')], ['Sincronizada con el audio', synced ? '<span class="ok-green">Sí</span>' : 'No'],
        ['Autoría de la letra', autores.length ? esc(autores.map(a => `${a.nombre} ${formatDecimal(a.porcentaje, 2)} %`).join(', ')) : '<span class="warn-amber">Sin cargar</span>']].map(([k, v]) => `<div class="lyr-row"><span>${k}</span><b>${v}</b></div>`).join('')}
      <div class="row-tight"><button class="mk-btn" onclick="startSync().catch(report)">Sincronizar con el audio</button>
        <a class="mk-btn" href="/api/composicion/letras/${comp.song}.txt" download>Exportar .txt</a>${synced ? `<a class="mk-btn" href="/api/composicion/letras/${comp.song}.lrc" download>Exportar .lrc</a>` : ''}
        <button class="mk-btn" onclick="go('entidades')">Usar en el registro (DNDA / SADAIC)</button></div>
      <small class="muted">La letra viaja con la canción: sale en la ficha del disco, en el portal del artista y en el paquete para la distribuidora. Spotify y otras plataformas muestran letras que les llegan a través de proveedores como Musixmatch, donde el artista puede cargarla y sincronizarla.</small></section>`;
}
function lyricEditor(doc) {
    const names = doc.nombres || [];
    const schemes = [['pop', 'Verso / Estribillo'], ['letras', 'A · A′ · B · C'], ['propio', 'Propio']];
    const autores = comp.lyric.autoria;
    const firstTime = b => (b.tiempos || []).find(t => t !== null && t !== undefined);
    return `<section class="card lyric-editor">
      <div class="lyr-head"><div><h2>${esc(comp.lyric.cancion.titulo)}</h2>
        <small class="muted">Letra: ${autores.length ? esc(autores.map(a => a.nombre).join(', ')) : '<button class="link warn-amber" onclick="openCreditsForSong()">sin autoría (completar en Créditos)</button>'} · versión V${doc.version} ·
          <select id="lyricState" class="inline-select" aria-label="Estado">${['Borrador', 'En revisión', 'Final'].map(s => `<option ${doc.estado === s ? 'selected' : ''}>${s.toLowerCase()}</option>`).join('')}</select> ·
          <input id="lyricLang" class="inline-input" value="${esc(comp.lyric.idioma)}" placeholder="idioma" aria-label="Idioma"></small></div>
        <div class="row-tight"><button class="mk-btn" onclick="openSong('${comp.song}').catch(report)">Ver en la canción</button>
          <button class="mk-btn" onclick="notify((comp.lyric.letra.historial||[]).map(h=>'V'+h.version+' · '+h.estado).join('  ·  ')||'Todavía no hay versiones anteriores.')">Historial</button></div></div>
      <div class="lyr-bar"><span class="muted">Forma de la canción</span><div class="seg">${schemes.map(([id, label]) => `<button class="${doc.esquema === id ? 'is-on' : ''}" onclick="setScheme('${id}')">${label}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" id="lyricInstrumental" ${doc.instrumental ? 'checked' : ''}> Instrumental</label><span class="spacer"></span>
        ${comp.collapsed.size ? `<button class="mk-btn" onclick="comp.collapsed.clear();paintComposition()">Desplegar todo</button>` : `<button class="mk-btn" onclick="comp.lyric.letra.secciones.forEach((_,i)=>comp.collapsed.add(i));paintComposition()">Achicar todo</button>`}
        <label class="mk-btn" title="Importar la letra desde Word, PDF, TXT o LRC">⤓ Importar<input type="file" accept=".docx,.pdf,.txt,.lrc" hidden onchange="importIntoLyric(this.files[0]).catch(report)"></label></div>
      <div class="form-bar">${doc.secciones.map((b, i) => `<button style="flex:${Math.max(1, b.lineas.length)};background:${SECTION_COLORS[b.tipo]}" title="${esc(names[i])}" onclick="document.getElementById('sec${i}').scrollIntoView({block:'center'})">${esc(names[i])}</button>`).join('')}</div>
      ${comp.sync ? syncBar() : ''}
      <div id="lyricBlocks">${doc.secciones.map((b, i) => { const t = firstTime(b); return `<section class="lyric-block" id="sec${i}" style="--c:${SECTION_COLORS[b.tipo]}">
          <div class="lyric-block-head"><button class="lyr-caret" onclick="toggleSection(${i})" aria-label="${comp.collapsed.has(i) ? 'Desplegar' : 'Achicar'}">${comp.collapsed.has(i) ? '▸' : '▾'}</button>
            <span class="lyr-chip">${esc(names[i])}</span>
            <select data-sec-kind="${i}" aria-label="Tipo de sección">${Object.entries(SECTION_LABELS).map(([k, l]) => `<option value="${k}" ${b.tipo === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            ${doc.esquema === 'propio' ? `<input data-sec-name="${i}" value="${esc(b.nombre || '')}" placeholder="Nombre propio" style="width:130px;margin:0">` : ''}
            <label class="check"><input type="checkbox" data-sec-var="${i}" ${b.variacion ? 'checked' : ''}> variación</label>
            <span class="spacer"></span><span class="lyr-meta"><b class="mono">${t !== undefined ? clockText(t) : ''}</b> ${countLabel(b.lineas.length, 'línea', 'líneas')}</span>
            <button class="lyr-mini" onclick="moveSection(${i},-1)" aria-label="Subir">↑</button><button class="lyr-mini" onclick="moveSection(${i},1)" aria-label="Bajar">↓</button>
            <button class="lyr-mini" onclick="removeSection(${i})" aria-label="Quitar sección">✕</button></div>
          ${comp.collapsed.has(i) ? `<p class="muted lyric-peek">${esc(b.lineas[0] || '')}…</p>` : `<textarea class="lyr-text" data-sec-text="${i}" rows="${Math.max(1, b.lineas.length)}">${esc(b.lineas.join('\n'))}</textarea>`}
        </section>`; }).join('')}</div>
      <div class="row-tight"><button class="mk-btn" onclick="addSection()">+ Marcar nueva sección</button><span class="spacer"></span><span id="lyricStatus" class="muted" role="status">${comp.lyricDirty ? 'Sin guardar' : ''}</span>
        <button class="mk-btn" onclick="saveLyric(true).catch(report)">Guardar como V${doc.version + 1}</button><button class="btn-primary" onclick="saveLyric(false).catch(report)">Guardar</button></div>
      <p class="insp-help">Para marcar una sección, elegí su tipo; o escribí una línea entre corchetes como [Estribillo] al importar y AudioTaller la reconoce. Los nombres se adaptan al estilo elegido arriba.</p>
    </section>`;
}
function readLyricForm() {
    const doc = comp.lyric.letra;
    doc.secciones.forEach((b, i) => {
        const text = document.querySelector(`[data-sec-text="${i}"]`);
        if (text) {
            const lines = text.value.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.join('\n') !== b.lineas.join('\n')) b.tiempos = [];
            b.lineas = lines;
        }
        const kind = document.querySelector(`[data-sec-kind="${i}"]`); if (kind) b.tipo = kind.value;
        const name = document.querySelector(`[data-sec-name="${i}"]`); if (name) b.nombre = name.value;
        const variation = document.querySelector(`[data-sec-var="${i}"]`); if (variation) b.variacion = variation.checked;
    });
    doc.estado = $('lyricState')?.value || doc.estado;
    doc.instrumental = !!$('lyricInstrumental')?.checked;
    return doc;
}
function bindLyricEditor() {
    const editor = document.querySelector('.lyric-editor');
    if (!editor) return;
    editor.addEventListener('input', () => { comp.lyricDirty = true; if ($('lyricStatus')) $('lyricStatus').textContent = 'Sin guardar'; });
    editor.querySelectorAll('[data-sec-kind],[data-sec-var]').forEach(el => el.addEventListener('change', () => { readLyricForm(); renameSections(); }));
}
function renameSections() {
    const doc = comp.lyric.letra, counters = {}, letters = {}, labels = SECTION_LABELS;
    doc.nombres = doc.secciones.map(b => {
        if (doc.esquema === 'letras') { if (!letters[b.tipo]) letters[b.tipo] = String.fromCharCode(65 + Object.keys(letters).length); return letters[b.tipo] + (b.variacion ? '′' : ''); }
        if (doc.esquema === 'propio' && b.nombre) return b.nombre;
        counters[b.tipo] = (counters[b.tipo] || 0) + 1;
        return labels[b.tipo] + (b.tipo === 'verse' ? ' ' + counters[b.tipo] : '');
    });
    comp.lyricDirty = true;
    paintComposition();
}
function setScheme(id) { readLyricForm(); comp.lyric.letra.esquema = id; renameSections(); }
function toggleSection(i) { readLyricForm(); comp.collapsed.has(i) ? comp.collapsed.delete(i) : comp.collapsed.add(i); paintComposition(); }
function addSection() { readLyricForm(); comp.lyric.letra.secciones.push({tipo: 'verse', variacion: false, lineas: [], tiempos: []}); renameSections(); }
function removeSection(i) { readLyricForm(); if (!confirm('¿Quitar esta sección?')) return; comp.lyric.letra.secciones.splice(i, 1); comp.collapsed.clear(); renameSections(); }
function moveSection(i, d) { readLyricForm(); const s = comp.lyric.letra.secciones, j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; comp.collapsed.clear(); renameSections(); }
async function pickLyricSong(id) {
    if (comp.lyricDirty && !confirm('Hay cambios sin guardar en la letra. ¿Cambiar de canción igual?')) return;
    comp.song = id; await loadLyricDoc(id); paintComposition();
}
async function saveLyric(newVersion) {
    const doc = readLyricForm();
    const result = await api('/api/composicion/letras/' + comp.song, body({...doc, nueva_version: newVersion, idioma: $('lyricLang')?.value || ''}));
    comp.lyric.letra = result.letra; comp.lyricDirty = false;
    comp.songs = await api('/api/composicion/letras');
    paintComposition();
    if ($('lyricStatus')) $('lyricStatus').textContent = '✓ Guardada' + (newVersion ? ' como nueva versión' : '');
}
async function importIntoLyric(file) {
    if (!file) return;
    const form = new FormData(); form.append('file', file);
    const response = await fetch('/api/composicion/letras/importar', {method: 'POST', body: form});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'No se pudo leer el archivo.');
    if (comp.lyric.letra.secciones.length && !confirm(`Se encontraron ${data.secciones.length} secciones. ¿Reemplazar la letra actual?`)) return;
    comp.lyric.letra.secciones = data.secciones; comp.collapsed.clear(); renameSections();
}
async function createLyric() {
    const id = $('newLyricSong').value;
    const file = $('newLyricFile').files[0];
    const form = new FormData();
    if (file) form.append('file', file); else form.append('texto', $('newLyricText').value);
    const response = await fetch('/api/composicion/letras/importar', {method: 'POST', body: form});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'No se pudo leer la letra.');
    const existing = comp.songs.find(s => s.id === id);
    if (existing?.version && !confirm('Esta canción ya tiene letra. ¿Guardar la nueva como otra versión?')) return;
    await api('/api/composicion/letras/' + id, body({esquema: 'pop', secciones: data.secciones, estado: 'Borrador', nueva_version: !!existing?.version, idioma: $('newLyricLang').value}));
    comp.panel = false; comp.song = id; comp.lyric = null;
    await renderCompositionPane();
    if ($('lyricStatus')) $('lyricStatus').textContent = `✓ Letra creada (V${comp.lyric.letra.version} · borrador)`;
}
function openCreditsForSong() {
    const song = comp.songs.find(s => s.id === comp.song);
    api('/api/creditos/' + comp.song).then(c => c.disco_id ? openCredits(c.disco_id).then(() => { credits.song = comp.song; renderCredits(); }) : report(Error('Las canciones sueltas cargan créditos desde «Ficha de la canción».'))).catch(report);
    void song;
}
// Sincronizar: se reproduce el audio de referencia y cada clic (o Enter) marca el inicio de la línea siguiente.
async function startSync() {
    if (comp.sync) { comp.sync.audio.pause(); comp.sync = null; paintComposition(); return; }
    readLyricForm();
    const work = await api('/api/produccion/' + comp.song);
    const audios = work.archivos.filter(f => AUDIO_EXT.test(f.nombre)).sort((a, b) => STAGE_ORDER.indexOf(b.etapa) - STAGE_ORDER.indexOf(a.etapa));
    if (!audios.length) throw Error('Esta canción todavía no tiene audios para sincronizar.');
    const lines = comp.lyric.letra.secciones.flatMap((b, s) => b.lineas.map((text, l) => ({s, l, text})));
    comp.sync = {audio: new Audio('/api/produccion/archivo/' + audios[0].id), lines, index: 0, file: audios[0].nombre};
    comp.lyric.letra.secciones.forEach(b => { b.tiempos = b.lineas.map(() => null); });
    paintComposition();
}
function syncBar() {
    const s = comp.sync, next = s.lines[s.index];
    return `<div class="sync-bar card"><span class="mono">${esc(s.file)}</span>
      <button class="t-play" onclick="comp.sync.audio.paused?comp.sync.audio.play():comp.sync.audio.pause()">▶ / ❚❚</button>
      <span>${next ? `Próxima línea: <strong>${esc(next.text)}</strong>` : '✓ Todas las líneas marcadas. Guardá la letra para exportar el .lrc.'}</span>
      ${next ? '<button class="btn-primary" id="syncMark" onclick="syncMark()">Marcar (Enter)</button>' : ''}</div>`;
}
function syncMark() {
    const s = comp.sync; const line = s?.lines[s.index];
    if (!line) return;
    comp.lyric.letra.secciones[line.s].tiempos[line.l] = Math.round(s.audio.currentTime * 100) / 100;
    s.index += 1; comp.lyricDirty = true; paintComposition();
}
document.addEventListener('keydown', event => { if (event.key === 'Enter' && comp.sync && trail.at(-1) === 'composition' && event.target.tagName !== 'TEXTAREA') { event.preventDefault(); syncMark(); } });

// ── Partituras ──
function scoresView() {
    const songs = comp.songs;
    return `<div class="score-grid2">${comp.scores.map(p => { const edit = comp.scoreEdit === p.id; const siblings = comp.scores.filter(x => x.cancion_id && x.cancion_id === p.cancion_id && x.arreglo === p.arreglo && x.instrumento === p.instrumento);
      return `<article class="score-card2 ${p.disponible ? '' : 'is-missing'}"><div class="score-top"><span class="score-thumb"><i></i><i></i><i></i><i></i><i></i></span>
        <div><strong>${esc(p.titulo)}${p.instrumento ? ' · ' + esc(p.instrumento) : ''}</strong><small>${esc(p.cancion || 'Sin canción asociada')}</small><small class="mono">${esc(p.nombre)}</small>
          <small>${p.arreglo ? `<b class="ok-green">↳ ${esc(p.arreglo)}</b>` : '<b>Canción completa</b>'}</small></div></div>
        <div class="row-tight">${siblings.filter(x => x.id !== p.id).map(x => `<span class="score-v">v${x.version}</span>`).join('')}<span class="score-v ${p.vigente ? 'on' : ''}">v${p.version}${p.vigente ? ' vigente' : ''}</span></div>
        <div class="row-tight">${p.disponible ? (['PDF', 'PNG', 'JPG', 'JPEG'].includes(p.formato) ? `<a class="mk-btn" href="/api/scores/${p.id}/file" target="_blank" rel="noopener">Abrir</a>` : `<button class="mk-btn" onclick="openScoreFolder('${p.id}')">Abrir</button>`) : ''}
          <button class="mk-btn" onclick="comp.scoreEdit=comp.scoreEdit==='${p.id}'?'':'${p.id}';paintComposition()">${edit ? 'Cerrar' : '+ Versión / editar'}</button>
          <a class="mk-btn" href="https://wa.me/?text=${encodeURIComponent('Te paso la partitura «' + p.titulo + '»' + (p.instrumento ? ' (' + p.instrumento + ')' : '') + '.')}" target="_blank" rel="noopener noreferrer">Compartir con músicos</a></div>
        ${edit ? `<div class="score-edit cr-grid"><label class="fld">Nombre<input value="${esc(p.titulo)}" onchange="saveScore('${p.id}',{titulo:this.value})"></label>
          <label class="fld">Canción<select onchange="saveScore('${p.id}',{cancion_id:this.value})"><option value="">Sin asociar</option>${songs.map(s => `<option value="${s.id}" ${s.id === p.cancion_id ? 'selected' : ''}>${esc(s.titulo)}</option>`).join('')}</select></label>
          <label class="fld">Arreglo<input value="${esc(p.arreglo)}" placeholder="Opcional" onchange="saveScore('${p.id}',{arreglo:this.value})"></label>
          <label class="fld">Instrumento / particella<input value="${esc(p.instrumento)}" onchange="saveScore('${p.id}',{instrumento:this.value})"></label>
          <label class="fld">Versión<input value="${p.version}" inputmode="numeric" onchange="saveScore('${p.id}',{version:this.value})"></label>
          <label class="check"><input type="checkbox" ${p.vigente ? 'checked' : ''} onchange="saveScore('${p.id}',{vigente:this.checked})"> Versión vigente</label></div>` : ''}</article>`; }).join('')}</div>
      <section class="card score-info"><strong>Cargar una partitura</strong><p>Acepta PDF y los archivos de MuseScore, Sibelius, Dorico, Finale o MusicXML. Se asocia a una canción y, si querés, a un arreglo (por ejemplo «Arreglo de cuerdas» con sus particellas de violín 1, violín 2 y cello). Cada cambio se guarda como versión nueva.</p>
        <small class="muted">Sacar una partitura confiable directo de un audio mezclado no es viable hoy. Más adelante se podría armar un borrador desde el MIDI de la sesión, exportándolo a MusicXML para terminarlo en el editor de partituras.</small></section>`;
}
async function saveScore(id, changes) {
    await api('/api/composicion/partituras/' + id, body(changes)).catch(report);
    comp.scores = await api('/api/composicion/partituras');
    paintComposition();
}
async function uploadScores() {
    if (!window.pywebview?.api?.choose_score_files) throw Error('Cargar partituras requiere la aplicación de escritorio.');
    const paths = await window.pywebview.api.choose_score_files();
    if (!paths?.length) return;
    let collections = await api('/api/scores/collections');
    collections = collections.colecciones || collections;
    let target = collections[0]?.id;
    if (!target) target = (await api('/api/scores/collections', body({nombre: 'Partituras'}))).id;
    await api('/api/scores', body({paths, collection_id: target}));
    comp.panel = false;
    await renderCompositionPane();
    notify(countLabel(paths.length, 'partitura cargada', 'partituras cargadas') + ': asociala a su canción y arreglo.');
}

// Pantalla principal de cada sección: la vista de trabajo (banco de beats, letras y partituras con versiones).
function compGo(tab) {
    if (trail.at(-1) === 'composition' && comp.tab === 'lyrics' && tab !== 'lyrics' && comp.lyricDirty && !confirm('Hay cambios sin guardar en la letra. ¿Salir igual?')) return;
    if (tab !== 'beats') comp.audio.pause();
    if (comp.tab !== tab) comp.lyricDirty = false;
    comp.tab = tab; comp.panel = false;
    if (trail.at(-1) === 'composition') renderCompositionPane(); else go('composition');
}
function compOpen(tab) { compGo(tab); }
// Listas y colecciones de cada sección (pantallas anteriores, aporte de Zharelly).
function compLists(tab) {
    if (comp.lyricDirty && !confirm('Hay cambios sin guardar en la letra. ¿Salir igual?')) return;
    comp.lyricDirty = false; comp.tab = tab; go(tab);
}

// Evitar reproducción simultánea entre Mis listas y Banco de beats.
$('beatPlayer')?.addEventListener('play', () => comp.audio.pause());
