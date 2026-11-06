let projects = {discos: [], canciones: [], sueltas: []};
let selectedProject;
let projectMode = 'grid';
let projectRequest = 0;

async function loadProjects(reset = false, selection) {
    const request = ++projectRequest;
    const owner = artist;
    const content = await api('/api/artistas/' + owner.id + '/contenido');
    if (request !== projectRequest || artist.id !== owner.id) return;
    projects = content;
    artist.discos = content.discos.length;
    artist.canciones = content.canciones.length;
    if (reset || selection !== undefined) {
        $('projectSearch').value = '';
        $('projectType').value = '';
        selectedProject = selection ?? null;
    }
    $('artistName').textContent = owner.nombre;
    $('projectArtistCrumb').textContent = owner.nombre;
    $('projectArtistCover').innerHTML = projectImage(owner.imagen, '♫');
    $('projectSearch').placeholder = 'Buscar en los proyectos de ' + owner.nombre + '…';
    $('projectCounts').textContent = owner.tipo + ' · ' + countLabel(projects.discos.length, 'disco', 'discos') + ' · ' +
        countLabel(projects.canciones.length, 'canción', 'canciones');
    renderProjects();
}

const countLabel = (count, singular, plural) => count + ' ' + (count === 1 ? singular : plural);
const projectImage = (url, fallback) => /^data:image\/(png|jpeg);base64,/.test(url || '') ?
    `<img src="${esc(url)}" alt="">` : fallback;
const projectType = album => album.tipo || 'Álbum';
const projectText = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const albumTracks = id => projects.canciones.filter(song => song.disco_id === id);
const trackCount = songs => countLabel(Array.isArray(songs) ? songs.length : songs, 'canción', 'canciones');

function selectProject(id) {
    selectedProject = id;
    renderProjects();
}

function renderProjects() {
    const query = projectText($('projectSearch').value.trim());
    const filter = $('projectType').value;
    const order = $('projectOrder').value;
    const matches = song => projectText(song.titulo).includes(query);
    const albums = projects.discos.filter(album => filter !== 'loose' && (!filter || projectType(album) === filter) &&
        (projectText(album.nombre).includes(query) || albumTracks(album.id).some(matches)));
    albums.sort((a, b) => (order === 'nombre' ? 0 : (b[order] || '').localeCompare(a[order] || '')) ||
        a.nombre.localeCompare(b.nombre, 'es'));
    const loose = (!filter || filter === 'loose') ? projects.sueltas.filter(matches) : [];
    if (!albums.some(album => album.id === selectedProject) && !(selectedProject === 'loose' && loose.length)) {
        selectedProject = albums[0]?.id ?? (loose.length ? 'loose' : null);
    }
    $('projectGrid').setAttribute('aria-pressed', projectMode === 'grid');
    $('projectList').setAttribute('aria-pressed', projectMode === 'list');
    $('projectTiles').innerHTML = `<div class="project-tiles ${projectMode === 'list' ? 'list-mode' : ''}">
        ${albums.map(album => `<article class="project-tile ${album.id === selectedProject ? 'selected' : ''}">
            <button class="project-select" aria-pressed="${album.id === selectedProject}" onclick="selectProject('${album.id}')">
              <span class="project-art">${projectImage(album.portada, '◉')}</span><span><strong>${esc(album.nombre)}</strong></span>
              <span class="muted">${esc(projectType(album))} · ${trackCount(albumTracks(album.id))}</span>
            </button><details><summary aria-label="Opciones del disco">⋯</summary>
              <button class="alt" onclick="projectForm('album', '${album.id}')">Editar disco</button></details>
        </article>`).join('')}</div>
        ${loose.length ? `<h3 class="project-subhead">Canciones independientes</h3>
          <button class="alt" aria-pressed="${selectedProject === 'loose'}" onclick="selectProject('loose')">♫ ${trackCount(loose)} · Ver canciones</button>` : ''}
        ${!albums.length && !loose.length ? '<p class="muted">No hay proyectos que coincidan.</p>' : ''}`;
    const album = albums.find(item => item.id === selectedProject);
    const allSongs = album ? albumTracks(album.id) : loose;
    const songs = album && query && !projectText(album.nombre).includes(query) ? allSongs.filter(matches) : allSongs;
    songs.sort((a,b) => (a.pista ?? Infinity) - (b.pista ?? Infinity) || a.titulo.localeCompare(b.titulo, 'es'));
    renderProjectDetail(album, songs, allSongs.length);
}

