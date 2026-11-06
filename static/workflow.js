// Vista de canción. Cada macroproceso conserva sus controles al alternar etapas.
let workflow;
let songLoad = 0;
let activeMacro = 'pre';
const selectedStageSessions = new Map();
const sessionDrafts = new Map();
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
    disposeWavePlayers();
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
        <h3>Resumen</h3><p>Preproducción · ${countLabel(macroCount('pre'),'archivo','archivos')}</p><p>Producción · ${countLabel(macroCount('prod'),'archivo','archivos')}</p>
        <h4>Última sesión</h4><p>${esc(workflow.sesiones[0]?.nombre || 'Sin sesiones')}</p>
        <h4>DAW principal</h4><p>${esc(main?.daw || 'Sin asociar')}</p>`;
    $('workflowPanels').innerHTML = ['pre','prod'].map(macro => {
        const stages = workflow.etapas.filter(stage => stage.macro === macro);
        if (!stages.some(stage => stage.clave === activeStages[macro])) activeStages[macro] = stages[0].clave;
        return `<article class="card macro-panel" data-macro-panel="${macro}"><div class="heading"><h2>${macro === 'pre' ? 'PREPRODUCCIÓN' : 'PRODUCCIÓN'}</h2><span>${countLabel(macroCount(macro),'archivo','archivos')}</span></div>
          <p class="muted">${macro === 'pre' ? 'Definición de la canción, ideas, arreglos y estructura.' : 'Grabación, edición, mezcla y mastering del material final.'}</p>
          <div class="stage-tabs">${stages.map(stage => `<button class="alt" data-macro="${macro}" data-stage="${stage.clave}" onclick="switchStage('${macro}','${stage.clave}')">${esc(stage.nombre)} (${stageFiles(stage.clave).length})</button>`).join('')}</div>
          ${stages.map(stage => stageMarkup(stage)).join('')}</article>`;
    }).join('');
    $('workflowMacroTabs').innerHTML = ['pre','prod'].map(macro =>
        `<button class="alt" role="tab" aria-selected="${macro === activeMacro}" data-macro-tab="${macro}"
            onclick="switchMacro('${macro}')">${macro === 'pre' ? 'Preproducción' : 'Producción'} · ${countLabel(macroCount(macro),'archivo','archivos')}</button>`).join('');
    for (const stage of workflow.etapas) bindStage(stage);
    switchStage('pre',activeStages.pre);
    switchStage('prod',activeStages.prod);
    switchMacro(activeMacro);
    setupWavePlayers($('workflowPanels'));
    $('songHistory').innerHTML = workflow.eventos.map(event => `<div class="item"><time>${esc(event.creado)}</time><span>${esc(event.tipo)} · ${esc(event.detalle)}</span></div>`).join('') ||
        '<p class="muted">Sin eventos nuevos registrados.</p>';
}
function switchStage(macro, key) {
    activeStages[macro] = key;
    document.querySelectorAll(`[data-stage-body][data-macro="${macro}"]`).forEach(panel => { panel.hidden = panel.dataset.stageBody !== key;
        if (panel.hidden) panel.querySelectorAll('audio').forEach(audio => audio.pause()); });
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
      <div class="row"><button class="alt" onclick="linkFileDialog('${stage.clave}')">Vincular archivo externo</button></div>
      <label>Sesión para los archivos nuevos<select id="targetSession-${stage.clave}"><option value="">Sin sesión específica</option>
        ${sessions.map(session => `<option value="${session.id}">${esc(session.nombre)}</option>`).join('')}</select></label>
      <label id="upload-${stage.clave}" class="drop-zone">Importar · Arrastrá archivos acá o elegilos
        <input type="file" multiple><span class="file-status" role="status">Se copiarán a AudioTaller conservando los originales.</span></label>
      <section class="sessions-explorer" aria-label="Sesiones de la etapa">
      <div class="heading"><h3>Sesiones (${sessions.length})</h3><div class="row">
        <button class="alt" onclick="discoverSessionDialog('${stage.clave}')">Buscar sesiones en carpeta</button>
        <button onclick="sessionDialog('${stage.clave}')">＋ Nueva sesión</button></div></div>
      <div class="session-scroll"><table class="session-table"><thead><tr>
        <th>Válida</th><th>Sesión</th><th>DAW</th><th>Estado</th><th>Acciones</th>
      </tr></thead><tbody>
        ${sessions.map(session => `<tr class="session-entry ${session.vigente ? 'valid-session' : ''}" data-session-row="${session.id}"
            onclick="selectStageSession('${stage.clave}','${session.id}')">
          <td onclick="event.stopPropagation()"><input type="checkbox" aria-label="Marcar ${esc(session.nombre)} como sesión válida"
              ${session.vigente ? 'checked' : ''} onchange="setValidSession('${session.id}','${stage.clave}',this.checked)"></td>
          <td><button class="session-name" title="${esc(session.ruta)}" onclick="event.stopPropagation();selectStageSession('${stage.clave}','${session.id}')">◈ ${esc(session.nombre)}
            <small>${/\.(cpr|rpp|ptx|als|song|flp|npr|wpr)$/i.test(session.ruta) ? esc(session.ruta.split(/[\\/]/).pop()) : ''}</small></button></td>
          <td>${esc(session.daw || '—')}</td><td>${session.vigente ? '<strong class="mint">Validada ✓</strong>' : ''}
              <small>${session.disponible ? 'Disponible' : 'Ruta no disponible'}</small></td>
          <td onclick="event.stopPropagation()"><div class="row session-actions">
            <button class="alt" ${session.abrible ? '' : 'disabled'} onclick="openDawSession('${session.id}')">Abrir en DAW</button>
            <button class="alt" onclick="sessionDialog('${stage.clave}','${session.id}')">Nueva sesión basada en esta</button>
          </div></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">Todavía no hay sesiones en esta etapa.</td></tr>'}
      </tbody></table></div></section>
      <div id="sessionNotes-${stage.clave}"></div>
      ${audioFilesMarkup(files)}
      <h3>Archivos de la etapa (${files.length})</h3><div class="file-table"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fecha</th><th>Tamaño</th><th>Sesión</th><th>Acciones</th></tr></thead><tbody>
      ${files.map(file => `<tr><td title="${esc(file.ruta)}">${esc(file.nombre)}<small>${esc(file.modo)} · ${file.disponible ? 'Disponible' : 'No disponible'}</small></td><td>${esc(fileType(file.nombre))}</td>
      <td>${esc(file.creado)}</td><td>${file.tamano === null ? '—' : (file.tamano / 1024).toFixed(1) + ' KB'}</td><td>${esc(sessionName(file.sesion_id))}</td>
      <td>${file.disponible ? `<details><summary>⋯</summary><a href="/api/produccion/archivo/${file.id}" target="_blank" rel="noopener">Abrir / descargar</a><button class="alt" onclick="fileVersionDialog('${file.id}','${stage.clave}')">Registrar versión</button>
</details>` : 'Ruta inaccesible'}</td></tr>`).join('')}
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
    const target = $('targetSession-' + key);
    const sessions = workflow.sesiones.filter(session => session.etapa === key);
    const saved = selectedStageSessions.get(draftKey(key));
    const selected = sessions.find(session => session.id === saved) || sessions.find(session => session.vigente) || sessions[0];
    if (selected) {
        target.value = selected.id;
        selectStageSession(key, selected.id);
    }
    target.onchange = () => selectStageSession(key, target.value);
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
          const discoverFolder = () => {
              const path = form.elements.ruta.value.trim();
              if (!path || /\.(cpr|rpp|ptx|als|song|flp|npr|wpr)$/i.test(path)) return;
              if ((form.elements.nombre.value.trim() || form.elements.notas.value.trim()) &&
                  !confirm('Para buscar sesiones vamos a abrir el explorador de carpeta. El nombre y las notas de este formulario no se guardarán. ¿Continuar?')) return;
              const selectedStage = form.elements.etapa.value;
              dialogDirty = false;
              $('iterationDialog').close();
              discoverSessionDialog(selectedStage, null, path);
          };
          $('pickDawFolder').onclick = async () => {
              await pickLocalPath(form.elements.ruta, true);
              discoverFolder();
          };
          form.elements.ruta.onchange = discoverFolder;
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
    return currentSong && ([...noteDrafts.keys()].some(key => key.startsWith(currentSong.id + ':')) || workflow?.sesiones.some(session => sessionDrafts.has(session.id)));
}
window.addEventListener('beforeunload', event => {
    if (hasUnsavedSongNotes() || dialogDirty) {
        event.preventDefault();
        event.returnValue = '';
    }
});

