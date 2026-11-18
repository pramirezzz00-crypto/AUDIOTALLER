// Página estática sin secretos del productor. Firebase Auth y las reglas de
// Firestore controlan la playlist; los enlaces de Drive son públicos por diseño.
const el=id=>document.getElementById(id);
let config,account=null,refreshTimer,updateTimer;
let feedbackSending=0;
const portalId=location.pathname.split('/').filter(Boolean).at(-1);
function sessionKey(){return 'audiotaller-artist-'+config.projectId;}
function showError(message){el('error').textContent=message;}
async function authCall(operation,values){
    const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:'+operation+'?key='+encodeURIComponent(config.apiKey),
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const result=await response.json();
    if(!response.ok)throw Error('No se pudo ingresar. Revisá correo y contraseña o consultá al productor.');
    return result;
}
function saveAccount(value){account=value;sessionStorage.setItem(sessionKey(),JSON.stringify(value));}
async function refreshAccount(){
    if(!account || account.expires>Date.now()+60000)return;
    const response=await fetch('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(config.apiKey),
        {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:account.refreshToken})});
    const value=await response.json();if(!response.ok){logout();throw Error('La sesión venció. Volvé a ingresar.');}
    saveAccount({idToken:value.id_token,refreshToken:value.refresh_token,uid:account.uid,expires:Date.now()+Number(value.expires_in)*1000});
}
function clearTracks(){document.querySelectorAll('audio').forEach(audio=>{audio.pause();audio.removeAttribute('src');audio.load();});el('tracks').replaceChildren();delete el('tracks').dataset.revision;}
function logout(){clearTracks();account=null;sessionStorage.removeItem(sessionKey());el('access').hidden=false;el('logout').hidden=true;el('reloadPlaylist').hidden=true;el('policy').textContent='';}
async function loadPlaylist(){
    if(!account)return;
    // No reemplazar un formulario mientras se envía o conserva texto sin enviar.
    if(feedbackSending)return;
    try{
        await refreshAccount();
        const response=await fetch('https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(config.projectId)+'/databases/(default)/documents/portals/'+portalId,
            {headers:{Authorization:'Bearer '+account.idToken},cache:'no-store'});
        if(!response.ok){clearTracks();throw Error('Esta playlist venció, fue revocada o no corresponde a tu cuenta. Consultá al productor.');}
        const doc=await response.json(),data=Object.fromEntries(Object.entries(doc.fields || {}).map(([key,value])=>[key,Object.values(value)[0]]));
        if(data.revoked || Date.parse(data.expiresAt)<=Date.now()){clearTracks();throw Error('Esta entrega ya no está vigente.');}
        const signature=doc.updateTime;
        el('access').hidden=true;el('logout').hidden=false;el('reloadPlaylist').hidden=false;
        if(el('tracks').dataset.revision===signature)return;
        if([...document.querySelectorAll('.feedback-text')].some(input=>input.value.trim())){
            showError('El productor actualizó la playlist. Conservá tu texto y pulsá Actualizar playlist para escuchar la nueva entrega.');return;
        }
        clearTracks();el('tracks').dataset.revision=signature;
        if(/^#[a-f0-9]{6}$/i.test(data.color || ''))document.documentElement.style.setProperty('--accent',data.color);
        el('title').textContent=data.title;el('producerBrand').textContent='♫ '+(data.producerName || 'AudioTaller');
        el('policy').textContent=(data.allowDownload?'Escucha y descarga':'Escucha')+' · Vence '+new Date(data.expiresAt).toLocaleString();
        const items=JSON.parse(data.items);
        for(const [index,item] of items.entries()){
            if(!/^[a-zA-Z0-9_-]{1,200}$/.test(item.driveId))continue;
            const card=document.createElement('article'),heading=document.createElement('h2'),info=document.createElement('p'),audio=document.createElement('audio'),status=document.createElement('small');
            heading.textContent=(index+1)+'. '+item.titulo;
            info.textContent=[item.artista,item.disco,item.clase,item.version,item.nombre].filter(Boolean).join(' · ');
            audio.controls=true;audio.preload='none';audio.setAttribute('aria-label',item.nombre);
            // La API pública evita dar al navegador credenciales del dueño del Drive.
            audio.src='https://www.googleapis.com/drive/v3/files/'+item.driveId+'?alt=media&key='+encodeURIComponent(config.driveApiKey);
            audio.onplay=()=>document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause();});
            audio.onerror=()=>{status.textContent='No se pudo reproducir este audio. Reintentá o avisale a tu productor.';};
            if(!data.allowDownload)audio.setAttribute('controlsList','nodownload');
            card.append(heading,info,audio,status);
            if(data.revision && item.cancionId)card.append(feedbackForm(item,data,audio));
            else{const notice=document.createElement('small');notice.textContent='El productor debe actualizar esta entrega para habilitar devoluciones.';card.append(notice);}
            el('tracks').append(card);
        }
        showError('');await loadFeedback();
    }catch(error){showError(error.message);}
}
el('access').onsubmit=async event=>{
    event.preventDefault();el('login').disabled=true;showError('');
    try{
        const value=await authCall('signInWithPassword',{email:el('email').value.trim(),password:el('password').value,returnSecureToken:true});
        saveAccount({idToken:value.idToken,refreshToken:value.refreshToken,uid:value.localId,expires:Date.now()+Number(value.expiresIn)*1000});el('password').value='';await loadPlaylist();
    }catch(error){showError(error.message);}finally{el('login').disabled=false;}
};
el('logout').onclick=logout;
el('reloadPlaylist').onclick=()=>{
    if(feedbackSending)return;
    if([...document.querySelectorAll('.feedback-text')].some(input=>input.value.trim()) && !confirm('Hay una devolución sin enviar. ¿Descartarla y cargar la última playlist?'))return;
    document.querySelectorAll('.feedback-text').forEach(input=>{input.value='';});delete el('tracks').dataset.revision;loadPlaylist();
};
(async()=>{
    try{
        config=await (await fetch('/config.json',{cache:'no-store'})).json();
        if(!config.projectId || !config.apiKey)throw Error('El productor todavía no configuró este portal.');
        if(!/^[a-f0-9]{32}$/.test(portalId || ''))throw Error('Abrí el enlace completo de la playlist que te compartió tu productor.');
        try{account=JSON.parse(sessionStorage.getItem(sessionKey()) || 'null');}catch{account=null;}
        if(account)await loadPlaylist();
        updateTimer=setInterval(()=>{if(account)loadPlaylist();},60000);
    }catch(error){showError(error.message);el('login').disabled=true;}
})();

