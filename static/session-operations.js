// Operaciones explícitas sobre sesiones y carpetas. Todo permanece en la instalación local.
const nativeSessionDrafts = new Map();
let productionCopyId;
let copyPoll;
let copyViewGeneration = 0;

function duplicateSessionDialog(identity) {
    const session = workflow.sesiones.find(item => item.id === identity);
    const songId = currentSong.id;
    if (!session) return;
    formDialog('Nueva versión basada en ' + session.nombre,
        `<p class="muted">Se copiará el archivo de proyecto en su misma carpeta. Los medios seguirán en las carpetas compartidas del DAW.</p>
         <label>Nombre base<input name="nombre" required maxlength="100" value="${esc(session.nombre.replace(/[ _-]V\d+$/i,''))}"></label>
         <p>AudioTaller agregará el siguiente número de versión disponible, por ejemplo _V010.</p>
         <label>Notas de los cambios<textarea name="notas"></textarea></label>`,
        async data => {
            const result = await api('/api/produccion/' + songId + '/duplicar-sesion/' + identity,body(data));
            selectedStageSessions.set(songId+':'+session.etapa,result.id);
            await openSong(songId);
            // Se pregunta después de guardar la copia y cerrar el diálogo compartido.
            setTimeout(async () => {
                if (confirm('La nueva versión quedó guardada en '+result.ruta+'. ¿Querés abrirla en el DAW?')) {
                    try { await api('/api/produccion/'+songId+'/sesiones/'+result.id+'/abrir',body({})); }
                    catch (error) { report(error); }
                }
            },0);
        });
}

async function newNativeSessionDialog(stage) {
    let daws;
    try { daws = await api('/api/daw/instalados'); }
    catch (error) { report(error); return; }
    const songId = currentSong.id;
    const draft = nativeSessionDrafts.get(songId+':'+stage) || {};
    formDialog('Crear una sesión en el DAW',
        `<label>Nombre de sesión<input name="nombre" required maxlength="100" value="${esc(draft.nombre)}"></label>
         <label>Carpeta de destino (opcional)<input name="ruta" value="${esc(draft.ruta)}" placeholder="Vacío = carpeta codificada dentro de esta canción en AudioTaller"></label>
         <button type="button" class="alt" id="nativeFolder">Elegir carpeta de destino</button>
         <fieldset><legend>DAW instalado</legend><div class="daw-grid">${daws.map(daw => `<label class="daw-choice">
           <input name="daw_id" type="radio" required value="${daw.id}" ${draft.daw_id === daw.id || (!draft.daw_id && daw.id === daws[0]?.id) ? 'checked' : ''}>
           <img width="36" height="36" src="/api/daw/${daw.id}/icono" alt=""><span>${esc(daw.nombre)}<small>${esc(daw.ejecutable)}</small></span></label>`).join('') ||
           '<p class="muted">No se encontraron instalaciones. Asociá el ejecutable del DAW.</p>'}</div></fieldset>
         <button type="button" class="alt" id="associateDaw">Asociar otro DAW</button>
         <div id="nativeTemplate"></div>
         <label>Notas<textarea name="notas">${esc(draft.notas)}</textarea></label>
         <p class="muted">Al guardar se creará un proyecto nativo y se abrirá en el DAW seleccionado.</p>`,
        async data => {
            if (data.plantilla_manual?.trim()) data.plantilla=data.plantilla_manual.trim();
            data.etapa=stage;
            const result=await api('/api/produccion/'+songId+'/crear-en-daw',body(data));
            nativeSessionDrafts.delete(songId+':'+stage);
            selectedStageSessions.set(songId+':'+stage,result.id);
            await openSong(songId);
            if (result.advertencia) report(Error(result.advertencia));
        }, form => {
            const templateView = () => {
                const daw=daws.find(item=>item.id===form.elements.daw_id?.value);
                if (!daw) { $('nativeTemplate').replaceChildren(); return; }
                $('nativeTemplate').innerHTML = `<h3>Proyecto inicial de ${esc(daw.nombre)}</h3>
                  <label>Plantilla<select name="plantilla">
                    <option value="">${daw.vacio ? 'Proyecto vacío' : 'Seleccioná una plantilla nativa'}</option>
                    ${daw.plantillas.map(item => `<option value="${esc(item.ruta)}">${esc(item.nombre)}</option>`).join('')}
                    ${daw.plantilla ? `<option value="${esc(daw.plantilla)}" selected>Plantilla personalizada guardada</option>` : ''}
                  </select></label>
                  <label>O ruta de una plantilla propia<input name="plantilla_manual" placeholder="Proyecto vacío guardado desde tu DAW"></label>
                  <button type="button" class="alt" id="nativeTemplateFile">Elegir plantilla</button>`;
                $('nativeTemplateFile').onclick=()=>pickLocalPath(form.elements.plantilla_manual);
            };
            form.querySelectorAll('[name=daw_id]').forEach(input=>input.onchange=templateView);
            templateView();
            $('nativeFolder').onclick=()=>pickLocalPath(form.elements.ruta,true);
            $('associateDaw').onclick=()=>{
                nativeSessionDrafts.set(songId+':'+stage,Object.fromEntries(new FormData(form)));
                closeIterationDialog();
                if (!$('iterationDialog').open) associateDawDialog(stage);
            };
        });
}
function associateDawDialog(stage) {
    formDialog('Asociar DAW instalado',
        '<label>Nombre<input name="nombre" required></label><label>Aplicación del DAW (.app en Mac / .exe en Windows)<input name="ejecutable" required></label>'+
        '<button type="button" class="alt" id="pickDawExe">Elegir aplicación</button>'+
        '<label>Extensión de sus proyectos<input name="extension" placeholder=".cpr, .rpp, .song…" required></label>'+
        '<label>Plantilla nativa (opcional)<input name="plantilla"></label><button type="button" class="alt" id="pickDawTemplate">Elegir plantilla</button>',
        async data=>{
            await api('/api/daw/configurar',body(data));
            setTimeout(()=>newNativeSessionDialog(stage),0);
        },form=>{
            $('pickDawExe').onclick=()=>pickLocalPath(form.elements.ejecutable);
            $('pickDawTemplate').onclick=()=>pickLocalPath(form.elements.plantilla);
        });
}

