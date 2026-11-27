// Catálogo y Playlist con el diseño del mockup: tabla de audios con tipo, versión vigente, LUFS/dBTP y playlists;
// barra de selección para sumar a una playlist. Playlist con lista lateral, portada, acciones, pistas y panel del portal.
const KIND = {mastering: ['master', 'Master', '#FF6B8B'], mezcla: ['mix', 'Mezcla', '#5ED17E'], grabacion: ['take', 'Toma', '#FFB547'],
    maqueta: ['maq', 'Maqueta', '#5AA7FF'], demo: ['demo', 'Demo', '#9B8CFF'], historico: ['otro', 'Otro', '#8A8A94']};
const cat = {all: [], q: '', kind: '', artist: '', vigentes: false, favs: false, song: '', sel: new Set(), extra: {}, lists: [], playing: '', audio: new Audio()};
const catKindOf = a => KIND[a.etapa] || KIND.historico;
const catVersionOf = a => (a.version || (a.nombre.match(/[_ -](V|T)(\d+)/i) || [, 'V', '1']).slice(1).join('').toUpperCase());

function openCatalog(songId = '') {
    cat.song = songId || '';
    if (trail.at(-1) === 'catalogPane') return refreshCatalog();
    go('catalogPane');
}
let catSeq = 0;
async function refreshCatalog() {
    const seq = ++catSeq;
    [cat.all, cat.lists] = await Promise.all([api('/api/catalogo?limit=500').then(r => r.audios), api('/api/playlists')]);
    // La versión vigente es el audio más reciente de cada canción y etapa.
    const newest = {};
    for (const a of cat.all) { const key = a.cancion_id + a.etapa; if (!newest[key] || a.creado > newest[key].creado) newest[key] = a; }
    cat.all.forEach(a => { a.vigente = newest[a.cancion_id + a.etapa] === a; });
    if (seq !== catSeq) return;
    paintCatalog();
    const ids = cat.all.map(a => a.id);
    for (let i = 0; i < ids.length; i += 50) Object.assign(cat.extra, await api('/api/catalogo/extra?ids=' + ids.slice(i, i + 50).join(',')).catch(() => ({})));
    paintCatalog();
}
async function loadCatalog() { return refreshCatalog(); }
function catVisible() {
    const q = cat.q.trim().toLowerCase();
    return cat.all.filter(a => (!q || [a.titulo, a.nombre, a.artista, a.disco].join(' ').toLowerCase().includes(q)) && (!cat.kind || catKindOf(a)[0] === cat.kind)
        && (!cat.artist || a.artista_id === cat.artist) && (!cat.vigentes || a.vigente) && (!cat.favs || a.favorito) && (!cat.song || a.cancion_id === cat.song))
        .sort((x, y) => x.titulo.localeCompare(y.titulo, 'es') || String(y.creado).localeCompare(String(x.creado)));
}
function paintCatalog() {
    const root = $('catalogPane');
    const list = catVisible();
    const count = k => cat.all.filter(a => catKindOf(a)[0] === k).length;
    const artists = [...new Map(cat.all.map(a => [a.artista_id, a.artista])).entries()];
    const keepFocus = document.activeElement?.id === 'catQ';
    root.innerHTML = `
      <header class="mk-head"><h1>Catálogo</h1><p class="muted">Todos los audios de todas las producciones en un solo lugar · ${countLabel(cat.all.length, 'audio', 'audios')} · ${countLabel(count('master'), 'master', 'masters')} · ${countLabel(count('mix'), 'mezcla', 'mezclas')}${cat.song ? ` · <button class="link" onclick="cat.song='';paintCatalog()">ver todas las canciones</button>` : ''}</p></header>
      <div class="mk-tools"><label class="mk-search"><input id="catQ" type="search" placeholder="Buscar canción, archivo, artista o disco" value="${esc(cat.q)}"><kbd>Ctrl K</kbd></label>
        <select aria-label="Artista" onchange="cat.artist=this.value;paintCatalog()"><option value="">Todos los artistas</option>${artists.map(([id, n]) => `<option value="${id}" ${cat.artist === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="mk-pill ${cat.vigentes ? 'is-on' : ''}" onclick="cat.vigentes=!cat.vigentes;paintCatalog()">Solo versiones vigentes</button>
        <button class="mk-pill ${cat.favs ? 'is-on' : ''}" onclick="cat.favs=!cat.favs;paintCatalog()">★ Favoritas</button>
        <button class="mk-pill" onclick="importCatalogAudio().catch(report)">+ Incorporar audio</button></div>
      <div class="mk-chips"><button class="mk-chip ${!cat.kind ? 'is-on' : ''}" onclick="cat.kind='';paintCatalog()">Todos <span>${cat.all.length}</span></button>
        ${['master', 'mix', 'take', 'maq', 'demo'].map(k => { const [, label, color] = Object.values(KIND).find(x => x[0] === k); return `<button class="mk-chip ${cat.kind === k ? 'is-on' : ''}" onclick="cat.kind='${k}';paintCatalog()"><i style="background:${color}"></i>${label} <span>${count(k)}</span></button>`; }).join('')}</div>
      <table class="mk-table cat-table"><thead><tr><th><input type="checkbox" aria-label="Seleccionar todos" ${list.length && list.every(a => cat.sel.has(a.id)) ? 'checked' : ''} onchange="catAll(this.checked)"></th><th></th><th>Audio</th><th>Canción · disco · artista</th><th>Tipo</th><th>Versión</th><th>LUFS</th><th>dBTP</th><th>Dur.</th><th>En playlists</th></tr></thead>
      <tbody>${list.map(a => { const [k, , color] = catKindOf(a); const x = cat.extra[a.id] || {}; const playing = cat.playing === a.id && !cat.audio.paused;
        return `<tr class="${cat.sel.has(a.id) ? 'is-sel' : ''} ${a.disponible ? '' : 'is-missing'}">
          <td><input type="checkbox" aria-label="Seleccionar ${esc(a.nombre)}" ${cat.sel.has(a.id) ? 'checked' : ''} onchange="catPick('${a.id}',this.checked)"></td>
          <td><button class="mk-play ${playing ? 'is-on' : ''}" ${a.disponible ? '' : 'disabled'} aria-label="${playing ? 'Pausar' : 'Escuchar'} ${esc(a.nombre)}" onclick="catPlay('${a.id}')">${playing ? '❚❚' : '▶'}</button></td>
          <td><strong>${esc(a.titulo)} · ${esc(KIND[a.etapa]?.[1] || a.clase || 'Audio')} ${esc(catVersionOf(a))}</strong><small class="mono">${esc(a.nombre)}</small></td>
          <td><button class="link" onclick="openSong('${a.cancion_id}','${a.id}').catch(report)">${esc(a.titulo)}</button><small>${esc([a.disco || 'Canción suelta', a.artista].join(' · '))}</small></td>
          <td><span class="mk-kind" style="--c:${color}">${k}</span></td>
          <td class="mono">${esc(catVersionOf(a))} ${a.vigente ? '<span class="ok-green">★ vigente</span>' : '<span class="muted">anterior</span>'}${a.favorito ? ' <span class="star">★</span>' : ''}</td>
          <td class="mono">${x.estado === 'ok' ? formatDecimal(x.lufs) : x.estado === 'midiendo' ? '…' : '—'}</td>
          <td class="mono ${x.estado === 'ok' && x.dbtp > -1 ? 'warn-amber' : ''}">${x.estado === 'ok' ? formatDecimal(x.dbtp) : '—'}</td>
          <td class="mono">${a.tecnica?.duracion ? clockText(a.tecnica.duracion) : '—'}</td>
          <td>${(x.playlists || []).map(n => `<span class="mk-tag">↗ ${esc(n)}</span>`).join(' ')}</td></tr>`; }).join('') || `<tr><td colspan="10" class="muted">${cat.all.length ? 'Ningún audio coincide con los filtros.' : 'Todavía no hay audios. Se suman al cargarlos en cada etapa de una canción.'}</td></tr>`}</tbody></table>
      ${cat.sel.size ? `<div class="mk-selbar"><strong>${countLabel(cat.sel.size, 'audio seleccionado', 'audios seleccionados')}</strong><span class="spacer"></span><span class="muted">Agregar a</span>
        ${cat.lists.slice(0, 3).map(l => `<button onclick="catAddTo('${l.id}').catch(report)">${esc(l.nombre)}</button>`).join('')}
        <button class="btn-primary" onclick="catNewPlaylist().catch(report)">+ Nueva playlist con estos</button><button class="btn-ghost" aria-label="Limpiar selección" onclick="cat.sel.clear();paintCatalog()">✕</button></div>` : ''}`;
    const q = $('catQ');
    q.oninput = () => { cat.q = q.value; const pos = q.selectionStart; paintCatalog(); $('catQ').focus(); $('catQ').setSelectionRange(pos, pos); };
    if (keepFocus) q.focus();
}
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && trail.at(-1) === 'catalogPane') { e.preventDefault(); $('catQ')?.focus(); } });
function catPick(id, on) { on ? cat.sel.add(id) : cat.sel.delete(id); paintCatalog(); }
function catAll(on) { catVisible().forEach(a => on ? cat.sel.add(a.id) : cat.sel.delete(a.id)); paintCatalog(); }
function catPlay(id) {
    if (cat.playing === id && !cat.audio.paused) cat.audio.pause();
    else { cat.playing = id; cat.audio.src = '/api/produccion/archivo/' + id; cat.audio.play().catch(report); }
    cat.audio.onplay = cat.audio.onpause = cat.audio.onended = () => trail.at(-1) === 'catalogPane' && paintCatalog();
}
async function catAddTo(pid) {
    const list = await api('/api/playlists/' + pid);
    await api('/api/playlists/' + pid, body({nombre: list.nombre, notas: list.notas, revision: list.revision, archivos: [...new Set([...list.audios.map(a => a.id), ...cat.sel])]}));
    notify(`${countLabel(cat.sel.size, 'audio sumado', 'audios sumados')} a «${list.nombre}».`); cat.sel.clear(); refreshCatalog();
}
async function catNewPlaylist() {
    const name = prompt('Nombre de la playlist (p. ej. «Escucha 3 · masters»):'); if (!name) return;
    playlistCurrent = await api('/api/playlists', body({nombre: name, archivos: [...cat.sel]}));
    cat.sel.clear(); openPlaylists();
}

// ── Playlist ──
const plx = {lists: [], cur: null, notes: [], news: null, opts: null};
function openPlaylists() { if (trail.at(-1) === 'playlistsPane') return loadPlaylists(); go('playlistsPane'); }
async function loadPlaylists() {
    plx.lists = await api('/api/playlists').catch(() => []);
    const details = await Promise.all(plx.lists.map(l => api('/api/playlists/' + l.id + '/opciones').catch(() => null)));
    plx.lists.forEach((l, i) => { l.opc = details[i]; });
    const id = playlistCurrent?.id && plx.lists.some(l => l.id === playlistCurrent.id) ? playlistCurrent.id : plx.lists[0]?.id;
    if (id) await selectPlaylist(id); else paintPlaylists();
}
async function selectPlaylist(id) {
    const [list, notes, news, opts] = await Promise.all([api('/api/playlists/' + id), api('/api/portal/devoluciones?playlist_id=' + id).catch(() => []),
        api('/api/playlists/' + id + '/novedades').catch(() => null), api('/api/playlists/' + id + '/opciones').catch(() => null)]);
    if (plPlayback.listId && (plPlayback.listId !== list.id || !list.audios.some(a => a.id === plPlayback.audioId))) plStop();
    playlistCurrent = list; plx.notes = notes; plx.news = news; plx.opts = opts;
    paintPlaylists();
}
function plStatus(l) {
    const p = l.opc?.publicacion;
    if (!p) return ['Borrador · sin publicar', 'muted'];
    const days = Number(l.opc.vence || 30);
    if (!days) return ['Publicada · sin vencimiento', 'ok-green'];
    const end = new Date(String(p.actualizado).replace(' ', 'T') + 'Z'); end.setDate(end.getDate() + days);
    const label = end.toLocaleDateString('es-AR', {day: 'numeric', month: 'short'});
    return end < new Date() ? ['Vencida el ' + label, 'muted'] : ['Publicada · vence ' + label, 'ok-green'];
}
function paintPlaylists() {
    const root = $('playlistsPane');
    const cur = playlistCurrent && plx.lists.some(l => l.id === playlistCurrent.id) ? playlistCurrent : null;
    const meta = cur ? plx.lists.find(l => l.id === cur.id) : null;
    const dots = id => { const n = plx.notes.filter(x => x.archivo_id === id); return n.length ? FB_STATES.map(s => { const c = n.filter(x => x.estado === s).length; return c ? `<span><i class="fb-dot" style="background:${FB_COLORS[s]}"></i>${c}</span>` : ''; }).join(' ') : '<span class="muted">sin devoluciones</span>'; };
    const newer = Object.fromEntries((plx.news?.novedades || []).map(n => [n.actual, n]));
    const open = plx.notes.filter(n => n.estado === 'Pendiente' || n.estado === 'En revisión').length;
    const o = plx.opts || {};
    const msg = cur ? encodeURIComponent(`Hola! Te comparto «${cur.nombre}» para que la escuches y me dejes tus devoluciones${o.publicacion?.url ? ': ' + o.publicacion.url : '.'}`) : '';
    root.innerHTML = `<div class="pl-layout">
      <aside class="pl-side"><div class="pl-side-head"><span class="eyebrow">Mis playlists</span><button class="link" onclick="newPlaylistDialog().catch(report)">+ Nueva</button></div>
        ${plx.lists.map(l => { const [st, cls] = plStatus(l); return `<button class="pl-item ${cur?.id === l.id ? 'is-on' : ''}" onclick="selectPlaylist('${l.id}').catch(report)">
          <span class="pl-art" style="${placeholderArt(l.id, 'mezcla')}"></span><span><strong>${esc(l.nombre)}</strong><small>${countLabel(l.total, 'audio', 'audios')}</small><small class="${cls}">${st}</small></span></button>`; }).join('') || '<p class="muted">Todavía no hay playlists. Creá una desde el Catálogo.</p>'}
        <div class="pl-guide"><span class="eyebrow">Tu Portal del artista</span><strong>Instructivo paso a paso</strong><small>Crear, conectar y mantener la página donde tus artistas escuchan y comentan.</small><button class="mk-btn" onclick="portalGuideDialog()">📘 Abrir instructivo</button></div></aside>
      ${cur ? `<section class="pl-main">
        <div class="pl-hero"><span class="pl-cover" style="${placeholderArt(cur.id, 'mezcla')}"></span>
          <div><span class="eyebrow">Playlist de escucha</span><h1>${esc(cur.nombre)}</h1>
            <p class="muted">${countLabel(cur.audios.length, 'audio', 'audios')} · creada el ${esc(new Date(String(cur.creado).replace(' ', 'T') + 'Z').toLocaleDateString('es-AR', {day: 'numeric', month: 'short'}))} · ${plStatus(meta)[0]}</p></div></div>
        <div class="pl-actions"><button class="mk-bigplay" id="plPlayButton" aria-label="Escuchar la playlist" onclick="plToggle()" ${cur.audios.length ? '' : 'disabled'}>▶</button>
          <a class="mk-btn wa" href="https://wa.me/?text=${msg}" target="_blank" rel="noopener noreferrer">✆ Compartir por WhatsApp</a>
          ${o.publicacion?.url ? `<button class="mk-btn" onclick="navigator.clipboard.writeText('${esc(o.publicacion.url)}').then(()=>notify('Enlace copiado'))">Copiar enlace</button>` : ''}
          <button class="mk-btn" onclick="openFeedbackPane({playlist_id:'${cur.id}'}).catch(report)">Ver devoluciones ${open ? `<b class="side-count">${open}</b>` : ''}</button>
          <button class="mk-btn" onclick="publishWebDialog().catch(report)">Publicar cambios en el portal</button>
          <button class="mk-btn pl-manual" onclick="downloadPortalGuide().catch(report)" title="Guía paso a paso para crear, conectar y mantener el Portal del artista">${PDF_ICON}Manual para generar el Portal del artista</button>
          <details class="menu"><summary class="menu-button">Más</summary><div class="menu-list">
            <button onclick="editPlaylistDialog()">Nombre y notas</button><button onclick="deliveryDialog().catch(report)">Vista local / entrega</button>
            <button onclick="portalSetupDialog().catch(report)">Conectar portal web</button><button onclick="portalGuideDialog()">Instructivo del portal (PDF)</button><button onclick="importCatalogAudio([], '${cur.id}').catch(report)">Incorporar audios desde la PC</button></div></details></div>
        <div class="pl-body"><div class="pl-tracks"><table class="mk-table"><thead><tr><th></th><th>#</th><th>Audio</th><th>Canción · disco</th><th>Devoluciones</th><th>Dur.</th><th></th></tr></thead><tbody>
          ${cur.audios.map((a, i) => `<tr draggable="true" data-pl="${i}"><td class="grip" title="Arrastrá para ordenar">⋮⋮</td><td class="mono">${i + 1}</td>
            <td><strong>${esc(a.titulo)} · ${esc(KIND[a.etapa]?.[1] || 'Audio')} ${esc(catVersionOf(a))}</strong><small class="mono">${esc(a.nombre)}</small></td>
            <td>${esc(a.titulo)} · ${esc(a.disco || 'suelta')}</td><td class="pl-dots">${dots(a.id)}</td><td class="mono">${a.tecnica?.duracion ? clockText(a.tecnica.duracion) : '—'}</td>
            <td><button class="mk-x" aria-label="Quitar ${esc(a.nombre)}" onclick="removePlaylistItem(${i})">✕</button></td></tr>
            ${newer[a.id] ? `<tr class="pl-newer"><td></td><td colspan="6"><span>Hay una versión más nueva: <b class="mono">${esc(newer[a.id].nuevo_nombre)}</b></span>
              <button onclick="playlistSwap('${a.id}','${newer[a.id].nuevo}',false).catch(report)">Sumarla al lado</button><button onclick="playlistSwap('${a.id}','${newer[a.id].nuevo}',true).catch(report)">Reemplazar</button></td></tr>` : ''}`).join('')}</tbody></table>
          <button class="pl-add" onclick="openCatalog()">+ Agregar audios desde el Catálogo</button></div>
        <aside class="pl-portal"><span class="eyebrow">En el portal</span>
          <div class="pl-stats"><div><b>${o.publicacion ? '✓' : '—'}</b><small>${o.publicacion ? 'Publicada' : 'Sin publicar'}</small></div><div><b>${o.devoluciones_total ?? 0}</b><small>Devoluciones</small></div>
            <div><b>${o.publicacion ? esc(relativeTime(o.publicacion.actualizado)) : '—'}</b><small>Última publicación</small></div><div><b>${o.devoluciones_abiertas ?? 0}</b><small>Devoluciones pendientes</small></div></div>
          <label class="fld">Vence<select id="plVence">${[['7', 'En 7 días'], ['15', 'En 15 días'], ['30', 'En 30 días'], ['60', 'En 60 días'], ['0', 'Sin vencimiento']].map(([v, l]) => `<option value="${v}" ${String(o.vence) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${[['devoluciones', 'Permitir devoluciones', 'El artista puede comentar con minuto'], ['descarga', 'Permitir descarga', 'Desactivado: solo escucha'], ['mostrar_version', 'Mostrar el nombre de la versión', 'Ej.: «Mix V2», para que sepa qué escucha']].map(([k, t, d]) =>
            `<label class="pl-opt"><input type="checkbox" data-opt="${k}" ${o[k] ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}
          <p class="insp-help">Los cambios se aplican al «Publicar cambios en el portal». Si quitás un audio, sus devoluciones se conservan en AudioTaller.</p></aside></div>
      </section>` : '<section class="pl-main"><p class="muted">Elegí una playlist o creá una nueva.</p></section>'}</div>`;
    root.querySelectorAll('#plVence,[data-opt]').forEach(el => el.onchange = () => api('/api/playlists/' + cur.id + '/opciones', body({vence: $('plVence').value,
        ...Object.fromEntries([...root.querySelectorAll('[data-opt]')].map(x => [x.dataset.opt, x.checked]))})).then(() => notify('Opciones guardadas: se aplican al publicar.')).catch(report));
    plSyncButton();
    let drag = null;
    root.querySelectorAll('[data-pl]').forEach(row => {
        row.ondragstart = () => { drag = Number(row.dataset.pl); };
        row.ondragover = e => { if (drag !== null) e.preventDefault(); };
        row.ondrop = e => { e.preventDefault(); if (drag !== null) movePlaylistItem(drag, Number(row.dataset.pl)); drag = null; };
    });
}
const plAudio = new Audio();
const plPlayback = {listId: null, audioId: null};
function plSyncButton() {
    const button = $('plPlayButton');
    if (!button) return;
    const playing = plPlayback.listId === playlistCurrent?.id && !plAudio.paused && !plAudio.ended;
    button.textContent = playing ? '❚❚' : '▶';
    button.setAttribute('aria-label', playing ? 'Pausar la playlist' : 'Escuchar la playlist');
}
function plStop() {
    plPlayback.listId = null; plPlayback.audioId = null;
    plAudio.pause(); plAudio.removeAttribute('src'); plAudio.load();
    plSyncButton();
}
function plToggle() {
    if (!playlistCurrent?.audios.length) return;
    if (plPlayback.listId === playlistCurrent.id && playlistCurrent.audios.some(a => a.id === plPlayback.audioId)) {
        if (!plAudio.paused) plAudio.pause();
        else plAudio.play().catch(error => { if (error.name !== 'AbortError') report(error); });
        plSyncButton();
    } else plPlay(0);
}
function plPlay(i) {
    const a = playlistCurrent?.audios[i];
    if (!a) { plStop(); return; }
    plPlayback.listId = playlistCurrent.id; plPlayback.audioId = a.id;
    plAudio.src = '/api/produccion/archivo/' + a.id;
    plAudio.play().catch(error => { if (error.name !== 'AbortError') report(error); });
    plSyncButton();
    notify('Sonando: ' + a.nombre);
}
plAudio.onplay = plAudio.onpause = plAudio.onerror = plSyncButton;
plAudio.onended = () => {
    if (plPlayback.listId !== playlistCurrent?.id) { plStop(); return; }
    const i = playlistCurrent.audios.findIndex(a => a.id === plPlayback.audioId);
    if (i < 0) plStop(); else plPlay(i + 1);
};

async function playlistSwap(current, newer, replace) {
    const ids = playlistCurrent.audios.map(a => a.id);
    const index = ids.indexOf(current);
    if (replace) ids.splice(index, 1, newer); else ids.splice(index + 1, 0, newer);
    await updatePlaylistItems([...new Set(ids)]);
    notify(replace ? 'Versión reemplazada. Las devoluciones de la anterior se conservan.' : 'Versión nueva sumada al lado.');
}
