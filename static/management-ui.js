// Módulo de personas: las clasificaciones son relaciones, no fichas duplicadas.
let categoryNames = [];
let peopleCache = [];
let activeCategory = '';
let previewPerson;
let previewTab = 'summary';
let globalProductions = {discos: [], canciones: []};

const splitTags = value => [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))];

async function renderCategoryChips() {
    categoryNames = await api('/api/clasificaciones');
    $('categoryChips').innerHTML = ['Todas', ...categoryNames].map(name =>
        `<button class="alt" aria-pressed="${activeCategory === (name === 'Todas' ? '' : name)}">${esc(name)}</button>`).join('') +
        '<button class="alt" id="newCategory">＋ Nueva clasificación</button>';
    // Los nombres creados por el usuario nunca se ejecutan como código.
    const buttons = $('categoryChips').querySelectorAll('button');
    buttons.forEach((button, index) => {
        button.removeAttribute('onclick');
        if (index <= categoryNames.length) button.onclick = () => {
            activeCategory = index === 0 ? '' : categoryNames[index - 1];
            loadLibrary();
        };
    });
    $('newCategory').onclick = () => formDialog('Nueva clasificación',
        '<label>Nombre <input name="nombre" maxlength="80" required></label>', async data => {
            await api('/api/clasificaciones', body(data));
            await loadLibrary();
        });
}

async function setupProfessionalForm(data, extra) {
    categoryNames = await api('/api/clasificaciones');
    const role = extra?.roles[0] || ({Artista:'Solista', Grupo:'Agrupación'}[data.tipo] || data.tipo || 'Solista');
    const names = [...new Set([...categoryNames, role])];
    $('primaryRole').innerHTML = names.map(name => `<option ${name === role ? 'selected' : ''}>${esc(name)}</option>`).join('');
    $('extraRoles').innerHTML = names.map(name => `<option ${extra?.roles.includes(name) ? 'selected' : ''}>${esc(name)}</option>`).join('');
    $('artistForm').elements.instrumentos.value = extra?.instrumentos.join(', ') || '';
    $('artistForm').elements.especialidades.value = extra?.especialidades.join(', ') || '';
}

async function selectPerson(id, tab = 'summary') {
    const [profile, professional, content] = await Promise.all([
        api('/api/artistas/' + id), api('/api/personas/' + id), api('/api/artistas/' + id + '/contenido')
    ]);
    previewPerson = {...profile, ...professional, content};
    previewTab = tab;
    renderPersonPreview();
}

function renderPersonPreview() {
    const person = previewPerson;
    if (!person) return;
    const panel = $('personPreview');
    panel.hidden = false;
    panel.innerHTML = `<div class="heading"><div class="project-art">${projectImage(person.imagen, artistInitials(person.nombre))}</div>
      <h2>${esc(person.nombre)}</h2></div><p class="muted">${esc(person.roles.join(' · '))}</p>
      <div class="row"><button class="alt" onclick="editArtist('${person.id}')">Modificar</button><button class="alt" onclick="openArtist('${person.id}')">Ver ficha</button><button class="alt" onclick="publicationDialog('persona','${person.id}').catch(report)">Identificación profesional</button></div>
      <div class="module-tabs">${[['summary','Resumen'],['projects','Producciones'],['notes','Notas']].map(([key,label]) =>
        `<button class="alt" aria-pressed="${previewTab === key}" onclick="previewTab='${key}'; renderPersonPreview()">${label}</button>`).join('')}
        <button disabled title="En desarrollo">Archivos</button></div><div id="personPreviewContent"></div>`;
    const target = $('personPreviewContent');
    if (previewTab === 'notes') {
        target.textContent = person.perfil.notas || 'Sin notas registradas.';
        return;
    }
    if (previewTab === 'projects') {
        target.innerHTML = `<button onclick="openArtist('${person.id}',true)">Gestionar producciones propias</button><h3>Producciones asociadas</h3>
          <div class="list">${person.content.discos.map(album => `<button class="alt" onclick="openGlobalAlbum('${album.id}','${person.id}')">${esc(album.nombre)}</button>`).join('')}
          ${person.creditos.map(credit => `<p>${esc(credit.nombre)} · ${esc(credit.rol)}</p>`).join('') || ''}</div>
          <button class="alt" onclick="creditDialog()">＋ Asociar participación en producción</button>`;
        return;
    }
    target.innerHTML = `<h3>Contacto</h3><dl>${profileFields([
        ['Correos',person.perfil.correos,'mail'],['Teléfonos',person.perfil.telefonos,'phone'],
        ['Sitio web',person.perfil.web,'web'],['Instrumentos',person.instrumentos.join(', ')],
        ['Especialidades',person.especialidades.join(', ')]
    ])}</dl><div id="previewSocials" class="social-links row"></div>
      <div class="heading"><h3>Participaciones en grupos</h3><button class="alt" onclick="membershipDialog()">＋ Asociar</button></div>
      ${person.participaciones.map((relation,index) => `<div class="item"><div><b>${esc(relation.grupo_id === person.id ? relation.persona : relation.grupo)}</b>
        <p>${esc(relation.funcion)} · ${esc(relation.estado)}</p><small>${esc(relation.desde || 'Sin fecha')} — ${esc(relation.hasta || 'Actualidad')}</small></div>
        <button class="alt" onclick="membershipDialog(${index})">Editar</button></div>`).join('') || '<p class="muted">Sin participaciones registradas.</p>'}`;
    renderSocials($('previewSocials'), person.perfil.redesSociales || []);
}