async function productionCopyDialog() {
    const songId=currentSong.id;
    try {
        const pending=await api('/api/produccion/'+songId+'/copiar-produccion/pendiente');
        if (pending && confirm('Hay una copia anterior en curso o pendiente de revisión. ¿Querés consultar su progreso?')) {
            showCopyProgress(songId,pending.id);
            return;
        }
    } catch(error) { report(error); return; }
    formDialog('Incorporar la producción completa a AudioTaller',
        '<p>Se copiarán las carpetas completas de las sesiones y sus subcarpetas. Al finalizar la verificación se actualizarán los vínculos de esta canción.</p>'+
        '<p class="muted">Guardá y cerrá las sesiones en el DAW antes de continuar. Las referencias relativas se conservan dentro de cada carpeta. Cubase u otro DAW puede pedir relocalizar referencias absolutas o medios ubicados fuera de esas carpetas.</p>'+
        '<div id="copyPreview"><button class="alt" type="button" id="prepareProductionCopy">Calcular copia</button></div>',
        async ()=>{
            if (!productionCopyId) throw Error('Primero calculá y revisá la copia.');
            await api('/api/produccion/'+songId+'/copiar-produccion/'+productionCopyId+'/iniciar',body({}));
            const identity=productionCopyId;
            setTimeout(()=>showCopyProgress(songId,identity),0);
        },()=>{
            productionCopyId=null;
            $('iterationSubmit').textContent='Confirmar copia y actualizar vínculos';
            const preview=$('copyPreview');
            const calculate=$('prepareProductionCopy');
            calculate.onclick=async()=>{
                calculate.disabled=true;
                $('iterationError').textContent='Calculando carpetas y espacio…';
                try {
                    const plan=await api('/api/produccion/'+songId+'/copiar-produccion/plan',body({}));
                    if(!preview.isConnected || !$('iterationDialog').open)return;
                    productionCopyId=plan.id;
                    $('iterationError').textContent='';
                    preview.innerHTML=`<h3>Contenido a copiar</h3><ul>${plan.carpetas.map(folder=>`<li>${esc(folder)}</li>`).join('')}</ul>
                      <p>${plan.archivos} archivos · ${formatBytes(plan.bytes)} · ${plan.extras} archivos externos adicionales</p>
                      <p>Destino: ${esc(plan.destino)}</p>`;
                } catch(error) {
                    if(!preview.isConnected || !$('iterationDialog').open)return;
                    $('iterationError').textContent=error.message;
                    calculate.disabled=false;
                }
            };
        });
}
function showCopyProgress(songId,identity) {
    const generation=++copyViewGeneration;
    formDialog('Copiando producción a AudioTaller',
        '<p class="muted">Mantené AudioTaller abierto hasta finalizar. Podés cerrar este aviso y volver a consultar el progreso desde el mismo botón.</p><p id="copyState" role="status">Iniciando copia…</p><progress id="copyProgress" max="100" value="0" style="width:100%"></progress><div id="copyResult"></div>',
        async()=>{});
    $('iterationSubmit').hidden=true;
    const dialog=$('iterationDialog');
    const closed=()=>{
        $('iterationSubmit').hidden=false;
        if(generation===copyViewGeneration) { copyViewGeneration++; clearTimeout(copyPoll); }
    };
    dialog.addEventListener('close',closed,{once:true});
    const poll=async()=>{
        if(generation!==copyViewGeneration || !dialog.open)return;
        try {
            const job=await api('/api/produccion/'+songId+'/copiar-produccion/'+identity);
            $('copyProgress').value=job.total?Math.min(100,job.copiados/job.total*100):0;
            $('copyState').textContent=job.estado+' · '+formatBytes(job.copiados)+' / '+formatBytes(job.total);
            if(job.estado==='completada') {
                $('copyResult').textContent='Copia verificada. Los vínculos apuntan a '+JSON.parse(job.resultado).destino;
                if(currentSong.id===songId)await openSong(songId);
                return;
            }
            if(job.estado==='error' || job.estado==='interrumpida') {
                const partial=job.resultado ? JSON.parse(job.resultado).copia_parcial : '';
                $('copyResult').textContent=job.error+(partial?' Copia parcial conservada en '+partial:'');
                const retry=document.createElement('button');
                retry.type='button';retry.className='alt';retry.textContent='Reintentar';
                retry.onclick=async()=>{
                    retry.remove();
                    try {
                        await api('/api/produccion/'+songId+'/copiar-produccion/'+identity+'/iniciar',body({}));
                        poll();
                    } catch(error) { $('copyResult').textContent=error.message; }
                };
                $('copyResult').append(retry);
                return;
            }
            copyPoll=setTimeout(poll,1000);
        } catch(error) {
            $('copyResult').textContent='No se pudo consultar el progreso: '+error.message;
            copyPoll=setTimeout(poll,3000);
        }
    };
    poll();
}
