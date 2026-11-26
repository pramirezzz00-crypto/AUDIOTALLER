// Devoluciones · pantalla de gestión (Playlist › Devoluciones).
// Playlists a la izquierda, audio con todas las marcas arriba, comentarios debajo y detalle a la derecha.
// Cada devolución guarda la versión que escuchó el artista y la versión con el cambio, para compararlas en bucle.
const FB_STATES = ['Pendiente', 'En revisión', 'Resuelta', 'Sin cambios'];
const FB_COLORS = {Pendiente: '#E5484D', 'En revisión': '#FFB547', Resuelta: '#5ED17E', 'Sin cambios': '#8E9BB0'};
const fbColor = state => FB_COLORS[state] || FB_COLORS.Pendiente;
const fbOpen = note => note.estado === 'Pendiente' || note.estado === 'En revisión';
const fb = {notes: [], playlist: '', state: 'abiertas', song: '', sel: null, works: new Map(), peaks: new Map(),
    side: 'oido', zoom: false, audio: new Audio(), raf: 0, loaded: ''};
fb.audio.preload = 'metadata';

async function openFeedbackPane(scope = {}) {
    if (scope.playlist_id) fb.playlist = scope.playlist_id;
    if (scope.cancion_id) fb.song = scope.cancion_id;
    go('feedbackPane');
    await loadFeedbackPane();
}
// Compatibilidad: los botones anteriores abrían un diálogo; ahora llevan a la pantalla.
async function feedbackDialog(scope = {}) { return openFeedbackPane(scope); }

async function loadFeedbackPane(selectId) {
    fb.notes = await api('/api/portal/devoluciones');
    if (selectId) fb.sel = selectId;
    if (!fb.notes.some(note => note.id === fb.sel)) fb.sel = visibleFeedback()[0]?.id || null;
    updateFeedbackBadge();
    renderFeedbackPane();
}
function updateFeedbackBadge(notes = fb.notes) {
    const open = notes.filter(fbOpen).length;
    const badge = $('sideFeedbackCount');
    if (badge) { badge.hidden = !open; badge.textContent = open; }
}
function visibleFeedback() {
    return fb.notes.filter(note => (!fb.playlist || note.playlist_id === fb.playlist) && (!fb.song || note.cancion_id === fb.song) &&
        (fb.state === 'todas' || (fb.state === 'abiertas' ? fbOpen(note) : note.estado === fb.state)))
        .sort((a, b) => (a.titulo || '').localeCompare(b.titulo || '') || a.archivo_id.localeCompare(b.archivo_id) || a.segundo - b.segundo);
}
const fbNote = () => fb.notes.find(note => note.id === fb.sel);
function fbPreviewLabel(note) {
    const stage = STAGE_INFO[note.archivo_etapa]?.name;
    return [note.disco, note.titulo].filter(Boolean).join(' · ') + (stage ? ` (${stage})` : '') + ' – ' + (note.archivo_nombre || note.etiqueta);
}
function fbLoop(note) {
    const start = note.bucle_inicio ?? Math.max(0, note.segundo - 15);
    return [start, note.bucle_fin ?? note.segundo + 15];
}