function optionPeople(people, selected) {
    return people.map(person => `<option value="${person.id}" ${person.id === selected ? 'selected' : ''}>${esc(person.nombre)}</option>`).join('');
}

async function membershipDialog(index) {
    const person = previewPerson;
    const people = await api('/api/personas');
    const relation = Number.isInteger(index) ? person.participaciones[index] : null;
    const groups = people.filter(item => item.roles.some(role => ['Banda','Agrupación'].includes(role)));
    formDialog(relation ? 'Editar participación' : 'Asociar integrante existente',
        `<label>Banda o agrupación<select name="grupo_id" required ${relation ? 'disabled' : ''}>
           ${optionPeople(groups, relation?.grupo_id || person.id)}</select></label>
         <label>Persona<select name="persona_id" required ${relation ? 'disabled' : ''}>
           ${optionPeople(people, relation?.persona_id || (!groups.some(item => item.id === person.id) ? person.id : ''))}</select></label>
         <label>Instrumento o función<input name="funcion" value="${esc(relation?.funcion)}"></label>
         <label>Incorporación<input type="date" name="desde" value="${esc(relation?.desde)}"></label>
         <label>Salida<input type="date" name="hasta" value="${esc(relation?.hasta)}"></label>
         <label>Estado<select name="estado">${['Activo','En pausa','Finalizado'].map(state => `<option ${relation?.estado === state ? 'selected' : ''}>${state}</option>`).join('')}</select></label>`,
        async data => {
            if (relation) Object.assign(data, {id:relation.id, grupo_id:relation.grupo_id, persona_id:relation.persona_id});
            await api('/api/participaciones', body(data));
            await selectPerson(person.id);
        });
}

async function creditDialog() {
    const person = previewPerson;
    const projects = await api('/api/proyectos');
    const targets = [...projects.discos.map(row => ({...row,entity:'disco_id',label:row.nombre})),
        ...projects.canciones.map(row => ({...row,entity:'cancion_id',label:row.titulo}))];
    formDialog('Participación en producción', `<label>Disco o canción<select name="target">
        ${targets.map((row,index) => `<option value="${index}">${esc(row.label)} · ${esc(row.artista)}</option>`).join('')}</select></label>
        <label>Rol o crédito<input name="rol" required></label>`, async data => {
            const target = targets[Number(data.target)];
            if (!target) throw Error('Primero creá una producción.');
            await api('/api/creditos', body({persona_id:person.id, [target.entity]:target.id, rol:data.rol}));
            await selectPerson(person.id, 'projects');
        });
}

// Las pestañas utilizan controles propios, conservando la búsqueda anterior en cada módulo.
async function loadGlobalProjects() {
    globalProductions = await api('/api/proyectos');
    renderGlobalProjects();
}
const productionStates = ['Idea','En preproducción','En producción','Finalizada','En pausa','Sin estado'];
const projectTypesSelected = new Set(['discos','sueltas']);
const projectStatesSelected = new Set(productionStates);