function feedbackForm(item,data,audio){
    const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('textarea'),
      moment=document.createElement('button'),send=document.createElement('button'),status=document.createElement('p'),history=document.createElement('div');
    input.className='feedback-text';input.maxLength=4000;input.required=true;input.rows=3;
    label.textContent='Tu devolución';input.placeholder='¿Qué te gustaría ajustar en este audio?';label.append(input);
    status.setAttribute('role','status');moment.type='button';moment.textContent='Marcar momento de escucha';
    send.type='submit';send.textContent='Enviar devolución';history.className='feedback-history';history.dataset.audioId=item.id;
    const key='audiotaller-draft-'+portalId+'-'+data.revision+'-'+item.id;
    let second=0,messageId=null;
    // El borrador se guarda en este navegador; nunca se envía sin pulsar Enviar.
    try{input.value=sessionStorage.getItem(key) || '';}catch{}
    input.oninput=()=>{messageId=null;try{sessionStorage.setItem(key,input.value);}catch{}};
    moment.onclick=()=>{second=Number.isFinite(audio.currentTime)?audio.currentTime:0;messageId=null;moment.textContent='Momento: '+Math.floor(second/60)+':'+String(Math.floor(second%60)).padStart(2,'0');};
    form.onsubmit=async event=>{
        event.preventDefault();const text=input.value.trim();if(!text)return;
        send.disabled=true;input.disabled=true;moment.disabled=true;feedbackSending++;status.textContent='Enviando…';
        messageId=messageId || crypto.randomUUID();
        const documentName='projects/'+config.projectId+'/databases/(default)/documents/portals/'+portalId+'/feedback/'+messageId;
        try{
            await refreshAccount();
            if(!account.uid)throw Error('Cerrá sesión y volvé a ingresar para enviar tu devolución.');
            const fields={artistUid:{stringValue:account.uid},audioId:{stringValue:item.id},songId:{stringValue:item.cancionId},
                driveId:{stringValue:item.driveId},revision:{integerValue:String(data.revision)},
                audioLabel:{stringValue:[item.titulo,item.clase,item.version,item.nombre].filter(Boolean).join(' · ')},
                body:{stringValue:text},positionSeconds:{doubleValue:second}};
            const response=await fetch('https://firestore.googleapis.com/v1/projects/'+config.projectId+'/databases/(default)/documents:commit',
                {method:'POST',headers:{Authorization:'Bearer '+account.idToken,'Content-Type':'application/json'},
                 body:JSON.stringify({writes:[{update:{name:documentName,fields},currentDocument:{exists:false},
                    updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]})});
            if(!response.ok){
                // Si la respuesta anterior se perdió, un reintento con el mismo
                // identificador confirma el envío sin duplicar el comentario.
                const prior=await fetch('https://firestore.googleapis.com/v1/'+documentName,{headers:{Authorization:'Bearer '+account.idToken}});
                if(!prior.ok)throw Error('No se pudo enviar. La entrega puede haber cambiado o vencido. Tu texto se conserva; reintentá o consultá al productor.');
                const existing=(await prior.json()).fields;
                if(existing?.body?.stringValue!==text)throw Error('Revisá el envío antes de volver a intentarlo.');
            }
            input.value='';messageId=null;try{sessionStorage.removeItem(key);}catch{}
            status.textContent='Devolución enviada. Tu productor podrá verla desde AudioTaller.';await loadFeedback();
        }catch(error){status.textContent=error.message || 'No se pudo conectar. Tu texto se conserva.';}
        finally{send.disabled=false;input.disabled=false;moment.disabled=false;feedbackSending--;}
    };
    form.className='feedback-form';form.append(label,moment,send,status,history);return form;
}
async function loadFeedback(){
    if(!account)return;
    try{
        let token='',notes=[];
        do{
            const query=new URLSearchParams({pageSize:'100'});if(token)query.set('pageToken',token);
            const response=await fetch('https://firestore.googleapis.com/v1/projects/'+config.projectId+'/databases/(default)/documents/portals/'+portalId+'/feedback?'+query,
                {headers:{Authorization:'Bearer '+account.idToken},cache:'no-store'});
            if(!response.ok)throw Error('No se pudo cargar el historial de devoluciones.');
            const page=await response.json();notes.push(...(page.documents || []));token=page.nextPageToken || '';
        }while(token);
        document.querySelectorAll('.feedback-history').forEach(box=>{
            box.replaceChildren();const relevant=notes.map(doc=>Object.fromEntries(Object.entries(doc.fields).map(([key,value])=>[key,Object.values(value)[0]])))
                .filter(note=>note.audioId===box.dataset.audioId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
            for(const note of relevant){const p=document.createElement('p'),meta=document.createElement('small');
                p.textContent=note.body;meta.textContent='Entrega '+note.revision+' · '+new Date(note.createdAt).toLocaleString()+' · '+Math.floor(note.positionSeconds/60)+':'+String(Math.floor(note.positionSeconds%60)).padStart(2,'0');
                const card=document.createElement('div');card.append(meta,p);box.append(card);}
        });
    }catch(error){showError(error.message);}
}