// La selección para consultar notas es independiente de la sesión válida de la etapa.
function selectStageSession(stage, identity) {
    selectedStageSessions.set(draftKey(stage), identity);
    $('targetSession-' + stage).value = identity;
    document.querySelectorAll(`[data-stage-body="${stage}"] [data-session-row]`).forEach(row => {
        row.classList.toggle('selected-session', row.dataset.sessionRow === identity);
        const button = row.querySelector('.session-name');
        if (button) button.setAttribute('aria-pressed', row.dataset.sessionRow === identity);
    });
    const target = $('sessionNotes-' + stage);
    const session = workflow.sesiones.find(item => item.id === identity);
    if (!session) { target.replaceChildren(); return; }
    target.innerHTML = `<div class="card"><h3>Notas de ${esc(session.nombre)}</h3>
        <p class="muted">${esc(session.daw || 'Sin DAW')} · Registrada: ${esc(session.creado)}</p>
        <textarea aria-label="Notas de la sesión seleccionada">${esc(sessionDrafts.get(identity) ?? session.comentario)}</textarea>
        <button class="alt">Guardar notas de esta sesión</button><span role="status"></span></div>`;
    const textarea = target.querySelector('textarea');
    textarea.oninput = () => { sessionDrafts.set(identity, textarea.value); };
    target.querySelector('button').onclick = async () => {
        const text = textarea.value;
        try {
            await api('/api/produccion/' + currentSong.id + '/sesiones/' + identity + '/notas', body({texto:text}));
            session.comentario = text;
            if (sessionDrafts.get(identity) === text) sessionDrafts.delete(identity);
            target.querySelector('[role=status]').textContent = 'Notas guardadas';
        } catch (error) { report(error); }
    };
}
async function setValidSession(identity, stage, active = true) {
    try {
        await api('/api/produccion/' + currentSong.id + '/vigente/' + identity, body({activa:active}));
        selectedStageSessions.set(draftKey(stage), identity);
        await openSong(currentSong.id);
    } catch (error) {
        renderWorkflow();
        report(error);
    }
}
async function openDawSession(identity) {
    try {
        await api('/api/produccion/' + currentSong.id + '/sesiones/' + identity + '/abrir', body({}));
    } catch (error) { report(error); }
}