function renderProjectDetail(album, songs, total) {
    const panel = $('projectDetail');
    if (!selectedProject) {
        panel.innerHTML = '<h2>Proyectos del artista</h2><p class="muted">Seleccioná un disco o creá un proyecto para empezar.</p>';
        return;
    }
    const date = value => value ? esc(value.slice(0, 10)) : 'Sin registro';
    panel.innerHTML = `<div class="heading">
      ${album ? `<div class="project-art">${projectImage(album.portada, '◉')}</div>` : ''}
      <div><h2>${esc(album?.nombre || 'Canciones independientes')}</h2>
      <p class="muted">${album ? esc(projectType(album)) + ' · ' : ''}${trackCount(total)}</p>
      ${album ? `<p class="muted">Creado: ${date(album.creado)} · Última edición: ${date(album.actualizado)}</p>` : ''}</div>
      ${album ? `<button class="alt" onclick="projectForm('album', '${album.id}')">Editar disco</button>` : ''}
    </div>
    ${album?.lanzamiento ? `<p>Lanzamiento previsto: ${esc(album.lanzamiento)}</p>` : ''}
    ${album?.notas ? `<p>${esc(album.notas)}</p>` : ''}
    <div class="heading"><h3>♫ Canciones (${songs.length})</h3><button class="alt" onclick="projectForm('song', '${album?.id || ''}')">＋ Agregar canción</button></div>
    <div class="list">${songs.map(song => `<button class="alt project-track" onclick="openSong('${song.id}')">
      <span>${song.pista ? String(song.pista).padStart(2, '0') : '—'}</span><span>${esc(song.titulo)}</span>
      <span class="muted">${esc(song.estado || 'En producción')}<small>${esc(song.actualizado || '')}</small></span>
      ${song.duracion ? `<span>${esc(song.duracion)}</span>` : ''}<span title="Abrir producción">›</span></button>`).join('') ||
      '<p class="muted">Todavía no hay canciones.</p>'}</div>`;
}

function projectForm(kind, id = '') {
    const ownerId = artist.id;
    const isAlbum = kind === 'album';
    const album = isAlbum ? projects.discos.find(item => item.id === id) : null;
    const dialog = $('projectDialog');
    $('projectFormTitle').textContent = isAlbum ? (album ? 'Editar disco' : 'Generar nuevo disco') : 'Generar nueva canción';
    $('projectFormError').textContent = '';
    $('projectFormFields').innerHTML = isAlbum ? `
        <label>Nombre <input name="nombre" required maxlength="150" value="${esc(album?.nombre)}"></label>
        <label>Tipo <select name="tipo">${['Álbum', 'EP', 'Single'].map(type => `<option ${type === album?.tipo ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
        <label class="drop-zone" id="coverDrop">Arrastrá o elegí una portada JPG o PNG (hasta 2 MB)<input type="file" accept="image/jpeg,image/png"><span role="status"></span></label>
        <label>Lanzamiento previsto <input type="date" name="lanzamiento" value="${esc(album?.lanzamiento)}"></label>
        <label>Notas <textarea name="notas">${esc(album?.notas)}</textarea></label>` : `
        <label>Título <input name="titulo" required maxlength="150"></label>
        <label>Proyecto <select name="disco_id"><option value="">Canción independiente</option>${projects.discos.map(item =>
            `<option value="${item.id}" ${item.id === id ? 'selected' : ''}>${esc(item.nombre)}</option>`).join('')}</select></label>
        <label id="trackField">Número de pista <input name="pista" type="number" min="1" max="99999"></label>
        <label>BPM <input name="bpm" type="number" min="1" step="any"></label>
        <label>Tonalidad <input name="tonalidad"></label>
        <label>Notas <textarea name="metadata"></textarea></label>`;
    let cover;
    const form = $('projectForm');
    if (isAlbum) {
        bindDropZone($('coverDrop'), files => {
            const status = $('coverDrop').querySelector('[role=status]');
            if (files.length !== 1 || !['image/jpeg','image/png'].includes(files[0].type) || files[0].size > 2 * 1024 * 1024) {
                status.textContent = 'Elegí una sola imagen JPG o PNG de hasta 2 MB.';
                return;
            }
            cover = files[0];
            status.textContent = cover.name;
        });
    } else {
        const project = form.elements.disco_id;
        const toggleTrack = () => {
            $('trackField').hidden = !project.value;
            form.elements.pista.disabled = !project.value;
        };
        project.onchange = toggleTrack;
        toggleTrack();
    }
    form.onsubmit = async event => {
        event.preventDefault();
        const submit = form.querySelector('button:not([type])');
        submit.disabled = true;
        try {
            const data = Object.fromEntries(new FormData(form));
            if (isAlbum) data.portada = cover ? await readProjectCover(cover) : (album?.portada || '');
            const endpoint = isAlbum ? '/discos' + (album ? '/' + album.id : '') : '/canciones';
            const result = await api('/api/artistas/' + ownerId + endpoint, body(data));
            dialog.close();
            await loadProjects(false, isAlbum ? result.id : (data.disco_id || 'loose'));
        } catch (error) {
            if (dialog.open) $('projectFormError').textContent = error.message;
            else report(error);
        } finally {
            submit.disabled = false;
        }
    };
    dialog.showModal();
}

function readProjectCover(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('No se pudo leer la portada.'));
        reader.readAsDataURL(file);
    });
}

$('projectSearch').oninput = renderProjects;
$('projectType').onchange = renderProjects;
$('projectOrder').onchange = renderProjects;
$('projectGrid').onclick = () => { projectMode = 'grid'; renderProjects(); };
$('projectList').onclick = () => { projectMode = 'list'; renderProjects(); };
