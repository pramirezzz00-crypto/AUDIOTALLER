// Catálogo y playlists comparten identificadores de archivos. Ninguna selección
// mueve medios ni cambia la sesión del DAW; cada entrega conserva una instantánea.
let catalogOffset=0,catalogSequence=0,catalogCache=[],catalogTotal=0;
const catalogSelected=new Set();
let playlistCurrent=null,playlistBusy=false,playlistSequence=0;
let playlistLoadRequest=0;
const audioClasses=['Demo','Maqueta','Grabación','Mezcla','Master','Referencia','Otro'];

async function openCatalog(songId=''){
    if(songId){$('catalogFilters').reset();catalogOffset=0;catalogSelected.clear();}
    $('catalogFilters').elements.cancion_id.value=songId;
    const [people,productions]=await Promise.all([api('/api/personas'),api('/api/proyectos')]);
    const artistFilter=$('catalogArtist').value,albumFilter=$('catalogAlbum').value;
    $('catalogArtist').innerHTML='<option value="">Todos</option>'+optionPeople(people,artistFilter);
    $('catalogAlbum').innerHTML='<option value="">Todos</option>'+productions.discos.map(album=>`<option value="${album.id}" ${album.id===albumFilter?'selected':''}>${esc(album.nombre)} · ${esc(album.artista)}</option>`).join('');
    go('catalogPane');
}
function clearCatalogFilters(){$('catalogFilters').reset();$('catalogFilters').elements.cancion_id.value='';loadCatalog(true);}
function catalogPage(delta){catalogOffset=Math.max(0,catalogOffset+delta*20);loadCatalog();}
async function loadCatalog(reset=false){
    if(reset){catalogOffset=0;catalogSelected.clear();}
    const sequence=++catalogSequence;
    const params=new URLSearchParams(new FormData($('catalogFilters')));
    params.set('offset',catalogOffset);params.set('limit','20');
    try{
        const result=await api('/api/catalogo?'+params);
        if(sequence!==catalogSequence || trail.at(-1)!=='catalogPane')return;
        disposeWavePlayers();catalogCache=result.audios;catalogTotal=result.total;
        $('catalogCount').textContent=`${catalogTotal} audios${params.get('cancion_id')?' · Canción seleccionada (Limpiar para ver todo)':''} · ${catalogSelected.size} seleccionados`;
        for(const [key,id] of [['genero','catalogGenres'],['tonalidad','catalogKeys'],['idioma','catalogLanguages']])
            $(id).innerHTML=result.opciones[key].map(value=>`<option value="${esc(value)}">`).join('');
        $('catalogAudios').innerHTML=catalogCache.map(audio=>`<article class="card catalog-audio">
          <div class="heading"><label class="filter-box"><input type="checkbox" data-catalog-select="${audio.id}" ${catalogSelected.has(audio.id)?'checked':''}>Seleccionar</label>
            <div><strong>${esc(audio.titulo)}</strong><p class="muted">${esc(audio.artista)} · ${esc(audio.disco || 'Canción suelta')}</p></div>
            <span class="audio-class">${esc(audio.clase)} ${esc(audio.version)}</span>
            <button class="alt" onclick="openSong('${audio.cancion_id}')">Ver canción</button></div>
          <p class="muted">${audioTechnicalText(audio)} · ${esc(audio.genero || 'Género sin definir')} · ${esc(audio.bpm || '—')} BPM · ${esc(audio.tonalidad || 'Sin tonalidad')}
          ${audio.sesion ? ' · Sesión: '+esc(audio.sesion):''}${audio.isrc ? ' · ISRC: '+esc(audio.isrc):''}${audio.con_enlace?' · Con enlaces de publicación':''}</p>
          ${audio.disponible?audioFilesMarkup([audio],false):`<p>Archivo no disponible: ${esc(audio.nombre)}</p><button class="alt" onclick="audioDetailsDialog('${audio.id}')">Consultar clasificación</button>`}
        </article>`).join('') || '<p class="muted">No hay audios que coincidan. Incorporá o vinculá un archivo desde su etapa de producción, o limpiá los filtros.</p>';
        $('catalogAudios').querySelectorAll('[data-catalog-select]').forEach(input=>input.onchange=()=>{
            if(input.checked)catalogSelected.add(input.dataset.catalogSelect);else catalogSelected.delete(input.dataset.catalogSelect);
            $('catalogCount').textContent=`${catalogTotal} audios · ${catalogSelected.size} seleccionados`;
        });
        $('catalogPrev').disabled=catalogOffset===0;$('catalogNext').disabled=catalogOffset+20>=catalogTotal;
        setupWavePlayers($('catalogAudios'));
    }catch(error){report(error);}
}
function audioTechnicalText(audio){
    const info=audio.tecnica || {};
    return [audio.nombre.split('.').pop().toUpperCase(),formatRate(info.frecuencia),
        info.bits?`${info.bits}\u00a0bit`:'',info.canales?(info.canales===1?'mono':info.canales===2?'estéreo':`${info.canales} canales`):'',info.duracion?formatWaveTime(info.duracion):'',
        audio.tamano!==null && audio.tamano!==undefined?formatBytes(audio.tamano):''].filter(Boolean).map(esc).join(' · ');
}
async function toggleAudioFavorite(id,button){
    button.disabled=true;
    try{
        const value=button.getAttribute('aria-pressed')!=='true';
        await api('/api/catalogo/'+id,body({favorito:value}));
        document.querySelectorAll('[data-star]').forEach(star=>{if(star.dataset.star===id){star.textContent=value?'★':'☆';star.setAttribute('aria-pressed',String(value));}});
        for(const file of workflow?.archivos || [])if(file.id===id)file.favorito=value;
        for(const file of catalogCache)if(file.id===id)file.favorito=value;
        if(trail.at(-1)==='catalogPane' && $('catalogFilters').elements.favoritos.checked && !value)await loadCatalog();
    }finally{button.disabled=false;}
}
async function audioDetailsDialog(id){
    const audio=await api('/api/catalogo/'+id);
    const registration=await api('/api/registro/obra/'+audio.cancion_id);
    formDialog('Audio · '+audio.nombre,`<p>${audioTechnicalText(audio)}</p>
      <p class="muted">${esc(audio.artista)} · ${esc(audio.titulo)} · ${esc(audio.sesion || 'Sin sesión asociada')}</p>
      <label>Clasificación<select name="clase">${audioClasses.map(kind=>`<option ${audio.clase===kind?'selected':''}>${kind}</option>`).join('')}</select></label>
      <label>Versión del audio<input name="version" value="${esc(audio.version)}" placeholder="V1, revisión artista, master streaming…"></label>
      <label>Asociar a grabación publicable<select name="grabacion_id"><option value="">Sin asociar</option>${registration.grabaciones.map(record=>`<option value="${record.id}" ${record.id===audio.grabacion_id?'selected':''}>${esc(record.nombre)} · ${esc(record.isrc || 'Sin ISRC')}</option>`).join('')}</select></label>
      <label><input type="checkbox" name="favorito" ${audio.favorito?'checked':''}> ★ Favorito para playlist</label>
      <label>Comentarios internos del audio<textarea name="notas">${esc(audio.notas_audio)}</textarea></label>
      <p class="muted">No modifica el WAV, su nombre ni la sesión del DAW. La versión es una etiqueta del archivo de audio.</p>`,async data=>{
        data.favorito=$('iterationForm').elements.favorito.checked;
        await api('/api/catalogo/'+id,body(data));
        if(trail.at(-1)==='songPane')await openSong(currentSong.id);
        else if(trail.at(-1)==='catalogPane')await loadCatalog();
        else if(playlistCurrent)await selectPlaylist(playlistCurrent.id);
    });
}
async function addSelectedToPlaylist(){
    if(!catalogSelected.size)throw Error('Seleccioná al menos un audio del Catálogo.');
    await choosePlaylist([...catalogSelected]);
}
async function choosePlaylist(ids){
    const lists=await api('/api/playlists');
    formDialog('Agregar audios a playlist',`<label>Destino<select name="playlist"><option value="">Nueva playlist</option>${lists.map(list=>`<option value="${list.id}">${esc(list.nombre)}</option>`).join('')}</select></label>
      <label>Nombre para playlist nueva<input name="nombre" value="Selección de producción"></label><p>${ids.length} audios seleccionados. Se conservan los archivos originales.</p>`,async data=>{
        let old=data.playlist?await api('/api/playlists/'+data.playlist):null;
        const payload={nombre:old?.nombre || data.nombre,notas:old?.notas || '',revision:old?.revision,
            archivos:[...new Set([...(old?.audios.map(audio=>audio.id) || []),...ids])]};
        const result=await api('/api/playlists'+(old?'/'+old.id:''),body(payload));
        playlistCurrent=result;go('playlistsPane');
    });
}
async function playlistFromFavorites(){
    const productions=await api('/api/proyectos');let candidates=[],generation=0;
    formDialog('Nueva playlist desde favoritos',`<label>Nombre<input name="nombre" value="Revisión para el artista" required></label>
      <label>Disco<select id="favoriteAlbum"><option value="">Todos los discos y canciones</option><option value="loose">Solo canciones sueltas</option>${productions.discos.map(album=>`<option value="${album.id}">${esc(album.nombre)} · ${esc(album.artista)}</option>`).join('')}</select></label>
      <p id="favoriteStatus" role="status"></p><div id="favoriteChoices"></div>`,async data=>{
        const ids=[...$('favoriteChoices').querySelectorAll('input:checked')].map(input=>input.value);
        if(!ids.length)throw Error('Seleccioná algún favorito disponible.');
        playlistCurrent=await api('/api/playlists',body({nombre:data.nombre,archivos:ids}));go('playlistsPane');
    },form=>{
        const load=async()=>{
            const sequence=++generation,box=$('favoriteChoices'),value=$('favoriteAlbum').value;
            $('iterationSubmit').disabled=true;box.replaceChildren();$('favoriteStatus').textContent='Buscando favoritos…';
            try{
                const result=await api('/api/catalogo?favoritos=1&limit=500'+(value && value!=='loose'?'&disco_id='+value:''));
                if(sequence!==generation || !box.isConnected)return;
                candidates=result.audios.filter(audio=>value!=='loose' || !audio.disco_id);
                $('favoriteStatus').textContent=candidates.length+' favoritos'+(result.total>500?' (mostrando hasta 500)':'');
                box.innerHTML=candidates.map(audio=>`<label class="filter-box"><input type="checkbox" value="${audio.id}" ${audio.disponible?'checked':'disabled'}>${esc(audio.titulo)} · ${esc(audio.clase)} ${esc(audio.version)} · ${esc(audio.nombre)}${audio.disponible?'':' (no disponible)'}</label>`).join('');
            }catch(error){if(box.isConnected)$('favoriteStatus').textContent=error.message;}
            finally{if(sequence===generation && box.isConnected)$('iterationSubmit').disabled=false;}
        };
        $('favoriteAlbum').onchange=load;load();
    });
}
function openPlaylists(){go('playlistsPane');}
async function loadPlaylists(){
    const sequence=++playlistSequence;
    try{
        const lists=await api('/api/playlists');
        if(sequence!==playlistSequence || trail.at(-1)!=='playlistsPane')return;
        $('playlistLibrary').innerHTML=lists.map(list=>`<button class="alt playlist-card" aria-pressed="${playlistCurrent?.id===list.id}" onclick="selectPlaylist('${list.id}').catch(report)"><strong>☷ ${esc(list.nombre)}</strong><span>${list.total} audios</span></button>`).join('') || '<p class="muted">Todavía no hay playlists.</p>';
        if(playlistCurrent)await selectPlaylist(playlistCurrent.id);
        else if(lists.length)await selectPlaylist(lists[0].id);
    }catch(error){report(error);}
}
async function selectPlaylist(id){
    const request=++playlistLoadRequest;
    const result=await api('/api/playlists/'+id);
    if(request!==playlistLoadRequest || trail.at(-1)!=='playlistsPane')return;
    playlistCurrent=result;
    $('playlistLibrary').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',button.getAttribute('onclick').includes(id)));
    $('playlistDetail').innerHTML=`<div class="heading"><div><h2>${esc(result.nombre)}</h2><p class="muted">${result.audios.length} audios · ${formatWaveTime(result.duracion)} de WAV conocidos</p></div><button class="alt" onclick="editPlaylistDialog()">Editar datos</button></div>
      <p>${esc(result.notas)}</p><div class="row"><button onclick="publishWebDialog().catch(report)">Publicar / actualizar web</button><button class="alt" onclick="feedbackDialog({playlist_id:playlistCurrent.id}).catch(report)">Devoluciones del artista</button><button class="alt" onclick="deliveryDialog().catch(report)">Vista local / entrega</button><button class="alt" onclick="openCatalog()">Agregar desde Catálogo</button><button class="alt" onclick="playlistFromFavorites().catch(report)">Nueva desde favoritos</button></div>
      <div id="playlistTracks" class="list">${result.audios.map((audio,index)=>`<article class="playlist-track" draggable="true" data-playlist-index="${index}">
        <div class="heading"><span class="muted">${index+1}</span><div class="playlist-track-name"><strong>${esc(audio.titulo)}</strong><small>${esc(audio.artista)} · ${esc(audio.nombre)}</small><span class="audio-class">${esc(audio.clase)} ${esc(audio.version)}</span></div>
        <button class="alt" onclick="audioDetailsDialog('${audio.id}')">Detalles</button><button class="alt" ${index===0?'disabled':''} aria-label="Subir ${esc(audio.nombre)}" onclick="movePlaylistItem(${index},${index-1})">↑</button><button class="alt" ${index===result.audios.length-1?'disabled':''} aria-label="Bajar ${esc(audio.nombre)}" onclick="movePlaylistItem(${index},${index+1})">↓</button><button class="alt" onclick="removePlaylistItem(${index})">Quitar</button></div>
        <p class="muted">${audioTechnicalText(audio)}</p>${audio.disponible?`<audio controls preload="none" src="/api/produccion/archivo/${audio.id}" aria-label="${esc(audio.nombre)}"></audio>`:'<p class="muted">Archivo no disponible. Revisá la unidad desde la canción.</p>'}</article>`).join('') || '<p class="muted">Esta playlist está vacía. Agregá audios desde el Catálogo o importalos abajo.</p>'}</div>
      <label id="playlistDrop" class="drop-zone">Arrastrá audios o elegilos para incorporar a una canción y a esta playlist<input type="file" multiple accept="audio/*,.wav,.flac,.aif,.aiff"><span role="status"></span></label>
      <p class="muted">Ordená arrastrando las filas o con ↑ / ↓. Los originales se conservan. Solo escucha no impide la captura de audio.</p>`;
    $('playlistTracks').querySelectorAll('audio').forEach(audio=>audio.onplay=()=>document.querySelectorAll('main audio').forEach(other=>{if(other!==audio)other.pause();}));
    let dragging=null;
    $('playlistTracks').querySelectorAll('[data-playlist-index]').forEach(row=>{
        row.ondragstart=event=>{if(event.target.closest('button,audio')){event.preventDefault();return;}dragging=Number(row.dataset.playlistIndex);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(dragging));};
        row.ondragover=event=>{if(dragging!==null)event.preventDefault();};
        row.ondrop=event=>{if(dragging===null)return;event.preventDefault();movePlaylistItem(dragging,Number(row.dataset.playlistIndex));dragging=null;};
        row.ondragend=()=>dragging=null;
    });
    bindDropZone($('playlistDrop'),files=>importCatalogAudio(files,result.id).catch(report));
}
async function updatePlaylistItems(ids){
    if(playlistBusy)return;playlistBusy=true;
    try{
        const old=playlistCurrent;
        playlistCurrent=await api('/api/playlists/'+old.id,body({nombre:old.nombre,notas:old.notas,revision:old.revision,archivos:ids}));
        await loadPlaylists();
    }catch(error){report(error);}finally{playlistBusy=false;}
}
function movePlaylistItem(from,to){if(playlistBusy || to<0 || to>=playlistCurrent.audios.length || from===to)return;const ids=playlistCurrent.audios.map(audio=>audio.id);ids.splice(to,0,ids.splice(from,1)[0]);updatePlaylistItems(ids);}
function removePlaylistItem(index){if(confirm('¿Quitar el audio de esta playlist? El archivo original se conserva.'))updatePlaylistItems(playlistCurrent.audios.filter((_,i)=>i!==index).map(audio=>audio.id));}
async function newPlaylistDialog(){formDialog('Nueva playlist','<label>Nombre<input name="nombre" required maxlength="150"></label><label>Notas internas<textarea name="notas"></textarea></label>',async data=>{playlistCurrent=await api('/api/playlists',body({...data,archivos:[]}));go('playlistsPane');await loadPlaylists();});}
function editPlaylistDialog(){const old=playlistCurrent;formDialog('Datos de playlist',`<label>Nombre<input name="nombre" required maxlength="150" value="${esc(old.nombre)}"></label><label>Notas internas<textarea name="notas">${esc(old.notas)}</textarea></label>`,async data=>{playlistCurrent=await api('/api/playlists/'+old.id,body({...data,revision:old.revision,archivos:old.audios.map(audio=>audio.id)}));await loadPlaylists();});}
async function importCatalogAudio(initialFiles=[],pid=''){
    const productions=await api('/api/proyectos');let chosen=Array.from(initialFiles || []),imported=[];
    formDialog('Incorporar audios',`<p class="muted">Se copiarán conservando los originales y se asociarán a la canción y etapa elegidas.</p>
      <label>Canción<select name="song">${productions.canciones.map(song=>`<option value="${song.id}" ${song.id===currentSong?.id?'selected':''}>${esc(song.titulo)} · ${esc(song.artista)}</option>`).join('')}</select></label>
      <label>Etapa<select name="stage"><option value="demo">Demo</option><option value="maqueta">Maqueta</option><option value="grabacion">Grabación</option><option value="mezcla" selected>Mezcla</option><option value="mastering">Mastering</option></select></label>
      <label id="catalogImportDrop" class="drop-zone">Arrastrá audios o elegilos<input type="file" multiple accept="audio/*,.wav,.flac,.aif,.aiff"><span role="status">${chosen.map(file=>esc(file.name)).join(', ')}</span></label>
      <p id="catalogImportStatus" role="status"></p>`,async data=>{
        if(!data.song)throw Error('Primero creá una canción en Producciones.');
        if(!chosen.length)throw Error('Elegí al menos un audio.');
        const invalid=chosen.find(file=>! /\.(wav|mp3|flac|ogg|m4a|aac|opus|aif|aiff)$/i.test(file.name));
        if(invalid)throw Error('Solo se admiten audios: '+invalid.name);
        // Conserva los ID importados si hay un fallo parcial; reintentar no duplica archivos.
        for(let i=imported.length;i<chosen.length;i++){
            $('catalogImportStatus').textContent=`Importando ${i+1} de ${chosen.length}…`;
            const form=new FormData();form.append('file',chosen[i]);
            const response=await fetch('/api/produccion/'+data.song+'/archivos/'+data.stage,{method:'POST',body:form});
            if(!response.ok)throw Error((await response.json()).error || 'Falló la importación. Podés reintentar.');
            imported.push((await response.json()).id);
        }
        if(pid){const list=await api('/api/playlists/'+pid);playlistCurrent=await api('/api/playlists/'+pid,body({nombre:list.nombre,notas:list.notas,revision:list.revision,archivos:[...new Set([...list.audios.map(audio=>audio.id),...imported])]}));await loadPlaylists();}
        else await loadCatalog(true);
    },form=>bindDropZone($('catalogImportDrop'),files=>{
        if(imported.length){$('catalogImportStatus').textContent='Terminá este lote antes de elegir otros archivos.';return;}
        chosen=Array.from(files);$('catalogImportDrop').querySelector('[role=status]').textContent=chosen.map(file=>file.name).join(', ');
    }));
}
async function deliveryDialog(){
    const list=playlistCurrent,deliveries=await api('/api/playlists/'+list.id+'/entregas');
    formDialog('Preparar entrega de escucha',`<p class="muted">La selección queda fija aunque después cambies la playlist. No se incluyen notas internas. Vista previa local; el portal de Internet requiere alojamiento.</p>
      <label>Nombre público<input name="nombre" value="${esc(list.nombre)}" required maxlength="150"></label>
      <label>Vence en días<input name="dias" type="number" min="1" max="365" value="7" required></label>
      <label>Clave opcional<input name="clave" type="password" autocomplete="new-password" maxlength="256"></label>
      <label><input type="checkbox" name="descarga"> Permitir descargar originales</label>
      <p class="muted">Solo escucha limita las opciones de descarga; no evita que alguien capture el audio reproducido.</p>
      <h3>Entregas anteriores</h3><div>${deliveries.map((entry,index)=>`<p>${esc(entry.nombre)} · ${entry.revocada?'Revocada':entry.vence*1000<Date.now()?'Vencida':'Activa'} · ${entry.descarga?'Con descarga':'Solo escucha'} ${!entry.revocada?`<button type="button" class="alt" data-revoke="${index}">Revocar ahora</button>`:''}</p>`).join('') || '<p>Sin entregas.</p>'}</div>`,async data=>{
        data.descarga=$('iterationForm').elements.descarga.checked;
        const delivery=await api('/api/playlists/'+list.id+'/entregas',body(data));
        $('iterationDialog').addEventListener('close',()=>showDeliveryLink(delivery),{once:true});
    },form=>form.querySelectorAll('[data-revoke]').forEach(button=>button.onclick=async()=>{
        if(!confirm('¿Revocar ahora esta entrega? Dejará de permitir nuevos accesos.'))return;
        try{await api('/api/entregas/'+deliveries[Number(button.dataset.revoke)].id+'/revocar',body({}));button.textContent='Revocada';button.disabled=true;}catch(error){$('iterationError').textContent=error.message;}
    }));
}
function showDeliveryLink(delivery){
    const url=location.origin+delivery.ruta;
    formDialog('Entrega preparada · vista local',`<p>Esta dirección funciona en esta computadora mientras AudioTaller esté abierto. Para el portal público se debe configurar alojamiento y HTTPS.</p>
      <label>Dirección local (guardala si la necesitás)<input id="localDeliveryUrl" readonly value="${esc(url)}"></label>
      <p>Vence: ${new Date(delivery.vence*1000).toLocaleString()}</p><button type="button" class="alt" id="copyDeliveryUrl">Copiar dirección local</button><button type="button" id="previewDelivery">Ver como artista</button>`,async()=>{});
    $('iterationSubmit').textContent='Listo';
    $('copyDeliveryUrl').onclick=async()=>{try{await navigator.clipboard.writeText(url);$('copyDeliveryUrl').textContent='Copiada';}catch{$('localDeliveryUrl').focus();$('localDeliveryUrl').select();}};
    $('previewDelivery').onclick=()=>{$('portalFrame').src=delivery.ruta;$('portalPreview').showModal();};
}
function closePortalPreview(){$('portalFrame').src='about:blank';$('portalPreview').close();}
$('portalPreview').addEventListener('cancel',event=>{event.preventDefault();closePortalPreview();});
