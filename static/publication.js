// La biblioteca de personas es común a artistas, músicos y técnicos. Seleccionar
// un crédito no duplica su ficha y no altera sus participaciones en otras obras.
function collaboratorFields(people) {
    return `<details><summary>Artistas, músicos y equipo participante (opcional)</summary>
      <p class="muted">El artista principal ya queda vinculado. Seleccioná participantes y especificá su rol.</p>
      ${people.map(person => `<div class="credit-choice"><label><input type="checkbox" data-person="${person.id}">
        ${esc(person.nombre)}</label><input data-role="${person.id}" maxlength="150" placeholder="Rol: guitarra, autor, mezcla…" aria-label="Rol de ${esc(person.nombre)}"></div>`).join('')}</details>`;
}
function readCollaborators(form) {
    return [...form.querySelectorAll('[data-person]:checked')].map(input => ({persona_id:input.dataset.person,
        rol:form.querySelector(`[data-role="${input.dataset.person}"]`).value.trim()}));
}
function looseSongFields(songs) {
    return `<fieldset><legend>Incorporar canciones sueltas</legend><p class="muted">Conservan archivos, sesiones y créditos. Dejan de aparecer como sueltas.</p>
        ${songs.map(song => `<label class="filter-box"><input type="checkbox" data-loose value="${song.id}">${esc(song.titulo)}</label>`).join('') || '<p>No hay canciones sueltas de este artista.</p>'}</fieldset>`;
}
async function newGlobalProject(kind) {
    const people = await api('/api/personas');
    if (!people.length) { editArtist(); return; }
    formDialog(kind === 'album' ? 'Nuevo disco · Artista principal' : 'Nueva canción suelta · Artista principal',
        `<p>Elegí el artista, banda o grupo responsable. Luego podrás agregar músicos y otros créditos.</p>
        <label>Artista principal<select name="owner" required>${optionPeople(people)}</select></label>`, async data => {
            await openArtist(data.owner, true);
            // El segundo formulario se abre al cerrar el primero, nunca superpuesto.
            $('iterationDialog').addEventListener('close', () => projectForm(kind).catch(report), {once:true});
        });
}
async function associateLooseSongs(id) {
    const album = projects.discos.find(row => row.id === id);
    formDialog('Incorporar canciones a ' + album.nombre, looseSongFields(projects.sueltas), async () => {
        const ids = [...$('iterationForm').querySelectorAll('[data-loose]:checked')].map(input => input.value);
        if (!ids.length) throw Error('Seleccioná al menos una canción.');
        await api('/api/discos/' + id + '/incorporar-canciones', body({canciones:ids}));
        await loadProjects(false, id);
    });
}

// Cada rubro tiene sus propios identificadores; todos se guardan como texto
// para conservar ceros iniciales. No se generan códigos de organismos externos.
const publicationFields = {
    persona:[['nombre_legal','Nombre legal'],['ipn','IPN · intérprete'],['ipi','IPI Name / CAE · 11 dígitos'],
        ['isni','ISNI'],['sociedad_autores','Sociedad de autores (ej. SADAIC)'],
        ['sociedad_interpretes','Sociedad de intérpretes (ej. AADI)'],['numero_socio','Número de socio / referencia local'],['pais','País'],['notas','Notas']],
    obra:[['titulo_original','Título original / alternativo'],['iswc','ISWC · obra musical'],['idioma','Idioma'],['genero','Género'],
        ['editorial','Editorial / administrador'],['sociedad','Sociedad de registro'],['registro_local','Registro local / expediente'],
        ['copyright','© Titular y año de la obra'],['notas','Notas editoriales']],
    lanzamiento:[['upc_ean','UPC / EAN · lanzamiento'],['sello','Sello'],['catalogo','Número de catálogo'],['distribuidora','Distribuidora'],
        ['fecha_lanzamiento','Fecha de lanzamiento','date'],['territorios','Territorios'],['copyright','© Titular y año del lanzamiento'],['notas','Notas de publicación']]
};
const recordingFields = [['nombre','Nombre de la grabación'],['version','Versión (estudio, vivo, remix…)'],['isrc','ISRC · grabación'],
    ['titular_master','℗ Titular del máster / fonograma'],['anio_fonograma','Año del fonograma'],['fecha_grabacion','Fecha de grabación','date'],
    ['idioma','Idioma'],['explicito','Contenido explícito (Sí / No / Sin definir)'],['notas','Notas']];
