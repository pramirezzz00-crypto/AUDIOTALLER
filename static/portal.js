// Portal público: solo usa rutas de la entrega. No tiene acceso a la interfaz
// de administración ni necesita conocer las ubicaciones de los archivos.
const portalPath=location.pathname.replace(/\/$/,'');
const node=id=>document.getElementById(id);
async function loadPortal(){
    node('portalError').textContent='';
    try{
        const response=await fetch(portalPath+'/datos');
        if(response.status===401){node('portalAccess').hidden=false;return;}
        const data=await response.json();if(!response.ok)throw Error(data.error || 'Entrega no disponible.');
        node('portalAccess').hidden=true;node('portalTitle').textContent=data.nombre;
        node('portalPolicy').textContent=(data.descarga?'Escucha y descarga autorizada':'Solo escucha')+' · Vence '+new Date(data.vence*1000).toLocaleString();
        node('portalTracks').replaceChildren();
        for(const [index,item] of data.audios.entries()){
            const article=document.createElement('article'),heading=document.createElement('h2'),description=document.createElement('p'),audio=document.createElement('audio');
            heading.textContent=(index+1)+'. '+item.titulo;
            description.textContent=[item.artista,item.disco,item.clase,item.version,item.nombre].filter(Boolean).join(' · ');
            audio.controls=true;audio.preload='none';audio.src=portalPath+'/audio/'+encodeURIComponent(item.id);
            audio.setAttribute('aria-label',item.nombre);audio.onplay=()=>document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause();});
            audio.onerror=()=>{node('portalError').textContent='No se pudo reproducir el archivo. La entrega puede haber vencido o el archivo ya no está disponible.';};
            article.append(heading,description,audio);
            if(data.descarga){const link=document.createElement('a');link.textContent='Descargar original';link.href=audio.src+'?descarga=1';link.download=item.nombre;article.append(link);}
            node('portalTracks').append(article);
        }
    }catch(error){node('portalError').textContent=error.message;}
}
node('portalAccess').onsubmit=async event=>{
    event.preventDefault();const submit=event.target.querySelector('button');submit.disabled=true;
    try{
        const response=await fetch(portalPath+'/acceso',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clave:node('portalPassword').value})});
        const data=await response.json();if(!response.ok)throw Error(data.error);node('portalPassword').value='';await loadPortal();
    }catch(error){node('portalError').textContent=error.message;}finally{submit.disabled=false;}
};
loadPortal();