function albumStates(album) {
    const songs=globalProductions.canciones.filter(song=>song.disco_id===album.id);
    return [...new Set(songs.length?songs.map(song=>song.estado || 'En producción'):['Sin estado'])];
}
function renderGlobalProjects() {
    const query=projectText($('globalSearch').value.trim());
    const all=[
        ...globalProductions.discos.map(album=>({...album,entity:'discos',label:album.nombre,states:albumStates(album)})),
        ...globalProductions.canciones.filter(song=>!song.disco_id).map(song=>({...song,entity:'sueltas',label:song.titulo,states:[song.estado || 'En producción']}))
    ];
    const searched=all.filter(item=>projectText([item.label,item.artista,item.busqueda_metadata || '',item.entity==='discos'?projectType(item):'Canción independiente',
        ...globalProductions.canciones.filter(song=>song.disco_id===item.id).map(song=>song.titulo+' '+(song.busqueda_metadata || ''))].join(' ')).includes(query));
    const typeCounts=type=>searched.filter(item=>item.entity===type && item.states.some(state=>projectStatesSelected.has(state))).length;
    $('globalTypeFilters').innerHTML=[['discos','Discos'],['sueltas','Canciones sueltas']].map(([key,label])=>
        `<label class="filter-box"><input type="checkbox" value="${key}" ${projectTypesSelected.has(key)?'checked':''}>
            ${label} (${typeCounts(key)})</label>`).join('');
    $('globalTypeFilters').querySelectorAll('input').forEach(input=>input.onchange=()=>{
        if(input.checked)projectTypesSelected.add(input.value);else projectTypesSelected.delete(input.value);
        renderGlobalProjects();
    });
    const typed=searched.filter(item=>projectTypesSelected.has(item.entity));
    $('globalStateFilters').innerHTML=productionStates.map((state,index)=>
        `<label class="filter-box state-filter state-${index}"><input type="checkbox" value="${index}" ${projectStatesSelected.has(state)?'checked':''}>
            <span class="state-dot"></span>${state} (${typed.filter(item=>item.states.includes(state)).length})</label>`).join('')+
        '<button type="button" class="alt" id="allProjectStates">Todos los estados</button>';
    $('globalStateFilters').querySelectorAll('input').forEach(input=>input.onchange=()=>{
        const state=productionStates[Number(input.value)];
        if(input.checked)projectStatesSelected.add(state);else projectStatesSelected.delete(state);
        renderGlobalProjects();
    });
    $('allProjectStates').onclick=()=>{
        productionStates.forEach(state=>projectStatesSelected.add(state));renderGlobalProjects();
    };
    const visible=typed.filter(item=>item.states.some(state=>projectStatesSelected.has(state)));
    const stateBadges=item=>'<div class="row">'+item.states.map(state=>
        `<small class="state-badge state-${productionStates.indexOf(state)}">${esc(state)}</small>`).join('')+'</div>';
    $('globalCards').innerHTML=visible.map(item=>item.entity==='discos'?
        `<article class="card tile"><button class="artist-open" onclick="openGlobalAlbum('${item.id}','${item.artista_id}')">
          <span class="cover">${projectImage(item.portada,'◉')}</span><span class="tile-body"><strong>${esc(item.nombre)}</strong>
          <span>${esc(item.artista)}</span><small>${esc(projectType(item))} · ${trackCount(item.total)}</small></span></button>
          ${stateBadges(item)}<button class="alt" onclick="editGlobalAlbum('${item.id}','${item.artista_id}')">Editar disco</button></article>`:
        `<article class="card"><h3>♫ ${esc(item.titulo)}</h3><p>${esc(item.artista)} · Canción independiente</p>${stateBadges(item)}
          <button onclick="openSong('${item.id}')">Abrir canción</button></article>`).join('') ||
        '<p class="muted">No hay producciones que coincidan con los filtros seleccionados.</p>';
}
async function openGlobalAlbum(id, owner) {
    await openAlbum(id);
}
async function editGlobalAlbum(id, owner) {
    await openGlobalAlbum(id, owner);
    projectForm('album', id);
}

// Diálogo compartido por relaciones, sesiones y metadatos. Cancelar no altera registros.
let dialogDirty = false;
let iterationBusy = false;
function formDialog(title, fields, save, prepare) {
    const dialog = $('iterationDialog');
    $('iterationTitle').textContent = title;
    $('iterationSubmit').textContent = 'Guardar';
    $('iterationSubmit').hidden = false;
    $('iterationFields').innerHTML = fields;
    $('iterationError').textContent = '';
    dialogDirty = false;
    const form = $('iterationForm');
    form.oninput = () => { dialogDirty = true; };
    form.onsubmit = async event => {
        event.preventDefault();
        if (iterationBusy) return;
        iterationBusy = true;
        $('iterationSubmit').disabled = true;
        try {
            await save(Object.fromEntries(new FormData(form)));
            dialogDirty = false;
            dialog.close();
        } catch (error) {
            $('iterationError').textContent = error.message;
        } finally {
            iterationBusy = false;
            $('iterationSubmit').disabled = false;
        }
    };
    if (prepare) prepare(form);
    dialog.showModal();
}
function closeIterationDialog() {
    if (iterationBusy) { $('iterationError').textContent = 'Hay una operación en curso. Esperá a que termine para cerrar.'; return; }
    if (!dialogDirty || confirm('Hay cambios sin guardar. ¿Querés descartarlos?')) {
        dialogDirty = false;
        $('iterationDialog').close();
    }
}
$('iterationDialog').addEventListener('cancel', event => {
    event.preventDefault();
    closeIterationDialog();
});