function renderFeedbackPane() {
    const root = $('feedbackPane');
    if (!root || root.hidden) return;
    const playlists = [...new Map(fb.notes.map(note => [note.playlist_id, note.playlist])).entries()];
    const songs = [...new Map(fb.notes.map(note => [note.cancion_id, note.titulo || 'Canción'])).entries()];
    const count = (list, filter) => list.filter(filter).length;
    const scoped = fb.notes.filter(note => (!fb.playlist || note.playlist_id === fb.playlist) && (!fb.song || note.cancion_id === fb.song));
    const list = visibleFeedback();
    const note = fbNote();
    root.innerHTML = `
      <header class="fb-head">
        <div><div class="eyebrow">Playlist › Devoluciones</div><h1>Devoluciones</h1>
          <p class="muted">Lo que marcó el artista en el portal, con el estado de cada cambio.</p></div>
        <div class="row"><span id="fbSyncStatus" class="muted" role="status"></span><button class="alt" onclick="syncFeedback().catch(report)">Buscar devoluciones nuevas</button><button onclick="sendFeedbackReplies().catch(report)" title="Envía tus respuestas, estados y versiones corregidas al portal del artista">Enviar respuestas al artista</button></div>
      </header>
      <div class="fb-layout">
        <aside class="fb-lists" aria-label="Playlists">
          <button class="fb-list ${fb.playlist ? '' : 'is-on'}" onclick="fb.playlist='';renderFeedbackPane()"><strong>Todas las playlists</strong>${fbDots(fb.notes)}</button>
          ${playlists.map(([id, name]) => `<button class="fb-list ${fb.playlist === id ? 'is-on' : ''}" onclick="fb.playlist='${id}';renderFeedbackPane()">
            <strong>${esc(name)}</strong>${fbDots(fb.notes.filter(n => n.playlist_id === id))}</button>`).join('')}
          ${playlists.length ? '' : '<p class="muted">Todavía no hay devoluciones. Publicá una playlist en el portal y el artista podrá marcar comentarios en cada audio.</p>'}
        </aside>
        <section class="fb-main">
          ${note ? fbPlayerMarkup(note) : ''}
          <div class="fb-filters">
            <div class="chips" role="radiogroup" aria-label="Estado">
              ${[['abiertas', 'Abiertas', count(scoped, fbOpen)], ['todas', 'Todas', scoped.length], ...FB_STATES.map(s => [s, s, count(scoped, n => n.estado === s)])].map(([id, label, n]) =>
                `<button role="radio" aria-checked="${fb.state === id}" class="chip-btn ${fb.state === id ? 'is-on' : ''}" onclick="fb.state='${id}';renderFeedbackPane()">
                  ${FB_COLORS[id] ? `<i class="fb-dot" style="background:${FB_COLORS[id]}"></i>` : ''}${esc(label)} <span class="mono">${n}</span></button>`).join('')}
            </div>
            <select aria-label="Canción" onchange="fb.song=this.value;renderFeedbackPane()"><option value="">Todas las canciones</option>
              ${songs.map(([id, title]) => `<option value="${id}" ${fb.song === id ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select>
          </div>
          <div class="fb-table" role="table" aria-label="Comentarios">
            <div class="fb-row fb-th" role="row"><span>Estado</span><span>Minuto</span><span>Comentario</span><span>Audio</span></div>
            ${list.map(n => `<button role="row" class="fb-row ${n.id === fb.sel ? 'is-selected' : ''}" onclick="selectFeedback('${esc(n.id)}',true)">
              <span><i class="fb-dot" style="background:${fbColor(n.estado)}"></i>${esc(n.estado === 'Resuelta' ? 'Resuelto' : n.estado)}</span>
              <span class="mono">${n.segundo > 0 ? clockText(n.segundo) : 'General'}</span>
              <span class="fb-text">${esc(n.texto)}${n.respuesta ? `<small>↳ ${esc(n.respuesta)}</small>` : ''}</span>
              <span class="fb-src"><span>${esc(n.titulo || '')}</span><small>${esc(n.archivo_nombre || n.etiqueta)}</small></span></button>`).join('')
              || '<p class="muted fb-empty">No hay devoluciones con este filtro.</p>'}
          </div>
        </section>
        <aside class="fb-detail card" aria-label="Detalle">${note ? fbDetailMarkup(note) : '<p class="muted">Elegí una devolución para ver el detalle.</p>'}</aside>
      </div>`;
    if (note) { bindFeedbackWave(note); ensureFeedbackWork(note); }
}
function fbDots(notes) {
    return `<span class="fb-dots">${FB_STATES.map(s => { const n = notes.filter(x => x.estado === s).length; return n ? `<span><i class="fb-dot" style="background:${FB_COLORS[s]}"></i>${n}</span>` : ''; }).join('')}</span>`;
}

// ── Audio con marcas, A/B y bucle ──
function fbSideFile(note) { return fb.side === 'cambio' && note.resuelve_archivo ? note.resuelve_archivo : note.archivo_id; }
function fbPlayerMarkup(note) {
    const [start, end] = fbLoop(note);
    const playing = !fb.audio.paused;
    return `<div class="fb-player card">
      <div class="fb-player-head"><div><strong>${esc(fbPreviewLabel(note))}</strong>
        <span class="tag">↗ ${esc(note.playlist)}</span></div>
        <div class="t-ab" role="group" aria-label="Comparar">
          <button aria-pressed="${fb.side === 'oido'}" onclick="fbSwitch('oido')"><b>A</b> Lo que escuchó</button>
          <button aria-pressed="${fb.side === 'cambio'}" ${note.resuelve_archivo ? '' : 'disabled title="Asociá una versión con el cambio"'} onclick="fbSwitch('cambio')"><b>B</b> ${esc(note.resuelve_nombre || 'Con el cambio')}</button>
        </div></div>
      <canvas id="fbWave" class="fb-wave" role="slider" tabindex="0" aria-label="Posición del audio"></canvas>
      <div class="fb-controls">
        <button class="t-play" onclick="fbToggle()" aria-label="${playing ? 'Pausar' : 'Reproducir el bucle'}">${playing ? '❚❚' : '▶'}</button>
        <span class="mono" id="fbClock">${clockText(fb.audio.currentTime)}</span>
        <span class="fb-loop mono">Bucle
          <button onclick="fbNudge('bucle_inicio',-1)" aria-label="Inicio un segundo antes">−</button>${clockText(start)}<button onclick="fbNudge('bucle_inicio',1)" aria-label="Inicio un segundo después">+</button>
          →
          <button onclick="fbNudge('bucle_fin',-1)" aria-label="Fin un segundo antes">−</button>${clockText(end)}<button onclick="fbNudge('bucle_fin',1)" aria-label="Fin un segundo después">+</button></span>
        <button class="btn-ghost" onclick="fb.zoom=!fb.zoom;renderFeedbackPane()">${fb.zoom ? 'Ver todo el audio' : 'Acercar al bucle'}</button>
      </div></div>`;
}
async function fbPeaks(id) {
    if (!fb.peaks.has(id)) fb.peaks.set(id, api('/api/produccion/archivo/' + id + '/onda').catch(() => null));
    return fb.peaks.get(id);
}
async function bindFeedbackWave(note) {
    const canvas = $('fbWave');
    const id = fbSideFile(note);
    if (fb.loaded !== id) { fb.loaded = id; fb.audio.src = '/api/produccion/archivo/' + id; }
    const data = await fbPeaks(note.archivo_id);
    if (!$('fbWave') || fbNote()?.id !== note.id) return;
    const duration = data?.duration || fb.audio.duration || Math.max(60, note.segundo + 30);
    const [start, end] = fbLoop(note);
    const view = fb.zoom ? [Math.max(0, start - 5), Math.min(duration, end + 5)] : [0, duration];
    const draw = () => {
        const box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
        if (!box.width) return;
        canvas.width = box.width * ratio; canvas.height = box.height * ratio;
        const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
        const x = t => (t - view[0]) / (view[1] - view[0]) * box.width;
        ctx.fillStyle = '#2FD8BF22'; ctx.fillRect(x(start), 0, x(end) - x(start), box.height);
        const peaks = data?.peaks || [], max = Math.max(...peaks, 0.01), bars = Math.floor(box.width / 3);
        for (let i = 0; i < bars; i++) {
            const t = view[0] + i / bars * (view[1] - view[0]);
            const v = peaks.length ? peaks[Math.min(peaks.length - 1, Math.floor(t / duration * peaks.length))] / max : 0.2;
            const h = Math.max(2, v * (box.height - 18));
            ctx.fillStyle = t >= start && t <= end ? '#5A9F96' : '#3A3A42';
            ctx.fillRect(i * 3, (box.height + 8) / 2 - h / 2, 2, h);
        }
        for (const other of fb.notes.filter(n => n.archivo_id === note.archivo_id && n.segundo > 0)) {
            ctx.fillStyle = fbColor(other.estado);
            ctx.beginPath(); ctx.arc(x(other.segundo), 6, other.id === note.id ? 6 : 4, 0, Math.PI * 2); ctx.fill();
        }
        if (fb.audio.duration || data) { ctx.fillStyle = '#EDEDF0'; ctx.fillRect(x(fb.audio.currentTime) - 1, 0, 2, box.height); }
    };
    fb.draw = draw;
    draw();
    canvas.onclick = event => {
        const box = canvas.getBoundingClientRect();
        const t = view[0] + (event.clientX - box.left) / box.width * (view[1] - view[0]);
        const hit = fb.notes.find(n => n.archivo_id === note.archivo_id && n.segundo > 0 && Math.abs(n.segundo - t) < (view[1] - view[0]) / 80 && event.clientY - box.top < 16);
        if (hit) return selectFeedback(hit.id, true);
        fb.audio.currentTime = Math.max(0, t); draw();
    };
}
function fbTick() {
    const note = fbNote();
    if (note && !fb.audio.paused) {
        const [start, end] = fbLoop(note);
        if (fb.audio.currentTime >= end) fb.audio.currentTime = start;
        if ($('fbClock')) $('fbClock').textContent = clockText(fb.audio.currentTime);
        fb.draw?.();
        fb.raf = requestAnimationFrame(fbTick);
    }
}
fb.audio.addEventListener('play', () => { cancelAnimationFrame(fb.raf); fbTick(); });
fb.audio.addEventListener('pause', () => cancelAnimationFrame(fb.raf));
function fbToggle() {
    const note = fbNote(); if (!note) return;
    if (fb.audio.paused) {
        const [start, end] = fbLoop(note);
        if (fb.audio.currentTime < start || fb.audio.currentTime > end) fb.audio.currentTime = Math.max(0, note.segundo - 5);
        fb.audio.play().catch(report);
    } else fb.audio.pause();
    renderFeedbackPane();
}
function fbSwitch(side) {
    const note = fbNote(); if (!note) return;
    const time = fb.audio.currentTime, playing = !fb.audio.paused;
    fb.side = side;
    const id = fbSideFile(note);
    fb.loaded = id; fb.audio.src = '/api/produccion/archivo/' + id;
    fb.audio.addEventListener('loadedmetadata', () => { fb.audio.currentTime = time; if (playing) fb.audio.play().catch(() => {}); }, {once: true});
    renderFeedbackPane();
}
async function fbNudge(field, delta) {
    const note = fbNote(); if (!note) return;
    const [start, end] = fbLoop(note);
    const value = Math.max(0, (field === 'bucle_inicio' ? start : end) + delta);
    if ((field === 'bucle_inicio' && value >= end - 1) || (field === 'bucle_fin' && value <= start + 1)) return;
    await saveFeedback(note, {bucle_inicio: start, bucle_fin: end, [field]: value}, false);
}
function selectFeedback(id, seek) {
    const note = fb.notes.find(n => n.id === id); if (!note) return;
    const changed = fb.sel !== id;
    fb.sel = id;
    if (changed) { fb.side = 'oido'; fb.audio.pause(); }
    renderFeedbackPane();
    if (seek) {
        const go = () => { fb.audio.currentTime = Math.max(0, note.segundo - 5); fb.audio.play().catch(() => {}); };
        if (fb.audio.readyState >= 1) go(); else fb.audio.addEventListener('loadedmetadata', go, {once: true});
    }
}

// ── Detalle: estado, respuesta, versión con el cambio y marcadores ──
async function ensureFeedbackWork(note) {
    if (fb.works.has(note.cancion_id)) return;
    fb.works.set(note.cancion_id, null);
    try { fb.works.set(note.cancion_id, await api('/api/produccion/' + note.cancion_id)); }
    catch { fb.works.delete(note.cancion_id); return; }
    if (fbNote()?.cancion_id === note.cancion_id) renderFeedbackPane();
}
function fbFamily(note) {
    const work = fb.works.get(note.cancion_id);
    if (!work) return [];
    return work.archivos.filter(f => AUDIO_EXT.test(f.nombre) && f.etapa === note.archivo_etapa).sort((a, b) => String(a.creado).localeCompare(String(b.creado)));
}
function nextVersionName(name) {
    const match = /^(.*?)([_ -]?)V(\d+)(\.[^.]+)$/i.exec(name || '');
    if (match) return `${match[1]}${match[2] || '_'}V${String(Number(match[3]) + 1).padStart(match[3].length, '0')}${match[4]}`;
    const dot = (name || 'audio.wav').lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) + '_V2' + name.slice(dot) : (name || 'audio') + '_V2.wav';
}
function fbDetailMarkup(note) {
    const family = fbFamily(note);
    const others = fb.notes.filter(n => n.archivo_id === note.archivo_id && n.id !== note.id && fbOpen(n));
    const resolvedBy = id => fb.notes.filter(n => n.resuelve_archivo === id).length;
    const work = fb.works.get(note.cancion_id);
    const sessions = work ? work.sesiones.filter(s => s.etapa === note.archivo_etapa) : [];
    return `<span class="insp-kicker">${note.segundo > 0 ? 'Minuto ' + clockText(note.segundo) : 'Comentario general'} · ${esc(note.email || '')}</span>
      <p class="fb-quote">${esc(note.texto)}</p>
      <div class="fb-states" role="radiogroup" aria-label="Estado">${FB_STATES.map(s => `<button role="radio" aria-checked="${note.estado === s}"
        style="--c:${FB_COLORS[s]}" class="${note.estado === s ? 'is-on' : ''}" onclick="fbSetState('${s}')">${s === 'Resuelta' ? 'Resuelto' : s}</button>`).join('')}</div>
      <label class="insp-label" for="fbReply">Respuesta al artista${note.estado === 'Sin cambios' ? ' · contá por qué no se cambia' : ''}</label>
      <textarea id="fbReply" rows="3" placeholder="Ej.: Subí la voz 1 dB en el estribillo.">${esc(note.respuesta || '')}</textarea>
      <label class="insp-label" for="fbInternal">Nota interna (solo vos)</label>
      <textarea id="fbInternal" rows="2">${esc(note.nota_interna || '')}</textarea>
      <button onclick="fbSaveText()">Guardar respuesta</button>
      <div class="insp-block"><span class="insp-label">Versiones</span>
        <dl class="facts mono"><dt>Escuchó</dt><dd>${esc(note.archivo_nombre || note.etiqueta)}</dd>
          <dt>Con el cambio</dt><dd>${note.resuelve_archivo ? esc(note.resuelve_nombre || '') : '<span class="muted">sin asociar</span>'}</dd></dl>
        ${family.length ? `<select aria-label="Versión con el cambio" onchange="saveFeedback(fbNote(),{resuelve_archivo:this.value})"><option value="">Elegir la versión con el cambio…</option>
          ${family.filter(f => f.id !== note.archivo_id).map(f => `<option value="${f.id}" ${f.id === note.resuelve_archivo ? 'selected' : ''}>${esc(f.nombre)}</option>`).join('')}</select>` : ''}
        <div class="fb-upload">
          <strong>Cargar la versión con el cambio</strong>
          <span class="muted">Se guarda como <span class="mono">${esc(nextVersionName(note.archivo_nombre))}</span> en la etapa y queda asociada.</span>
          ${others.length ? `<span class="insp-label">Resolver también con esta versión</span>${others.map(o => `<label class="check"><input type="checkbox" data-fb-also="${esc(o.id)}">
            <span class="mono">${o.segundo > 0 ? clockText(o.segundo) : 'Gral.'}</span> ${esc(o.texto.slice(0, 60))}</label>`).join('')}` : ''}
          <input id="fbVersionFile" type="file" accept="audio/*" hidden onchange="fbUploadVersion(this.files[0]).catch(report)">
          <button class="btn-primary" onclick="$('fbVersionFile').click()">Elegir audio…</button>
        </div>
        ${family.length ? `<details><summary>Historial de la familia · ${family.length}</summary>${family.map(f => `<div class="fb-hist"><span class="mono">${esc(f.nombre)}</span><small>${f.id === note.archivo_id ? 'la escuchó el artista' : resolvedBy(f.id) ? 'resuelve ' + countLabel(resolvedBy(f.id), 'comentario', 'comentarios') : ''}</small></div>`).join('')}</details>` : ''}
      </div>
      <div class="insp-block"><span class="insp-label">Marcadores al DAW</span>
        <span class="muted">Un marcador por comentario de este audio (minuto · estado · texto).</span>
        <label class="row-tight">Desfase (s)<input id="fbOffset" type="number" step="0.1" value="0" style="width:90px" title="Si el bounce no arranca en 0:00 de la sesión"></label>
        ${sessions.length ? `<select id="fbSession" aria-label="Sesión">${sessions.map(s => `<option value="${s.id}" ${s.vigente ? 'selected' : ''}>${esc(s.nombre)}${s.vigente ? ' · vigente' : ''}</option>`).join('')}</select>` : ''}
        ${sessions.some(s => /\.rpp$/i.test(s.ruta || '')) ? '<label class="check"><input type="checkbox" id="fbReaper" checked> En REAPER, crear la siguiente versión .rpp con los marcadores (la original no se toca)</label>' : ''}
        <button onclick="fbSaveMarkers().catch(report)">Guardar .mid y .csv en la carpeta de la sesión</button>
        <div class="row-tight"><a class="btn-link" href="/api/portal/devoluciones/marcadores.mid?archivo_id=${encodeURIComponent(note.archivo_id)}" download>Descargar .mid</a>
          <a class="btn-link" href="/api/portal/devoluciones/marcadores.csv?archivo_id=${encodeURIComponent(note.archivo_id)}" download>Descargar .csv</a></div>
        <span class="insp-help">El .mid se importa en Cubase, Pro Tools, Logic, Studio One y REAPER; el .csv es la lista de marcadores de REAPER.</span>
        <span id="fbStatus" class="insp-help" role="status"></span>
      </div>
      <button class="btn-ghost" onclick="openSong('${note.cancion_id}','${note.archivo_id}').catch(report)">Abrir la canción en este audio</button>`;
}
async function saveFeedback(note, changes, rerender = true) {
    const payload = {estado: note.estado, nota_interna: note.nota_interna || '', respuesta: note.respuesta || '',
        resuelve_archivo: note.resuelve_archivo || '', bucle_inicio: note.bucle_inicio, bucle_fin: note.bucle_fin, ...changes};
    await api('/api/portal/devoluciones/' + encodeURIComponent(note.id), body(payload));
    await loadFeedbackPane(note.id);
}
async function fbSetState(state) {
    const note = fbNote(); if (!note) return;
    const respuesta = $('fbReply')?.value ?? note.respuesta;
    if (state === 'Resuelta' && !note.resuelve_archivo && !confirm('Esta devolución no tiene una versión con el cambio. Podés cargarla abajo. ¿Marcarla como resuelta igual?')) return;
    if (state === 'Sin cambios' && !respuesta.trim()) { $('fbReply').focus(); return report(Error('Para «Sin cambios», contá en la respuesta por qué no se cambia.')); }
    await saveFeedback(note, {estado: state, respuesta, nota_interna: $('fbInternal')?.value ?? note.nota_interna}).catch(report);
}
async function fbSaveText() {
    const note = fbNote(); if (!note) return;
    await saveFeedback(note, {respuesta: $('fbReply').value, nota_interna: $('fbInternal').value}).catch(report);
}
async function fbUploadVersion(file) {
    const note = fbNote(); if (!note || !file) return;
    const name = nextVersionName(note.archivo_nombre);
    const form = new FormData();
    form.append('file', new File([file], name, {type: file.type}));
    form.append('version_de', note.archivo_id);
    form.append('comentario', 'Cambio pedido en la devolución: ' + note.texto.slice(0, 300));
    const response = await fetch(`/api/produccion/${note.cancion_id}/archivos/${note.archivo_etapa}`, {method: 'POST', body: form});
    if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || 'No se pudo guardar la versión.');
    const {id} = await response.json();
    const also = [...document.querySelectorAll('[data-fb-also]:checked')].map(box => box.dataset.fbAlso);
    for (const target of [note, ...fb.notes.filter(n => also.includes(n.id))])
        await api('/api/portal/devoluciones/' + encodeURIComponent(target.id), body({estado: 'Resuelta', nota_interna: target.nota_interna || '',
            respuesta: target.id === note.id ? ($('fbReply')?.value ?? target.respuesta ?? '') : (target.respuesta || ''),
            resuelve_archivo: id, bucle_inicio: target.bucle_inicio, bucle_fin: target.bucle_fin}));
    fb.works.delete(note.cancion_id);
    await loadFeedbackPane(note.id);
    fbSwitch('cambio');
}
async function fbSaveMarkers() {
    const note = fbNote(); if (!note) return;
    const result = await api('/api/portal/devoluciones/marcadores', body({archivo_id: note.archivo_id, desfase: Number($('fbOffset').value) || 0,
        sesion_id: $('fbSession')?.value || '', reaper: !!$('fbReaper')?.checked}));
    $('fbStatus').textContent = '✓ ' + result.mensaje + ' ' + result.archivos.map(path => path.split(/[\\/]/).pop()).join(', ');
}
// Manda respuestas, estados y la versión que resuelve cada pedido al portal (sin volver a publicar la playlist).
async function sendFeedbackReplies() {
    const notes = fb.notes.filter(n => (!fb.playlist || n.playlist_id === fb.playlist) && (n.respuesta || n.estado !== 'Pendiente' || n.resuelve_archivo));
    const pubs = [...new Set(notes.map(n => n.publicacion_id).filter(Boolean))];
    if (!pubs.length) throw Error('Todavía no hay respuestas para enviar: respondé o cambiá el estado de alguna devolución.');
    const status = $('fbSyncStatus');
    let total = 0;
    for (const id of pubs) total += (await cloudOperation('/api/portal/publicaciones/' + encodeURIComponent(id) + '/respuestas', {}, status)).respuestas;
    if (status) status.textContent = `✓ ${countLabel(total, 'respuesta enviada', 'respuestas enviadas')} al portal. El artista verá el aviso al entrar.`;
}
async function syncFeedback() {
    const result = await api('/api/portal/devoluciones/sincronizar', body(fb.playlist ? {playlist_id: fb.playlist} : {}));
    await loadFeedbackPane();
    if ($('fbSyncStatus')) $('fbSyncStatus').textContent = result.mensaje;
}
window.addEventListener('resize', () => { if (trail.at(-1) === 'feedbackPane') fb.draw?.(); });
// El contador de la barra lateral se actualiza al abrir la app.
api('/api/portal/devoluciones').then(updateFeedbackBadge).catch(() => {});
