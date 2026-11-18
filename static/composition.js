// Aporte de Zharelly, adaptado a la navegación actual de AudioTaller.
// Beats: múltiples listas independientes, con rutas originales y orden propio.
let selectedBeatId = null;
let selectedBeatPlaylistId = localStorage.getItem('audiotaller.beats.playlist') || 'default';
let beatsPlaylists = [];
let beatsRequest = 0;
let beatPlaylistDialogMode = 'create';
async function loadBeats(loadPlaylists = true) {
    const request = ++beatsRequest;
    try {
        if (loadPlaylists) {
            const result = await api('/api/beats/playlists');
            beatsPlaylists = result.listas || [];
            const saved = localStorage.getItem('audiotaller.beats.playlist');
            if (!beatsPlaylists.some(item => item.id === selectedBeatPlaylistId)) {
                selectedBeatPlaylistId = beatsPlaylists.some(item => item.id === saved) ? saved : (beatsPlaylists[0]?.id || null);
            }
            $('beatsPlaylistSelect').innerHTML = beatsPlaylists.map(item =>
                `<option value="${esc(item.id)}">${esc(item.nombre)} (${item.cantidad})</option>`).join('');
            $('beatsPlaylistSelect').value = selectedBeatPlaylistId || '';
            $('renameBeatPlaylist').disabled = !selectedBeatPlaylistId;
            $('deleteBeatPlaylist').disabled = !selectedBeatPlaylistId;
            $('addBeats').disabled = !selectedBeatPlaylistId;
            if (selectedBeatPlaylistId) localStorage.setItem('audiotaller.beats.playlist', selectedBeatPlaylistId);
            else localStorage.removeItem('audiotaller.beats.playlist');
        }
        if (!selectedBeatPlaylistId) {
            selectedBeatId = null;
            $('beatPlayer').pause(); $('beatPlayer').removeAttribute('src'); $('beatPlayer').load();
            $('beatNow').textContent = 'Creá o seleccioná una lista para escuchar un audio.';
            $('openBeatFolder').disabled = true;
            $('beatsCount').textContent = '0 audios';
            $('beatsListTitle').textContent = 'Sin listas';
            $('beatsStatus').textContent = 'Todavía no hay listas. Usá «Nueva lista» para crear la primera.';
            $('beatsList').innerHTML = '<div class="beats-empty">No hay listas de Beats. Podés crear una nueva cuando quieras.</div>';
            return;
        }
        const result = await api('/api/beats?playlist_id=' + encodeURIComponent(selectedBeatPlaylistId));
        if (request !== beatsRequest || trail.at(-1) !== 'beats') return;
        renderBeats(result);
    } catch (error) {
        if (request === beatsRequest) $('beatsStatus').textContent = error.message;
    }
}
function renderBeats(result) {
    const beats = result.audios || [];
    const playlist = beatsPlaylists.find(item => item.id === selectedBeatPlaylistId);
    $('beatsCount').textContent = beats.length + (beats.length === 1 ? ' audio' : ' audios');
    $('beatsListTitle').textContent = playlist ? playlist.nombre : 'Mi lista de audios';
    $('beatsStatus').textContent = beats.length ? `Lista «${playlist?.nombre || 'Beats'}» guardada automáticamente.` : 'Esta lista está vacía. Usá “Agregar audios” para elegir archivos de tu PC.';
    if (selectedBeatId && !beats.some(item => item.id === selectedBeatId)) {
        selectedBeatId = null;
        $('beatPlayer').pause(); $('beatPlayer').removeAttribute('src'); $('beatPlayer').load();
        $('beatNow').textContent = 'Seleccioná un audio de la lista para escucharlo.';
        $('openBeatFolder').disabled = true;
    }
    $('beatsList').innerHTML = beats.length ? beats.map(item => `
      <div class="item beat-row" draggable="true" data-beat-row="${esc(item.id)}">
        <span class="beat-grip" title="Arrastrar para cambiar el orden" aria-hidden="true">⠿</span>
        <button class="beat-select" data-beat-select="${esc(item.id)}" aria-pressed="${item.id === selectedBeatId}">♫ <span><b>${esc(item.nombre)}</b><small class="muted" style="display:block">${esc(item.formato)} · ${item.disponible ? 'Disponible' : '<span class="beat-missing">No se encuentra en esta ubicación</span>'}</small></span></button>
        <div class="beat-actions"><button class="alt" data-beat-folder="${esc(item.id)}" title="Abrir carpeta" ${item.disponible ? '' : 'disabled'}>📁</button><button class="alt" data-beat-remove="${esc(item.id)}" title="Quitar de la lista">✕</button></div>
      </div>`).join('') : '<div class="beats-empty">Tu lista está vacía.</div>';
    for (const button of $('beatsList').querySelectorAll('[data-beat-select]')) button.addEventListener('click', () => selectBeat(button.dataset.beatSelect, beats));
    for (const button of $('beatsList').querySelectorAll('[data-beat-folder]')) button.addEventListener('click', () => openBeatFolder(button.dataset.beatFolder));
    for (const button of $('beatsList').querySelectorAll('[data-beat-remove]')) button.addEventListener('click', () => removeBeat(button.dataset.beatRemove));
    bindBeatReordering();
    if (selectedBeatId) {
        const selected = beats.find(item => item.id === selectedBeatId);
        if (selected) { $('beatNow').textContent = selected.nombre; $('openBeatFolder').disabled = !selected.disponible; }
    }
}
let draggedBeatId = null;
function bindBeatReordering() {
    const rows = $('beatsList').querySelectorAll('[data-beat-row]');
    rows.forEach(row => {
        row.addEventListener('dragstart', event => {
            draggedBeatId = row.dataset.beatRow;
            row.classList.add('beat-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', draggedBeatId);
        });
        row.addEventListener('dragover', event => {
            if (!draggedBeatId || draggedBeatId === row.dataset.beatRow) return;
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('beat-drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('beat-drop-target'));
        row.addEventListener('drop', async event => {
            event.preventDefault(); row.classList.remove('beat-drop-target');
            const sourceId = draggedBeatId || event.dataTransfer.getData('text/plain'); draggedBeatId = null;
            if (sourceId && sourceId !== row.dataset.beatRow) await moveBeatBefore(sourceId, row.dataset.beatRow);
        });
        row.addEventListener('dragend', () => { draggedBeatId = null; rows.forEach(item => item.classList.remove('beat-dragging', 'beat-drop-target')); });
    });
}
async function persistBeatOrder(ids) {
    try {
        await api('/api/beats/orden', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ids,playlist_id:selectedBeatPlaylistId})});
        await loadBeats(false);
    } catch (error) { report(error); await loadBeats(false); }
}
async function moveBeatBefore(sourceId, targetId) {
    try {
        const result = await api('/api/beats?playlist_id=' + encodeURIComponent(selectedBeatPlaylistId));
        const ids = (result.audios || []).map(item => item.id);
        const from = ids.indexOf(sourceId), to = ids.indexOf(targetId);
        if (from < 0 || to < 0 || from === to) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]); await persistBeatOrder(ids);
    } catch (error) { report(error); }
}
async function addBeats() {
    try {
        if (!selectedBeatPlaylistId) throw Error('Primero creá o seleccioná una lista de Beats.');
        if (!window.pywebview?.api?.choose_audio_files) throw Error('El selector de archivos local está disponible al abrir la aplicación de escritorio AudioTaller.');
        const paths = await window.pywebview.api.choose_audio_files();
        if (!paths || !paths.length) return;
        const result = await api('/api/beats', body({paths,playlist_id:selectedBeatPlaylistId}));
        $('beatsStatus').textContent = result.agregados + ' audio(s) agregado(s).' + (result.omitidos ? ' ' + result.omitidos + ' omitido(s).' : '');
        await loadBeats(true);
    } catch (error) { report(error); }
}
function selectBeat(id, beats) {
    const beat = beats.find(item => item.id === id);
    if (!beat || !beat.disponible) { report(Error('No se encuentra el archivo en su ubicación original.')); return; }
    selectedBeatId = id; $('beatNow').textContent = beat.nombre;
    $('beatPlayer').src = '/api/beats/' + encodeURIComponent(id) + '/audio'; $('beatPlayer').load();
    $('openBeatFolder').disabled = false; renderBeats({audios: beats});
}
async function openBeatFolder(id = selectedBeatId) {
    if (!id) return;
    try {
        if (!window.pywebview?.api?.open_location) throw Error('La apertura de carpetas requiere la aplicación de escritorio.');
        const result = await window.pywebview.api.open_location(id);
        if (!result) throw Error('No se pudo abrir la carpeta del audio.');
    } catch (error) { report(error); }
}
async function removeBeat(id) {
    if (!confirm('¿Quitar este audio de la lista? El archivo original no se borrará.')) return;
    try { await api('/api/beats/' + encodeURIComponent(id), {method:'DELETE'}); await loadBeats(true); }
    catch (error) { report(error); }
}
async function deleteBeatPlaylist() {
    const playlist = beatsPlaylists.find(item => item.id === selectedBeatPlaylistId);
    if (!playlist) return;
    const count = Number(playlist.cantidad) || 0;
    const detail = count === 1 ? '1 audio' : `${count} audios`;
    if (!confirm(`¿Eliminar la lista «${playlist.nombre}»? Contiene ${detail}. Se quitarán de AudioTaller, pero los archivos originales permanecerán en tu PC.`)) return;
    try {
        await api('/api/beats/playlists/' + encodeURIComponent(playlist.id), {method:'DELETE'});
        selectedBeatId = null;
        $('beatPlayer').pause(); $('beatPlayer').removeAttribute('src'); $('beatPlayer').load();
        $('beatNow').textContent = 'Seleccioná un audio de la lista para escucharlo.';
        $('openBeatFolder').disabled = true;
        selectedBeatPlaylistId = null;
        localStorage.removeItem('audiotaller.beats.playlist');
        await loadBeats(true);
    } catch (error) { report(error); }
}
function openBeatPlaylistDialog(mode) {
    beatPlaylistDialogMode = mode;
    const current = beatsPlaylists.find(item => item.id === selectedBeatPlaylistId);
    $('beatPlaylistDialogTitle').textContent = mode === 'create' ? 'Crear nueva lista' : 'Cambiar nombre de la lista';
    $('beatPlaylistName').value = mode === 'rename' ? (current?.nombre || '') : '';
    $('beatPlaylistDialog').showModal(); $('beatPlaylistName').focus();
}
$('beatPlaylistForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('beatPlaylistName').value.trim();
    if (!name) return;
    const submit = $('beatPlaylistForm').querySelector('[type=submit]'); submit.disabled = true;
    try {
        if (beatPlaylistDialogMode === 'create') {
            const created = await api('/api/beats/playlists', body({nombre:name}));
            selectedBeatPlaylistId = created.id; localStorage.setItem('audiotaller.beats.playlist', created.id);
        } else {
            await api('/api/beats/playlists/' + encodeURIComponent(selectedBeatPlaylistId), {method:'PATCH',body:JSON.stringify({nombre:name})});
        }
        $('beatPlaylistDialog').close(); await loadBeats(true);
    } catch (error) { report(error); }
    finally { submit.disabled = false; }
});
$('cancelBeatPlaylist').addEventListener('click', () => $('beatPlaylistDialog').close());
$('newBeatPlaylist').addEventListener('click', () => openBeatPlaylistDialog('create'));
$('renameBeatPlaylist').addEventListener('click', () => openBeatPlaylistDialog('rename'));
$('deleteBeatPlaylist').addEventListener('click', deleteBeatPlaylist);
$('beatsPlaylistSelect').addEventListener('change', async event => {
    selectedBeatPlaylistId = event.target.value || null;
    if (selectedBeatPlaylistId) localStorage.setItem('audiotaller.beats.playlist', selectedBeatPlaylistId);
    else localStorage.removeItem('audiotaller.beats.playlist');
    selectedBeatId = null; $('beatPlayer').pause(); $('beatPlayer').removeAttribute('src'); $('beatPlayer').load();
    $('beatNow').textContent = 'Seleccioná un audio de la lista para escucharlo.'; $('openBeatFolder').disabled = true;
    await loadBeats(false);
});
$('addBeats').addEventListener('click', addBeats);
$('openBeatFolder').addEventListener('click', () => openBeatFolder());


