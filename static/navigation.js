async function openAlbum(id){currentAlbum=await api('/api/discos/'+id);$('albumTitle').textContent='💿 '+currentAlbum.nombre;go('albumPane');let ss=await api('/api/discos/'+id+'/canciones');$('albumSongs').innerHTML=ss.map(songRow).join('')||'<p class="muted">Disco vacío.</p>'}function songRow(s){return `<div class="item"><b>♫ ${esc(s.titulo)}</b><button onclick="openSong('${s.id}')">Producción</button></div>`}async function openSong(id){currentSong=await api('/api/canciones/'+id);$('songHeading').textContent=currentSong.titulo;go('songPane');let stages=await api('/api/canciones/'+id+'/etapas');$('stages').innerHTML=stages.map(s=>`<div class="card"><h3>${esc(s.etapa)}</h3><div class="row"><button onclick="newSession('${s.etapa}')">Nueva sesión</button></div><label class="drop-zone" data-attachment="${s.adjuntos}">Arrastrá archivos acá o elegilos<input type="file" multiple><span class="file-status" role="status"></span></label><div class="list">${s.sesiones.map(x=>`<div class="item"><div><b>${esc(x.daw||'Archivo')}</b><div class="muted">${esc(x.ruta)} ${esc(x.comentario)}</div></div><button class="alt" onclick="version('${x.id}')">Nueva versión</button></div>`).join('')}</div></div>`).join(''); bindAttachments(id)}async function newSession(stage){let daw=prompt('DAW (Cubase, REAPER, WaveLab u otro)');if(!daw)return;let path=prompt('Ubicación de carpeta de sesión. Dejá vacío para crearla dentro del artista.','');let comment=prompt('Notas o cambios iniciales:')||'';try{await api('/api/canciones/'+currentSong.id+'/sesiones',body({etapa:stage,daw,ruta:path,comentario:comment}));openSong(currentSong.id)}catch(e){alert(e.message)}}async function version(id){let comentario=prompt('Describe los cambios de esta versión:')||'';try{await api('/api/sesiones/'+id+'/versiones',body({comentario}));openSong(currentSong.id)}catch(e){alert(e.message)}}
const $ = id => document.getElementById(id);
let artist, currentAlbum, currentSong, editing, photo, selectedPhoto;
let previewUrl;
const pages = ['home', 'manager', 'profile', 'editor', 'artistPane', 'albumPane', 'songPane', 'arrangements'];
const trail = ['home'];
function display() {
    const page = trail.at(-1);
    const visible = page === 'projectManager' ? 'manager' : page;
    pages.forEach(id => { $(id).hidden = id !== visible; });
    $('nav').hidden = page === 'home';
    $('sideHome').setAttribute('aria-current', page === 'home' ? 'page' : 'false');
    $('sideArtists').setAttribute('aria-current', ['home', 'arrangements'].includes(page) ? 'false' : 'page');
    $('sideArrangements').setAttribute('aria-current', page === 'arrangements' ? 'page' : 'false');
    if (page !== 'arrangements') $('takePlayer').pause();
    const projectPath = trail.includes('projectManager');
    const manager = projectPath ? 'Gestión de proyectos' : 'Gestión de artistas';
    const artistLabel = ['profile', 'artistPane', 'editor', 'songPane'].includes(page) && artist ? ' › ' + esc(artist.nombre) : '';
    $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> › <button onclick="openArtistManager(${projectPath})">${manager}</button>${artistLabel}`;
    if (page === 'arrangements') $('crumbPath').innerHTML = '<button onclick="go(\'home\')">Inicio</button> › Arreglos';
    $('error').textContent = '';
    window.scrollTo(0, 0);
    if (page === 'profile' && artist) renderProfile();
    if (visible === 'manager') {
        const projects = page === 'projectManager';
        $('managerTitle').textContent = projects ? 'Gestión de proyectos por artistas' : 'Gestión de artistas';
        $('managerDescription').textContent = projects ? 'Elegí un artista para gestionar sus discos y canciones.' : 'Buscá un artista para consultar o modificar su ficha.';
        loadLibrary();
    }
}
function go(page) {
    if (page === 'home') trail.splice(1);
    else if (trail.at(-1) !== page) trail.push(page);
    display();
}
function back() {
    if (trail.length > 1) trail.pop();
    display();
}
async function api(url, options = {}) {
    const response = await fetch(url, {headers: {'Content-Type': 'application/json'}, ...options});
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw Error(error.error || 'No se pudo completar la operación.');
    }
    return response.json();
}
const body = data => ({method: 'POST', body: JSON.stringify(data)});
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));
function report(error) { $('error').textContent = error.message; }
window.addEventListener('unhandledrejection', event => report(event.reason));
// El modo de vista se conserva mientras la ventana está abierta.
let compactArtists = false;
let searchSequence = 0;
function openArtistManager(projects = false) {
    trail.splice(1);
    go(projects ? 'projectManager' : 'manager');
}
function setArtistView(compact) {
    compactArtists = compact;
    $('library').classList.toggle('compact', compact);
    $('artistGrid').setAttribute('aria-pressed', !compact);
    $('artistList').setAttribute('aria-pressed', compact);
}
function artistInitials(name) {
    return esc(name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase());
}
function artistTotals(row) {
    return countLabel(row.discos ?? 0, 'disco', 'discos') + ' · ' + countLabel(row.canciones ?? 0, 'canción', 'canciones');
}
async function loadLibrary() {
    const sequence = ++searchSequence;
    const page = trail.at(-1);
    const projects = page === 'projectManager';
    const query = $('query').value.trim();
    $('query').placeholder = projects ? 'Buscar artista, disco o canción…' : 'Buscar artista, grupo o banda…';
    try {
        let rows = await api('/api/biblioteca?q=' + encodeURIComponent(projects ? query : ''));
        if (sequence !== searchSequence || page !== trail.at(-1)) return;
        const hasArtists = rows.length > 0;
        if (!projects) rows = rows.filter(row => projectText(row.nombre).includes(projectText(query)));
        rows = rows.filter(row => !$('typeFilter').value || row.tipo === $('typeFilter').value);
        const order = $('sort').value;
        rows.sort((a, b) => {
            const name = a.nombre.localeCompare(b.nombre, 'es');
            const date = (a.creado || '').localeCompare(b.creado || '');
            return order === 'new' ? -date || name : order === 'old' ? date || name : order === 'desc' ? -name : name;
        });
        setArtistView(compactArtists);
        $('library').innerHTML = rows.map(row => `
            <article class="card tile artist-tile">
              <button class="artist-open" onclick="openArtist('${row.id}', ${projects})">
                <span class="cover">${projectImage(row.imagen, artistInitials(row.nombre))}</span>
                <span class="tile-body"><strong>${esc(row.nombre)}</strong><span class="muted">${esc(row.tipo)}</span><small>${artistTotals(row)}</small></span>
              </button>
              <details><summary aria-label="Opciones de ${esc(row.nombre)}">•••</summary>
                <button class="alt" onclick="editArtist('${row.id}')">Editar artista</button>
                <button class="alt" onclick="openArtist('${row.id}', ${!projects})">${projects ? 'Ver ficha' : 'Ver proyectos'}</button>
              </details>
            </article>`).join('') +
            '<button class="card artist-new" onclick="editArtist()"><span>＋</span>Nuevo artista</button>';
        $('count').textContent = rows.length ? countLabel(rows.length, 'artista', 'artistas') :
            !hasArtists && !query ? 'Todavía no registraste artistas. Creá el primero para comenzar.' : 'No hay artistas que coincidan.';
    } catch (error) { report(error); }
}
async function openArtist(id, projects = false) {
    artist = await api('/api/artistas/' + id);
    if (!projects) {
        renderProfile();
        go('profile');
        return;
    }
    $('artistName').textContent = artist.nombre;
    renderArtistSocials();
    go('artistPane');
    await loadProjects(true);
}
function addMember(member = {}) {
    const block = document.createElement('fieldset');
    block.innerHTML = ['nombre','rol','telefono','correo'].map((key, i) =>
        `<label>${['Nombre','Rol o instrumento','Teléfono','Correo'][i]}<input data-key="${key}" value="${esc(member[key])}"></label>`
    ).join('') + '<button type="button" class="alt">Quitar integrante</button>';
    block.querySelector('button').onclick = () => block.remove();
    $('members').append(block);
}
async function editArtist(id, addContact = false) {
    const data = id ? await api('/api/artistas/' + id) : {};
    editing = id;
    photo = data.imagen || '';
    selectedPhoto = null;
    $('photoStatus').textContent = '';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $('artistForm').reset();
    $('members').replaceChildren();
    const {integrantes = [], redesSociales = [], ...profile} = data.perfil || {};
    for (const [key, value] of Object.entries({...profile, nombre: data.nombre || '', tipo: data.tipo || 'Artista'})) {
        const field = $('artistForm').elements.namedItem(key);
        if (field) field.value = value;
    }
    integrantes.forEach(addMember);
    $('legacySocial').hidden = !profile.redes;
    $('socialRows').replaceChildren();
    socialAccounts = [...redesSociales];
    renderSocials($('savedSocials'), socialAccounts, true);
    setupSocialInput();
    $('preview').hidden = !photo;
    if (photo) $('preview').src = photo;
    $('formTitle').textContent = id ? 'Editar artista' : 'Nuevo artista, grupo o banda';
    go('editor');
    if (addContact) {
        addMember();
        $('members').lastElementChild.querySelector('input').focus();
    }
}
async function saveArtist(event) {
    event.preventDefault();
    const button = $('save');
    button.disabled = true;
    try {
        const {nombre, tipo, ...perfil} = Object.fromEntries(new FormData(event.target));
        perfil.integrantes = [...$('members').children].map(block =>
            Object.fromEntries([...block.querySelectorAll('input')].map(input => [input.dataset.key,input.value.trim()]))
        ).filter(member => Object.values(member).some(Boolean));
        if ($('socialUser').value.trim() && !confirmSocial()) return;
        perfil.redesSociales = socialAccounts;
        const file = selectedPhoto;
        if (file) {
            if (file.size > 2 * 1024 * 1024 || !['image/png','image/jpeg'].includes(file.type)) {
                throw Error('Elegí una imagen JPG o PNG de hasta 2 MB.');
            }
            photo = await new Promise((resolve,reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }
        await api('/api/artistas' + (editing ? '/' + editing : ''), body({nombre,tipo,perfil,imagen:photo}));
        if (editing) {
            if (artist?.id === editing) {
                artist = {...artist, nombre: nombre.trim(), tipo, perfil, imagen: photo};
                $('artistName').textContent = nombre;
                renderArtistSocials();
                renderProfile();
                if (trail.at(-2) === 'artistPane') await loadProjects();
            }
            back();
        } else {
            if (['manager', 'projectManager'].includes(trail.at(-2))) back();
            else { trail.pop(); go('manager'); }
        }
    } catch (error) { report(error); }
    finally { button.disabled = false; }
}
display();

function fileDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
}

// Impide que WebView abra un archivo soltado fuera de una zona.
for (const name of ['dragover', 'drop']) {
    window.addEventListener(name, event => {
        if (fileDrag(event)) event.preventDefault();
    });
}

function bindDropZone(zone, receive) {
    const input = zone.querySelector('input');
    input.addEventListener('change', () => {
        const files = Array.from(input.files);
        input.value = '';
        if (files.length) receive(files);
    });
    zone.addEventListener('dragover', event => {
        if (!fileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        zone.classList.add('is-dragging');
    });
    zone.addEventListener('dragleave', event => {
        if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-dragging');
    });
    zone.addEventListener('drop', event => {
        if (!fileDrag(event)) return;
        event.preventDefault();
        zone.classList.remove('is-dragging');
        const files = Array.from(event.dataTransfer.files);
        if (files.length) receive(files);
    });
}

bindDropZone($('photoZone'), files => {
    const [file] = files;
    if (files.length !== 1 || file.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(file.type)) {
        $('photoStatus').textContent = 'Elegí una sola imagen JPG o PNG de hasta 2 MB.';
        return;
    }
    selectedPhoto = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    $('preview').src = previewUrl;
    $('preview').hidden = false;
    $('photoStatus').textContent = file.name;
});

function bindAttachments(songId) {
    for (const zone of document.querySelectorAll('[data-attachment]')) {
        const status = zone.querySelector('[role="status"]');
        const url = '/api/canciones/' + songId + '/adjuntos/' + zone.dataset.attachment;
        let pending = Promise.resolve();
        bindDropZone(zone, files => {
            pending = pending.then(async () => {
                status.textContent = 'Guardando archivos…';
                const saved = [];
                const failed = [];
                for (const file of files) {
                    const form = new FormData();
                    form.append('file', file);
                    try {
                        const response = await fetch(url, {method: 'POST', body: form});
                        if (!response.ok) throw Error();
                        saved.push(file.name);
                    } catch {
                        failed.push(file.name);
                    }
                }
                status.textContent = [
                    saved.length ? 'Guardados: ' + saved.join(', ') : '',
                    failed.length ? 'No se pudieron guardar: ' + failed.join(', ') : ''
                ].filter(Boolean).join(' · ');
            });
        });
    }
}

const socialNetworks = new Map([
    ['Instagram', ['https://www.instagram.com/', '@']],
    ['TikTok', ['https://www.tiktok.com/@', '@']],
    ['YouTube', ['https://www.youtube.com/@', '@']],
    ['Facebook', ['https://www.facebook.com/', '@']],
    ['X', ['https://x.com/', '@']],
    ['SoundCloud', ['https://soundcloud.com/', '@']],
    ['Bandcamp', ['https://', '', '.bandcamp.com']]
]);

function socialUrl(red, value) {
    const network = socialNetworks.get(red);
    const user = value.trim().replace(/^@/, '');
    if (!network || !/^[a-z0-9_.-]+$/i.test(user) || /^\.+$/.test(user)) return '';
    const [base, , suffix = ''] = network;
    if (suffix && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(user)) return '';
    return base + encodeURIComponent(user) + suffix;
}


const socialIcons = {
    Instagram: ['#a62d69', '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.2"/>'],
    TikTok: ['#121212', '<path d="M14 3h3c.4 2.2 1.7 3.5 4 3.8v3a8 8 0 0 1-4-1.4v7.1a5.5 5.5 0 1 1-5.5-5.5v3a2.5 2.5 0 1 0 2.5 2.5z"/>'],
    YouTube: ['#cf1414', '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 8 6 4-6 4z" fill="#cf1414"/>'],
    Facebook: ['#1765ce', '<path d="M14 22v-9h3l.5-3H14V8c0-1 .4-2 2-2h2V3h-3c-3 0-5 2-5 5v2H7v3h3v9z"/>'],
    X: ['#101010', '<path d="M4 3h5l4 6 5-6h2l-6 7 7 11h-5l-5-7-6 7H3l7-8zm3 2 10 14h1L8 5z"/>'],
    SoundCloud: ['#b94408', '<path d="M10 16V7a5 5 0 0 1 8 3 3 3 0 1 1 1 6zM7 8h2v8H7zm-3 2h2v6H4zm-3 2h2v3H1z"/>'],
    Bandcamp: ['#216a80', '<path d="M7 6h15l-5 12H2z"/>']
};
let socialAccounts = [];

function setupSocialInput() {
    $('socialRows').innerHTML = `
        <label>Red social<select id="socialNetwork">${[...socialNetworks.keys()].map(name => `<option>${name}</option>`).join('')}</select></label>
        <label>Usuario<input id="socialUser" autocomplete="off"></label>
        <button type="button" class="alt" onclick="confirmSocial()">＋ Agregar</button>`;
    const network = $('socialNetwork');
    const user = $('socialUser');
    const updatePlaceholder = () => { user.placeholder = socialNetworks.get(network.value)[1] + 'usuario'; };
    network.addEventListener('change', updatePlaceholder);
    user.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        confirmSocial();
    });
    updatePlaceholder();
}

function confirmSocial() {
    const red = $('socialNetwork').value;
    const input = $('socialUser');
    const usuario = input.value.trim();
    const url = socialUrl(red, usuario);
    if (!url) {
        report(Error('Ingresá un usuario válido para ' + red + '.'));
        input.focus();
        return false;
    }
    if (!socialAccounts.some(account => socialUrl(account.red, account.usuario) === url)) {
        socialAccounts.push({red, usuario});
    }
    input.value = '';
    $('error').textContent = '';
    renderSocials($('savedSocials'), socialAccounts, true);
    return true;
}

function renderSocials(container, accounts, editable = false) {
    container.replaceChildren();
    accounts.forEach(({red, usuario}, index) => {
        const url = socialUrl(red, usuario);
        if (!url) return;
        const [color, icon] = socialIcons[red];
        const badge = document.createElement('span');
        badge.className = 'social-badge';
        const link = document.createElement('a');
        link.className = 'social-icon';
        link.style.setProperty('--brand', color);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = red + ' · ' + usuario;
        link.setAttribute('aria-label', 'Abrir ' + link.title);
        link.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${icon}</svg>`;
        badge.append(link);
        if (editable) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'alt';
            remove.textContent = '×';
            remove.setAttribute('aria-label', 'Quitar ' + link.title);
            remove.onclick = () => {
                accounts.splice(index, 1);
                renderSocials(container, accounts, true);
            };
            badge.append(remove);
        }
        container.append(badge);
    });
}

