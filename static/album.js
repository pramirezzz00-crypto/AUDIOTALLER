// Vista exclusiva del disco: la portada pertenece al lanzamiento y el artista
// queda como contexto. No se reutiliza el encabezado del explorador de artistas.
let albumOwner;
let albumOpenSequence = 0;

async function openAlbum(id) {
    const sequence = ++albumOpenSequence;
    const base = await api('/api/discos/' + id);
    const [owner, content] = await Promise.all([
        api('/api/artistas/' + base.artista_id), api('/api/artistas/' + base.artista_id + '/contenido')
    ]);
    if (sequence !== albumOpenSequence) return;
    albumOwner = owner;
    artist = owner;
    projects = content;
    currentAlbum = content.discos.find(album => album.id === id);
    if (!currentAlbum) throw Error('No se encontró el disco.');
    $('albumSearch').value = '';
    go('albumPane');
}

function renderAlbumPage() {
    const album = projects.discos.find(row => row.id === currentAlbum.id);
    if (!album) return;
    currentAlbum = album;
    // Una única ruta; Atrás conserva la pantalla desde la que se abrió el disco.
    $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> ›
        <button onclick="openArtistManager(true)">Producciones</button> › ${esc(album.nombre)}`;
    $('albumHero').innerHTML = `<div class="album-cover">${projectImage(album.portada,'◉')}</div>
      <div class="album-hero-copy"><p class="album-kind">${esc(projectType(album))}</p>
        <h1 id="albumTitle">${esc(album.nombre)}</h1>
        <button class="album-artist-link" onclick="openArtist('${album.artista_id}')">${esc(albumOwner.nombre)}</button>
        <p class="muted">${trackCount(albumTracks(album.id))}${album.lanzamiento ? ' · Lanzamiento: ' + esc(album.lanzamiento) : ''}</p>
      </div>`;
    $('albumActions').innerHTML = `<button class="alt" onclick="projectForm('album','${album.id}')">Editar disco</button>
        <button class="alt" onclick="associateLooseSongs('${album.id}').catch(report)">Incorporar canciones sueltas</button>
        <button class="alt" onclick="publicationDialog('lanzamiento','${album.id}').catch(report)">Ficha de lanzamiento</button>
        <button class="alt" onclick="productionCreditsDialog('disco','${album.id}').catch(report)">Artistas y músicos</button>`;
    $('albumNotes').textContent = album.notas || '';
    renderAlbumSongs();
}

function renderAlbumSongs() {
    const all = albumTracks(currentAlbum.id).slice().sort((a,b) =>
        (a.pista ?? Infinity) - (b.pista ?? Infinity) || a.titulo.localeCompare(b.titulo,'es'));
    const query = projectText($('albumSearch').value.trim());
    const visible = all.map((song,index) => ({song,index})).filter(({song}) => projectText(song.titulo+' '+(song.busqueda_metadata || '')).includes(query));
    $('albumSongsTitle').textContent = 'Canciones (' + all.length + ')';
    $('albumSongs').innerHTML = visible.map(({song,index}) => `<tr>
        <td class="muted">${song.pista || index + 1}</td>
        <td><button class="album-track-title" onclick="openSong('${song.id}')">${esc(song.titulo)}</button></td>
        <td class="muted">${esc(albumOwner.nombre)}</td><td><span class="album-state">${esc(song.estado || 'En producción')}</span></td>
        <td class="muted">${esc(song.duracion || '—')}</td>
        <td><button class="alt" onclick="openSong('${song.id}')" aria-label="Abrir producción de ${esc(song.titulo)}">Abrir producción ›</button></td>
      </tr>`).join('');
    $('albumEmpty').hidden = visible.length > 0;
    $('albumEmpty').textContent = all.length ? 'No hay canciones que coincidan con la búsqueda.' : 'Este disco todavía no tiene canciones. Podés agregarlas o incorporar canciones sueltas.';
}
