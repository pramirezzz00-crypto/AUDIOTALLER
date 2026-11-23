// Catálogo y Playlist: LUFS / dBTP y en qué playlists está cada audio; aviso de versiones más nuevas y compartir por WhatsApp.
const _loadCatalogOriginal = loadCatalog;
loadCatalog = async function (reset = false) {
    await _loadCatalogOriginal(reset);
    const ids = (catalogCache || []).map(audio => audio.id);
    if (!ids.length) return;
    const extra = await api('/api/catalogo/extra?ids=' + ids.join(',')).catch(() => ({}));
    for (const [id, info] of Object.entries(extra)) {
        const card = document.querySelector(`[data-catalog-select="${id}"]`)?.closest('.catalog-audio');
        if (!card) continue;
        card.querySelector('.cat-extra')?.remove();
        const loud = info.estado === 'ok' ? `<span class="mono">${formatDecimal(info.lufs)} LUFS</span><span class="mono ${info.dbtp > -1 ? 'warn-amber' : ''}">${formatDecimal(info.dbtp)} dBTP</span>`
            : info.estado === 'midiendo' ? '<span>midiendo sonoridad…</span>' : '';
        card.querySelector('.heading')?.insertAdjacentHTML('afterend', `<div class="cat-extra">${loud}${info.playlists.length ? 'En: ' + info.playlists.map(n => `<span class="tag">${esc(n)}</span>`).join(' ') : '<span>En ninguna playlist</span>'}</div>`);
    }
};
async function playlistNews() {
    const holder = $('playlistDetail');
    if (!holder || !playlistCurrent?.id || playlistNews.busy) return;
    playlistNews.busy = true;
    setTimeout(() => { playlistNews.busy = false; }, 800);
    const data = await api('/api/playlists/' + playlistCurrent.id + '/novedades').catch(() => null);
    if (!data) return;
    holder.querySelector('.pl-news')?.remove();
    const share = `${location.origin}`;
    const message = encodeURIComponent(`Hola! Te comparto «${playlistCurrent.nombre}» para que la escuches y me dejes tus devoluciones${data.publicacion?.url ? ': ' + data.publicacion.url : '.'}`);
    holder.insertAdjacentHTML('beforeend', `<section class="card pl-news">
      ${data.novedades.length ? `<strong class="warn-amber">Hay versiones más nuevas</strong>${data.novedades.map(n => `<div class="row-tight"><span class="mono">${esc(n.actual_nombre)}</span> → <span class="mono">${esc(n.nuevo_nombre)}</span>
        <button onclick="playlistSwap('${n.actual}','${n.nuevo}',false).catch(report)">Sumar al lado</button><button onclick="playlistSwap('${n.actual}','${n.nuevo}',true).catch(report)">Reemplazar</button></div>`).join('')}
        <span class="insp-help">Reemplazar conserva las devoluciones de la versión anterior. Nada cambia para el artista hasta «Publicar / actualizar web».</span>` : '<span class="muted">La playlist tiene las últimas versiones.</span>'}
      <div class="row-tight"><a class="btn-link" href="https://wa.me/?text=${message}" target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>
        ${data.publicacion?.url ? `<button class="btn-ghost" onclick="navigator.clipboard.writeText('${esc(data.publicacion.url)}').then(()=>notify('Enlace copiado'))">Copiar enlace</button>` : '<span class="muted">Publicala en el portal para tener un enlace.</span>'}</div></section>`);
    void share;
}
async function playlistSwap(current, newer, replace) {
    const list = await api('/api/playlists/' + playlistCurrent.id);
    const ids = list.audios.map(audio => audio.id);
    const index = ids.indexOf(current);
    if (replace) ids.splice(index, 1, newer); else ids.splice(index + 1, 0, newer);
    playlistCurrent = await api('/api/playlists/' + playlistCurrent.id, body({nombre: list.nombre, notas: list.notas, revision: list.revision, archivos: [...new Set(ids)]}));
    await loadPlaylists();
    notify(replace ? 'Versión reemplazada en la playlist.' : 'Versión nueva sumada al lado.');
}
// Se agrega el aviso cada vez que se muestra el detalle de una playlist.
new MutationObserver(() => { const d = $('playlistDetail'); if (d && !d.querySelector('.pl-news') && playlistCurrent?.id && trail.at(-1) === 'playlistsPane') playlistNews(); })
    .observe(document.body, {childList: true, subtree: true});
