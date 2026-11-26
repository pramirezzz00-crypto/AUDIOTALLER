// Configuración inicial del proyecto propio. El estado público nunca incluye
// tokens de Google. Publicar requiere confirmar los archivos compartidos.
let lastCloudResult=null;
const cloudDelay=()=>new Promise(resolve=>setTimeout(resolve,1000));
async function cloudOperation(url,data,status){
    const task=await api(url,body(data));
    while(true){
        const result=await api('/api/portal/tareas/'+task.id);
        if(status?.isConnected)status.textContent=result.mensaje || 'Procesando…';
        if(result.estado==='error')throw Error(result.mensaje);
        if(result.estado==='completado'){lastCloudResult=result.resultado;return result.resultado;}
        await cloudDelay();
    }
}
const PORTAL_GUIDE_URL='/static/docs/Instructivo-Portal-del-artista-AudioTaller.pdf';
async function downloadPortalGuide(){
    if(window.pywebview?.api?.save_portal_guide){const path=await window.pywebview.api.save_portal_guide();if(path)notify('Instructivo guardado en '+path);return;}
    const link=document.createElement('a');link.href=PORTAL_GUIDE_URL;link.download='Instructivo-Portal-del-artista-AudioTaller.pdf';document.body.append(link);link.click();link.remove();
}
async function copyPortalAiPrompt(button){
    const text=await (await fetch('/static/docs/prompt-asistencia-ia-portal.txt')).text();
    if(window.pywebview?.api?.copy_text&&await window.pywebview.api.copy_text(text)){if(button)button.textContent='Prompt copiado';return notify('Prompt copiado: pegalo en tu IA');}
    try{await navigator.clipboard.writeText(text);if(button)button.textContent='Prompt copiado';notify('Prompt copiado: pegalo en tu IA');}
    catch{const box=document.createElement('textarea');box.readOnly=true;box.value=text;(button||document.body).after(box);box.select();}
}
function portalGuideDialog(){
    formDialog('Instructivo · Gestionar tu Portal del artista',`<p>Guía paso a paso para crear, conectar y mantener la página web donde tus artistas escuchan las mezclas y te dejan devoluciones. Está pensada para hacerla sin saber programar, aunque sea la primera vez que usás Google Drive, Firebase o una API.</p>
      <ul><li>Preparar Firebase y Google Cloud gratis (plan Spark).</li><li>Conectar AudioTaller e instalar el portal.</li><li>Publicar playlists y compartirlas por WhatsApp.</li><li>Responder devoluciones y enviar la corrección con antes/después.</li><li>Problemas frecuentes y qué hacer con cada mensaje.</li></ul>
      <div class="row"><button type="button" id="portalGuideSave">Descargar instructivo (PDF)</button><button type="button" class="alt" id="portalGuidePrompt">Copiar prompt de asistencia con IA</button></div>
      <p class="muted">El prompt sirve para pegarlo en Claude, ChatGPT, Gemini u otra IA: te guía pantalla por pantalla y te ayuda con los errores. El instructivo viene incluido en AudioTaller; no necesita internet para descargarlo.</p>`,async()=>{},()=>{
        $('iterationSubmit').textContent='Cerrar';
        $('portalGuideSave').onclick=()=>downloadPortalGuide().catch(report);
        $('portalGuidePrompt').onclick=event=>copyPortalAiPrompt(event.currentTarget).catch(report);
    });
}
async function portalSetupDialog(){
    const state=await api('/api/portal/config'),config=state.config;
    formDialog('Conectar portal del artista',`<p>Conectá tu espacio de publicaciones y tu Google usando el plan gratuito Spark. Después podrás publicar, recibir devoluciones y copiar invitaciones desde cada playlist.</p>
      <p role="status">${state.google.conectado?'✓ Google conectado':'○ Conectar Google'} · ${config.projectId?'✓ Espacio configurado':'○ Elegir espacio de publicaciones'}</p>
      <label id="cloudProfileDrop" class="drop-zone">Importar perfil de conexión de AudioTaller<input type="file" accept="application/json,.json"><span role="status"></span></label>
      <p class="portal-guide-hint">¿Primera vez? <button type="button" class="alt" onclick="portalGuideDialog()">📘 Abrir el instructivo paso a paso</button></p>
      <p class="muted">Si te entregaron un perfil de conexión, importalo y autorizá tu cuenta. No necesitás escribir código. Este piloto todavía requiere que el responsable prepare el espacio Firebase; el alta universal depende de la verificación de Google para la versión distribuible.</p>
      <details><summary>Configuración avanzada · preparar el espacio gratuito</summary><ol>
        <li><a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">Abrir Firebase</a> y crear un proyecto, sin activar facturación.</li>
        <li>Agregar una aplicación web para obtener el ID y la clave web pública.</li>
        <li>En Authentication, habilitar Correo/contraseña. En Firestore, crear la base <b>default</b>.</li>
        <li>En la <a href="https://console.cloud.google.com/apis/dashboard" target="_blank" rel="noopener noreferrer">consola de Google Cloud</a>, habilitar Drive API, Firebase Hosting API y Firebase Rules API en ese mismo proyecto.</li>
        <li>Configurar consentimiento OAuth y crear un cliente de tipo <b>Aplicación de escritorio</b>. Descargar su JSON. Si el consentimiento está en prueba, agregar tu correo como usuario de prueba.</li>
      </ol><p class="muted">Esta primera preparación del desarrollador requiere la consola de Google. Para una distribución general se configura un cliente OAuth común y su verificación; no se deben repartir credenciales privadas de servidor.</p>
      <h3>2. Datos públicos del proyecto</h3>
      <label>ID del proyecto<input name="projectId" value="${esc(config.projectId)}" placeholder="audiotaller-ejemplo" required></label>
      <label>Clave web pública de Firebase<input name="apiKey" value="${esc(config.apiKey)}" required autocomplete="off"></label>
      <label>Clave pública para reproducción desde Drive<input name="driveApiKey" value="${esc(config.driveApiKey)}" placeholder="Vacío = usar la clave web de Firebase" autocomplete="off"></label>
      <p class="muted">La clave de reproducción debe permitir Google Drive API y el dominio del portal. No es una contraseña ni una clave privada.</p>
      <label>Nombre del sitio (vacío = sugerido)<input name="siteId" value="${esc(config.siteId)}" placeholder="audiotaller-ejemplo-portal"></label>
      <label>Nombre de tu estudio / productor<input name="producerName" value="${esc(config.producerName)}" maxlength="150"></label>
      <label>Color del portal<input type="color" name="color" value="${esc(config.color || '#55d6be')}"></label>
      <p>Guardá estos datos antes de instalar.</p>
      <label id="cloudClientDrop" class="drop-zone">Arrastrá o elegí el JSON del cliente OAuth de escritorio<input type="file" accept="application/json,.json"><span role="status"></span></label></details>
      <h3>Conectar tu Google</h3><p id="cloudGoogleState" role="status">${esc(state.google.estado)} · ${state.google.cliente?'Conexión preparada':'Falta el perfil de conexión'}</p>
      <div class="row"><button type="button" class="alt" id="cloudConnect">Autorizar Google</button><button type="button" class="alt" id="cloudDisconnect">Desconectar en esta PC</button></div>
      <p class="muted">Google solicitará acceso a los archivos de esta app y administración de los recursos de tu proyecto para desplegar el portal. Las credenciales se protegen con tu cuenta de Windows o el Llavero de macOS. Desconectar no borra publicaciones.</p>
      <h3>4. Instalar la web</h3><label><input type="checkbox" id="cloudDedicated"> Confirmo que este proyecto es exclusivo de AudioTaller. La instalación configura las reglas de Firestore y la web del sitio indicado.</label>
      <button type="button" id="cloudInstall">Instalar / actualizar portal en Firebase</button><p id="cloudInstallState" role="status"></p>
      <p class="muted">No activa Blaze, Cloud Storage ni facturación. Los audios van a tu Drive y quedan compartidos por enlace. Google aplica sus límites gratuitos.</p>`,async data=>{
        await api('/api/portal/config',body(data));
    },form=>{
        $('iterationSubmit').textContent='Guardar configuración';
        const status=$('cloudGoogleState');
        bindDropZone($('cloudProfileDrop'),async files=>{
            try{if(files.length!==1)throw Error('Elegí un solo perfil de conexión.');const data=new FormData();data.append('file',files[0]);
                const response=await fetch('/api/portal/conexion/importar',{method:'POST',body:data});const result=await response.json();if(!response.ok)throw Error(result.error || 'No se pudo importar.');
                dialogDirty=false;closeIterationDialog();await portalSetupDialog();
            }catch(error){$('iterationError').textContent=error.message;}
        });
        const refresh=async()=>{const next=await api('/api/portal/config');if(status.isConnected){status.textContent=next.google.estado+(next.google.conectado?' · Conectado':'');return next;}return null;};
        bindDropZone($('cloudClientDrop'),async files=>{
            try{
                if(files.length!==1)throw Error('Elegí un solo JSON OAuth.');
                const data=new FormData();data.append('file',files[0]);
                const response=await fetch('/api/portal/google/cliente',{method:'POST',body:data});
                if(!response.ok)throw Error((await response.json()).error || 'No se pudo importar.');
                if(status.isConnected){$('cloudClientDrop').querySelector('[role=status]').textContent='Cliente importado. Su contenido no se muestra ni se publica.';await refresh();}
            }catch(error){if(status.isConnected)$('iterationError').textContent=error.message;}
        });
        $('cloudConnect').onclick=async()=>{
            try{
                await api('/api/portal/google/conectar',body({}));
                while(status.isConnected){const next=await refresh();if(!next?.google.esperando)break;await cloudDelay();}
            }catch(error){if(status.isConnected)$('iterationError').textContent=error.message;}
        };
        $('cloudDisconnect').onclick=async()=>{try{await api('/api/portal/google/desconectar',body({}));await refresh();}catch(error){$('iterationError').textContent=error.message;}};
        $('cloudInstall').onclick=async()=>{
            if(!$('cloudDedicated').checked){$('iterationError').textContent='Confirmá que el proyecto es exclusivo de AudioTaller.';return;}
            const button=$('cloudInstall'),progress=$('cloudInstallState');button.disabled=true;
            try{
                await api('/api/portal/config',body(Object.fromEntries(new FormData(form))));
                const result=await cloudOperation('/api/portal/instalar',{proyecto_dedicado:true},progress);
                if(progress.isConnected)progress.textContent=result.mensaje+' '+result.url;
            }catch(error){if(progress.isConnected)$('iterationError').textContent=error.message;}finally{button.disabled=false;}
        };
    });
}
async function publishWebDialog(){
    const playlist=playlistCurrent;
    const [state,publications,recipients]=await Promise.all([api('/api/portal/config'),api('/api/playlists/'+playlist.id+'/publicaciones-web'),api('/api/portal/destinatarios')]);
    if(!state.config.projectId || !state.google.conectado){await portalSetupDialog();return;}
    const existing=publications.find(publication=>publication.proyecto===state.config.projectId);
    formDialog('Publicar playlist en la web',`<p>${esc(playlist.nombre)} · ${playlist.audios.length} audios. Se subirán copias a Drive, conservando los originales.</p>
      ${existing?`<p>La publicación se actualizará conservando su dirección:</p><a href="${esc(existing.url)}" target="_blank" rel="noopener noreferrer">${esc(existing.url)}</a>`:'<p>Se creará un enlace nuevo para esta playlist.</p>'}
      <label>Artista de tu agenda<select id="webRecipient"><option value="">Elegir artista o ingresar otro correo</option>${recipients.map(person=>`<option value="${esc(person.id)}">${esc(person.nombre)}${person.correos.length?'':' · sin correo registrado'}</option>`).join('')}</select></label>
      <label>Correo del artista<input name="email" type="email" value="${esc(existing?.email)}" required></label>
      <label>Contraseña del artista<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="Primera publicación: elegir una contraseña"></label>
      <button type="button" id="generateArtistPassword" class="alt">Generar contraseña segura</button><p class="muted">La cuenta se crea al publicar. Al actualizar dejá la contraseña vacía para conservarla. Si el correo ya tiene cuenta, usá su contraseña actual. La invitación se guarda cifrada en esta PC para volver a copiarla.</p>
      <label>Vigencia en días<input name="dias" type="number" min="1" max="365" value="7" required></label>
      <label><input name="audios_publicos" type="checkbox" required> Compartir los audios por enlace en Drive. Entiendo que quien obtenga ese enlace directo podrá escucharlos, aunque la playlist venza.</label>
      <p id="webPublishProgress" role="status"></p><p class="muted">Mantené AudioTaller abierto hasta terminar. No se envían correos automáticamente.</p>
      ${existing?'<button type="button" class="alt" id="webRevoke">Revocar la página publicada</button><p class="muted">Revocar la página no retira los enlaces directos de Drive.</p>':''}`,async data=>{
        data.audios_publicos=$('iterationForm').elements.audios_publicos.checked;
        data.descarga=false;
        const result=await cloudOperation('/api/playlists/'+playlist.id+'/publicar-web',data,$('webPublishProgress'));
        $('iterationDialog').addEventListener('close',()=>cloudResultDialog(result),{once:true});
    },form=>{
        $('iterationSubmit').textContent='Publicar / actualizar';
        const email=form.elements.email;
        $('webRecipient').onchange=()=>{const person=recipients.find(person=>person.id===$('webRecipient').value);if(person)email.value=person.correos[0] || '';};
        if(!existing){const person=recipients.find(person=>person.id===playlist.audios[0]?.artista_id);if(person){$('webRecipient').value=person.id;email.value=person.correos[0] || '';}}
        $('generateArtistPassword').onclick=()=>{
            if(existing?.email===email.value.trim().toLowerCase()){$('iterationError').textContent='Este artista ya tiene acceso. Dejá la contraseña vacía para conservarla; este formulario no cambia contraseñas.';return;}
            const bytes=crypto.getRandomValues(new Uint8Array(18));form.elements.password.value=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');};
        if(existing){const access=document.createElement('button');access.type='button';access.className='alt';access.textContent='Copiar datos de acceso';access.onclick=async()=>{try{const value=await api('/api/portal/publicaciones/'+existing.id+'/acceso');await copyPortalInvitation(value,access);}catch(error){$('iterationError').textContent=error.message;}};$('webRevoke').before(access);}
        if(existing)$('webRevoke').onclick=async()=>{
            try{const result=await api('/api/portal/publicaciones/'+existing.id+'/revocar',body({}));$('webPublishProgress').textContent=result.mensaje;}
            catch(error){$('iterationError').textContent=error.message;}
        };
    });
}
function cloudResultDialog(result){
    formDialog('Playlist publicada',`<p>${esc(result.mensaje)}</p><label>Enlace del artista<input readonly value="${esc(result.url)}" id="cloudPublishedUrl"></label>
      <p>Usuario: <b>${esc(result.email)}</b></p>${result.password?`<label>Contraseña elegida (guardala ahora)<input readonly value="${esc(result.password)}"></label>`:'<p>Se conserva la contraseña del acceso existente.</p>'}
      <a href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">Abrir el portal</a><button type="button" id="copyPublishedUrl" class="alt">Copiar enlace</button><button type="button" id="copyPortalInvitation" class="alt">Copiar invitación para WhatsApp</button>
      <p class="muted">Los enlaces directos de audio son públicos. No se enviaron mensajes al artista.</p>`,async()=>{});
    $('iterationSubmit').textContent='Listo';
    $('copyPublishedUrl').onclick=async()=>{try{await navigator.clipboard.writeText(result.url);$('copyPublishedUrl').textContent='Copiado';}catch{$('cloudPublishedUrl').focus();$('cloudPublishedUrl').select();}};
    $('copyPortalInvitation').onclick=()=>copyPortalInvitation(result,$('copyPortalInvitation')).catch(report);
}

function portalInvitation(value){return 'Te comparto tu playlist de AudioTaller:\n'+value.url+'\nUsuario: '+value.email+'\n'+(value.password?'Contraseña: '+value.password:'Contraseña: la que ya usabas (no está guardada en esta PC).')+'\nPodés escuchar y enviar tus devoluciones debajo de cada audio. Si actualizo la selección, usá este mismo enlace.';}
async function copyPortalInvitation(value,button){
    const message=portalInvitation(value);
    try{await navigator.clipboard.writeText(message);button.textContent='Invitación copiada';}
    catch{const box=document.createElement('textarea');box.readOnly=true;box.value=message;button.after(box);box.focus();box.select();button.textContent='Seleccioná y copiá la invitación';}
}
async function feedbackDialog(scope={}){
    const query=new URLSearchParams(scope),notes=await api('/api/portal/devoluciones?'+query);
    const saveNote=async(i,form)=>{const estado=form.querySelector(`[data-feedback-state="${i}"]`).value,nota_interna=form.querySelector(`[data-feedback-note="${i}"]`).value;
        await api('/api/portal/devoluciones/'+encodeURIComponent(notes[i].id),body({estado,nota_interna}));notes[i].estado=estado;notes[i].nota_interna=nota_interna;};
    formDialog('Devoluciones del artista',`<p>Las devoluciones conservan la entrega y versión escuchadas. Tus estados y notas internas no se muestran al artista.</p>
      <button type="button" id="feedbackSync">Buscar nuevas devoluciones</button><p id="feedbackSyncStatus" role="status"></p>
      <div id="feedbackList">${notes.length?'':'<p>Todavía no hay devoluciones descargadas. Pulsá Buscar nuevas devoluciones para consultar el portal.</p>'}
      ${notes.map((note,index)=>`<article class="panel"><h3>${esc(note.etiqueta)}</h3><p class="muted">${esc(note.email)} · ${esc(note.playlist)} · Entrega ${note.revision} · ${esc(note.creado)} · ${formatWaveTime(note.segundo)}</p>
        <p style="white-space:pre-wrap">${esc(note.texto)}</p><label>Seguimiento<select data-feedback-state="${index}">${['Pendiente','En revisión','Resuelta'].map(state=>`<option ${note.estado===state?'selected':''}>${state}</option>`).join('')}</select></label>
        <label>Nota privada del productor<textarea data-feedback-note="${index}" maxlength="8000">${esc(note.nota_interna)}</textarea></label>
        <button type="button" class="alt" data-feedback-save="${index}">Guardar seguimiento</button><span data-feedback-status="${index}" role="status"></span>
        ${note.cancion_id?`<button type="button" class="alt" data-feedback-song="${index}">Ir a la producción</button>`:''}</article>`).join('')}</div>`,async()=>{for(let i=0;i<notes.length;i++)await saveNote(i,$('iterationForm'));},form=>{
        $('iterationSubmit').textContent='Guardar y cerrar';
        $('feedbackSync').onclick=async()=>{const button=$('feedbackSync');button.disabled=true;
            try{for(let i=0;i<notes.length;i++)await saveNote(i,form);await api('/api/portal/devoluciones/sincronizar',body(scope));dialogDirty=false;closeIterationDialog();await feedbackDialog(scope);}
            catch(error){$('feedbackSyncStatus').textContent=error.message+' Las devoluciones ya descargadas siguen disponibles.';button.disabled=false;}};
        form.querySelectorAll('[data-feedback-save]').forEach(button=>button.onclick=async()=>{
            const i=Number(button.dataset.feedbackSave);button.disabled=true;
            try{await saveNote(i,form);form.querySelector(`[data-feedback-status="${i}"]`).textContent='Guardado';dialogDirty=notes.some((note,index)=>note.estado!==form.querySelector(`[data-feedback-state="${index}"]`).value || note.nota_interna!==form.querySelector(`[data-feedback-note="${index}"]`).value);}
            catch(error){$('iterationError').textContent=error.message;}finally{button.disabled=false;}});
        form.querySelectorAll('[data-feedback-song]').forEach(button=>button.onclick=()=>{const note=notes[Number(button.dataset.feedbackSong)];if(dialogDirty && !confirm('Hay seguimiento sin guardar. ¿Salir igualmente?'))return;dialogDirty=false;closeIterationDialog();openSong(note.cancion_id).catch(report);});
    });
}
