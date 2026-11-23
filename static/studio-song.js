// Canción como proyecto de DAW: un carril por etapa, cada archivo o sesión es un clip
// ubicado en el tiempo, un inspector a la derecha y una barra de transporte abajo.
// Reemplaza la presentación anterior; conserva las mismas operaciones y endpoints.
const DAW_SIGLAS = {Cubase: 'CPR', Reaper: 'RPP', 'Pro Tools': 'PTX', 'Ableton Live': 'ALS', 'Studio One': 'SONG',
    'FL Studio': 'FLP', Nuendo: 'NPR', WaveLab: 'WPR', 'Logic Pro': 'LOGIC'};
const DAW_BY_EXT = {cpr: 'Cubase', rpp: 'Reaper', ptx: 'Pro Tools', als: 'Ableton Live', song: 'Studio One',
    flp: 'FL Studio', npr: 'Nuendo', wpr: 'WaveLab', logicx: 'Logic Pro'};
const AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a|aif|aiff|aac|opus)$/i;
const SESSION_EXT = /\.(cpr|rpp|ptx|als|song|flp|npr|wpr|logicx)$/i;
let studioSel = null;
let songFeedback = [];
const peaksCache = new Map();
const ab = {a: null, b: null, side: 'b'};
const transport = {audio: new Audio(), fileId: null, peaks: null, raf: 0};
transport.audio.preload = 'metadata';

let pendingSeek = null;
async function openSong(id, selectFile, seekAt) {
    if (currentSong?.id !== id && hasUnsavedSongNotes() &&
        !confirm('Hay notas sin guardar. Se conservarán en esta ventana. ¿Querés abrir otra canción?')) return;
    const sequence = ++songLoad;
    const [data, notes] = await Promise.all([api('/api/produccion/' + id),
        api('/api/portal/devoluciones?cancion_id=' + encodeURIComponent(id)).catch(() => [])]);
    if (sequence !== songLoad) return;
    if (currentSong?.id !== id) { studioSel = null; ab.a = ab.b = null; ab.side = 'b'; stopTransport(true); }
    workflow = data;
    currentSong = data.cancion;
    songFeedback = notes;
    if (selectFile) studioSel = {kind: 'file', id: selectFile};
    pendingSeek = selectFile && seekAt !== undefined ? {id: selectFile, at: Number(seekAt) || 0} : null;
    artist = await api('/api/artistas/' + currentSong.artista_id);
    go('songPane');
}

const songStages = () => workflow.etapas.filter(stage => stage.clave !== 'historico' ||
    workflow.archivos.some(file => file.etapa === 'historico'));
