// Disco como lanzamiento: portada grande, título y lista de canciones al estilo de
// las plataformas, con el avance de producción de cada canción.
let albumSummary = [];
let albumSummarySeq = 0;

async function renderAlbumPage() {
    const album = projects.discos.find(row => row.id === currentAlbum.id);
    if (!album) return;
    currentAlbum = album;
    $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> ›
        <button onclick="openArtistManager(true)">Producciones</button> › ${esc(album.nombre)}`;
    const sequence = ++albumSummarySeq;
    try { albumSummary = await api('/api/discos/' + album.id + '/resumen'); }
    catch (error) { albumSummary = []; report(error); }
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
      <div class="release-actions">
        <button class="release-play" ${playable.length ? '' : 'disabled'} aria-label="Escuchar versiones de referencia" onclick="playAlbumReferences()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
        <span class="muted release-play-label">${playable.length ? 'Escuchar versiones de referencia' : 'Sin audios todavía'}</span>
        <button class="pill" onclick="projectForm('album','${album.id}')">Editar disco</button>
        <button class="pill" onclick="publicationDialog('lanzamiento','${album.id}').catch(report)">Ficha de lanzamiento</button>
        <button class="pill" onclick="productionCreditsDialog('disco','${album.id}').catch(report)">Artistas y músicos</button>
        <button class="pill" onclick="associateLooseSongs('${album.id}').catch(report)">Incorporar canciones sueltas</button>
        <button class="pill pill-accent" onclick="projectForm('song','${album.id}')">+ Agregar canción</button>
      </div>
      ${album.notas ? `<p class="muted release-notes">${esc(album.notas)}</p>` : ''}
      <div class="tracklist-tools"><label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="albumSearch" type="search" placeholder="Buscar en este disco…" aria-label="Buscar canciones del disco"></label>
        ${pending ? `<span class="badge">${countLabel(pending, 'devolución pendiente', 'devoluciones pendientes')}</span>` : ''}</div>
      <div class="tracklist-scroll"><div class="tracklist" role="table" aria-label="Canciones">
        <div class="track track-head" role="row"><span role="columnheader">#</span><span role="columnheader">Título</span><span role="columnheader">Producción</span>
          <span role="columnheader">Referencia</span><span role="columnheader">Devoluciones</span><span role="columnheader" class="right">Dur.</span></div>
        <div id="albumSongs"></div>
      </div></div>
      <p id="albumEmpty" class="muted" hidden></p>`;
    $('albumSearch').oninput = renderAlbumSongs;
    renderAlbumSongs();
}

function renderAlbumSongs() {
    if (!$('albumSongs')) return;
    const query = projectText($('albumSearch').value.trim());
    const meta = Object.fromEntries(albumTracks(currentAlbum.id).map(song => [song.id, song]));
    const visible = albumSummary.filter(song => projectText(song.titulo + ' ' + (meta[song.id]?.busqueda_metadata || '')).includes(query));
    $('albumSongs').innerHTML = visible.map((song, index) => `
      <div class="track" role="row">
        <span class="mono muted" role="cell">${song.pista || index + 1}</span>
        <span role="cell" class="track-title"><button class="link strong" onclick="openSong('${song.id}')">${esc(song.titulo)}</button>
          <small>${esc(song.artista)}${song.bpm ? ' · ' + esc(song.bpm) + ' BPM' : ''}${song.tonalidad ? ' · ' + esc(song.tonalidad) : ''}</small></span>
        <span role="cell" class="track-stage"><span class="segments">${STAGE_ORDER.map((key, i) => `<i class="${i <= song.etapa_indice ? 'st-' + key + ' on' : ''}"></i>`).join('')}</span>
          <small>${song.etapa ? 'En ' + esc(stageName(song.etapa).toLowerCase()) : 'Sin material'}</small></span>
        <span role="cell" class="mono">${song.referencia ? esc(song.referencia) + (song.referencia_favorita ? ' <span class="star">★</span>' : '') : '<span class="muted">—</span>'}</span>
        <span role="cell">${song.pendientes ? `<span class="badge">${countLabel(song.pendientes, 'pendiente', 'pendientes')}</span>` : '<span class="muted">Sin pendientes</span>'}</span>
        <span role="cell" class="mono muted right">${esc(song.duracion || '—')}</span>
      </div>`).join('');
    $('albumEmpty').hidden = visible.length > 0;
    $('albumEmpty').textContent = albumSummary.length ? 'No hay canciones que coincidan con la búsqueda.' :
        'Este disco todavía no tiene canciones. Podés agregarlas o incorporar canciones sueltas.';
}

// Reproduce en orden la versión de referencia de cada canción (favorita o última).
async function playAlbumReferences() {
    const queue = albumSummary.filter(song => song.referencia_id);
    if (!queue.length) return;
    let index = 0;
    const audio = transport.audio;
    const playNext = () => {
        if (index >= queue.length || trail.at(-1) !== 'albumPane') return;
        const song = queue[index++];
        audio.src = '/api/produccion/archivo/' + song.referencia_id;
        transport.fileId = null;
        audio.play().catch(() => {});
        document.querySelectorAll('.track').forEach(row => row.classList.toggle('is-playing', row.querySelector(`[onclick="openSong('${song.id}')"]`) !== null));
    };
    audio.onended = playNext;
    playNext();
}
