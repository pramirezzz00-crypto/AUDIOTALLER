// Vista de canción. Cada macroproceso conserva sus controles al alternar etapas.
let workflow;
let songLoad = 0;
const activeStages = {pre:'demo', prod:'grabacion'};
const noteDrafts = new Map();
const stageDescriptions = {
    demo:'Primeras ideas, grabaciones de referencia y documentación inicial.',
    maqueta:'Guías instrumentales, arreglos y estructura de la canción.',
    grabacion:'Tomas de estudio, planillas, microfonía y notas técnicas.',
    mezcla:'Edición, balance, stems, referencias y revisiones.',
    mastering:'Premasters, masters finales y documentación de entrega.',
    historico:'Archivos anteriores cuya etapa no fue registrada.'
};
async function openSong(id) {
    if (currentSong?.id !== id && hasUnsavedSongNotes() &&
        !confirm('Hay notas sin guardar. Se conservarán en esta ventana. ¿Querés abrir otra canción?')) return;
    const sequence = ++songLoad;
    const data = await api('/api/produccion/' + id);
    if (sequence !== songLoad) return;
    workflow = data;
    currentSong = data.cancion;
    artist = await api('/api/artistas/' + currentSong.artista_id);
    go('songPane');
    renderWorkflow();
}
function songBreadcrumbs() {
    $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> ›
        <button onclick="go('projectManager')">Proyectos</button> ›
        <button onclick="openArtist('${currentSong.artista_id}',true)">${esc(currentSong.artista)}</button> ›
        ${currentSong.disco_id ? `<button onclick="openGlobalAlbum('${currentSong.disco_id}','${currentSong.artista_id}')">${esc(currentSong.disco)}</button> ›` : ''}
        ${esc(currentSong.titulo)}`;
}
const stageFiles = key => workflow.archivos.filter(file => file.etapa === key);
const macroCount = macro => workflow.archivos.filter(file => workflow.etapas.find(stage => stage.clave === file.etapa)?.macro === macro).length;
const draftKey = stage => currentSong.id + ':' + stage;

function renderWorkflow() {
    const song = currentSong;
    $('songHeading').textContent = song.titulo;
    songBreadcrumbs();
    const main = workflow.sesiones.find(session => session.principal) || workflow.sesiones.find(session => session.daw);
    $('songSummary').innerHTML = `<span><small>Artista</small><b>${esc(song.artista)}</b></span>
      <span><small>Disco / Proyecto</small><b>${esc(song.disco || 'Canción independiente')}</b></span>
      <span><small>Estado</small><b>${esc(song.estado)}</b></span>
      <span><small>Última edición registrada</small><b>${esc(song.actualizado || 'Sin registro')}</b></span>
      <span><small>DAW asociado</small><b>${esc(main?.daw || 'Sin asociar')}</b></span>`;
    $('songOverview').innerHTML = `<div class="project-art">${projectImage(song.portada,'♫')}</div>
        <h3>Resumen</h3><p>Preproducción · ${macroCount('pre')} archivos</p><p>Producción · ${macroCount('prod')} archivos</p>
        <h4>Última sesión</h4><p>${esc(workflow.sesiones[0]?.nombre || 'Sin sesiones')}</p>
        <h4>DAW principal</h4><p>${esc(main?.daw || 'Sin asociar')}</p>`;
    $('workflowPanels').innerHTML = ['pre','prod'].map(macro => {
        const stages = workflow.etapas.filter(stage => stage.macro === macro);
        if (!stages.some(stage => stage.clave === activeStages[macro])) activeStages[macro] = stages[0].clave;
        return `<article class="card macro-panel"><div class="heading"><h2>${macro === 'pre' ? 'PREPRODUCCIÓN' : 'PRODUCCIÓN'}</h2><span>${macroCount(macro)} archivos</span></div>
          <p class="muted">${macro === 'pre' ? 'Definición de la canción, ideas, arreglos y estructura.' : 'Grabación, edición, mezcla y mastering del material final.'}</p>
          <div class="stage-tabs">${stages.map(stage => `<button class="alt" data-macro="${macro}" data-stage="${stage.clave}" onclick="switchStage('${macro}','${stage.clave}')">${esc(stage.nombre)} (${stageFiles(stage.clave).length})</button>`).join('')}</div>
          ${stages.map(stage => stageMarkup(stage)).join('')}</article>`;
    }).join('');
    for (const stage of workflow.etapas) bindStage(stage);
    switchStage('pre',activeStages.pre);
    switchStage('prod',activeStages.prod);
    $('songHistory').innerHTML = workflow.eventos.map(event => `<div class="item"><time>${esc(event.creado)}</time><span>${esc(event.tipo)} · ${esc(event.detalle)}</span></div>`).join('') ||
        '<p class="muted">Sin eventos nuevos registrados.</p>';
}
function switchStage(macro, key) {
    activeStages[macro] = key;
    document.querySelectorAll(`[data-stage-body][data-macro="${macro}"]`).forEach(panel => { panel.hidden = panel.dataset.stageBody !== key; });
    document.querySelectorAll(`button[data-macro="${macro}"]`).forEach(button => button.setAttribute('aria-pressed', button.dataset.stage === key));
}
function fileType(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (['wav','aif','aiff','mp3','flac','ogg','m4a'].includes(ext)) return '♫ Audio';
    if (['cpr','rpp','als','ptx','flp','song','logicx','wavelab'].includes(ext)) return '◈ Sesión DAW';
    if (['png','jpg','jpeg','webp','gif'].includes(ext)) return '▧ Imagen';
    return ({pdf:'▤ PDF',txt:'▤ Notas',mid:'♫ MIDI',midi:'♫ MIDI'}[ext] || ext.toUpperCase());
}
function stageMarkup(stage) {
    const sessions = workflow.sesiones.filter(session => session.etapa === stage.clave);
    const files = stageFiles(stage.clave);
    const sessionName = id => workflow.sesiones.find(session => session.id === id)?.nombre || 'Sin sesión';
    return `<section data-stage-body="${stage.clave}" data-macro="${stage.macro}">
      <h3>${esc(stage.nombre)}</h3><p class="muted">${esc(stageDescriptions[stage.clave] || '')}</p>
      <div class="row"><button onclick="sessionDialog('${stage.clave}')">＋ Nueva sesión</button>
        <button class="alt" onclick="linkFileDialog('${stage.clave}')">Vincular archivo externo</button></div>
      <label>Sesión para los archivos nuevos<select id="targetSession-${stage.clave}"><option value="">Sin sesión específica</option>
        ${sessions.map(session => `<option value="${session.id}">${esc(session.nombre)}</option>`).join('')}</select></label>
      <label id="upload-${stage.clave}" class="drop-zone">Importar · Arrastrá archivos acá o elegilos
        <input type="file" multiple><span class="file-status" role="status">Se copiarán a AudioTaller conservando los originales.</span></label>
      <details ${sessions.length ? 'open' : ''}><summary>Sesiones (${sessions.length})</summary><div class="list">
        ${sessions.map(session => `<div class="session-row"><strong>${esc(session.nombre)}</strong><span>${esc(session.daw || 'Sin DAW')} · ${esc(session.creado)}</span>
        <small>${esc(session.ruta)} · ${session.disponible ? 'Disponible' : 'No disponible'} · ${esc(session.modo || 'Anterior')}</small>
        <p>${esc(session.comentario)}</p><div class="row"><button class="alt" onclick="sessionDialog('${stage.clave}','${session.id}')">Nueva sesión basada en esta</button>
        ${session.daw ? `<button class="alt" onclick="setMainSession('${session.id}')">${session.principal ? 'DAW principal ✓' : 'Usar como principal'}</button>` : ''}</div></div>`).join('') || '<p class="muted">Sin sesiones.</p>'}
      </div></details>
      <h3>Archivos de la etapa (${files.length})</h3><div class="file-table"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fecha</th><th>Tamaño</th><th>Sesión</th><th>Acciones</th></tr></thead><tbody>
      ${files.map(file => `<tr><td title="${esc(file.ruta)}">${esc(file.nombre)}<small>${esc(file.modo)} · ${file.disponible ? 'Disponible' : 'No disponible'}</small></td><td>${esc(fileType(file.nombre))}</td>
      <td>${esc(file.creado)}</td><td>${file.tamano === null ? '—' : (file.tamano / 1024).toFixed(1) + ' KB'}</td><td>${esc(sessionName(file.sesion_id))}</td>
      <td>${file.disponible ? `<details><summary>⋯</summary><a href="/api/produccion/archivo/${file.id}" target="_blank" rel="noopener">Abrir / descargar</a><button class="alt" onclick="fileVersionDialog('${file.id}','${stage.clave}')">Registrar versión</button>
      ${/\.(wav|mp3|flac|ogg|m4a)$/i.test(file.nombre) ? `<audio controls preload="none" src="/api/produccion/archivo/${file.id}"></audio>` : ''}</details>` : 'Ruta inaccesible'}</td></tr>`).join('')}
      </tbody></table></div>
      <label>Documentación y notas<textarea id="note-${stage.clave}">${esc(noteDrafts.get(draftKey(stage.clave)) ?? workflow.notas[stage.clave] ?? '')}</textarea></label>
      <button class="alt" onclick="saveStageNote('${stage.clave}')">Guardar nota</button><span id="noteStatus-${stage.clave}" role="status"></span>
    </section>`;
}
function bindStage(stage) {
    const key = stage.clave;
    $('note-' + key).oninput = event => {
        noteDrafts.set(draftKey(key), event.target.value);
        $('noteStatus-' + key).textContent = 'Sin guardar';
    };
    const songId = currentSong.id;
    let queue = Promise.resolve();
    bindDropZone($('upload-' + key), files => {
        const session = $('targetSession-' + key).value;
        queue = queue.then(async () => {
            const failed = [];
            for (const file of files) {
                try {
                    const data = new FormData();
                    data.append('file',file);
                    data.append('sesion_id', session);
                    const response = await fetch('/api/produccion/' + songId + '/archivos/' + key, {method:'POST',body:data});
                    if (!response.ok) {
                        const error = await response.json();
                        throw Error(error.error || 'No se pudo importar.');
                    }
                } catch (error) { failed.push(file.name + ': ' + error.message); }
            }
            if (currentSong.id === songId) await openSong(songId);
            if (failed.length) report(Error(failed.join(' · ')));
        });
    });
}
async function saveStageNote(stage) {
    try {
        await api('/api/produccion/' + currentSong.id + '/notas/' + stage, body({texto:$('note-' + stage).value}));
        noteDrafts.delete(draftKey(stage));
        await openSong(currentSong.id);
    } catch (error) { report(error); }
}
async function pickLocalPath(input, folder = false) {
    if (!window.pywebview?.api?.choose_path) {
        input.focus();
        return;
    }
    try {
        const selected = await window.pywebview.api.choose_path(folder);
        if (selected) {
            input.value = selected;
            input.dispatchEvent(new Event('input', {bubbles:true}));
        }
    } catch { report(Error('Pegá la ruta local en el campo para continuar.')); }
}
function sessionDialog(stage = activeStages.prod, baseId) {
    const base = workflow.sesiones.find(session => session.id === baseId);
    const daws = ['Cubase','Reaper','Pro Tools','Ableton Live','Logic Pro','Studio One','FL Studio','WaveLab','Otro'];
    formDialog(base ? 'Nueva sesión basada en ' + base.nombre : 'Nueva sesión / vincular DAW', `
      <label>Nombre de sesión<input name="nombre" required maxlength="150" value="${esc(base ? base.nombre + ' · nueva sesión' : '')}"></label>
      <label>Etapa<select name="etapa">${workflow.etapas.map(item => `<option value="${item.clave}" ${item.clave === stage ? 'selected' : ''}>${esc(item.nombre)}</option>`).join('')}</select></label>
      <label>DAW<select name="daw"><option value="">Sin asociar</option>${daws.map(daw => `<option ${base?.daw === daw ? 'selected' : ''}>${daw}</option>`).join('')}</select></label>
      <label>Aplicación personalizada<input name="personalizado" placeholder="Completar si elegiste Otro"></label>
      <label>Ruta vinculada del DAW (opcional)<input name="ruta" placeholder="Archivo o carpeta local. Vacío = carpeta administrada nueva."></label>
      <div class="row"><button type="button" class="alt" id="pickDawFile">Elegir archivo</button><button type="button" class="alt" id="pickDawFolder">Elegir carpeta</button></div>
      <p class="muted">La ruta se registra como vínculo. Una nueva sesión de trabajo conserva su propio registro y notas.</p>
      <label>Notas<textarea name="notas">${esc(base ? 'Basada en ' + base.nombre + '. ' : '')}</textarea></label>
      <label><input type="checkbox" name="principal"> Usar como DAW principal</label>`,
      async data => {
          if (data.daw === 'Otro') {
              if (!data.personalizado.trim()) throw Error('Indicá la aplicación personalizada.');
              data.daw = data.personalizado.trim();
          }
          await api('/api/produccion/' + currentSong.id + '/sesiones', body(data));
          await openSong(currentSong.id);
      }, form => {
          $('pickDawFile').onclick = () => pickLocalPath(form.elements.ruta);
          $('pickDawFolder').onclick = () => pickLocalPath(form.elements.ruta, true);
      });
}
function linkFileDialog(stage) {
    const session = $('targetSession-' + stage).value;
    formDialog('Vincular archivo externo', `<p class="muted">Se guardará su ubicación original. El archivo permanece en esa carpeta.</p>
        <label>Ruta absoluta del archivo<input name="ruta" required></label><button class="alt" type="button" id="pickLinked">Elegir archivo</button>`,
        async data => {
            await api('/api/produccion/' + currentSong.id + '/vinculos', body({...data,etapa:stage,sesion_id:session}));
            await openSong(currentSong.id);
        }, form => { $('pickLinked').onclick = () => pickLocalPath(form.elements.ruta); });
}
async function setMainSession(id) {
    await api('/api/produccion/' + currentSong.id + '/principal/' + id, body({}));
    await openSong(currentSong.id);
}
async function editProductionSong() {
    const content = await api('/api/artistas/' + currentSong.artista_id + '/contenido');
    const song = currentSong;
    formDialog('Editar canción', `
      <label>Título<input name="titulo" required value="${esc(song.titulo)}"></label>
      <label>Disco / proyecto<select name="disco_id"><option value="">Canción independiente</option>
      ${content.discos.map(album => `<option value="${album.id}" ${song.disco_id === album.id ? 'selected' : ''}>${esc(album.nombre)}</option>`).join('')}</select></label>
      <label>Número de pista<input type="number" name="pista" min="1" max="99999" value="${song.pista || ''}"></label>
      <label>BPM<input name="bpm" value="${esc(song.bpm)}"></label>
      <label>Tonalidad<input name="tonalidad" value="${esc(song.tonalidad)}"></label>
      <label>Estado<select name="estado">${['Idea','En preproducción','En producción','Finalizada','En pausa'].map(state => `<option ${state === song.estado ? 'selected' : ''}>${state}</option>`).join('')}</select></label>
      <label>Notas generales<textarea name="metadata">${esc(song.metadata)}</textarea></label>`,
      async data => {
          await api('/api/canciones/' + song.id + '/editar', body(data));
          await openSong(song.id);
      });
}

function fileVersionDialog(identity, stage) {
    let versionFile;
    const songId = currentSong.id;
    formDialog('Registrar una nueva versión de archivo',
        '<label id="versionDrop" class="drop-zone">Arrastrá o elegí el archivo nuevo<input type="file" id="versionFile"><span role="status"></span></label><label>Comentario de los cambios<textarea name="comentario"></textarea></label>',
        async data => {
            const file = versionFile;
            if (!file) throw Error('Seleccioná el archivo de la nueva versión.');
            const form = new FormData();
            form.append('file', file);
            form.append('version_de', identity);
            form.append('comentario',data.comentario);
            const response = await fetch('/api/produccion/' + songId + '/archivos/' + stage, {method:'POST',body:form});
            if (!response.ok) throw Error((await response.json()).error || 'No se pudo guardar la versión.');
            await openSong(songId);
        }, () => bindDropZone($('versionDrop'), files => {
            if (files.length !== 1) return;
            versionFile = files[0];
            $('versionDrop').querySelector('[role=status]').textContent = versionFile.name;
        }));
}

function hasUnsavedSongNotes() {
    return currentSong && [...noteDrafts.keys()].some(key => key.startsWith(currentSong.id + ':'));
}
window.addEventListener('beforeunload', event => {
    if (hasUnsavedSongNotes() || dialogDirty) {
        event.preventDefault();
        event.returnValue = '';
    }
});
