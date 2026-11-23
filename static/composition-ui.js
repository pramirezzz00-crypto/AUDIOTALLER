// Composición · Beats, Letras y Partituras en una sola pantalla.
// Las listas y colecciones anteriores siguen disponibles («Ver listas» / «Ver colecciones»).
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
      <header class="prod-head"><div><div class="eyebrow">Composición</div><h1>${{beats: 'Beats', lyrics: 'Letras', scores: 'Partituras'}[comp.tab]}</h1>
        <p class="muted">${{beats: 'Bases instrumentales con BPM, tonalidad, estado y acceso rápido al DAW. Los archivos quedan donde están.',
          lyrics: 'La letra de cada canción, por secciones y con versiones. Viaja a la ficha, al portal y a los registros.',
          scores: 'Partituras por canción y por arreglo, con versión vigente.'}[comp.tab]}</p></div>
        <div class="row"><button class="alt" onclick="go('${comp.tab}')">${comp.tab === 'beats' ? 'Ver listas' : 'Ver colecciones'}</button>
          <button class="btn-primary" onclick="compNew()">${cta}</button></div></header>
      <div class="seg tabs" role="tablist">${[['beats', 'Beats'], ['lyrics', 'Letras'], ['scores', 'Partituras']].map(([id, label]) =>
        `<button role="tab" aria-selected="${comp.tab === id}" class="${comp.tab === id ? 'is-on' : ''}" onclick="compTab('${id}')">${label}</button>`).join('')}</div>
      <div id="compPanel"></div>
      <div id="compBody">${comp.tab === 'beats' ? beatsView() : comp.tab === 'lyrics' ? lyricsView() : scoresView()}</div>`;
    if (comp.panel) paintCompPanel();
    if (comp.tab === 'lyrics') bindLyricEditor();
}
function compTab(tab) {
    if (comp.lyricDirty && !confirm('Hay cambios sin guardar en la letra. ¿Salir igual?')) return;
    comp.tab = tab; comp.panel = false; comp.lyricDirty = false; renderCompositionPane();
}
function compNew() { comp.panel = !comp.panel; comp.scan = null; paintComposition(); }

// ── Beats ──
function beatsView() {
    const q = comp.q.trim().toLowerCase();
    const list = comp.beats.filter(b => (!q || [b.nombre, b.archivo, b.tonalidad, b.lista, ...b.etiquetas].join(' ').toLowerCase().includes(q))
        && (!comp.bpmMin || (b.bpm && b.bpm >= Number(comp.bpmMin))) && (!comp.bpmMax || (b.bpm && b.bpm <= Number(comp.bpmMax)))
        && (!comp.beatState || b.estado === comp.beatState));
    const sel = comp.beats.find(b => b.id === comp.beat);
    return `<div class="prod-tools">
        <label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
          <input id="beatQ" type="search" placeholder="Buscar por nombre, etiqueta o tonalidad…" value="${esc(comp.q)}"></label>
        <label class="bpm-range">BPM <input id="bpmMin" inputmode="numeric" placeholder="desde" value="${esc(comp.bpmMin)}"> – <input id="bpmMax" inputmode="numeric" placeholder="hasta" value="${esc(comp.bpmMax)}"></label>
        <div class="chips">${[['', 'Todos'], ...Object.keys(BEAT_COLORS).map(s => [s, s])].map(([id, label]) => `<button class="chip-btn ${comp.beatState === id ? 'is-on' : ''}" onclick="comp.beatState='${id}';paintComposition()">${id ? `<i class="fb-dot" style="background:${BEAT_COLORS[id]}"></i>` : ''}${label}</button>`).join('')}</div>
      </div>
      <div class="beat-layout"><div class="beat-table">
        <div class="beat-row beat-th"><span></span><span>Beat</span><span>BPM</span><span>Tonalidad</span><span>Etiquetas</span><span>Estado</span><span>Stems</span><span></span></div>
        ${list.map(b => `<div class="beat-row ${b.id === comp.beat ? 'is-selected' : ''} ${b.disponible ? '' : 'is-missing'}" draggable="${b.disponible}" data-beat="${b.id}"
            ondragstart="beatDrag(event,'${b.id}')" onclick="comp.beat='${b.id}';paintComposition()">
          <button class="beat-play" aria-label="Escuchar ${esc(b.nombre)}" onclick="event.stopPropagation();beatPlay('${b.id}')">${comp.playing === b.id && !comp.audio.paused ? '❚❚' : '▶'}</button>
          <span><strong>${esc(b.nombre)}</strong><small>${esc(b.archivo)} · ${esc(b.lista)}</small></span>
          <span class="mono">${b.bpm || '—'}</span><span>${esc(b.tonalidad || '—')}</span>
          <span>${b.etiquetas.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</span>
          <span><i class="fb-dot" style="background:${BEAT_COLORS[b.estado]}"></i>${esc(b.estado)}${b.estado !== 'Libre' && (b.cancion || b.para) ? `<small>${esc(b.cancion || b.para)}</small>` : ''}</span>
          <span class="muted">${esc(b.stems || '—')}</span>
          <span class="beat-actions"><button class="btn-ghost" title="Mostrar en carpeta" onclick="event.stopPropagation();openBeatFolder('${b.id}')">📁</button>
            <button class="btn-ghost" title="Copiar ruta" onclick="event.stopPropagation();copyPath(${JSON.stringify(b.ruta).replace(/"/g, '&quot;')})">⧉</button></span>
        </div>`).join('') || `<p class="muted fb-empty">${comp.beats.length ? 'Ningún beat coincide con los filtros.' : 'Todavía no hay beats. Importá una carpeta.'}</p>`}
      </div>${sel ? beatDetail(sel) : ''}</div>
      <p class="insp-help">Arrastrá un beat a una pista del DAW o usá «Copiar ruta» y pegala en el explorador de archivos del DAW. AudioTaller guarda la ruta; no mueve los archivos.</p>`;
}
function beatDetail(b) {
    return `<aside class="card beat-detail">
      <span class="insp-kicker">Beat</span><input class="title-input" value="${esc(b.nombre)}" aria-label="Nombre" onchange="saveBeat('${b.id}',{titulo:this.value})">
      <div class="cr-grid"><label>BPM<input value="${b.bpm || ''}" inputmode="numeric" onchange="saveBeat('${b.id}',{bpm:this.value})"></label>
        <label>Tonalidad<input value="${esc(b.tonalidad)}" onchange="saveBeat('${b.id}',{tonalidad:this.value})"></label></div>
      <label>Etiquetas (separadas por coma)<input value="${esc(b.etiquetas.join(', '))}" onchange="saveBeat('${b.id}',{etiquetas:this.value.split(',')})"></label>
      <label>Estado<select onchange="saveBeat('${b.id}',{estado:this.value})">${Object.keys(BEAT_COLORS).map(s => `<option ${b.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      ${b.estado === 'Reservado' ? `<label>Reservado para<input value="${esc(b.para)}" placeholder="Artista o proyecto" onchange="saveBeat('${b.id}',{para:this.value})"></label>` : ''}
      ${b.estado === 'En uso' ? `<label>En la canción<select onchange="saveBeat('${b.id}',{cancion_id:this.value})"><option value="">Elegir…</option>${(comp.songs.length ? comp.songs : []).map(s => `<option value="${s.id}" ${s.id === b.cancion_id ? 'selected' : ''}>${esc(s.titulo)}</option>`).join('')}</select></label>` : ''}
      <span class="insp-label">Segmentos</span>
      <div class="seg-list">${b.segmentos.map((s, i) => `<span class="tag">${esc(s.nombre)} · ${clockText(s.inicio)}–${clockText(s.fin)} <button class="btn-ghost" onclick="removeSegment('${b.id}',${i})" aria-label="Quitar">✕</button></span>`).join('') || '<span class="muted">Marcá intro, loop o drop mientras escuchás.</span>'}</div>
      <div class="row-tight"><input id="segName" placeholder="Loop A" style="width:110px"><button onclick="markSegment('${b.id}','inicio')">Inicio = ${clockText(comp.playing === b.id ? comp.audio.currentTime : 0)}</button><button onclick="markSegment('${b.id}','fin')">Fin y guardar</button></div>
      <span class="insp-help mono">${esc(b.ruta)}</span></aside>`;
}
function bindBeatFilters() {
    const q = $('beatQ');
    if (!q) return;
    q.oninput = () => { comp.q = q.value; const pos = q.selectionStart; paintComposition(); $('beatQ').focus(); $('beatQ').setSelectionRange(pos, pos); };
    $('bpmMin').onchange = e => { comp.bpmMin = e.target.value; paintComposition(); };
    $('bpmMax').onchange = e => { comp.bpmMax = e.target.value; paintComposition(); };
}
const _paintComposition = paintComposition;
paintComposition = function () { _paintComposition(); if (comp.tab === 'beats') bindBeatFilters(); };
async function saveBeat(id, changes) {
    await api('/api/composicion/beats/' + id, body(changes)).catch(report);
    await renderCompositionPane();
}
function beatPlay(id) {
    if (comp.playing === id && !comp.audio.paused) { comp.audio.pause(); paintComposition(); return; }
    comp.playing = id; comp.audio.src = '/api/beats/' + encodeURIComponent(id) + '/audio';
    comp.audio.play().catch(report); comp.audio.onpause = comp.audio.onplay = () => paintComposition();
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
    return `<div class="cr-layout">
      <aside class="cr-songs"><input id="lyricSongQ" type="search" placeholder="Buscar canción…" oninput="document.querySelectorAll('[data-lsong]').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(this.value.toLowerCase()))">
        ${comp.songs.map(s => `<button data-lsong class="${s.id === comp.song ? 'is-on' : ''}" onclick="pickLyricSong('${s.id}')"><span><strong>${esc(s.titulo)}</strong>
          <small class="${s.version ? '' : 'muted'}">${s.instrumental ? 'Instrumental' : s.version ? `V${s.version} · ${esc(s.estado)} · ${s.secciones} secciones` : 'Sin letra'} · ${esc(s.disco || 'suelta')}</small></span></button>`).join('')}</aside>
      ${doc ? lyricEditor(doc) : '<p class="muted">Elegí una canción o creá una letra nueva.</p>'}
      <aside class="card publish-card"><strong>Para publicar</strong>
        <span class="muted">La letra se guarda en la ficha de la canción: sale en la exportación de metadata, en el portal del artista y en las guías de DNDA y SADAIC.</span>
        <span class="muted">Spotify y otras plataformas muestran letras a través de proveedores como Musixmatch: subí ahí el texto final (y el .lrc si está sincronizado).</span>
        ${doc ? `<div class="row-tight"><a class="btn-link" href="/api/composicion/letras/${comp.song}.txt" download>Exportar .txt</a><a class="btn-link" href="/api/composicion/letras/${comp.song}.lrc" download>Exportar .lrc</a></div>` : ''}</aside>
    </div>`;
}
function lyricEditor(doc) {
    const names = doc.nombres || [];
    const schemes = [['pop', 'Verso / Estribillo'], ['letras', 'A · A′ · B · C'], ['propio', 'Propio']];
    const autores = comp.lyric.autoria;
    return `<div class="card lyric-editor">
      <div class="cr-sub"><div><span class="insp-kicker">Letra · V${doc.version}</span><h2 style="margin:2px 0">${esc(comp.lyric.cancion.titulo)}</h2>
        <small class="muted">${autores.length ? 'Autoría de la letra: ' + autores.map(a => `${esc(a.nombre)} ${formatDecimal(a.porcentaje, 2)} %`).join(', ') : '<span class="warn-amber">Sin autoría cargada</span> · <button class="link" onclick="openCreditsForSong()">completar en Créditos</button>'}</small></div>
        <div class="row-tight"><select id="lyricState" aria-label="Estado">${['Borrador', 'En revisión', 'Final'].map(s => `<option ${doc.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <input id="lyricLang" value="${esc(comp.lyric.idioma)}" placeholder="Idioma" style="width:110px" aria-label="Idioma"></div></div>
      <div class="row-tight"><span class="insp-label">Nombres de las secciones</span><div class="seg">${schemes.map(([id, label]) => `<button class="${doc.esquema === id ? 'is-on' : ''}" onclick="setScheme('${id}')">${label}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" id="lyricInstrumental" ${doc.instrumental ? 'checked' : ''}> Instrumental</label></div>
      <div class="form-bar">${doc.secciones.map((b, i) => `<button style="flex:${Math.max(1, b.lineas.length)};background:${SECTION_COLORS[b.tipo]}" title="${esc(names[i])}" onclick="document.getElementById('sec${i}').scrollIntoView({block:'center'})">${esc(names[i])}</button>`).join('')}</div>
      <div class="row-tight"><button class="btn-ghost" onclick="comp.collapsed.clear();paintComposition()">Desplegar todo</button><button class="btn-ghost" onclick="comp.lyric.letra.secciones.forEach((_,i)=>comp.collapsed.add(i));paintComposition()">Achicar todo</button>
        <label class="btn-link">Importar Word / PDF<input type="file" accept=".docx,.pdf,.txt,.lrc" hidden onchange="importIntoLyric(this.files[0]).catch(report)"></label>
        <button class="btn-ghost" onclick="startSync().catch(report)">${comp.sync ? 'Sincronizando…' : 'Sincronizar con el audio'}</button></div>
      ${comp.sync ? syncBar() : ''}
      <div id="lyricBlocks">${doc.secciones.map((b, i) => `<section class="lyric-block" id="sec${i}" style="--c:${SECTION_COLORS[b.tipo]}">
          <div class="lyric-block-head"><button class="btn-ghost" onclick="toggleSection(${i})" aria-label="${comp.collapsed.has(i) ? 'Desplegar' : 'Achicar'}">${comp.collapsed.has(i) ? '▸' : '▾'}</button>
            <strong>${esc(names[i])}</strong>
            <select data-sec-kind="${i}" aria-label="Tipo de sección">${Object.entries(SECTION_LABELS).map(([k, l]) => `<option value="${k}" ${b.tipo === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            ${doc.esquema === 'propio' ? `<input data-sec-name="${i}" value="${esc(b.nombre || '')}" placeholder="Nombre propio" style="width:130px">` : ''}
            <label class="check"><input type="checkbox" data-sec-var="${i}" ${b.variacion ? 'checked' : ''}> Variación</label>
            <span class="muted">${countLabel(b.lineas.length, 'línea', 'líneas')}</span>
            <span class="spacer"></span><button class="btn-ghost" onclick="moveSection(${i},-1)" aria-label="Subir">↑</button><button class="btn-ghost" onclick="moveSection(${i},1)" aria-label="Bajar">↓</button>
            <button class="btn-ghost" onclick="removeSection(${i})" aria-label="Quitar sección">✕</button></div>
          ${comp.collapsed.has(i) ? `<p class="muted lyric-peek">${esc(b.lineas[0] || '')}…</p>` : `<textarea data-sec-text="${i}" rows="${Math.max(2, b.lineas.length + 1)}">${esc(b.lineas.join('\n'))}</textarea>`}
        </section>`).join('')}</div>
      <button class="btn-ghost" onclick="addSection()">+ Sección</button>
      <div class="form-actions"><span id="lyricStatus" class="muted" role="status">${comp.lyricDirty ? 'Sin guardar' : ''}</span>
        <button onclick="saveLyric(true).catch(report)">Guardar como V${doc.version + 1}</button><button class="btn-primary" onclick="saveLyric(false).catch(report)">Guardar</button></div>
    </div>`;
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
    const songs = comp.songs.length ? comp.songs : [];
    return `<div class="score-grid">${comp.scores.map(p => `<article class="card score-card ${p.vigente ? '' : 'is-old'}">
        <div class="cr-sub"><span class="tag">${esc(p.formato)}</span>${p.vigente ? '<span class="ok-green">vigente</span>' : '<span class="muted">versión anterior</span>'}</div>
        <input class="title-input" value="${esc(p.titulo)}" onchange="saveScore('${p.id}',{titulo:this.value})" aria-label="Nombre">
        <label>Canción<select onchange="saveScore('${p.id}',{cancion_id:this.value})"><option value="">Sin asociar</option>${songs.map(s => `<option value="${s.id}" ${s.id === p.cancion_id ? 'selected' : ''}>${esc(s.titulo)}</option>`).join('')}</select></label>
        <div class="cr-grid"><label>Arreglo<input value="${esc(p.arreglo)}" placeholder="Opcional" onchange="saveScore('${p.id}',{arreglo:this.value})"></label>
          <label>Instrumento<input value="${esc(p.instrumento)}" placeholder="General" onchange="saveScore('${p.id}',{instrumento:this.value})"></label>
          <label>Versión<input value="${p.version}" inputmode="numeric" onchange="saveScore('${p.id}',{version:this.value})"></label></div>
        <label class="check"><input type="checkbox" ${p.vigente ? 'checked' : ''} onchange="saveScore('${p.id}',{vigente:this.checked})"> Versión vigente</label>
        <div class="row-tight">${['PDF', 'PNG', 'JPG', 'JPEG'].includes(p.formato) ? `<a class="btn-link" href="/api/scores/${p.id}/file" target="_blank" rel="noopener">Ver</a>` : ''}
          <button class="btn-ghost" onclick="openScoreFolder('${p.id}')">📁 Mostrar en carpeta</button></div>
        <small class="muted">${esc(p.coleccion)} · ${p.disponible ? 'disponible' : 'archivo no encontrado'}</small></article>`).join('') ||
        '<p class="muted">Todavía no hay partituras. Cargá PDF, imágenes o archivos de MuseScore, Sibelius, Dorico, Finale o MusicXML.</p>'}</div>
      <p class="insp-help">Las partituras no se generan desde el audio mezclado. Idea a futuro: un borrador desde el MIDI de la sesión.</p>`;
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
