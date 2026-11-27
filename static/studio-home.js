// Inicio · Sala de control. Resume en qué se está trabajando, qué etapa ocupa cada
// canción y qué devoluciones esperan respuesta. Solo lee datos: no modifica nada.
const STAGE_INFO = {
    demo: {name: 'Demo', short: '01 Demo', macro: 'Preproducción'},
    maqueta: {name: 'Maquetado', short: '02 Maquetado', macro: 'Preproducción'},
    grabacion: {name: 'Grabación', short: '03 Grabación', macro: 'Producción'},
    mezcla: {name: 'Mezcla', short: '04 Mezcla', macro: 'Producción'},
    mastering: {name: 'Mastering', short: '05 Mastering', macro: 'Producción'},
    historico: {name: 'Históricos', short: 'Históricos', macro: 'Sin etapa'},
};
const STAGE_ORDER = ['demo', 'maqueta', 'grabacion', 'mezcla', 'mastering'];
let homeSequence = 0;
let homeData;

// Portada generada cuando el disco no tiene imagen: una composición abstracta y estable.
function placeholderArt(seed, stage) {
    const colors = ['#2FD8BF', '#5AA7FF', '#9B8CFF', '#FFB547', '#5ED17E', '#FF6B8B'];
    let hash = 0;
    for (const char of String(seed || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const a = colors[hash % colors.length], b = `var(--st-${stage || 'historico'})`;
    return `background:radial-gradient(circle at 30% 35%,${a} 0 18%,transparent 19%),radial-gradient(circle at 70% 70%,${b} 0 30%,transparent 31%),linear-gradient(160deg,#1E1E23,#0B0B0D)`;
}
function artBox(url, seed, stage, cls = 'art') {
    if (/^data:image\/(png|jpeg);base64,/.test(url || '')) return `<span class="${cls}"><img src="${url}" alt=""></span>`;
    return `<span class="${cls}" style="${placeholderArt(seed, stage)}"></span>`;
}
const stageName = key => STAGE_INFO[key]?.name || 'Sin material';
function relativeTime(text) {
    if (!text) return '';
    const date = new Date(text.replace(' ', 'T') + 'Z');
    if (Number.isNaN(date.getTime())) return text;
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'recién';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'ayer';
    if (days < 30) return `hace ${days} días`;
    return date.toLocaleDateString('es-AR', {day: 'numeric', month: 'short', year: 'numeric'});
}
function clockText(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}

async function renderHome() {
    const sequence = ++homeSequence;
    const root = $('homeDash');
    try {
        const data = await api('/api/inicio');
        if (sequence !== homeSequence) return;
        homeData = data;
        renderSideRecents(data.recientes);
        const today = new Date().toLocaleDateString('es-AR', {weekday: 'long', day: 'numeric', month: 'long'});
        const empty = !data.recientes.length && !data.discos.length;
        root.innerHTML = `
          <header class="home-head">
            <div class="home-greet"><div class="date">${esc(today.charAt(0).toUpperCase() + today.slice(1))}</div><h1>Hola${data.usuario ? ', ' + esc(data.usuario) : ''}</h1></div>
            <div class="row home-actions">
              <label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
                <input id="homeSearch" type="search" placeholder="Buscar canción, artista, archivo…" aria-label="Buscar en producciones"><kbd class="kbd">Ctrl K</kbd></label>
              <button class="alt" onclick="editArtist()">Nuevo Artista</button>
              <details class="home-create-menu"><summary class="btn-primary">Crear Proyecto <span aria-hidden="true">▾</span></summary>
                <div class="home-project-options" role="menu">
                  <button role="menuitem" onclick="newGlobalProject('song').catch(report)">Nueva Canción</button>
                  <button role="menuitem" onclick="newGlobalProject('album').catch(report)">Nuevo Disco</button>
                  <button role="menuitem" onclick="newAvProject().catch(report)">Producción Audiovisual</button>
                </div>
              </details>
            </div>
          </header>
          ${empty ? `<section class="home-empty card"><h2>Empezá tu biblioteca</h2>
              <p class="muted">Creá un artista y organizá sus canciones, discos y producciones audiovisuales desde “Crear Proyecto”. Después vas a poder cargar demos, sesiones de DAW y mezclas en cada etapa.</p>
              </section>` : ''}
          ${empty ? '' : `<div class="home-split">
            <section class="card pipeline" aria-labelledby="homePipeline">
              <div class="section-head"><h2 id="homePipeline">Producción en curso</h2><span class="mono muted">${countLabel(data.canciones_activas, 'canción activa', 'canciones activas')}</span></div>
              <div class="pipeline-grid">${data.etapas.map(stage => `<div class="pipeline-col">
                  <i class="bar st-${stage.etapa}"></i><span class="pipeline-name">${esc(stageName(stage.etapa))}</span>
                  <span class="pipeline-count mono">${stage.total}</span>
                  ${stage.canciones.map(song => `<button class="pipeline-song" onclick="openSong('${song.id}')">${esc(song.titulo)}</button>`).join('')}
                </div>`).join('')}</div>
            </section>
            <section class="card feedback-box" aria-labelledby="homeFeedback">
              <div class="section-head"><h2 id="homeFeedback">Devoluciones</h2></div>
              <div class="fb-counts">${[['Pendiente', 'pendientes'], ['En revisión', 'en revisión'], ['Resuelta', 'resueltas']].map(([k, l]) => `<span><i class="fb-dot" style="background:${FB_COLORS[k]}"></i>${(data.estados || {})[k] || 0} ${l}</span>`).join('')}</div>
              <button class="mk-btn fb-go" onclick="openFeedbackPane().catch(report)">Ver todas las devoluciones →</button>
              ${data.devoluciones.map(note => `<button class="feedback-row" onclick="openSong('${note.cancion_id}','${note.archivo_id}',${Number(note.segundo) || 0}).catch(report)">
                  <span class="mono feedback-time"><i class="fb-dot" style="background:${FB_COLORS[note.estado] || '#E5484D'}"></i>${note.segundo > 0 ? clockText(note.segundo) : 'General'}</span>
                  <span><span class="feedback-text">${esc(note.texto)}</span><small>${esc([note.disco, note.titulo].filter(Boolean).join(' · '))}${note.archivo_etapa ? ' (' + esc(stageName(note.archivo_etapa)) + ')' : ''} – <span class="mono">${esc(note.archivo_nombre || note.etiqueta)}</span></small></span>${note.playlist ? `<span class="pl-tag">${esc(note.playlist)}</span>` : ''}
                </button>`).join('') || '<p class="muted">No hay devoluciones pendientes. Las que envíe el artista desde el portal aparecen acá.</p>'}

            </section>
          </div>`}
          ${data.recientes.length ? `<section aria-labelledby="homeContinue">
            <div class="section-head"><h2 id="homeContinue">Seguir trabajando</h2><button class="btn-ghost" onclick="openArtistManager(true)">Ver producciones</button></div>
            <div class="continue-grid">${data.recientes.map(song => `
              <button class="continue-card" onclick="openSong('${song.id}')">
                ${artBox(song.portada, song.disco_id || song.id, song.etapa)}
                <span class="continue-copy"><strong>${esc(song.titulo)}</strong>
                  <span class="muted">${esc(song.artista)}${song.disco ? ' · ' + esc(song.disco) : ' · Canción suelta'}</span>
                  <span class="continue-meta"><i class="dot st-${song.etapa || 'historico'}"></i>${esc(stageName(song.etapa))}${song.referencia ? ' · ' + esc(song.referencia) : ''} · ${esc(relativeTime(song.actualizado))}</span></span>
                <svg class="play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
              </button>`).join('')}</div></section>` : ''}
          ${data.discos.length || data.sueltas ? `<section aria-labelledby="homeAlbums">
            <div class="section-head"><h2 id="homeAlbums">Discos y proyectos</h2><button class="btn-ghost" onclick="openArtistManager(true)">Ver todos</button></div>
            <div class="shelf">${data.discos.map(album => `<button class="shelf-item" onclick="openGlobalAlbum('${album.id}','${album.artista_id}').catch(report)">
                ${artBox(album.portada, album.id, '', 'shelf-art')}
                <strong>${esc(album.nombre)}</strong><span class="muted">${esc(album.tipo)} · ${esc(album.artista)}</span></button>`).join('')}
              ${data.sueltas ? `<button class="shelf-item" onclick="openArtistManager(true)">${artBox('', 'sueltas', 'demo', 'shelf-art')}
                <strong>Canciones sueltas</strong><span class="muted">${countLabel(data.sueltas, 'canción', 'canciones')}</span></button>` : ''}
            </div></section>` : ''}`;
        const search = $('homeSearch');
        search.onkeydown = event => {
            if (event.key !== 'Enter') return;
            const value = search.value;
            openArtistManager(true);
            setTimeout(() => { if ($('prodSearch')) { $('prodSearch').value = value; renderGlobalProjects(); } }, 300);
        };
    } catch (error) { report(error); }
}

function renderSideRecents(recent) {
    const list = (recent || []).slice(0, 4);
    $('sideRecentsLabel').hidden = !list.length;
    $('sideRecents').innerHTML = list.map(song => `<button class="side-recent" onclick="openSong('${song.id}')" title="${esc(song.titulo)} · ${esc(song.artista)}">
        <span class="dot" style="background:var(--st-${song.etapa || 'historico'})"></span><span>${esc(song.titulo)}</span></button>`).join('');
}

// Se llama al final de display(): agrega el comportamiento de las pantallas nuevas.
function studioDisplayHook(page) {
    document.body.dataset.page = page;
    document.body.classList.toggle('no-crumbs', ['catalogPane', 'playlistsPane', 'arrangements', 'beats', 'lyrics', 'scores', 'entidades', 'launchesPane', 'artistsPane', 'feedbackPane', 'projectManager', 'configPane', 'pluginsPane', 'budgetsPane'].includes(page));
    $('sideFeedback')?.setAttribute('aria-current', page === 'feedbackPane' ? 'page' : 'false');
    $('sideMyPlaylists')?.setAttribute('aria-current', page === 'playlistsPane' ? 'page' : 'false');
    if (page === 'feedbackPane') { $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> › <button onclick="openPlaylists()">Playlist</button> › Devoluciones`; renderFeedbackPane(); }
    else if (typeof fb !== 'undefined') fb.audio.pause();
    if (page === 'creditsPane') renderCredits();
    if (page === 'composition') renderCompositionPane();
    const compLists = ['beats', 'lyrics', 'scores'].includes(page);
    document.querySelectorAll('.comp-sub').forEach(b => { b.hidden = page !== 'composition' && !compLists; });
    if (typeof comp !== 'undefined') {
        if (compLists) comp.tab = page;
        const compNow = page === 'composition' || compLists ? comp.tab : '';
        $('sideBeats')?.setAttribute('aria-current', compNow === 'beats' ? 'page' : 'false');
        $('sideLyrics')?.setAttribute('aria-current', compNow === 'lyrics' ? 'page' : 'false');
        $('sideScores')?.setAttribute('aria-current', compNow === 'scores' ? 'page' : 'false'); }
    if (page === 'entidades') renderEntitiesPane();
    if (page === 'pluginsPane') renderPluginsPane();
    if (page === 'budgetsPane') renderBudgetsPane().catch(report);
    $('sideBudgets')?.setAttribute('aria-current', page === 'budgetsPane' ? 'page' : 'false');
    $('sidePlugins')?.setAttribute('aria-current', page === 'pluginsPane' ? 'page' : 'false');
    if (page === 'arrangements') renderArrangementsPane();
    const crumbs = {launchesPane: 'Lanzamientos', avPane: 'Audiovisual', configPane: 'Configuración', pluginsPane: 'Plugins', budgetsPane: 'Presupuestos'};
    if (crumbs[page]) $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> › ${crumbs[page]}`;
    $('sideLaunches')?.setAttribute('aria-current', page === 'launchesPane' ? 'page' : 'false');
    $('sideConfig')?.setAttribute('aria-current', page === 'configPane' ? 'page' : 'false');
    if (page === 'artistsPane') { $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> › Artistas`; paintArtists(); }
    else if (typeof arr !== 'undefined' && arr.playing) arrStop();
    if (page !== 'composition' && typeof comp !== 'undefined') { comp.audio.pause(); comp.sync?.audio.pause(); }
    if (page === 'exportPane') renderExport();
    if (page !== 'albumPane' && typeof albumPlayer !== 'undefined' && albumPlayer.index >= 0) albumPlayer.stop();
    if (page === 'home') renderHome().then(() => typeof homeUpcoming === 'function' && homeUpcoming());
    else if (page !== 'songPane') api('/api/inicio').then(data => renderSideRecents(data.recientes)).catch(() => {});
    if (page !== 'songPane' && typeof stopTransport === 'function') stopTransport();
}

// Notación del SI: coma decimal, espacio entre número y unidad, múltiplos decimales.
function formatDecimal(value, digits = 1) {
    return Number(value).toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: digits, useGrouping: false});
}
function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '—';
    const units = [['GB', 1e9], ['MB', 1e6], ['kB', 1e3]];
    for (const [unit, size] of units) if (bytes >= size) return formatDecimal(bytes / size) + ' ' + unit;
    return bytes + ' B';
}
function formatRate(hertz) { return hertz ? formatDecimal(hertz / 1000) + ' kHz' : ''; }

// Avisos breves (no son errores): aparecen abajo y se van solos.
function notify(message) {
    let box = $('toast');
    if (!box) { box = document.createElement('div'); box.id = 'toast'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    box.textContent = message; box.className = 'is-on';
    clearTimeout(notify.timer); notify.timer = setTimeout(() => { box.className = ''; }, 4200);
}

document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && trail.at(-1) === 'home') { e.preventDefault(); $('homeSearch')?.focus(); } });
