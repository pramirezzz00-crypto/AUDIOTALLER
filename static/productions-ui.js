// Producciones · biblioteca tipo streaming: discos y canciones sueltas con estado, avance por etapa y última actividad.
// Reemplaza la grilla anterior; abrir, editar y crear siguen usando las mismas funciones.
const PROD_STATES = ['Borrador', 'En producción', 'Finalizado', 'Lanzado', 'En pausa'];
const PROD_COLORS = {Borrador: '#8A8A94', 'En producción': '#5AA7FF', Finalizado: '#5ED17E', Lanzado: '#2FD8BF', 'En pausa': '#FFB547'};
const prod = {items: [], type: 'todo', state: '', sort: 'actividad', list: false, media: 'audio'};
let prodSeq = 0;

async function loadGlobalProjects() {
    const sequence = ++prodSeq;
    const items = await api('/api/producciones');
    if (sequence !== prodSeq) return;
    prod.items = items;
    renderGlobalProjects();
}
function prodProgress(item) {
    const songs = item.canciones || [];
    return STAGE_ORDER.map((key, index) => ({key, total: songs.filter(song => song.etapa_indice === index).length})).filter(x => x.total);
}
function renderGlobalProjects() {
    const root = $('globalProjects');
    if (!root) return;
    if (prod.media === 'audiovisual' && typeof renderAvLibrary === 'function') return renderAvLibrary(root);
    const query = projectText(($('prodSearch')?.value || '').trim());
    const typed = prod.items.filter(item => prod.type === 'todo' || (prod.type === 'discos' ? item.tipo === 'disco' : item.tipo === 'cancion'));
    const searched = typed.filter(item => projectText([item.nombre, item.artista, item.formato, ...(item.canciones || []).map(s => s.titulo)].join(' ')).includes(query));
    const visible = searched.filter(item => !prod.state || item.estado === prod.state);
    const sorters = {
        actividad: (a, b) => String(b.actualizado || '').localeCompare(String(a.actualizado || '')),
        titulo: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
        artista: (a, b) => a.artista.localeCompare(b.artista, 'es') || a.nombre.localeCompare(b.nombre, 'es'),
        avance: (a, b) => avg(b) - avg(a),
    };
    function avg(item) { const s = item.canciones || []; return s.length ? s.reduce((n, x) => n + x.etapa_indice + 1, 0) / s.length : 0; }
    visible.sort(sorters[prod.sort]);
    const keepFocus = document.activeElement?.id === 'prodSearch';
    const nDiscs = prod.items.filter(i => i.tipo === 'disco').length, nLoose = prod.items.length - nDiscs;
    const nSongs = prod.items.reduce((n, i) => n + (i.canciones || []).length, 0);
    root.innerHTML = `
      <header class="mk-head"><h1>Producciones</h1><p class="muted">${countLabel(nDiscs, 'disco', 'discos')} · ${countLabel(nLoose, 'canción suelta', 'canciones sueltas')} · ${countLabel(nSongs, 'canción', 'canciones')} en total</p></header>
      <div class="prod-bar"><div class="seg big" role="radiogroup" aria-label="Tipo de producción">
            <button role="radio" aria-checked="${prod.media === 'audio'}" class="${prod.media === 'audio' ? 'is-on' : ''}" onclick="prod.media='audio';renderGlobalProjects()">Audio</button>
            <button role="radio" aria-checked="${prod.media === 'audiovisual'}" class="${prod.media === 'audiovisual' ? 'is-on' : ''}" onclick="prod.media='audiovisual';renderGlobalProjects()">Audiovisual</button></div>
          <details class="menu"><summary class="menu-button btn-primary">+ Nueva producción ▾</summary><div class="menu-list">
            <button onclick="newGlobalProject('album').catch(report)">Disco</button>
            <button onclick="newGlobalProject('song').catch(report)">Canción suelta</button>
            <button onclick="typeof newAvProject==='function'?newAvProject():report(Error('Disponible con Audiovisual.'))">Producción audiovisual</button>
          </div></details></div>
      <div class="prod-tools">
        <label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
          <input id="prodSearch" type="search" placeholder="Buscar disco, canción o artista…" aria-label="Buscar producciones" value="${esc($('prodSearch')?.value || '')}"></label>
        <div class="seg" role="radiogroup" aria-label="Tipo">${[['todo', 'Todo', prod.items.length], ['discos', 'Discos', nDiscs], ['sueltas', 'Canciones sueltas', nLoose]].map(([id, label, n]) =>
          `<button role="radio" aria-checked="${prod.type === id}" class="${prod.type === id ? 'is-on' : ''}" onclick="prod.type='${id}';renderGlobalProjects()">${label} <span class="mono">${n}</span></button>`).join('')}</div>
        <span class="muted">Ordenar</span>
        <select aria-label="Ordenar" onchange="prod.sort=this.value;renderGlobalProjects()">${[['actividad', 'Última actividad'], ['titulo', 'Título'], ['artista', 'Artista'], ['avance', 'Avance']].map(([id, label]) =>
          `<option value="${id}" ${prod.sort === id ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <div class="seg" aria-label="Vista"><button class="${prod.list ? '' : 'is-on'}" aria-pressed="${!prod.list}" onclick="prod.list=false;renderGlobalProjects()" title="Cuadrícula">▦</button>
          <button class="${prod.list ? 'is-on' : ''}" aria-pressed="${prod.list}" onclick="prod.list=true;renderGlobalProjects()" title="Lista">☰</button></div>
      </div>
      <div class="chips" role="radiogroup" aria-label="Estado">
        ${[['', 'Todos los estados', searched.length], ...PROD_STATES.map(s => [s, s, searched.filter(i => i.estado === s).length])].map(([id, label, n]) =>
          `<button role="radio" aria-checked="${prod.state === id}" class="chip-btn ${prod.state === id ? 'is-on' : ''}" onclick="prod.state='${id}';renderGlobalProjects()">
            ${id ? `<i class="fb-dot" style="background:${PROD_COLORS[id]}"></i>` : ''}${label} <span class="mono">${n}</span></button>`).join('')}
      </div>
      <div class="${prod.list ? 'prod-list' : 'prod-grid'}">${visible.map(item => prod.list ? prodRow(item) : prodCard(item)).join('') ||
        `<p class="muted">${prod.items.length ? 'No hay producciones que coincidan con los filtros.' : 'Todavía no hay producciones. Creá un disco o una canción suelta.'}</p>`}</div>
      <p class="prod-legend">Barra de etapas: cada segmento es una canción, coloreada por su etapa actual — ${STAGE_ORDER.map(k => `<span><i style="background:var(--st-${k})"></i>${esc(stageName(k))}</span>`).join('')}<span>▶ con video asociado</span></p>`;
    const search = $('prodSearch');
    search.oninput = () => { const pos = search.selectionStart; renderGlobalProjects(); const box = $('prodSearch'); box.focus(); box.setSelectionRange(pos, pos); };
    if (keepFocus) search.focus();
}
function prodOpen(item) {
    return item.tipo === 'disco' ? `openGlobalAlbum('${item.id}','${item.artista_id}').catch(report)` : `openSong('${item.id}').catch(report)`;
}
function prodSegments(item) {
    const songs = item.canciones || [];
    return `<span class="prod-segs" title="Etapa de cada canción">${(item.estado === 'Lanzado' ? [{etapa: 'lanzado', titulo: 'Lanzado'}] : songs).slice(0, 24).map(song =>
        `<i style="background:${song.etapa === 'lanzado' ? '#EDEDF0' : song.etapa ? `var(--st-${song.etapa})` : 'var(--at-line3)'}" title="${esc(song.titulo)} · ${esc(stageName(song.etapa))}"></i>`).join('')}</span>`;
}
function prodCard(item) {
    const playable = (item.canciones || []).find(song => song.referencia_id);
    const counts = STAGE_ORDER.map(k => [k, (item.canciones || []).filter(s => s.etapa === k).length]).filter(([, n]) => n).reverse();
    const summary = item.estado === 'Lanzado' ? 'Lanzado' : counts.map(([k, n]) => `${n} en ${stageName(k).toLowerCase()}`).join(' · ') || 'Sin material';
    const video = item.video ? (item.canciones || []).find(s => s.video) : null;
    return `<article class="prod-card">
      <div class="prod-cover" onclick="${prodOpen(item)}">${/^data:image/.test(item.portada || '') ? `<img class="prod-img" src="${item.portada}" alt="">` : `<span class="prod-blur" style="${placeholderArt(item.id, (item.canciones || [])[0]?.etapa)}"></span>`}
        <span class="prod-state" style="--c:${PROD_COLORS[item.estado]}"><i></i>${esc(item.estado)}</span>
        ${video ? `<span class="prod-video">▶ ${esc(item.tipo === 'disco' ? video.titulo : 'video')}</span>` : ''}
        <span class="prod-overlay">${esc(item.nombre)}</span>
        ${playable ? `<button class="prod-play" aria-label="Escuchar ${esc(item.nombre)}" onclick="event.stopPropagation();prodPreview('${playable.referencia_id}',this)"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>` : ''}
      </div>
      <button class="prod-copy" onclick="${prodOpen(item)}"><strong>${esc(item.nombre)}</strong><span class="muted">${esc(item.artista)}</span>
        <small class="muted">${esc(item.formato)}${item.tipo === 'disco' ? ' · ' + countLabel(item.canciones.length, 'canción', 'canciones') : ''}</small></button>
      ${prodSegments(item)}
      <span class="prod-meta"><span>${item.pendientes ? `<b class="side-count">${item.pendientes}</b> ` : ''}${item.campana ? '📅 ' + esc(item.campana.nombre) + ' · ' : ''}${esc(summary)}</span><span>${esc(relativeTime(item.actualizado) || '')}</span></span>
    </article>`;
}
function prodRow(item) {
    return `<button class="prod-row" onclick="${prodOpen(item)}">${artBox(item.portada, item.id, (item.canciones || [])[0]?.etapa, 'prod-art-s')}
      <span><strong>${esc(item.nombre)}</strong><small>${esc(item.artista)} · ${esc(item.formato)}</small></span>
      <span class="prod-state" style="--c:${PROD_COLORS[item.estado]}">${esc(item.estado)}</span>
      ${prodSegments(item)}<span class="muted">${esc(relativeTime(item.actualizado) || '—')}</span></button>`;
}
function fmtDay(iso) {
    const d = new Date(iso + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-AR', {day: 'numeric', month: 'short', year: 'numeric'});
}
const prodAudio = new Audio();
function prodPreview(id, button) {
    if (prodAudio.dataset.id === id && !prodAudio.paused) { prodAudio.pause(); button.classList.remove('is-playing'); return; }
    document.querySelectorAll('.prod-play.is-playing').forEach(b => b.classList.remove('is-playing'));
    prodAudio.dataset.id = id; prodAudio.src = '/api/produccion/archivo/' + id;
    prodAudio.play().catch(report); button.classList.add('is-playing');
}