async function discoverSessionDialog(stage, baseId, folder = '') {
    const songId = currentSong.id;
    const base = workflow.sesiones.find(session => session.id === baseId);
    // Para un archivo vinculado, la exploración comienza en su carpeta contenedora.
    let initial = folder || base?.ruta || '';
    if (initial && /\.(cpr|rpp|ptx|als|song|flp|npr|wpr)$/i.test(initial)) initial = initial.replace(/[\\/][^\\/]+$/, '');
    let discovered = [];
    let generation = 0;
    let scanParameters;
    formDialog('Buscar y vincular sesiones DAW',
        `<label>Carpeta local<input name="ruta" required value="${esc(initial)}" placeholder="Pegá la ruta de la carpeta de sesiones"></label>
        <button class="alt" type="button" id="chooseSessionFolder">Elegir carpeta</button>
        <label><input type="checkbox" name="recursivo"> Incluir subcarpetas</label>
        <button class="alt" type="button" id="scanSessionFolder">Buscar sesiones</button>
        <p class="muted">Se registran vínculos a los archivos elegidos. Marcá luego cuál es la sesión válida de esta etapa.</p>
        <div id="discoveryStatus" role="status"></div><div id="discoveredSessions" class="list"></div>`,
        async () => {
            if (!scanParameters) throw Error('Primero buscá las sesiones de la carpeta.');
            const checked = Array.from($('discoveredSessions').querySelectorAll('input:checked'), input => discovered[Number(input.value)].ruta);
            if (!checked.length) throw Error('Marcá al menos una sesión nueva para vincular.');
            const result = await api('/api/produccion/' + songId + '/vincular-sesiones', body({...scanParameters,archivos:checked}));
            if (result.ids.length) selectedStageSessions.set(draftKey(stage), result.ids[0]);
            await openSong(songId);
        }, form => {
            const resetResults = () => {
                generation++;
                scanParameters = null;
                discovered = [];
                $('discoveredSessions').replaceChildren();
            };
            const scan = async () => {
                resetResults();
                const request = generation;
                const parameters = {ruta:form.elements.ruta.value, etapa:stage, recursivo:form.elements.recursivo.checked};
                $('discoveryStatus').textContent = 'Buscando sesiones…';
                try {
                    const result = await api('/api/produccion/' + songId + '/buscar-sesiones', body(parameters));
                    if (request !== generation || !$('iterationDialog').open) return;
                    discovered = result.sesiones;
                    scanParameters = parameters;
                    $('discoveryStatus').textContent = discovered.length + ' sesiones encontradas' +
                        (result.inaccesibles ? ' · Algunas ubicaciones no se pudieron leer.' : '');
                    $('discoveredSessions').innerHTML = discovered.map((session,index) =>
                        `<label class="session-row"><span><input type="checkbox" value="${index}" ${session.registrada ? 'disabled' : 'checked'}>
                          ${esc(session.nombre)} ${session.registrada ? '· Ya vinculada' : ''}</span>
                          <small>${esc(session.daw)} · Archivo modificado: ${new Date(session.modificado * 1000).toLocaleString()}<br>${esc(session.ruta)}</small></label>`).join('');
                } catch (error) {
                    if (request === generation) $('discoveryStatus').textContent = error.message;
                }
            };
            $('chooseSessionFolder').onclick = async () => {
                await pickLocalPath(form.elements.ruta, true);
                if (form.elements.ruta.value.trim()) scan();
            };
            form.elements.ruta.oninput = resetResults;
            form.elements.ruta.onchange = () => { if (form.elements.ruta.value.trim()) scan(); };
            form.elements.recursivo.onchange = () => { if (form.elements.ruta.value.trim()) scan(); };
            $('scanSessionFolder').onclick = scan;
            if (initial) scan();
        });
    $('iterationSubmit').textContent = 'Vincular seleccionadas';
}

// Se muestran los dos macroprocesos como solapas. Sus etapas y borradores permanecen montados.
function switchMacro(macro) {
    activeMacro = macro;
    document.querySelectorAll('[data-macro-panel]').forEach(panel => {
        panel.hidden = panel.dataset.macroPanel !== macro;
        if (panel.hidden) panel.querySelectorAll('audio').forEach(audio => audio.pause());
    });
    document.querySelectorAll('[data-macro-tab]').forEach(button => {
        const selected = button.dataset.macroTab === macro;
        button.setAttribute('aria-selected', selected);
        button.setAttribute('aria-pressed', selected);
    });
}