function publicationInputs(fields, data = {}) {
    return fields.map(([key,label,type]) => `<label>${label}${key === 'notas' ?
        `<textarea name="${key}" maxlength="10000">${esc(data[key])}</textarea>` :
        `<input name="${key}" type="${type || 'text'}" maxlength="1000" value="${esc(data[key])}">`}</label>`).join('');
}
async function publicationDialog(kind, id) {
    const saved = await api('/api/registro/' + kind + '/' + id);
    let editing = false;
    formDialog('Ficha de ' + ({persona:'identificación profesional',obra:'obra y grabaciones',lanzamiento:'lanzamiento'}[kind]),
        `<p class="muted">Datos opcionales. Se registran códigos ya asignados; no se generan ni verifican ante organismos.</p>
        <button type="button" class="alt" id="modifyPublication">Modificar</button>
        <fieldset id="publicationMain" disabled>${publicationInputs(publicationFields[kind], saved.datos)}</fieldset>
        ${kind === 'obra' ? '<h3>Grabaciones publicables</h3><p class="muted">Cada grabación o remix puede tener su propio ISRC. No son versiones de sesiones del DAW.</p><div id="publicationRecordings"></div><button type="button" class="alt" id="addRecording" hidden>＋ Agregar grabación</button>' : ''}`,
        async () => {
            if (!editing) return;
            const datos = Object.fromEntries([...$('publicationMain').querySelectorAll('[name]')].map(input => [input.name,input.value]));
            // Los campos repetidos de cada grabación se leen dentro de su bloque.
            const grabaciones = kind === 'obra' ? [...$('publicationRecordings').children].map(block => ({id:block.dataset.id || undefined,
                ...Object.fromEntries([...block.querySelectorAll('[name]')].map(input => [input.name,input.value]))})) : [];
            await api('/api/registro/' + kind + '/' + id, body({datos,grabaciones}));
        }, form => {
            $('iterationSubmit').hidden = true;
            const addRecording = (data = {}) => {
                const block = document.createElement('fieldset');
                block.dataset.id = data.id || '';
                block.disabled = !editing;
                block.innerHTML = `<legend>${esc(data.nombre || 'Nueva grabación')}</legend>${publicationInputs(recordingFields,data)}
                    <button type="button" class="alt">Quitar grabación de esta ficha</button>`;
                block.querySelector('button').onclick = () => {
                    if (confirm('¿Quitar esta grabación de la ficha? No se eliminarán archivos de audio.')) { block.remove(); dialogDirty = true; }
                };
                $('publicationRecordings').append(block);
            };
            if (kind === 'obra') {
                saved.grabaciones.forEach(addRecording);
                $('addRecording').onclick = () => { addRecording(); dialogDirty = true; };
            }
            $('modifyPublication').onclick = () => {
                editing = true;
                form.querySelectorAll('fieldset').forEach(block => block.disabled = false);
                $('modifyPublication').hidden = true;
                $('iterationSubmit').hidden = false;
                if (kind === 'obra') $('addRecording').hidden = false;
            };
        });
}
async function productionCreditsDialog(kind, id) {
    const [credits, people] = await Promise.all([api('/api/produccion-creditos/' + kind + '/' + id),api('/api/personas')]);
    const removed = new Set();
    formDialog('Artistas, músicos y créditos', `<p class="muted">El artista principal se conserva en el proyecto. Los créditos del disco no se atribuyen automáticamente a cada canción.</p>
        <div id="currentCredits">${credits.map((credit,index) => `<p>${esc(credit.persona)} · ${esc(credit.rol)}
        <button type="button" class="alt" data-remove-credit="${index}">Quitar crédito</button></p>`).join('') || 'Sin créditos adicionales.'}</div>
        ${collaboratorFields(people)}`, async () => {
            const selected = readCollaborators($('iterationForm'));
            for (const entry of selected) if (!entry.rol) throw Error('Indicá el rol de cada participante.');
            await api('/api/produccion-creditos/' + kind + '/' + id, body({agregar:selected,quitar:[...removed]}));
        }, form => form.querySelectorAll('[data-remove-credit]').forEach(button => button.onclick = () => {
            removed.add(credits[Number(button.dataset.removeCredit)].id);
            button.parentElement.remove();
            dialogDirty = true;
        }));
}