function renderArtistSocials() {
    renderSocials($('artistSocials'), artist.perfil?.redesSociales || []);
}

async function openProjectFromProfile(kind) {
    await openArtist(artist.id, true);
    projectForm(kind);
}

// Solo los correos, números internacionales y URL web reconocibles se convierten en enlaces.
function contactMarkup(value, kind) {
    return String(value || '').split(/[,;\n]+/).filter(part => part.trim()).map(part => {
        const label = part.trim();
        let url;
        if (kind === 'mail' && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(label)) url = 'mailto:' + label;
        if (kind === 'phone' && /^\+[0-9 ()-]+$/.test(label)) {
            const digits = label.replace(/\D/g, '');
            if (/^[1-9][0-9]{7,14}$/.test(digits)) url = 'https://wa.me/' + digits;
        }
        if (kind === 'web' && /^https?:\/\//i.test(label)) {
            try { url = new URL(label).href; } catch { /* Mostrar el texto original. */ }
        }
        return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
    }).join('<br>');
}

function profileFields(fields) {
    return fields.map(([label, value, kind]) => `<div><dt>${label}</dt><dd>${(kind ? contactMarkup(value, kind) : esc(value)) || '—'}</dd></div>`).join('');
}

function renderProfile() {
    const profile = artist.perfil || {};
    $('profileName').textContent = artist.nombre;
    $('profileCounts').textContent = artist.tipo + ' · ' + artistTotals(artist);
    $('profileAvatar').innerHTML = projectImage(artist.imagen, artistInitials(artist.nombre));
    $('profileImage').hidden = !artist.imagen;
    if (artist.imagen) $('profileImage').src = artist.imagen;
    $('profileMain').innerHTML = profileFields([
        ['Tipo', artist.tipo], ['Formación', profile.formacion],
        ['Año de inicio', profile.anio], ['Estado', profile.estado]
    ]);
    $('profileContact').innerHTML = profileFields([
        ['Correos', profile.correos, 'mail'], ['Teléfonos / WhatsApp', profile.telefonos, 'phone'],
        ['Sitio web', profile.web, 'web'], ['Redes guardadas como texto', profile.redes], ['Notas', profile.notas]
    ]);
    $('profileMembers').innerHTML = (profile.integrantes || []).map(member => `
        <fieldset><legend>${esc(member.nombre || 'Integrante')}</legend><dl>${profileFields([
            ['Rol o instrumento', member.rol], ['Teléfono', member.telefono, 'phone'], ['Correo', member.correo, 'mail']
        ])}</dl></fieldset>`
    ).join('') || '<p class="muted">Sin integrantes registrados.</p>';
    renderSocials($('profileSocials'), profile.redesSociales || []);
}