// Partituras: colecciones independientes, archivos originales y visor integrado.
let selectedScoreCollectionId = localStorage.getItem('audiotaller.scores.collection') || null;
let selectedScoreId = null;
let scoreCollections = [];
let scoreDialogMode = 'create';
let draggedScoreId = null;
let scoresRequest = 0;

async function loadScores(loadCollections = true) {
    const requestId = ++scoresRequest;
    try {
        if (loadCollections) {
            const data = await api('/api/scores/collections');
            scoreCollections = data.colecciones || [];
            if (!scoreCollections.some(x => x.id === selectedScoreCollectionId)) {
                const saved = localStorage.getItem('audiotaller.scores.collection');
                selectedScoreCollectionId = scoreCollections.some(x => x.id === saved) ? saved : (scoreCollections[0]?.id || null);
            }
            $('scoresCollectionSelect').innerHTML = scoreCollections.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('');
            $('scoresCollectionSelect').value = selectedScoreCollectionId || '';
            $('scoresCollectionSelect').disabled = !scoreCollections.length;
            $('renameScoreCollection').disabled = !selectedScoreCollectionId;
            $('deleteScoreCollection').disabled = !selectedScoreCollectionId;
            $('addScores').disabled = !selectedScoreCollectionId;
            if (selectedScoreCollectionId) localStorage.setItem('audiotaller.scores.collection', selectedScoreCollectionId);
            else localStorage.removeItem('audiotaller.scores.collection');
        }
        if (!selectedScoreCollectionId) {
            $('scoresCount').textContent = '0 partituras'; $('scoresListTitle').textContent = 'Sin colecciones';
            $('scoresStatus').textContent = 'Todavía no hay colecciones. Creá una para comenzar.';
            $('scoresList').innerHTML = '<div class="muted">No hay colecciones de partituras.</div>';
            clearScoreViewer(); return;
        }
        const data = await api('/api/scores?collection_id=' + encodeURIComponent(selectedScoreCollectionId));
        if (requestId !== scoresRequest || trail.at(-1) !== 'scores') return;
        renderScores(data);
    } catch (error) { if (requestId === scoresRequest) $('scoresStatus').textContent = error.message; }
}
function clearScoreViewer() {
    selectedScoreId = null; $('scoreNow').textContent = 'Seleccioná una partitura de la colección para verla.';
    $('openScoreFolder').disabled = true;
    $('scoreViewer').innerHTML = '<div class="score-viewer-empty">♫<br>La vista previa aparecerá acá.</div>';
}
function renderScores(data) {
    const items = data.partituras || [];
    const collection = scoreCollections.find(x => x.id === selectedScoreCollectionId);
    $('scoresCount').textContent = items.length + (items.length === 1 ? ' partitura' : ' partituras');
    $('scoresListTitle').textContent = collection?.nombre || 'Mis partituras';
    $('scoresStatus').textContent = items.length ? `Colección «${collection?.nombre || 'Partituras'}» guardada automáticamente.` : 'Esta colección está vacía. Usá «Agregar partituras» para elegir archivos de tu PC.';
    if (selectedScoreId && !items.some(x => x.id === selectedScoreId)) clearScoreViewer();
    $('scoresList').innerHTML = items.length ? items.map(item => `
      <div class="item score-row" draggable="true" data-score-row="${esc(item.id)}">
        <span class="score-grip" title="Arrastrar para cambiar el orden">⠿</span>
        <button class="score-select" data-score-select="${esc(item.id)}" aria-pressed="${item.id === selectedScoreId}"><span>▤ <b>${esc(item.nombre)}</b><small class="muted">${esc(item.formato)} · ${item.disponible ? 'Disponible' : '<span class="score-missing">No se encuentra en esta ubicación</span>'}</small></span></button>
        <div class="score-actions"><button class="alt" data-score-folder="${esc(item.id)}" title="Abrir carpeta" ${item.disponible ? '' : 'disabled'}>📁</button><button class="alt" data-score-remove="${esc(item.id)}" title="Quitar de la colección">✕</button></div>
      </div>`).join('') : '<div class="muted">Tu colección está vacía.</div>';
    for (const b of $('scoresList').querySelectorAll('[data-score-select]')) b.addEventListener('click', () => selectScore(b.dataset.scoreSelect, items));
    for (const b of $('scoresList').querySelectorAll('[data-score-folder]')) b.addEventListener('click', () => openScoreFolder(b.dataset.scoreFolder));
    for (const b of $('scoresList').querySelectorAll('[data-score-remove]')) b.addEventListener('click', () => removeScore(b.dataset.scoreRemove));
    bindScoreReordering();
    if (selectedScoreId) { const selected = items.find(x => x.id === selectedScoreId); if (selected) $('scoreNow').textContent = selected.nombre; }
}
function selectScore(id, items) {
    const item = items.find(x => x.id === id);
    if (!item || !item.disponible) { report(Error('No se encuentra el archivo en su ubicación original.')); return; }
    selectedScoreId = id; $('scoreNow').textContent = item.nombre; $('openScoreFolder').disabled = false;
    const url = '/api/scores/' + encodeURIComponent(id) + '/file';
    if (item.formato === 'PDF') $('scoreViewer').innerHTML = `<iframe title="Vista previa de ${esc(item.nombre)}" src="${url}"></iframe>`;
    else $('scoreViewer').innerHTML = `<img alt="Vista previa de ${esc(item.nombre)}" src="${url}">`;
    renderScores({partituras:items});
}
async function addScores() {
    try {
        if (!selectedScoreCollectionId) throw Error('Primero creá o seleccioná una colección.');
        if (!window.pywebview?.api?.choose_score_files) throw Error('El selector local está disponible al abrir la aplicación de escritorio AudioTaller.');
        const paths = await window.pywebview.api.choose_score_files(); if (!paths?.length) return;
        const result = await api('/api/scores', body({paths,collection_id:selectedScoreCollectionId}));
        $('scoresStatus').textContent = result.agregados + ' partitura(s) agregada(s).' + (result.omitidos ? ' ' + result.omitidos + ' omitida(s).' : '');
        await loadScores(true);
    } catch (error) { report(error); }
}
async function openScoreFolder(id=selectedScoreId) {
    if (!id) return;
    try {
        if (!window.pywebview?.api?.open_score_location) throw Error('La apertura de carpetas requiere la aplicación de escritorio.');
        if (!await window.pywebview.api.open_score_location(id)) throw Error('No se pudo abrir la carpeta de la partitura.');
    } catch (error) { report(error); }
}
async function removeScore(id) {
    if (!confirm('¿Quitar esta partitura de la colección? El archivo original no se borrará.')) return;
    try { await api('/api/scores/' + encodeURIComponent(id), {method:'DELETE'}); await loadScores(true); }
    catch (error) { report(error); }
}
async function deleteScoreCollection() {
    const collection = scoreCollections.find(x => x.id === selectedScoreCollectionId); if (!collection) return;
    const count = Number(collection.cantidad) || 0;
    if (!confirm(`¿Eliminar la colección «${collection.nombre}»? Se quitarán ${count} referencia(s) de AudioTaller, pero los archivos originales permanecerán en tu PC.`)) return;
    try {
        await api('/api/scores/collections/' + encodeURIComponent(collection.id), {method:'DELETE'});
        selectedScoreCollectionId = null; localStorage.removeItem('audiotaller.scores.collection'); clearScoreViewer(); await loadScores(true);
    } catch (error) { report(error); }
}
function openScoreCollectionDialog(mode) {
    scoreDialogMode = mode; const current = scoreCollections.find(x => x.id === selectedScoreCollectionId);
    $('scoreCollectionDialogTitle').textContent = mode === 'create' ? 'Crear nueva colección' : 'Cambiar nombre de la colección';
    $('scoreCollectionName').value = mode === 'rename' ? (current?.nombre || '') : '';
    $('scoreCollectionDialog').showModal(); $('scoreCollectionName').focus();
}
$('scoreCollectionForm').addEventListener('submit', async event => {
    event.preventDefault(); const name = $('scoreCollectionName').value.trim(); if (!name) return;
    const submit = $('scoreCollectionForm').querySelector('[type=submit]'); submit.disabled = true;
    try {
        if (scoreDialogMode === 'create') {
            const created = await api('/api/scores/collections', body({nombre:name}));
            selectedScoreCollectionId = created.id; localStorage.setItem('audiotaller.scores.collection',created.id);
        } else await api('/api/scores/collections/' + encodeURIComponent(selectedScoreCollectionId), {method:'PATCH',body:JSON.stringify({nombre:name})});
        $('scoreCollectionDialog').close(); await loadScores(true);
    } catch (error) { report(error); } finally { submit.disabled = false; }
});
function bindScoreReordering() {
    const rows = $('scoresList').querySelectorAll('[data-score-row]');
    rows.forEach(row => {
        row.addEventListener('dragstart', event => { draggedScoreId=row.dataset.scoreRow; row.classList.add('beat-dragging'); event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain',draggedScoreId); });
        row.addEventListener('dragover', event => { if (!draggedScoreId || draggedScoreId===row.dataset.scoreRow) return; event.preventDefault(); event.dataTransfer.dropEffect='move'; row.classList.add('beat-drop-target'); });
        row.addEventListener('dragleave', () => row.classList.remove('beat-drop-target'));
        row.addEventListener('drop', async event => { event.preventDefault(); row.classList.remove('beat-drop-target'); const source=draggedScoreId || event.dataTransfer.getData('text/plain'); draggedScoreId=null; if(source && source!==row.dataset.scoreRow) await moveScoreBefore(source,row.dataset.scoreRow); });
        row.addEventListener('dragend', () => { draggedScoreId=null; rows.forEach(x=>x.classList.remove('beat-dragging','beat-drop-target')); });
    });
}
async function moveScoreBefore(sourceId,targetId) {
    try {
        const data=await api('/api/scores?collection_id='+encodeURIComponent(selectedScoreCollectionId));
        const ids=(data.partituras||[]).map(x=>x.id); const from=ids.indexOf(sourceId),to=ids.indexOf(targetId);
        if(from<0||to<0||from===to)return; ids.splice(to,0,ids.splice(from,1)[0]);
        await api('/api/scores/orden',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,collection_id:selectedScoreCollectionId})});
        await loadScores(false);
    } catch(error) { report(error); await loadScores(false); }
}
$('scoresCollectionSelect').addEventListener('change', async event => {
    selectedScoreCollectionId=event.target.value||null;
    if(selectedScoreCollectionId)localStorage.setItem('audiotaller.scores.collection',selectedScoreCollectionId);else localStorage.removeItem('audiotaller.scores.collection');
    clearScoreViewer(); await loadScores(false);
});
$('addScores').addEventListener('click',addScores);
$('newScoreCollection').addEventListener('click',()=>openScoreCollectionDialog('create'));
$('renameScoreCollection').addEventListener('click',()=>openScoreCollectionDialog('rename'));
$('deleteScoreCollection').addEventListener('click',deleteScoreCollection);
$('openScoreFolder').addEventListener('click',()=>openScoreFolder());
$('cancelScoreCollection').addEventListener('click',()=>$('scoreCollectionDialog').close());
// Letras: organización de archivos TXT y DOCX en colecciones.
let lyricCollections=[], selectedLyricCollectionId=localStorage.getItem('audiotaller.lyrics.collection')||null;
let selectedLyricId=null, lyricDialogMode='create', draggedLyricId=null, lyricsRequest=0;
async function loadLyrics(preserve=false) {
    const req=++lyricsRequest;
    try {
        const data=await api('/api/lyrics/collections'); lyricCollections=data.colecciones||[];
        if(!preserve||!lyricCollections.some(x=>x.id===selectedLyricCollectionId)) {
            const saved=localStorage.getItem('audiotaller.lyrics.collection');
            selectedLyricCollectionId=lyricCollections.some(x=>x.id===saved)?saved:(lyricCollections[0]?.id||null);
        }
        $('lyricsCollectionSelect').innerHTML=lyricCollections.map(x=>`<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('');
        $('lyricsCollectionSelect').value=selectedLyricCollectionId||'';
        $('lyricsCollectionSelect').disabled=!lyricCollections.length;
        $('renameLyricCollection').disabled=!selectedLyricCollectionId;
        $('deleteLyricCollection').disabled=!selectedLyricCollectionId;
        $('addLyrics').disabled=!selectedLyricCollectionId;
        if(selectedLyricCollectionId)localStorage.setItem('audiotaller.lyrics.collection',selectedLyricCollectionId);else localStorage.removeItem('audiotaller.lyrics.collection');
        if(!selectedLyricCollectionId) {
            $('lyricsCount').textContent='0 letras'; $('lyricsListTitle').textContent='Sin colecciones';
            $('lyricsStatus').textContent='Todavía no hay colecciones. Creá una para comenzar.';
            $('lyricsList').innerHTML='<div class="muted">No hay colecciones de letras.</div>'; clearLyricViewer(); return;
        }
        const result=await api('/api/lyrics?collection_id='+encodeURIComponent(selectedLyricCollectionId));
        if(req!==lyricsRequest||trail.at(-1)!=='lyrics')return; renderLyrics(result);
    } catch(error) { if(req===lyricsRequest)$('lyricsStatus').textContent=error.message; }
}
function clearLyricViewer(){selectedLyricId=null;$('lyricNow').textContent='Seleccioná una letra de la colección para verla.';$('openLyricFolder').disabled=true;$('lyricViewer').textContent='♫\nEl contenido de la letra aparecerá acá.';}
function renderLyrics(data){
    const items=data.letras||[], collection=lyricCollections.find(x=>x.id===selectedLyricCollectionId);
    $('lyricsCount').textContent=items.length+(items.length===1?' letra':' letras'); $('lyricsListTitle').textContent=collection?.nombre||'Mis letras';
    $('lyricsStatus').textContent=items.length?`Colección «${collection?.nombre||'Letras'}» guardada automáticamente.`:'Esta colección está vacía. Usá «Agregar letras» para elegir archivos de tu PC.';
    if(selectedLyricId&&!items.some(x=>x.id===selectedLyricId))clearLyricViewer();
    $('lyricsList').innerHTML=items.length?items.map(item=>`<div class="item lyric-row" draggable="true" data-lyric-row="${esc(item.id)}"><span class="lyric-grip" title="Arrastrar para cambiar el orden">⠿</span><button class="lyric-select" data-lyric-select="${esc(item.id)}" aria-pressed="${item.id===selectedLyricId}"><span>▤ <b>${esc(item.nombre)}</b><small class="muted">${esc(item.formato)} · ${item.disponible?'Disponible':'No se encuentra en esta ubicación'}</small></span></button><div class="lyric-actions"><button class="alt" data-lyric-folder="${esc(item.id)}" title="Abrir carpeta" ${item.disponible?'':'disabled'}>📁</button><button class="alt" data-lyric-remove="${esc(item.id)}" title="Quitar de la colección">✕</button></div></div>`).join(''):'<div class="muted">Tu colección está vacía.</div>';
    for(const b of $('lyricsList').querySelectorAll('[data-lyric-select]'))b.addEventListener('click',()=>selectLyric(b.dataset.lyricSelect,items));
    for(const b of $('lyricsList').querySelectorAll('[data-lyric-folder]'))b.addEventListener('click',()=>openLyricFolder(b.dataset.lyricFolder));
    for(const b of $('lyricsList').querySelectorAll('[data-lyric-remove]'))b.addEventListener('click',()=>removeLyric(b.dataset.lyricRemove));
    bindLyricReordering();
}
async function selectLyric(id,items){
    const item=items.find(x=>x.id===id); if(!item||!item.disponible){report(Error('No se encuentra el archivo en su ubicación original.'));return;}
    selectedLyricId=id;$('lyricNow').textContent=item.nombre;$('openLyricFolder').disabled=false;$('lyricViewer').textContent='Cargando letra…';renderLyrics({letras:items});
    try{const response=await fetch('/api/lyrics/'+encodeURIComponent(id)+'/file');if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'No se pudo abrir la letra.');}$('lyricViewer').textContent=await response.text();}
    catch(error){$('lyricViewer').textContent=error.message;report(error);}
}
async function addLyrics(){
    try{if(!selectedLyricCollectionId)throw Error('Primero creá o seleccioná una colección.');if(!window.pywebview?.api?.choose_lyric_files)throw Error('El selector local está disponible al abrir la aplicación de escritorio AudioTaller.');const paths=await window.pywebview.api.choose_lyric_files();if(!paths?.length)return;const result=await api('/api/lyrics',body({paths,collection_id:selectedLyricCollectionId}));$('lyricsStatus').textContent=result.agregados+' letra(s) agregada(s).'+(result.omitidos?' '+result.omitidos+' omitida(s).':'');await loadLyrics(true);}
    catch(error){report(error);}
}
async function openLyricFolder(id=selectedLyricId){if(!id)return;try{if(!window.pywebview?.api?.open_lyric_location)throw Error('La apertura de carpetas requiere la aplicación de escritorio.');if(!await window.pywebview.api.open_lyric_location(id))throw Error('No se pudo abrir la carpeta de la letra.');}catch(error){report(error);}}
async function removeLyric(id){if(!confirm('¿Quitar esta letra de la colección? El archivo original no se borrará.'))return;try{await api('/api/lyrics/'+encodeURIComponent(id),{method:'DELETE'});await loadLyrics(true);}catch(error){report(error);}}
async function deleteLyricCollection(){const collection=lyricCollections.find(x=>x.id===selectedLyricCollectionId);if(!collection)return;const count=Number(collection.cantidad)||0;if(!confirm(`¿Eliminar la colección «${collection.nombre}»? Se quitarán ${count} referencia(s) de AudioTaller, pero los archivos originales permanecerán en tu PC.`))return;try{await api('/api/lyrics/collections/'+encodeURIComponent(collection.id),{method:'DELETE'});selectedLyricCollectionId=null;localStorage.removeItem('audiotaller.lyrics.collection');clearLyricViewer();await loadLyrics(true);}catch(error){report(error);}}
function openLyricCollectionDialog(mode){lyricDialogMode=mode;const current=lyricCollections.find(x=>x.id===selectedLyricCollectionId);$('lyricCollectionDialogTitle').textContent=mode==='create'?'Crear nueva colección':'Cambiar nombre de la colección';$('lyricCollectionName').value=mode==='rename'?(current?.nombre||''):'';$('lyricCollectionDialog').showModal();$('lyricCollectionName').focus();}
$('lyricCollectionForm').addEventListener('submit',async event=>{event.preventDefault();const name=$('lyricCollectionName').value.trim();if(!name)return;const submit=$('lyricCollectionForm').querySelector('[type=submit]');submit.disabled=true;try{if(lyricDialogMode==='create'){const created=await api('/api/lyrics/collections',body({nombre:name}));selectedLyricCollectionId=created.id;localStorage.setItem('audiotaller.lyrics.collection',created.id);}else await api('/api/lyrics/collections/'+encodeURIComponent(selectedLyricCollectionId),{method:'PATCH',body:JSON.stringify({nombre:name})});$('lyricCollectionDialog').close();await loadLyrics(true);}catch(error){report(error);}finally{submit.disabled=false;}});
function bindLyricReordering(){const rows=$('lyricsList').querySelectorAll('[data-lyric-row]');rows.forEach(row=>{row.addEventListener('dragstart',event=>{draggedLyricId=row.dataset.lyricRow;row.classList.add('beat-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',draggedLyricId);});row.addEventListener('dragover',event=>{if(!draggedLyricId||draggedLyricId===row.dataset.lyricRow)return;event.preventDefault();event.dataTransfer.dropEffect='move';row.classList.add('beat-drop-target');});row.addEventListener('dragleave',()=>row.classList.remove('beat-drop-target'));row.addEventListener('drop',async event=>{event.preventDefault();row.classList.remove('beat-drop-target');const source=draggedLyricId||event.dataTransfer.getData('text/plain');draggedLyricId=null;if(source&&source!==row.dataset.lyricRow)await moveLyricBefore(source,row.dataset.lyricRow);});row.addEventListener('dragend',()=>{draggedLyricId=null;rows.forEach(x=>x.classList.remove('beat-dragging','beat-drop-target'));});});}
async function moveLyricBefore(sourceId,targetId){try{const data=await api('/api/lyrics?collection_id='+encodeURIComponent(selectedLyricCollectionId));const ids=(data.letras||[]).map(x=>x.id),from=ids.indexOf(sourceId),to=ids.indexOf(targetId);if(from<0||to<0||from===to)return;ids.splice(to,0,ids.splice(from,1)[0]);await api('/api/lyrics/orden',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,collection_id:selectedLyricCollectionId})});await loadLyrics(false);}catch(error){report(error);await loadLyrics(false);}}
$('lyricsCollectionSelect').addEventListener('change',async event=>{selectedLyricCollectionId=event.target.value||null;if(selectedLyricCollectionId)localStorage.setItem('audiotaller.lyrics.collection',selectedLyricCollectionId);else localStorage.removeItem('audiotaller.lyrics.collection');clearLyricViewer();await loadLyrics(false);});
$('addLyrics').addEventListener('click',addLyrics);$('newLyricCollection').addEventListener('click',()=>openLyricCollectionDialog('create'));$('renameLyricCollection').addEventListener('click',()=>openLyricCollectionDialog('rename'));$('deleteLyricCollection').addEventListener('click',deleteLyricCollection);$('openLyricFolder').addEventListener('click',()=>openLyricFolder());$('cancelLyricCollection').addEventListener('click',()=>$('lyricCollectionDialog').close());

