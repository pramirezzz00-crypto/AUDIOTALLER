// Disco como lanzamiento: portada grande, título y lista de canciones al estilo de
// las plataformas, con el avance de producción de cada canción.
let albumSummary = [];
let albumSummarySeq = 0;
let albumMeasures = {};
let albumShowVideo = false;
let albumProd = null;
let albumMeasureTimer = 0;

async function renderAlbumPage() {
    const album = projects.discos.find(row => row.id === currentAlbum.id);
    if (!album) return;
    currentAlbum = album;
    $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> ›
        <button onclick="openArtistManager(true)">Producciones</button> › ${esc(album.nombre)}`;
    const sequence = ++albumSummarySeq;
    try {
        [albumSummary, albumProd] = await Promise.all([api('/api/discos/' + album.id + '/resumen'),
            api('/api/producciones').then(items => items.find(item => item.id === album.id)).catch(() => null)]);
    } catch (error) { albumSummary = []; report(error); }
    loadAlbumMeasures(album.id);
    if (sequence !== albumSummarySeq || trail.at(-1) !== 'albumPane') return;
    const counts = STAGE_ORDER.map(key => ({key, total: albumSummary.filter(song => song.etapa === key).length})).filter(item => item.total);
    const pending = albumSummary.reduce((sum, song) => sum + song.pendientes, 0);
    const seconds = albumSummary.reduce((sum, song) => {
        const [m, s] = (song.duracion || '').split(':').map(Number);
        return sum + (Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : 0);
    }, 0);
    const playable = albumSummary.filter(song => song.referencia_id);
    $('albumPane').innerHTML = `
      <section class="release-hero">
        ${artBox(album.portada, album.id, '', 'release-cover')}
        <div class="release-copy">
          <span class="eyebrow">${esc(projectType(album))}${album.lanzamiento ? ' · lanzamiento ' + esc(album.lanzamiento) : ''}</span>
          <h1 id="albumTitle">${esc(album.nombre)}</h1>
          <div class="release-meta"><button class="link strong" onclick="openArtist('${album.artista_id}')">${esc(albumOwner.nombre)}</button>
            <span>·</span><span>${countLabel(albumSummary.length, 'canción', 'canciones')}</span>${seconds ? `<span>·</span><span class="mono">${clockText(seconds)}</span>` : ''}</div>
          ${counts.length ? `<div class="release-progress" aria-label="Avance de producción">
            <div class="progress-bar">${counts.map(item => `<i class="st-${item.key}" style="flex:${item.total}"></i>`).join('')}</div>
            <div class="progress-legend">${counts.map(item => `<span><i class="dot st-${item.key}"></i>${item.total} en ${esc(stageName(item.key).toLowerCase())}</span>`).join('')}</div>
          </div>` : ''}
        </div>
      </section>
      ${albumStepper(albumProd?.estado || 'En producción', album.id)}
      <div class="release-actions">
        <button class="release-play" ${playable.length ? '' : 'disabled'} aria-label="Escuchar el disco de corrido" onclick="albumPlayer.start(0)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
        <span class="muted release-play-label">${playable.length ? 'Escuchar de corrido' : 'Sin audios todavía'}</span>
        <button class="pill pill-cal" onclick="typeof openCampaignFor==='function'?openCampaignFor('${album.id}'):report(Error('Las campañas llegan con Lanzamientos.'))" title="Campaña de lanzamiento">📅 ${albumProd?.campana ? esc(albumProd.campana.nombre) + (albumProd.fecha ? ' · ' + esc(fmtDay(albumProd.fecha)) : '') : 'Crear campaña'}</button>
        <button class="pill" onclick="openCredits('${album.id}').catch(report)">Créditos</button>
        <button class="pill" onclick="openExport('disco','${album.id}').catch(report)">Exportar metadata</button>
        <button class="pill" onclick="projectForm('album','${album.id}')">Editar disco</button>
        <button class="pill" onclick="publicationDialog('lanzamiento','${album.id}').catch(report)">Ficha de lanzamiento</button>
        <button class="pill" onclick="productionCreditsDialog('disco','${album.id}').catch(report)">Artistas y músicos</button>
        <button class="pill" onclick="associateLooseSongs('${album.id}').catch(report)">Incorporar canciones sueltas</button>
        <button class="pill pill-accent" onclick="projectForm('song','${album.id}')">+ Agregar canción</button>
      </div>
      ${album.notas ? `<p class="muted release-notes">${esc(album.notas)}</p>` : ''}
      <div class="tracklist-tools"><label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="albumSearch" type="search" placeholder="Buscar en este disco…" aria-label="Buscar canciones del disco"></label>
        ${pending ? `<span class="badge">${countLabel(pending, 'devolución pendiente', 'devoluciones pendientes')}</span>` : ''}
        <label class="switch"><input type="checkbox" ${albumShowVideo ? 'checked' : ''} onchange="albumShowVideo=this.checked;renderAlbumPage()"> Ver audiovisuales</label></div>
      <div class="tracklist-scroll"><div class="tracklist" role="table" aria-label="Canciones">
        <div class="track track-head" role="row"><span role="columnheader">#</span><span role="columnheader">Título</span><span role="columnheader">Producción</span>
          <span role="columnheader">Referencia</span><span role="columnheader" class="right">LUFS</span><span role="columnheader" class="right">dBTP</span><span role="columnheader">Formato</span><span role="columnheader">Devoluciones</span><span role="columnheader" class="right">Dur.</span>${albumShowVideo ? '<span role="columnheader">Audiovisual</span>' : ''}</div>
        <div id="albumSongs"></div>
      </div></div>
      <p id="albumEmpty" class="muted" hidden></p>
      <div id="albumPlayerBar" class="album-player" hidden></div>`;
    document.querySelector('.tracklist')?.classList.toggle('with-video', albumShowVideo);
    $('albumSearch').oninput = renderAlbumSongs;
    renderAlbumSongs();
}

function renderAlbumSongs() {
    if (!$('albumSongs')) return;
    const query = projectText($('albumSearch').value.trim());
    const meta = Object.fromEntries(albumTracks(currentAlbum.id).map(song => [song.id, song]));
    const visible = albumSummary.filter(song => projectText(song.titulo + ' ' + (meta[song.id]?.busqueda_metadata || '')).includes(query));
    $('albumSongs').innerHTML = visible.map((song, index) => `
      <div class="track ${albumPlayer.current === song.id ? 'is-playing' : ''}" role="row" data-song="${song.id}">
        <span class="mono muted" role="cell">${song.pista || index + 1}</span>
        <span role="cell" class="track-title"><button class="link strong" onclick="openSong('${song.id}')">${esc(song.titulo)}</button>
          <small>${esc(song.artista)}${song.bpm ? ' · ' + esc(song.bpm) + ' BPM' : ''}${song.tonalidad ? ' · ' + esc(song.tonalidad) : ''}</small></span>
        <span role="cell" class="track-stage"><span class="segments">${STAGE_ORDER.map((key, i) => `<i class="${i <= song.etapa_indice ? 'st-' + key + ' on' : ''}"></i>`).join('')}</span>
          <small>${song.etapa ? 'En ' + esc(stageName(song.etapa).toLowerCase()) : 'Sin material'}</small></span>
        <span role="cell" class="mono">${song.referencia ? esc(song.referencia) + (song.referencia_favorita ? ' <span class="star">★</span>' : '') : '<span class="muted">—</span>'}</span>
        ${measureCells(albumMeasures[song.id])}
        <span role="cell">${song.pendientes ? `<span class="badge">${countLabel(song.pendientes, 'pendiente', 'pendientes')}</span>` : '<span class="muted">Sin pendientes</span>'}</span>
        <span role="cell" class="mono muted right">${esc(song.duracion || '—')}</span>
        ${albumShowVideo ? `<span role="cell">${typeof avLinkFor === 'function' ? avLinkFor(song.id) : '<span class="muted">—</span>'}</span>` : ''}
      </div>`).join('');
    $('albumEmpty').hidden = visible.length > 0;
    $('albumEmpty').textContent = albumSummary.length ? 'No hay canciones que coincidan con la búsqueda.' :
        'Este disco todavía no tiene canciones. Podés agregarlas o incorporar canciones sueltas.';
}

// Medidas técnicas: se piden al servidor y se actualizan mientras se miden en segundo plano.
async function loadAlbumMeasures(id) {
    clearTimeout(albumMeasureTimer);
    try { albumMeasures = await api('/api/discos/' + id + '/medidas'); } catch { return; }
    if (trail.at(-1) !== 'albumPane' || currentAlbum?.id !== id) return;
    renderAlbumSongs();
    if (Object.values(albumMeasures).some(m => m.estado === 'midiendo')) albumMeasureTimer = setTimeout(() => loadAlbumMeasures(id), 4000);
}
function measureCells(m) {
    if (!m) return '<span role="cell" class="muted right">—</span><span role="cell" class="muted right">—</span><span role="cell" class="muted">—</span>';
    if (m.estado === 'midiendo') return '<span role="cell" class="muted right mono" title="Midiendo en segundo plano">…</span><span role="cell" class="muted right mono">…</span><span role="cell" class="muted">midiendo</span>';
    if (m.estado !== 'ok') return `<span role="cell" class="muted right">—</span><span role="cell" class="muted right">—</span><span role="cell" class="muted">${esc(m.formato || (m.estado === 'error' ? 'no se pudo medir' : '—'))}</span>`;
    const hot = m.dbtp !== null && m.dbtp > -1;
    const fmt = [formatRate(m.frecuencia), m.bits ? m.bits + ' bit' : ''].filter(Boolean).join(' · ');
    return `<span role="cell" class="mono right" title="Sonoridad integrada · ${esc(m.medidor || '')}">${m.lufs === null ? '—' : formatDecimal(m.lufs)}</span>
      <span role="cell" class="mono right ${hot ? 'warn-amber' : ''}" title="${hot ? 'Pico verdadero por encima de −1 dBTP: puede distorsionar al codificar' : 'Pico verdadero'}">${m.dbtp === null ? '—' : formatDecimal(m.dbtp)}</span>
      <span role="cell" class="mono muted">${esc(fmt)}</span>`;
}

// Estado del disco: Borrador → En producción → Finalizado → Lanzado (más En pausa).
function albumStepper(state, id) {
    const steps = ['Borrador', 'En producción', 'Finalizado', 'Lanzado'];
    const index = steps.indexOf(state);
    return `<div class="stepper" role="group" aria-label="Estado del disco">${steps.map((step, i) =>
        `<button class="${i < index ? 'done' : i === index ? 'now' : ''}" aria-pressed="${i === index}" onclick="setAlbumState('${id}','${step}')">
          <i>${i < index ? '✓' : i + 1}</i>${step}</button>`).join('<span class="step-line"></span>')}
      <button class="pause ${state === 'En pausa' ? 'now' : ''}" aria-pressed="${state === 'En pausa'}" onclick="setAlbumState('${id}','${state === 'En pausa' ? '' : 'En pausa'}')">${state === 'En pausa' ? '❚❚ En pausa · reanudar' : '❚❚ Pausar'}</button></div>`;
}
async function setAlbumState(id, state) {
    await api('/api/discos/' + id + '/estado', body({estado: state})).catch(report);
    renderAlbumPage();
}

// Escuchar de corrido: dos reproductores alternados (sin hueco) y ganancia por canción
// para igualar la sonoridad del disco (≈ −14 LUFS, sin subir más de 6 dB).
const albumPlayer = {
    players: [new Audio(), new Audio()], active: 0, queue: [], index: -1, current: '', ctx: null, gains: [], normalize: true,
    ensureGraph() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.gains = this.players.map(player => { const node = this.ctx.createGain(); this.ctx.createMediaElementSource(player).connect(node).connect(this.ctx.destination); return node; });
        } catch { this.ctx = null; }
    },
    gainFor(songId) {
        const m = albumMeasures[songId];
        if (!this.normalize || !m || m.estado !== 'ok' || m.lufs === null) return 1;
        return Math.pow(10, Math.min(6, -14 - m.lufs) / 20);
    },
    load(slot, entry) {
        const player = this.players[slot];
        player.src = '/api/produccion/archivo/' + entry.referencia_id;
        player.preload = 'auto';
        if (this.gains[slot]) this.gains[slot].gain.value = this.gainFor(entry.id);
    },
    start(index) {
        this.queue = albumSummary.filter(song => song.referencia_id);
        if (!this.queue.length) return;
        transport.audio.pause();
        this.ensureGraph(); this.ctx?.resume();
        this.players.forEach(p => { p.pause(); p.onended = null; p.ontimeupdate = null; });
        this.index = Math.max(0, Math.min(index, this.queue.length - 1));
        this.active = 0;
        this.load(0, this.queue[this.index]);
        this.players[0].play().catch(report);
        this.prepareNext();
        this.wire();
        this.render();
    },
    prepareNext() {
        const next = this.queue[this.index + 1];
        if (next) this.load(1 - this.active, next);
    },
    wire() {
        this.players.forEach((player, slot) => {
            player.ontimeupdate = () => {
                if (slot !== this.active) return;
                const left = (player.duration || 0) - player.currentTime;
                // timeupdate llega cada ~250 ms: se agenda la siguiente pista justo al final para no dejar silencio.
                if (left > 0 && left < 0.4 && this.queue[this.index + 1] && !this.scheduled) {
                    this.scheduled = setTimeout(() => { this.scheduled = 0; if (slot === this.active) this.advance(); }, Math.max(0, left * 1000 - 15));
                }
                this.paintProgress();
            };
            player.onended = () => { if (slot === this.active && !this.scheduled) this.advance(); };
        });
    },
    advance() {
        if (!this.queue[this.index + 1]) { this.stop(); return; }
        this.index += 1;
        this.active = 1 - this.active;
        this.players[this.active].play().catch(() => {});
        this.prepareNext();
        this.render();
    },
    toggle() { const p = this.players[this.active]; p.paused ? p.play().catch(() => {}) : p.pause(); this.render(); },
    step(delta) { this.start(this.index + delta); },
    stop() { this.players.forEach(p => p.pause()); this.current = ''; this.index = -1; this.render(); },
    paintProgress() {
        const p = this.players[this.active], bar = $('albumPlayerProgress');
        if (bar && p.duration) bar.style.width = (p.currentTime / p.duration * 100) + '%';
        if ($('albumPlayerTime')) $('albumPlayerTime').textContent = clockText(p.currentTime) + ' / ' + clockText(p.duration || 0);
    },
    render() {
        const entry = this.queue[this.index];
        this.current = entry ? entry.id : '';
        document.querySelectorAll('#albumSongs .track').forEach(row => row.classList.toggle('is-playing', row.dataset.song === this.current));
        const bar = $('albumPlayerBar');
        if (!bar) return;
        bar.hidden = !entry;
        if (!entry) return;
        const paused = this.players[this.active].paused;
        bar.innerHTML = `<button onclick="albumPlayer.step(-1)" aria-label="Anterior">⏮</button>
          <button class="t-play" onclick="albumPlayer.toggle()" aria-label="${paused ? 'Reproducir' : 'Pausar'}">${paused ? '▶' : '❚❚'}</button>
          <button onclick="albumPlayer.step(1)" aria-label="Siguiente">⏭</button>
          <span class="ap-title"><strong>${esc(entry.pista || this.index + 1)}. ${esc(entry.titulo)}</strong><small>${esc(entry.referencia || '')}</small></span>
          <span class="ap-track"><span id="albumPlayerProgress"></span></span><span id="albumPlayerTime" class="mono muted"></span>
          <label class="switch"><input type="checkbox" ${this.normalize ? 'checked' : ''} onchange="albumPlayer.normalize=this.checked;albumPlayer.gains.forEach((g,i)=>g.gain.value=i===albumPlayer.active?albumPlayer.gainFor(albumPlayer.current):g.gain.value)"> Igualar volumen</label>
          <button onclick="albumPlayer.stop()" aria-label="Cerrar">✕</button>`;
        this.paintProgress();
    },
};
function playAlbumReferences() { albumPlayer.start(0); }