const fileById = id => workflow.archivos.find(file => file.id === id);
const sessionById = id => workflow.sesiones.find(session => session.id === id);
const isAudio = file => AUDIO_EXT.test(file.nombre);
const fileLabel = file => file.version_audio || (file.clase && file.clase !== 'Otro' ? file.clase : '') || file.nombre.replace(/\.[^.]+$/, '');
const openNote = note => note.estado === 'Pendiente' || note.estado === 'En revisión';
const noteColor = note => (typeof FB_COLORS !== 'undefined' && FB_COLORS[note.estado]) || '#E5484D';
const notesFor = id => songFeedback.filter(note => note.archivo_id === id).sort((a, b) => a.segundo - b.segundo);
const parseDate = text => { const d = new Date(String(text || '').replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? null : d; };
const shortDate = d => d ? d.toLocaleDateString('es-AR', {day: 'numeric', month: 'short'}) : '';
function currentStageKey() {
    let best = -1;
    for (const item of [...workflow.archivos, ...workflow.sesiones]) best = Math.max(best, STAGE_ORDER.indexOf(item.etapa));
    return best >= 0 ? STAGE_ORDER[best] : '';
}
function defaultSelection() {
    const audios = workflow.archivos.filter(isAudio);
    const favorite = audios.filter(file => file.favorito).sort((a, b) => STAGE_ORDER.indexOf(b.etapa) - STAGE_ORDER.indexOf(a.etapa))[0];
    const pick = favorite || audios[0] || workflow.archivos[0];
    if (pick) return {kind: 'file', id: pick.id};
    const session = workflow.sesiones[0];
    if (session) return {kind: 'session', id: session.id};
    return {kind: 'stage', id: 'demo'};
}
function validSelection(sel) {
    if (!sel) return false;
    if (sel.kind === 'file') return !!fileById(sel.id);
    if (sel.kind === 'session') return !!sessionById(sel.id);
    return songStages().some(stage => stage.clave === sel.id);
}

// ── Línea de tiempo ──
function timelineItems() {
    const items = [
        ...workflow.archivos.map(file => ({kind: 'file', id: file.id, stage: file.etapa, date: parseDate(file.creado), ref: file})),
        ...workflow.sesiones.map(session => ({kind: 'session', id: session.id, stage: session.etapa,
            date: session.fecha_archivo ? new Date(session.fecha_archivo * 1000) : parseDate(session.creado), ref: session})),
    ];
    const dates = items.map(item => item.date?.getTime()).filter(Boolean);
    let min = dates.length ? Math.min(...dates) : Date.now();
    let max = dates.length ? Math.max(...dates) : Date.now();
    const day = 86400000;
    if (max - min < 6 * day) { const mid = (max + min) / 2; min = mid - 3 * day; max = mid + 3 * day; }
    const span = max - min;
    const WIDTH = 13;
    for (const item of items) {
        const t = item.date ? item.date.getTime() : max;
        item.left = (t - min) / span * (100 - WIDTH);
        item.width = WIDTH;
    }
    const ticks = Array.from({length: 5}, (_, i) => new Date(min + span * i / 4));
    return {items, ticks};
}
function packRows(items) {
    const rows = [];
    for (const item of items.sort((a, b) => a.left - b.left)) {
        let row = rows.findIndex(end => end <= item.left + 0.2);
        if (row < 0) { rows.push(0); row = rows.length - 1; }
        rows[row] = item.left + item.width;
        item.row = row;
    }
    return Math.max(1, rows.length);
}
function clipMarkup(item) {
    const selected = studioSel && studioSel.kind === item.kind && studioSel.id === item.id;
    if (item.kind === 'session') {
        const s = item.ref;
        return `<button class="clip clip-session ${selected ? 'is-selected' : ''} ${s.disponible ? '' : 'is-missing'}" data-clip="session:${s.id}"
            style="left:min(${item.left}%, calc(100% - 96px));width:max(${item.width}%, 92px);top:${8 + item.row * 66}px" title="${esc(s.nombre)} · ${esc(s.ruta || '')}"
            aria-pressed="${selected}" aria-label="Sesión ${esc(s.nombre)}">
            <span class="clip-head"><span class="clip-daw">${esc(DAW_SIGLAS[s.daw] || (s.daw || 'DAW').slice(0, 4).toUpperCase())}</span>
              <span class="clip-name">${esc(s.nombre)}</span>${s.vigente ? '<span class="clip-flag" title="Sesión vigente">✓</span>' : ''}</span>
            <span class="clip-foot mono">${s.version ? 'V' + String(s.version).padStart(3, '0') : 'sesión'} · ${esc(shortDate(item.date))}</span></button>`;
    }
    const f = item.ref;
    const notes = notesFor(f.id).filter(openNote).length;
    const shared = (f.compartido || [])[0];
    const audio = isAudio(f);
    return `<button class="clip ${audio ? 'clip-audio' : 'clip-doc'} ${selected ? 'is-selected' : ''} ${f.disponible ? '' : 'is-missing'}" data-clip="file:${f.id}"
        style="left:min(${item.left}%, calc(100% - 96px));width:max(${item.width}%, 92px);top:${8 + item.row * 66}px" title="${esc(f.nombre)}"
        aria-pressed="${selected}" aria-label="${audio ? 'Audio' : 'Archivo'} ${esc(f.nombre)}">
        <span class="clip-head">${audio ? '' : `<span class="clip-daw">${esc(f.nombre.split('.').pop().toUpperCase().slice(0, 4))}</span>`}
          <span class="clip-name">${esc(fileLabel(f))}</span>${f.favorito ? '<span class="clip-star" title="Favorito">★</span>' : ''}${shared ? `<span class="clip-shared" title="El artista lo escuchó en «${esc(shared)}»">↗ ${esc(shared)}</span>` : ''}${notes ? `<span class="clip-notes" title="Devoluciones abiertas">${notes}</span>` : ''}</span>
        ${audio ? `<canvas class="clip-wave" data-peaks="${f.id}" data-size="${f.tamano ?? ''}" data-rev="${f.modificado || ''}" aria-hidden="true"></canvas>`
                : `<span class="clip-foot mono">${esc(shortDate(item.date))}</span>`}</button>`;
}

function renderWorkflow() {
    disposeWavePlayers();
    const song = currentSong;
    songBreadcrumbs();
    if (!validSelection(studioSel)) studioSel = defaultSelection();
    if (!ab.b || !fileById(ab.b)) {
        const audios = workflow.archivos.filter(isAudio);
        const sel = studioSel.kind === 'file' && fileById(studioSel.id) && isAudio(fileById(studioSel.id)) ? fileById(studioSel.id) : audios[0];
        ab.b = sel?.id || null;
        ab.a = audios.find(file => file.id !== ab.b && file.etapa === sel?.etapa)?.id || audios.find(file => file.id !== ab.b)?.id || null;
    }
    const stageKey = currentStageKey();
    const mainSession = workflow.sesiones.find(session => session.principal) || workflow.sesiones.find(session => session.vigente) || workflow.sesiones[0];
    const {items, ticks} = timelineItems();
    const lanes = songStages().map(stage => {
        const laneItems = items.filter(item => item.stage === stage.clave);
        const sessionItems = laneItems.filter(item => item.kind === 'session'), audioItems = laneItems.filter(item => item.kind === 'file');
        const sessionRows = packRows(sessionItems), audioRows = packRows(audioItems);
        const files = audioItems.length, sessions = sessionItems.length;
        const selected = studioSel.kind === 'stage' && studioSel.id === stage.clave;
        const sub = (label, list, rows, empty) => `<div class="sublane" style="--rows:${rows}"><span class="sublane-label">${label}</span>
            <div class="lane-body" data-drop-stage="${stage.clave}">${list.length ? list.map(clipMarkup).join('') : `<div class="lane-empty">${empty}</div>`}</div></div>`;
        return `<div class="lane st-${stage.clave}">
          <div class="lane-head ${selected ? 'is-selected' : ''}">
            <button class="lane-select" data-stage-select="${stage.clave}" aria-pressed="${selected}">
              <span class="lane-macro">${stage.macro === 'pre' ? 'PREPRODUCCIÓN' : 'PRODUCCIÓN'}</span>
              <span class="lane-name">${esc(STAGE_INFO[stage.clave]?.short || stage.nombre)}</span>
              <span class="lane-count mono">${laneItems.length ? [files && countLabel(files, 'audio', 'audios'), sessions && countLabel(sessions, 'sesión', 'sesiones')].filter(Boolean).join(' · ') : 'vacía'}</span>
            </button>
            <button class="lane-add" title="Agregar a ${esc(stage.nombre)}" aria-label="Agregar a ${esc(stage.nombre)}" data-stage-add="${stage.clave}">+</button>
          </div>
          <div class="sublanes">
            ${sub('Sesión', sessionItems, sessionRows, 'Sin sesiones · soltá el proyecto del DAW acá')}
            ${sub('Audios', audioItems, audioRows, 'Sin audios · soltá bounces, mezclas o masters acá')}
          </div>
        </div>`;
    }).join('');
    const cover = artBox(song.portada, song.disco_id || song.id, stageKey, 'song-art');
    $('songPane').innerHTML = `
      <header class="song-head">
        <div class="song-id">${cover}
          <div class="song-titles">
            <span class="eyebrow">${song.disco ? `Canción${song.pista ? ' · pista ' + esc(song.pista) : ''} de <button class="link" onclick="openGlobalAlbum('${song.disco_id}','${song.artista_id}').catch(report)">${esc(song.disco)}</button>` : 'Canción suelta'} · <button class="link" onclick="openArtist('${song.artista_id}',true)">${esc(song.artista)}</button></span>
            <h1 id="songHeading">${esc(song.titulo)}</h1>
            <div class="song-chips">
              ${stageKey ? `<span class="stage-pill st-${stageKey}">En ${esc(stageName(stageKey).toLowerCase())}</span>` : '<span class="chip">Sin material</span>'}
              ${song.bpm ? `<span class="chip">${esc(song.bpm)} BPM</span>` : ''}${song.tonalidad ? `<span class="chip">${esc(song.tonalidad)}</span>` : ''}
              <span class="chip">${esc(song.estado)}</span>${mainSession?.daw ? `<span class="chip">${esc(mainSession.daw)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="song-actions">
          <button onclick="songDataDialog(currentSong.id).catch(report)">Ficha de la canción</button>
          <details class="menu"><summary class="menu-button" aria-label="Más acciones">Más</summary><div class="menu-list">
            <button onclick="editProductionSong().catch(report)">Editar título, disco y estado</button>
            <button onclick="sessionDialog(activeStudioStage())">Vincular sesión DAW…</button>
            <button onclick="productionCopyDialog()">Incorporar producción a AudioTaller…</button>
            <button onclick="feedbackDialog({cancion_id:currentSong.id}).catch(report)">Devoluciones del artista…</button>
            <button onclick="openCatalog(currentSong.id)">Ver audios en el Catálogo</button>
          </div></details>
          <button class="btn-primary" onclick="addMaterialDialog()">+ Agregar audio o sesión</button>
        </div>
      </header>
      <div id="transport" class="transport" role="region" aria-label="Transporte"></div>
      <div class="studio">
        <section class="arrange" aria-label="Línea de producción">
          <div class="ruler"><span class="ruler-label">Etapas</span><div class="ruler-ticks mono">${ticks.map(tick => `<span>${esc(shortDate(tick))}</span>`).join('')}</div></div>
          <div class="lanes">${lanes}</div>
          <details class="history"><summary>Historial de producción · ${countLabel(workflow.eventos.length, 'evento', 'eventos')}</summary>
            <div class="history-list">${workflow.eventos.map(event => `<div><time>${esc(event.creado)}</time><span>${esc(event.tipo)}</span><small>${esc(event.detalle)}</small></div>`).join('') || '<p class="muted">Sin eventos registrados.</p>'}</div>
          </details>
        </section>
        <aside id="inspector" class="inspector" aria-label="Inspector"></aside>
      </div>`;
    bindLanes();
    renderInspector();
    renderTransport();
    drawClipWaves();
    if (pendingSeek && fileById(pendingSeek.id)) {
        const {id, at} = pendingSeek; pendingSeek = null;
        if (ab.a !== id && ab.b !== id) { ab.b = id; ab.side = 'b'; } else ab.side = ab.a === id ? 'a' : 'b';
        loadTransport(id).then(() => { transport.audio.currentTime = Math.max(0, at - 5); renderTransport(); });
        document.querySelector(`[data-clip="file:${id}"]`)?.scrollIntoView({block: 'nearest', inline: 'center'});
    }
}
function activeStudioStage() {
    if (!studioSel) return 'demo';
    if (studioSel.kind === 'stage') return studioSel.id;
    const item = studioSel.kind === 'file' ? fileById(studioSel.id) : sessionById(studioSel.id);
    return item?.etapa && item.etapa !== 'historico' ? item.etapa : (currentStageKey() || 'demo');
}
function bindLanes() {
    document.querySelectorAll('[data-clip]').forEach(clip => clip.onclick = () => {
        const [kind, id] = clip.dataset.clip.split(':');
        selectStudio({kind, id});
    });
    document.querySelectorAll('[data-clip^="file:"]').forEach(clip => clip.ondblclick = () => {
        const file = fileById(clip.dataset.clip.slice(5));
        if (file && isAudio(file)) playFile(file.id);
    });
    document.querySelectorAll('[data-clip^="session:"]').forEach(clip => clip.ondblclick = () => {
        const session = sessionById(clip.dataset.clip.slice(8));
        if (session?.abrible) openDawSession(session.id);
    });
    document.querySelectorAll('[data-stage-select]').forEach(button => button.onclick = () => selectStudio({kind: 'stage', id: button.dataset.stageSelect}));
    document.querySelectorAll('[data-stage-add]').forEach(button => button.onclick = () => addMaterialDialog(button.dataset.stageAdd));
    document.querySelectorAll('[data-drop-stage]').forEach(zone => {
        const stage = zone.dataset.dropStage;
        zone.ondragover = event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); zone.classList.add('is-dragging'); } };
        zone.ondragleave = () => zone.classList.remove('is-dragging');
        zone.ondrop = event => {
            event.preventDefault();
            zone.classList.remove('is-dragging');
            if (event.dataTransfer.files.length) addMaterialDialog(stage, [...event.dataTransfer.files]);
        };
    });
}
function selectStudio(sel) {
    studioSel = sel;
    document.querySelectorAll('[data-clip]').forEach(clip => {
        const on = clip.dataset.clip === sel.kind + ':' + sel.id;
        clip.classList.toggle('is-selected', on);
        clip.setAttribute('aria-pressed', on);
    });
    document.querySelectorAll('[data-stage-select]').forEach(button => {
        const on = sel.kind === 'stage' && button.dataset.stageSelect === sel.id;
        button.closest('.lane-head').classList.toggle('is-selected', on);
        button.setAttribute('aria-pressed', on);
    });
    renderInspector();
}

// ── Mini formas de onda de los clips: solo WAV, con caché y carga diferida ──
let clipObserver;
function drawClipWaves() {
    if (clipObserver) clipObserver.disconnect();
    clipObserver = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) { clipObserver.unobserve(entry.target); paintClip(entry.target); }
    });
    document.querySelectorAll('canvas[data-peaks]').forEach(canvas => clipObserver.observe(canvas));
}
async function loadPeaks(file) {
    const key = [file.id, file.tamano, file.modificado].join(':');
    if (peaksCache.has(key)) return peaksCache.get(key);
    const promise = /\.wav$/i.test(file.nombre) && file.disponible
        ? fetch('/api/produccion/archivo/' + file.id + '/onda').then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null);
    peaksCache.set(key, promise);
    return promise;
}
async function paintClip(canvas) {
    const file = fileById(canvas.dataset.peaks);
    if (!file) return;
    const data = await loadPeaks(file);
    if (!canvas.isConnected) return;
    const box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio));
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
    const color = getComputedStyle(canvas.closest('.lane')).getPropertyValue('--stage').trim() || '#A6A6B0';
    ctx.fillStyle = color;
    const bars = Math.max(8, Math.floor(box.width / 3)), mid = box.height / 2;
    const peaks = data?.peaks;
    const max = peaks ? Math.max(...peaks, 0.01) : 1;
    for (let i = 0; i < bars; i++) {
        let value;
        if (peaks) {
            const from = Math.floor(i / bars * peaks.length), to = Math.max(from + 1, Math.floor((i + 1) / bars * peaks.length));
            value = Math.max(...peaks.slice(from, to)) / max;
        } else value = 0.25 + 0.15 * Math.abs(Math.sin(i * 1.7));
        const h = Math.max(1, value * (box.height - 2));
        ctx.globalAlpha = peaks ? 0.9 : 0.35;
        ctx.fillRect(i * 3, mid - h / 2, 2, h);
    }
}

// ── Inspector ──
function stageOptions(current) {
    return STAGE_ORDER.filter(key => key !== current).map(key => `<option value="${key}">${esc(STAGE_INFO[key].short)}</option>`).join('');
}
function moveBlock(kind, item) {
    return `<div class="insp-block">
        <label class="insp-label" for="moveTarget">Pasar a otra etapa</label>
        <div class="row-tight"><select id="moveTarget">${stageOptions(item.etapa)}</select>
          <button onclick="transferItem('${kind}','${item.id}',false)">Mover</button>
          <button onclick="transferItem('${kind}','${item.id}',true)">Copiar</button></div>
        <p class="insp-help">${kind === 'sesion'
            ? 'Mover conserva la sesión, su historial y sus archivos asociados. Copiar crea una versión nueva del proyecto (_V00x) junto al original y la registra en la otra etapa.'
            : 'Mover conserva el archivo, su ruta y su historial. Copiar deja el original donde está y suma una copia en la otra etapa.'}</p>
      </div>`;
}
async function renderInspector() {
    const root = $('inspector');
    if (!root) return;
    const sel = studioSel;
    if (sel.kind === 'stage') return renderStageInspector(root, sel.id);
    if (sel.kind === 'session') {
        const s = sessionById(sel.id);
        root.innerHTML = `<span class="insp-kicker">Inspector · sesión de DAW</span>
          <h2 class="insp-title">${esc(s.nombre)}</h2>
          <span class="insp-type"><i class="dot st-${s.etapa}"></i>${esc(s.daw || 'Sin DAW')} · ${esc(stageName(s.etapa))}</span>
          <dl class="facts mono">
            <dt>Versión</dt><dd>${s.version ? 'V' + String(s.version).padStart(3, '0') : '—'}</dd>
            <dt>Estado</dt><dd>${s.vigente ? 'Vigente de la etapa' : 'No vigente'}</dd>
            <dt>Ubicación</dt><dd class="path" title="${esc(s.ruta)}">${esc(s.ruta || '—')}</dd>
            <dt>Disponible</dt><dd>${s.disponible ? 'Sí' : 'Ruta no disponible'}</dd>
            <dt>Registrada</dt><dd>${esc(s.creado)}</dd>
          </dl>
          <div class="insp-actions">
            <button class="btn-primary" ${s.abrible ? '' : 'disabled title="Para abrirla, vinculá el archivo de proyecto del DAW"'} onclick="openDawSession('${s.id}')">Abrir en ${esc(s.daw || 'el DAW')}</button>
            <div class="row-tight"><button onclick="setValidSession('${s.id}','${s.etapa}',${!s.vigente})">${s.vigente ? 'Quitar vigente' : 'Marcar como vigente'}</button>
              <button onclick="duplicateSessionDialog('${s.id}')">Nueva versión</button></div>
          </div>
          <div class="insp-block"><label class="insp-label" for="sessionNote">Notas de la sesión</label>
            <textarea id="sessionNote" rows="4">${esc(sessionDrafts.get(s.id) ?? s.comentario ?? '')}</textarea>
            <div class="row-tight"><button onclick="saveSessionNote('${s.id}')">Guardar notas</button><span id="sessionNoteStatus" class="insp-help" role="status"></span></div></div>
          ${moveBlock('sesion', s)}`;
        $('sessionNote').oninput = event => { sessionDrafts.set(s.id, event.target.value); $('sessionNoteStatus').textContent = 'Sin guardar'; };
        return;
    }
    const f = fileById(sel.id);
    const audio = isAudio(f);
    const notes = notesFor(f.id);
    const session = f.sesion_id ? sessionById(f.sesion_id) : null;
    root.innerHTML = `<span class="insp-kicker">Inspector · ${audio ? 'audio' : 'archivo'}</span>
      <h2 class="insp-title">${esc(f.nombre)}</h2>
      <span class="insp-type"><i class="dot st-${f.etapa}"></i>${esc(fileLabel(f))} · ${esc(stageName(f.etapa))}${f.favorito ? ' · <span class="star">★ Favorito</span>' : ''}</span>
      ${notes.length ? `<div class="insp-block insp-feedback"><span class="insp-label">Devoluciones del artista</span>
        ${notes.map(note => `<button class="note-row" onclick="seekNote('${f.id}',${Number(note.segundo) || 0})">
          <span class="mono note-time"><i class="fb-dot" style="background:${noteColor(note)}"></i>${note.segundo > 0 ? clockText(note.segundo) : 'General'}</span><span><span>${esc(note.texto)}</span><small>${esc(note.estado === 'Resuelta' ? 'Resuelto' : note.estado)} · ${esc(note.playlist || note.etiqueta)}</small></span></button>`).join('')}
        <button class="btn-ghost" onclick="feedbackDialog({cancion_id:currentSong.id}).catch(report)">Gestionar devoluciones</button></div>` : ''}
      <dl class="facts mono" id="fileFacts">
        <dt>Fecha</dt><dd>${esc(f.creado)}</dd>
        <dt>Tamaño</dt><dd>${formatBytes(f.tamano)}</dd>
        <dt>Origen</dt><dd>${f.modo === 'vinculado' ? 'Vinculado: original en su carpeta' : 'Copia en AudioTaller'}</dd>
        ${session ? `<dt>Sesión</dt><dd>${esc(session.nombre)}</dd>` : ''}
        <dt>Estado</dt><dd>${f.disponible ? 'Disponible' : 'Ruta no disponible'}</dd>
      </dl>
      <div class="insp-actions">
        ${audio ? `<button class="btn-primary" ${f.disponible ? '' : 'disabled'} onclick="playFile('${f.id}')">▶ Reproducir</button>
          <div class="row-tight"><button data-star="${f.id}" aria-pressed="${!!f.favorito}" onclick="toggleStudioFavorite('${f.id}',this)">${f.favorito ? '★ Quitar favorito' : '☆ Favorito'}</button>
            <button onclick="audioDetailsDialog('${f.id}').catch(report)">Clasificar / versión</button></div>
          <div class="row-tight ab-set"><span class="insp-help">Comparar en el transporte:</span><button onclick="setAB('a','${f.id}')" aria-label="Usar como versión A" ${ab.a === f.id ? 'aria-pressed="true"' : ''}>A</button><button onclick="setAB('b','${f.id}')" aria-label="Usar como versión B" ${ab.b === f.id ? 'aria-pressed="true"' : ''}>B</button></div>` :
          `<a class="btn-link btn-primary" href="/api/produccion/archivo/${f.id}" target="_blank" rel="noopener">Abrir / descargar</a>`}
        <div class="row-tight"><button onclick="fileVersionDialog('${f.id}','${f.etapa === 'historico' ? activeStudioStage() : f.etapa}')">Registrar nueva versión</button>
          ${audio ? `<a class="btn-link" href="/api/produccion/archivo/${f.id}" target="_blank" rel="noopener">Abrir archivo</a>` : ''}</div>
      </div>
      ${moveBlock('archivo', f)}
`;
    if (audio && f.disponible) {
        try {
            const info = (await api('/api/catalogo/' + f.id)).tecnica || {};
            if (studioSel?.id !== f.id || !$('fileFacts')) return;
            const parts = [f.nombre.split('.').pop().toUpperCase(), formatRate(info.frecuencia), info.bits ? info.bits + ' bit' : '',
                info.canales === 1 ? 'mono' : info.canales === 2 ? 'estéreo' : info.canales ? info.canales + ' canales' : ''].filter(Boolean);
            $('fileFacts').insertAdjacentHTML('afterbegin', `<dt>Formato</dt><dd>${esc(parts.join(' · '))}</dd>${info.duracion ? `<dt>Duración</dt><dd>${clockText(info.duracion)}</dd>` : ''}`);
        } catch { /* Los datos técnicos son opcionales. */ }
    }
}
function renderStageInspector(root, key) {
    const stage = workflow.etapas.find(item => item.clave === key);
    const files = workflow.archivos.filter(file => file.etapa === key);
    const sessions = workflow.sesiones.filter(session => session.etapa === key);
    const draft = noteDrafts.get(draftKey(key)) ?? workflow.notas[key] ?? '';
    root.innerHTML = `<span class="insp-kicker">Inspector · etapa</span>
      <h2 class="insp-title"><i class="dot st-${key}"></i> ${esc(STAGE_INFO[key]?.short || stage.nombre)}</h2>
      <p class="insp-help">${esc(stageDescriptions[key] || '')}</p>
      <dl class="facts mono"><dt>Archivos</dt><dd>${files.length}</dd><dt>Sesiones</dt><dd>${sessions.length}</dd>
        <dt>Vigente</dt><dd>${esc(sessions.find(s => s.vigente)?.nombre || '—')}</dd></dl>
      ${key === 'historico' ? '<p class="insp-help">Archivos de una versión anterior de AudioTaller sin etapa registrada. Seleccioná cada uno y movelo a la etapa que corresponda.</p>' : `
      <div class="insp-actions">
        <button class="btn-primary" onclick="addMaterialDialog('${key}')">+ Agregar audio o sesión</button>
        <div class="row-tight"><button onclick="discoverSessionDialog('${key}')">Buscar sesiones en carpeta</button>
          <button onclick="newNativeSessionDialog('${key}')">Nueva sesión</button></div>
      </div>`}
      <div class="insp-block"><label class="insp-label" for="stageNote">Documentación y notas de la etapa</label>
        <textarea id="stageNote" rows="6">${esc(draft)}</textarea>
        <div class="row-tight"><button onclick="saveStudioStageNote('${key}')">Guardar nota</button><span id="stageNoteStatus" class="insp-help" role="status"></span></div></div>`;
    $('stageNote').oninput = event => { noteDrafts.set(draftKey(key), event.target.value); $('stageNoteStatus').textContent = 'Sin guardar'; };
}
async function saveStudioStageNote(key) {
    try {
        await api('/api/produccion/' + currentSong.id + '/notas/' + key, body({texto: $('stageNote').value}));
        noteDrafts.delete(draftKey(key));
        studioSel = {kind: 'stage', id: key};
        await openSong(currentSong.id);
    } catch (error) { report(error); }
}
async function saveSessionNote(id) {
    const text = $('sessionNote').value;
    try {
        await api('/api/produccion/' + currentSong.id + '/sesiones/' + id + '/notas', body({texto: text}));
        const session = sessionById(id);
        if (session) session.comentario = text;
        if (sessionDrafts.get(id) === text) sessionDrafts.delete(id);
        $('sessionNoteStatus').textContent = 'Notas guardadas';
    } catch (error) { report(error); }
}
async function toggleStudioFavorite(id, button) {
    try {
        await toggleAudioFavorite(id, button);
        renderWorkflow();
    } catch (error) { report(error); }
}
async function transferItem(kind, id, copy) {
    const target = $('moveTarget').value;
    const label = STAGE_INFO[target].short;
    if (kind === 'sesion' && !copy && !confirm(`¿Mover la sesión a ${label}? Sus archivos asociados la acompañan y deberás marcar de nuevo cuál es la sesión vigente.`)) return;
    try {
        const result = await api('/api/produccion/' + currentSong.id + '/trasladar', body({tipo: kind, id, etapa: target, copiar: copy}));
        studioSel = {kind: kind === 'sesion' ? 'session' : 'file', id: result.id || id};
        await openSong(currentSong.id);
    } catch (error) { report(error); }
}
// Reemplaza la versión anterior, que dependía de la tabla de la etapa.
function linkFileDialog(stage) {
    formDialog('Vincular archivo externo', `<p class="muted">Se guardará su ubicación original. El archivo permanece en esa carpeta.</p>
        <label>Ruta absoluta del archivo<input name="ruta" required></label><button class="alt" type="button" id="pickLinked">Elegir archivo</button>`,
        async data => {
            await api('/api/produccion/' + currentSong.id + '/vinculos', body({...data, etapa: stage, sesion_id: ''}));
            await openSong(currentSong.id);
        }, form => { $('pickLinked').onclick = () => pickLocalPath(form.elements.ruta); });
}

// ── Transporte: un único reproductor, comparación A/B y marcas de devolución ──
function setAB(side, id) {
    ab[side] = id;
    if (transport.fileId && ab.side === side) loadTransport(id, true);
    renderTransport();
    renderInspector();
}
function playFile(id) {
    if (ab.a !== id && ab.b !== id) { ab.b = id; ab.side = 'b'; }
    else ab.side = ab.a === id ? 'a' : 'b';
    return loadTransport(id, false, true);
}
async function loadTransport(id, keepTime = false, autoplay = false) {
    const file = fileById(id);
    if (!file) return;
    const audio = transport.audio;
    const time = keepTime ? audio.currentTime : 0;
    const playing = keepTime ? !audio.paused : autoplay;
    if (transport.fileId !== id) {
        transport.fileId = id;
        audio.src = '/api/produccion/archivo/' + id;
        transport.peaks = null;
        loadPeaks(file).then(data => { if (transport.fileId === id) { transport.peaks = data?.peaks || null; drawTransport(); } });
        await new Promise(resolve => { audio.onloadedmetadata = resolve; audio.onerror = resolve; });
        if (time) audio.currentTime = Math.min(time, audio.duration || time);
    }
    if (playing) audio.play().catch(() => {});
    renderTransport();
}
function stopTransport(reset = false) {
    transport.audio.pause();
    if (reset) { transport.fileId = null; transport.audio.removeAttribute('src'); transport.audio.load(); }
    cancelAnimationFrame(transport.raf);
}
function toggleTransport() {
    const id = ab[ab.side] || ab.b || ab.a;
    if (!id) return;
    if (transport.fileId !== id) return loadTransport(id, false, true);
    transport.audio.paused ? transport.audio.play().catch(() => {}) : transport.audio.pause();
}
function switchSide(side) {
    ab.side = side;
    if (ab[side]) loadTransport(ab[side], !!transport.fileId);
    renderTransport();
}
async function seekNote(id, seconds) {
    if (transport.fileId !== id) await playFile(id);
    transport.audio.currentTime = Math.max(0, seconds - 5);
    transport.audio.play().catch(() => {});
}
function renderTransport() {
    const root = $('transport');
    if (!root) return;
    const audio = transport.audio;
    const current = fileById(transport.fileId) || fileById(ab[ab.side]) || fileById(ab.b);
    const labelOf = id => { const f = fileById(id); return f ? fileLabel(f) : '—'; };
    root.innerHTML = `
      <div class="t-buttons">
        <button class="btn-ghost" onclick="stopTransport();transport.audio.currentTime=0;renderTransport()" aria-label="Detener"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button>
        <button class="t-play" onclick="toggleTransport()" aria-label="${audio.paused ? 'Reproducir' : 'Pausar'}" ${current ? '' : 'disabled'}>
          ${audio.paused ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'}</button>
        <button class="btn-ghost ${audio.loop ? 'is-on' : ''}" onclick="transport.audio.loop=!transport.audio.loop;renderTransport()" aria-pressed="${audio.loop}" aria-label="Repetir"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg></button>
      </div>
      <div class="t-clock mono"><span id="tNow">${clockText(audio.currentTime)}</span><small> / ${clockText(audio.duration || 0)}</small></div>
      <div class="t-wave"><canvas id="tWave" aria-label="Posición" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100"></canvas>
        <span class="t-name">${current ? esc(current.nombre) : 'Elegí un audio y presioná reproducir · barra espaciadora: reproducir o pausar'}</span></div>
      <div class="t-ab" role="group" aria-label="Comparar versiones">
        <button aria-pressed="${ab.side === 'a'}" ${ab.a ? '' : 'disabled'} onclick="switchSide('a')"><b>A</b> ${esc(labelOf(ab.a))}</button>
        <button aria-pressed="${ab.side === 'b'}" ${ab.b ? '' : 'disabled'} onclick="switchSide('b')"><b>B</b> ${esc(labelOf(ab.b))}</button>
      </div>`;
    const canvas = $('tWave');
    const seek = event => {
        if (!audio.duration) return;
        const box = canvas.getBoundingClientRect();
        const hit = notesFor(transport.fileId).find(note => note.segundo > 0 && Math.abs(note.segundo / audio.duration * box.width - (event.clientX - box.left)) < 7);
        if (hit && event.clientY - box.top < 14) return seekNote(transport.fileId, hit.segundo);
        audio.currentTime = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * audio.duration;
        drawTransport();
    };
    canvas.onclick = seek;
    canvas.onkeydown = event => {
        if (!audio.duration) return;
        if (event.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
        if (event.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
    };
    drawTransport();
}
function drawTransport() {
    const canvas = $('tWave');
    if (!canvas) return;
    const audio = transport.audio;
    const box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    if (!box.width) return;
    canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio);
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    const bars = Math.floor(box.width / 3), mid = box.height / 2, peaks = transport.peaks;
    const max = peaks ? Math.max(...peaks, 0.01) : 1;
    for (let i = 0; i < bars; i++) {
        let v = 0.18;
        if (peaks) {
            const from = Math.floor(i / bars * peaks.length), to = Math.max(from + 1, Math.floor((i + 1) / bars * peaks.length));
            v = Math.max(...peaks.slice(from, to)) / max;
        }
        const h = Math.max(2, v * (box.height - 6));
        ctx.fillStyle = i / bars <= progress ? '#2FD8BF' : '#3A3A42';
        ctx.fillRect(i * 3, mid - h / 2, 2, h);
    }
    if (audio.duration) {
        for (const note of notesFor(transport.fileId)) {
            const x = note.segundo / audio.duration * box.width;
            ctx.fillStyle = noteColor(note);
            ctx.beginPath(); ctx.arc(x, 5, 4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#EDEDF0';
        ctx.fillRect(progress * box.width - 1, 0, 2, box.height);
    }
    canvas.setAttribute('aria-valuenow', Math.round(progress * 100));
}
function tickTransport() {
    if (!$('tNow')) return;
    $('tNow').textContent = clockText(transport.audio.currentTime);
    drawTransport();
    if (!transport.audio.paused) transport.raf = requestAnimationFrame(tickTransport);
}
transport.audio.addEventListener('play', () => { renderTransport(); tickTransport(); });
transport.audio.addEventListener('pause', () => { renderTransport(); cancelAnimationFrame(transport.raf); });
transport.audio.addEventListener('ended', () => renderTransport());
transport.audio.addEventListener('loadedmetadata', () => renderTransport());
document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || trail.at(-1) !== 'songPane' || document.querySelector('dialog[open]')) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName) || event.target.isContentEditable) return;
    event.preventDefault();
    toggleTransport();
});
window.addEventListener('resize', () => { if (trail.at(-1) === 'songPane') { drawTransport(); drawClipWaves(); } });

// ── Agregar audio o sesión: un solo lugar, con tipo detectado y etapa sugerida ──
let addItems = [];
let addStage = '';
function suggestStage(name) {
    if (addStage) return addStage;
    if (/master/i.test(name)) return 'mastering';
    if (/mix|mezcla|stem/i.test(name)) return 'mezcla';
    if (/toma|take|grab|rec|voz|vox/i.test(name)) return 'grabacion';
    if (/maqueta|gu[ií]a|arreglo|preprod/i.test(name)) return 'maqueta';
    if (/demo|idea|boceto|nota de voz/i.test(name)) return 'demo';
    return currentStageKey() || 'demo';
}
function kindOf(name) { return SESSION_EXT.test(name) ? 'sesion' : AUDIO_EXT.test(name) ? 'audio' : 'doc'; }
const baseName = name => name.replace(/\.[^.]+$/, '').replace(/[ _-]*(v|ver|version|versión|mix|take|toma)?[ _-]*\d+$/i, '').toLowerCase();
function previousVersionFor(name, stage) {
    const base = baseName(name);
    return workflow.archivos.filter(file => file.etapa === stage && isAudio(file) && baseName(file.nombre) === base)[0]?.id || '';
}
function addMaterialDialog(stage = '', files = []) {
    addStage = stage;
    addItems = [];
    let dialog = $('addDialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'addDialog';
        dialog.className = 'add-dialog';
        document.body.append(dialog);
    }
    const linkable = !!window.pywebview?.api?.choose_audio_files;
    dialog.innerHTML = `<form method="dialog" id="addForm">
      <header class="add-head"><div><h2>Agregar a «${esc(currentSong.titulo)}»</h2>
        <p class="muted">Audios, sesiones de DAW o documentos. AudioTaller detecta el tipo y sugiere la etapa.</p></div>
        <button type="button" class="btn-ghost" aria-label="Cerrar" onclick="$('addDialog').close()">✕</button></header>
      <div class="add-body">
        <label class="add-drop" id="addDrop">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
          <strong>Soltá archivos acá</strong><span class="muted">o hacé clic para elegirlos · se guarda una copia y el original queda intacto</span>
          <input type="file" multiple id="addInput"></label>
        ${linkable ? `<button type="button" class="add-link" id="addLink"><strong>Vincular desde su ubicación</strong>
          <span class="muted">Para sesiones de DAW y archivos grandes: no se copia nada, se registra dónde están.</span></button>` : ''}
        <div id="addList" class="add-list"></div>
        <p id="addError" role="alert" class="add-error"></p>
      </div>
      <footer class="add-foot"><span id="addSummary" class="mono muted"></span>
        <div class="row-tight"><button type="button" class="alt" onclick="$('addDialog').close()">Cancelar</button>
          <button type="button" class="btn-primary" id="addSubmit" disabled>Agregar</button></div></footer></form>`;
    const input = $('addInput'), drop = $('addDrop');
    input.onchange = () => { queueFiles([...input.files]); input.value = ''; };
    drop.ondragover = event => { event.preventDefault(); drop.classList.add('is-dragging'); };
    drop.ondragleave = () => drop.classList.remove('is-dragging');
    drop.ondrop = event => { event.preventDefault(); drop.classList.remove('is-dragging'); queueFiles([...event.dataTransfer.files]); };
    if (linkable) $('addLink').onclick = async () => {
        try {
            const paths = await window.pywebview.api.choose_audio_files();
            for (const path of paths || []) {
                const name = path.split(/[\\/]/).pop();
                const stageKey = suggestStage(name);
                addItems.push({mode: 'link', path, name, kind: kindOf(name), stage: stageKey, versionOf: kindOf(name) === 'audio' ? previousVersionFor(name, stageKey) : ''});
            }
            renderAddList();
        } catch (error) { $('addError').textContent = error.message; }
    };
    $('addSubmit').onclick = submitAdd;
    queueFiles(files);
    dialog.showModal();
}
function queueFiles(files) {
    for (const file of files) {
        const stageKey = suggestStage(file.name);
        addItems.push({mode: 'copy', file, name: file.name, size: file.size, kind: kindOf(file.name), stage: stageKey,
            versionOf: kindOf(file.name) === 'audio' ? previousVersionFor(file.name, stageKey) : ''});
    }
    renderAddList();
}
function renderAddList() {
    const list = $('addList');
    list.innerHTML = addItems.map((item, index) => {
        const versions = workflow.archivos.filter(file => file.etapa === item.stage && isAudio(file));
        const warn = item.kind === 'sesion' && item.mode === 'copy';
        return `<div class="add-item">
          <span class="kind kind-${item.kind}">${item.kind === 'sesion' ? 'SESIÓN' : item.kind === 'audio' ? 'AUDIO' : 'ARCHIVO'}</span>
          <span class="add-name"><strong>${esc(item.name)}</strong><small class="mono">${item.mode === 'link' ? esc(item.path) : formatBytes(item.size) + ' · se copia'}</small>
            ${warn ? '<small class="add-warn">Una sesión copiada sola pierde la referencia a sus audios. Usá «Vincular desde su ubicación» para registrarla.</small>' : ''}</span>
          <label class="add-field">Etapa<select data-add-stage="${index}">${STAGE_ORDER.map(key => `<option value="${key}" ${key === item.stage ? 'selected' : ''}>${esc(STAGE_INFO[key].short)}</option>`).join('')}</select></label>
          ${item.kind === 'audio' && item.mode === 'copy' ? `<label class="add-field">Versión de<select data-add-version="${index}"><option value="">Audio nuevo</option>
            ${versions.map(file => `<option value="${file.id}" ${file.id === item.versionOf ? 'selected' : ''}>${esc(fileLabel(file))}</option>`).join('')}</select></label>` : ''}
          <button type="button" class="btn-ghost" data-add-remove="${index}" aria-label="Quitar ${esc(item.name)}">✕</button>
        </div>`;
    }).join('');
    list.querySelectorAll('[data-add-stage]').forEach(select => select.onchange = () => {
        const item = addItems[Number(select.dataset.addStage)];
        item.stage = select.value;
        item.versionOf = item.kind === 'audio' ? previousVersionFor(item.name, item.stage) : '';
        renderAddList();
    });
    list.querySelectorAll('[data-add-version]').forEach(select => select.onchange = () => { addItems[Number(select.dataset.addVersion)].versionOf = select.value; });
    list.querySelectorAll('[data-add-remove]').forEach(button => button.onclick = () => { addItems.splice(Number(button.dataset.addRemove), 1); renderAddList(); });
    const valid = addItems.filter(item => !(item.kind === 'sesion' && item.mode === 'copy'));
    const bytes = addItems.reduce((sum, item) => sum + (item.size || 0), 0);
    $('addSummary').textContent = addItems.length ? countLabel(addItems.length, 'elemento', 'elementos') + (bytes ? ' · ' + formatBytes(bytes) : '') : 'Sin archivos todavía';
    $('addSubmit').disabled = !valid.length;
    $('addSubmit').textContent = valid.length ? 'Agregar ' + countLabel(valid.length, 'elemento', 'elementos') : 'Agregar';
}
async function submitAdd() {
    const button = $('addSubmit');
    button.disabled = true;
    const songId = currentSong.id;
    const failed = [];
    let last = null;
    for (const item of addItems) {
        if (item.kind === 'sesion' && item.mode === 'copy') continue;
        button.textContent = 'Agregando ' + item.name + '…';
        try {
            if (item.mode === 'copy') {
                const data = new FormData();
                data.append('file', item.file);
                data.append('sesion_id', '');
                if (item.versionOf) data.append('version_de', item.versionOf);
                const response = await fetch('/api/produccion/' + songId + '/archivos/' + item.stage, {method: 'POST', body: data});
                const result = await response.json();
                if (!response.ok) throw Error(result.error || 'No se pudo importar.');
                last = {kind: 'file', id: result.id};
            } else if (item.kind === 'sesion') {
                const ext = item.name.split('.').pop().toLowerCase();
                const result = await api('/api/produccion/' + songId + '/sesiones', body({nombre: item.name.replace(/\.[^.]+$/, ''),
                    etapa: item.stage, daw: DAW_BY_EXT[ext] || '', ruta: item.path, notas: ''}));
                last = {kind: 'session', id: result.id};
            } else {
                const result = await api('/api/produccion/' + songId + '/vinculos', body({etapa: item.stage, ruta: item.path, sesion_id: ''}));
                last = {kind: 'file', id: result.id};
            }
        } catch (error) { failed.push(item.name + ': ' + error.message); }
    }
    if (failed.length) { $('addError').textContent = failed.join(' · '); button.disabled = false; button.textContent = 'Reintentar'; }
    else $('addDialog').close();
    if (last) studioSel = last;
    if (currentSong?.id === songId) await openSong(songId);
}
