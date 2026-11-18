// Una sola ficha mantiene todos los borradores mientras se alternan pestañas.
// No se guarda parcialmente: canción, letra, créditos y grabaciones son un lote.
let songDataDraft;
let songDataDirty = false;
let songDataPeople = [];
const songDataSections = [['general','Metadata'],['lyrics','Letra'],['credits','Créditos'],
    ['publication','Publicación'],['tags','Etiquetas y campos'],['notes','Notas']];

function songDataTab(key) {
    document.querySelectorAll('[data-song-section]').forEach(panel => panel.hidden = panel.dataset.songSection !== key);
    $('songDataTabs').querySelectorAll('button').forEach(button => {
        button.setAttribute('aria-selected',button.dataset.tab === key);
        button.tabIndex = button.dataset.tab === key ? 0 : -1;
    });
}
function songInput(key,label,value='',type='text') {
    return `<label>${label}<input name="${key}" type="${type}" value="${esc(value)}"></label>`;
}
function addSongCredit(credit = {}) {
    const row = document.createElement('fieldset');
    row.className = 'song-credit'; row.dataset.id = credit.id || '';
    row.innerHTML = `<label>Persona<select name="persona_id">${optionPeople(songDataPeople,credit.persona_id)}</select></label>
      <label>Rol<input name="rol" maxlength="150" value="${esc(credit.rol)}" list="songCreditRoles"></label><button type="button" class="alt">Quitar</button>`;
    row.querySelector('button').onclick = () => { row.remove(); songDataDirty=true; };
    $('songCredits').append(row);
}
function addSongRecording(record = {}) {
    const block = document.createElement('fieldset');
    block.dataset.id = record.id || '';
    block.innerHTML = `<legend>${esc(record.nombre || 'Nueva grabación')}</legend><div class="song-data-grid">${publicationInputs(recordingFields,record)}</div>
        <button type="button" class="alt">Quitar de la ficha</button>`;
    block.querySelector('button').onclick = () => {
        if (confirm('¿Quitar esta grabación de la ficha? Los audios y las sesiones se conservan.')) { block.remove(); songDataDirty=true; }
    };
    $('songRecordings').append(block);
}
function addSongCustomField(key='',value='') {
    const row=document.createElement('div');row.className='song-custom-field';
    row.innerHTML=`<label>Dato<input data-custom-key value="${esc(key)}" maxlength="100"></label><label>Valor<input data-custom-value value="${esc(value)}" maxlength="2000"></label><button type="button" class="alt">Quitar</button>`;
    row.querySelector('button').onclick=()=>{row.remove();songDataDirty=true;};$('songCustom').append(row);
}
async function songDataDialog(id) {
    const [bundle,people,content] = await Promise.all([api('/api/canciones/'+id+'/ficha'),api('/api/personas'),
        api('/api/artistas/'+currentSong.artista_id+'/contenido')]);
    songDataDraft=bundle; songDataPeople=people; songDataDirty=false;
    const song=bundle.cancion,extra=bundle.ficha;
    $('songDataTitle').textContent='Datos de '+song.titulo;
    $('songDataError').textContent='';
    $('songDataExport').href='/api/canciones/'+id+'/entrega-editorial';
    $('songDataExport').title='Descarga JSON, CSV, letra y descripción. Incluye solo los últimos cambios guardados.';
    $('songDataTabs').innerHTML=songDataSections.map(([key,label])=>`<button type="button" role="tab" data-tab="${key}" onclick="songDataTab('${key}')">${label}</button>`).join('');
    $('songDataFields').innerHTML=`
      <section data-song-section="general" role="tabpanel"><div id="songGeneral" class="song-data-grid">
        ${songInput('titulo','Título',song.titulo)}
        <label>Disco<select name="disco_id"><option value="">Canción suelta</option>${content.discos.map(album=>`<option value="${album.id}" ${album.id===song.disco_id?'selected':''}>${esc(album.nombre)}</option>`).join('')}</select></label>
        ${songInput('pista','Número de pista',song.pista || '','number')}
        <label>Estado<select name="estado">${productionStates.filter(state=>state!=='Sin estado').map(state=>`<option ${song.estado===state?'selected':''}>${state}</option>`).join('')}</select></label>
        ${songInput('bpm','BPM',song.bpm || '','number')}${songInput('tonalidad','Tonalidad',song.tonalidad)}${songInput('duracion','Duración de referencia (mm:ss)',song.duracion)}
      </div><div id="songWork" class="song-data-grid">${publicationInputs(publicationFields.obra.filter(([key])=>!['notas','iswc','editorial','sociedad','registro_local','copyright'].includes(key)),bundle.obra)}</div>
      <p class="muted">La duración exacta de cada WAV se consulta en Catálogo. Cambiar de disco conserva las rutas del DAW.</p></section>
      <section data-song-section="lyrics" role="tabpanel" hidden><label>Letra completa<textarea id="songLyrics" rows="18" maxlength="100000" placeholder="Versos, estribillos y estructura…">${esc(extra.letra)}</textarea></label>
        <p class="muted">Letra sin sincronizar. Se incluye en la exportación editorial; no se publica automáticamente.</p></section>
      <section data-song-section="credits" role="tabpanel" hidden><p class="muted">Asociá fichas existentes y especificá cada función. Los créditos del disco se mantienen separados.</p><div id="songCredits"></div>
        <datalist id="songCreditRoles">${['Artista principal','Artista invitado','Autor / letra','Compositor / música','Arreglista','Productor','Guitarra','Voz','Grabación','Mezcla','Mastering'].map(role=>`<option>${role}</option>`).join('')}</datalist>
        <button type="button" class="alt" id="addSongCredit">＋ Agregar participante</button></section>
      <section data-song-section="publication" role="tabpanel" hidden><h3>Obra musical</h3><div id="songWorkRegistration" class="song-data-grid">${publicationInputs(publicationFields.obra.filter(([key])=>['iswc','editorial','sociedad','registro_local','copyright'].includes(key)),bundle.obra)}</div>
        <h3>Grabaciones publicables</h3><p class="muted">Un fonograma puede tener su propio ISRC. Una versión del DAW no equivale automáticamente a un nuevo fonograma.</p><div id="songRecordings"></div><button type="button" class="alt" id="addSongRecording">＋ Agregar grabación</button>
        <h3>Entrega / single</h3><p class="muted">Si pertenece a un disco, completá también su Ficha de lanzamiento. Estos datos permiten preparar la entrega individual.</p>
        <div id="songRelease" class="song-data-grid">${publicationInputs(publicationFields.lanzamiento,extra.publicacion || {})}</div>
        <div id="songLinks" class="song-data-grid">${songInput('spotify','Enlace Spotify',extra.links?.spotify,'url')}${songInput('youtube','Enlace YouTube',extra.links?.youtube,'url')}${songInput('ama','Enlace / referencia web AMA',extra.links?.ama,'url')}</div>
        <label>Descripción para YouTube<textarea id="songYoutube" rows="6" maxlength="20000">${esc(extra.descripcion_youtube)}</textarea></label>
        <div class="card"><h3>Preparación de entrega</h3><ul id="songReadiness"></ul><p class="muted">Guía de revisión, sin validar derechos ni asegurar aceptación por una plataforma.</p></div>
        <h3>Registro y distribución</h3><div class="resource-links">
          <a target="_blank" rel="noopener noreferrer" href="https://www.argentina.gob.ar/servicio/registrar-una-cancion-o-un-album-musical">DNDA · registro de canción o álbum</a>
          <a target="_blank" rel="noopener noreferrer" href="https://inamu.musica.ar/tutorial-sadaic-2026">INAMU · guía de registro SADAIC</a>
          <a target="_blank" rel="noopener noreferrer" href="https://www.ama.musica.ar/preguntas">AMA · distribución musical</a>
          <a target="_blank" rel="noopener noreferrer" href="https://support.spotify.com/us/artists/article/metadata-formatting-guidelines/">Spotify · guía de metadata</a>
          <a target="_blank" rel="noopener noreferrer" href="https://support.google.com/youtubemusic/answer/9105565?hl=es">YouTube Music · agregadoras</a></div></section>
      <section data-song-section="tags" role="tabpanel" hidden>${songInput('anio','Año',extra.anio)}
        <label>Etiquetas separadas por comas<input id="songTags" value="${esc((extra.etiquetas || []).join(', '))}" placeholder="Acústico, balada, guitarras, referencia…"></label>
        <h3>Campos propios</h3><div id="songCustom"></div><button type="button" class="alt" id="addSongCustom">＋ Agregar dato</button><p class="muted">Por ejemplo: Clima → Nostálgico, Instrumentación → Guitarras. Se pueden buscar desde Catálogo.</p></section>
      <section data-song-section="notes" role="tabpanel" hidden><label>Notas generales existentes<textarea id="songGeneralNotes" rows="6" maxlength="50000">${esc(song.metadata)}</textarea></label>
        <label>Notas de obra<textarea id="songWorkNotes" rows="5" maxlength="10000">${esc(bundle.obra.notas)}</textarea></label>
        <label>Notas internas de producción<textarea id="songInternalNotes" rows="6" maxlength="50000">${esc(extra.notas)}</textarea></label>
        <p class="muted">Estas notas internas no se incluyen en el portal ni en el paquete editorial.</p></section>`;
    bundle.creditos.forEach(addSongCredit);bundle.grabaciones.forEach(addSongRecording);
    Object.entries(extra.campos || {}).forEach(([key,value])=>addSongCustomField(key,value));
    $('addSongCustom').onclick=()=>{addSongCustomField();songDataDirty=true;};
    $('songGeneral').querySelector('[name=bpm]').step='any';
    $('addSongCredit').onclick=()=>{addSongCredit();songDataDirty=true;};
    $('addSongRecording').onclick=()=>{addSongRecording();songDataDirty=true;};
    $('songDataForm').oninput=()=>{songDataDirty=true;updateSongReadiness();};
    $('songDataForm').onsubmit=saveSongData;
    $('songDataTabs').onkeydown=event=>{
        if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
        const buttons=[...$('songDataTabs').children],current=buttons.indexOf(document.activeElement);
        const target=buttons[(current+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length];
        songDataTab(target.dataset.tab);target.focus();event.preventDefault();
    };
    songDataTab('general');updateSongReadiness();$('songDataDialog').showModal();
}
function updateSongReadiness() {
    const recordings=[...$('songRecordings').children];
    const checks=[['Título',!!$('songGeneral').querySelector('[name=titulo]').value.trim()],
        ['Créditos de participantes',!!$('songCredits').children.length],['Letra o revisión de tema instrumental',!!$('songLyrics').value.trim()],
        ['ISWC de la obra (si ya fue asignado)',!!$('songWorkRegistration').querySelector('[name=iswc]').value.trim()],
        ['Grabación con ISRC (si ya fue asignado)',recordings.some(block=>block.querySelector('[name=isrc]').value.trim())]];
    $('songReadiness').innerHTML=checks.map(([label,ready])=>`<li>${ready?'✓':'○'} ${label}</li>`).join('');
}
function fieldsIn(id) { return Object.fromEntries([...$(id).querySelectorAll('[name]')].map(input=>[input.name,input.value])); }
async function saveSongData(event) {
    event.preventDefault();$('saveSongData').disabled=true;$('songDataError').textContent='';
    try {
        const general=fieldsIn('songGeneral');
        if(!general.titulo.trim()){songDataTab('general');throw Error('Ingresá un título.');}
        const customEntries=[...$('songCustom').children].map(row=>[row.querySelector('[data-custom-key]').value.trim(),row.querySelector('[data-custom-value]').value]);
        if(customEntries.some(([key,value])=>!key && value.trim())){songDataTab('tags');throw Error('Poné un nombre a cada dato propio.');}
        if(new Set(customEntries.filter(([key])=>key).map(([key])=>key)).size!==customEntries.filter(([key])=>key).length){songDataTab('tags');throw Error('Hay campos propios con el mismo nombre.');}
        const payload={revision:songDataDraft.revision,cancion:{...general,metadata:$('songGeneralNotes').value},
            obra:{...songDataDraft.obra,...fieldsIn('songWork'),...fieldsIn('songWorkRegistration'),notas:$('songWorkNotes').value},
            ficha:{...songDataDraft.ficha,letra:$('songLyrics').value,descripcion_youtube:$('songYoutube').value,
                notas:$('songInternalNotes').value,anio:$('songDataFields').querySelector('[name=anio]').value,
                etiquetas:splitTags($('songTags').value),campos:Object.fromEntries(customEntries.filter(([key])=>key)),
                publicacion:fieldsIn('songRelease'),links:fieldsIn('songLinks')},
            creditos:[...$('songCredits').children].map(row=>({...(row.dataset.id?{id:row.dataset.id}:{}),
                ...Object.fromEntries([...row.querySelectorAll('[name]')].map(input=>[input.name,input.value]))})),
            grabaciones:[...$('songRecordings').children].map(row=>({...(row.dataset.id?{id:row.dataset.id}:{}),
                ...Object.fromEntries([...row.querySelectorAll('[name]')].map(input=>[input.name,input.value]))}))};
        await api('/api/canciones/'+songDataDraft.cancion.id+'/ficha',body(payload));
        songDataDirty=false;$('songDataDialog').close();await openSong(songDataDraft.cancion.id);
    }catch(error){$('songDataError').textContent=error.message;}
    finally{$('saveSongData').disabled=false;}
}
function closeSongData(){if($('saveSongData').disabled)return;if(!songDataDirty || confirm('Hay cambios sin guardar en la ficha. ¿Querés descartarlos?')){$('songDataDialog').close();songDataDirty=false;}}
$('songDataDialog').addEventListener('cancel',event=>{event.preventDefault();closeSongData();});
