// Lanzamientos (campañas y calendario), Audiovisual y Asistente Claude (chat flotante + Configuración).
const camp = {list: [], sel: '', tab: 'campanas', songs: [], albums: [], month: new Date().toISOString().slice(0, 7)};
const av = {list: [], sel: '', tab: 'resumen', opts: null, artists: []};
const CHECKS = [['portada', 'Portada 3000 × 3000'], ['audio', 'WAV master (≤ −1 dBTP)'], ['metadata', 'Metadata exportada'], ['perfiles', 'Perfiles de artista'], ['pitch', 'Pitch a editores'], ['ama', 'Código de distribución AMA']];
const fmtD = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', {day: 'numeric', month: 'short', year: 'numeric'}) : 'sin fecha';
const field = (label, html) => `<label class="fld">${label}${html}</label>`;

// ── Lanzamientos ──
async function openLaunches() { go('launchesPane'); await loadLaunches(); }
async function loadLaunches() {
    [camp.list, camp.songs, camp.albums] = await Promise.all([api('/api/campanas'), api('/api/composicion/letras'), api('/api/producciones').then(x => x.filter(i => i.tipo === 'disco'))]);
    if (!camp.list.some(c => c.id === camp.sel)) camp.sel = '';
    paintLaunches();
}
async function openCampaignFor(albumId) {
    go('launchesPane'); await loadLaunches();
    const found = camp.list.find(c => c.disco_id === albumId);
    if (found) { camp.sel = found.id; return paintLaunches(); }
    const draft = await api('/api/discos/' + albumId + '/campana-sugerida');
    const saved = await api('/api/campanas', body(draft));
    notify('Borrador de campaña creado según la cantidad de canciones. Ajustá fechas y etapas.');
    camp.sel = saved.id; await loadLaunches();
}
function paintLaunches() {
    const root = $('launchesPane');
    const cur = camp.list.find(c => c.id === camp.sel);
    root.innerHTML = `<header class="prod-head"><div><div class="eyebrow">Lanzamientos</div><h1>${cur ? esc(cur.nombre) : 'Campañas'}</h1>
        <p class="muted">Etapas, fechas límite (−28 días distribuidora, −7 pitch), lista de chequeo y condición para avanzar.</p></div>
      <div class="row">${cur ? `<button class="alt" onclick="camp.sel='';paintLaunches()">← Campañas</button><a class="btn-link" href="/api/campanas/${cur.id}/pdf" download>PDF de la campaña</a>` : ''}
        <details class="menu"><summary class="menu-button btn-primary">+ Nueva campaña</summary><div class="menu-list">
          ${camp.albums.map(a => `<button onclick="openCampaignFor('${a.id}').catch(report)">Desde ${esc(a.nombre)} (borrador sugerido)</button>`).join('')}
          <button onclick="newBlankCampaign().catch(report)">Vacía (canción suelta)</button></div></details></div></header>
      ${cur ? campaignDetail(cur) : `<div class="seg tabs">${[['campanas', 'Campañas'], ['calendario', 'Calendario general']].map(([id, l]) => `<button class="${camp.tab === id ? 'is-on' : ''}" onclick="camp.tab='${id}';paintLaunches()">${l}</button>`).join('')}</div>
        ${camp.tab === 'campanas' ? campaignList() : calendarView()}`}`;
}
function campaignList() {
    return `<div class="camp-list">${camp.list.map(c => `<button class="card camp-card" onclick="camp.sel='${c.id}';paintLaunches()">
      <span><strong>${esc(c.nombre)}</strong><small class="muted">${esc(c.disco || 'Canción suelta')}</small></span>
      <span class="camp-bar">${c.etapas.map(s => `<i class="st-${s.estado.replace(/ /g, '')}" title="${esc(s.nombre)} · ${esc(s.estado)}">${esc(s.tipo)}</i>`).join('')}</span>
      <span>${c.proximo ? `Próximo: <b>${esc(c.proximo.nombre)}</b> · ${fmtD(c.proximo.fecha)}` : '<span class="muted">Sin hitos pendientes</span>'}</span></button>`).join('') || '<p class="muted">Todavía no hay campañas. Creá una desde un disco: AudioTaller sugiere un borrador.</p>'}</div>`;
}
function calendarView() {
    const [y, m] = camp.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), offset = (first.getDay() + 6) % 7;
    const events = {};
    for (const c of camp.list) for (const s of c.etapas) {
        if (s.fecha) (events[s.fecha] ||= []).push(['Sale', s.nombre, c.id, 'ok']);
        if (s.limites?.distribuidora) (events[s.limites.distribuidora] ||= []).push(['Subir', s.nombre, c.id, 'warn']);
        if (s.limites?.pitch) (events[s.limites.pitch] ||= []).push(['Pitch', s.nombre, c.id, 'info']);
    }
    const shift = d => { const t = new Date(y, m - 1 + d, 1); camp.month = t.toISOString().slice(0, 7); paintLaunches(); };
    window.calShift = shift;
    return `<div class="row-tight"><button class="btn-ghost" onclick="calShift(-1)">←</button><strong>${first.toLocaleDateString('es-AR', {month: 'long', year: 'numeric'})}</strong><button class="btn-ghost" onclick="calShift(1)">→</button></div>
      <div class="cal">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="cal-h">${d}</span>`).join('')}${'<span></span>'.repeat(offset)}
      ${Array.from({length: days}, (_, i) => { const iso = `${camp.month}-${String(i + 1).padStart(2, '0')}`; return `<div class="cal-d"><small>${i + 1}</small>${(events[iso] || []).map(([k, n, id, c]) => `<button class="cal-e ${c}" onclick="camp.sel='${id}';paintLaunches()">${k}: ${esc(n)}</button>`).join('')}</div>`; }).join('')}</div>`;
}
function campaignDetail(c) {
    return `<div class="camp-stages">${c.etapas.map((s, i) => `<section class="card camp-stage" data-stage="${i}">
        <div class="cr-grid">${field('Nombre', `<input data-k="nombre" value="${esc(s.nombre)}">`)}
          ${field('Tipo', `<select data-k="tipo">${['Single', 'EP', 'Disco completo', 'Focus track', 'Videoclip'].map(t => `<option ${s.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
          ${field('Fecha de salida', `<input type="date" data-k="fecha" value="${esc(s.fecha)}">`)}
          ${field('Distribuidora', `<input data-k="distribuidora" value="${esc(s.distribuidora)}">`)}
          ${field('Estado', `<select data-k="estado">${['Planificada', 'En preparación', 'Enviada', 'Publicada'].map(t => `<option ${s.estado === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}</div>
        ${s.fecha ? `<span class="muted">Subir a la distribuidora antes del <b>${fmtD(s.limites.distribuidora)}</b> · pitch antes del <b>${fmtD(s.limites.pitch)}</b></span>` : ''}
        ${field('Canciones', `<select data-k="canciones" multiple size="4">${camp.songs.map(x => `<option value="${x.id}" ${s.canciones.includes(x.id) ? 'selected' : ''}>${esc(x.titulo)} · ${esc(x.disco || 'suelta')}</option>`).join('')}</select>`)}
        <div class="row-tight">${CHECKS.map(([k, l]) => `<label class="check"><input type="checkbox" data-check="${k}" ${s.chequeo?.[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        ${field('Condición para avanzar («abrir camino»)', `<input data-k="condicion" value="${esc(s.condicion || '')}" placeholder="Ej.: el single anterior supera 10.000 escuchas en 4 semanas">`)}
        <span class="${s.lista ? 'ok-green' : 'warn-amber'}">${s.lista ? '✓ Lista para publicar' : 'Falta completar la lista de chequeo'}</span>
        <button class="btn-ghost" onclick="campStageRemove(${i})">Quitar etapa</button></section>`).join('')}</div>
      <div class="row-tight"><button onclick="campStageAdd()">+ Etapa</button><span class="spacer"></span><button class="alt" onclick="campDelete().catch(report)">Borrar campaña</button><button class="btn-primary" onclick="campSave().catch(report)">Guardar</button></div>
      <p class="insp-help">Estadísticas: el reporte de la distribuidora se importa para regalías; la conexión con Soundcharts (tendencias) queda como próximo paso.</p>`;
}
function campRead() {
    const c = camp.list.find(x => x.id === camp.sel);
    document.querySelectorAll('.camp-stage').forEach(sec => {
        const s = c.etapas[sec.dataset.stage];
        sec.querySelectorAll('[data-k]').forEach(el => { s[el.dataset.k] = el.multiple ? [...el.selectedOptions].map(o => o.value) : el.value; });
        s.chequeo = Object.fromEntries([...sec.querySelectorAll('[data-check]')].map(el => [el.dataset.check, el.checked]));
    });
    return c;
}
async function campSave() { const c = campRead(); await api('/api/campanas/' + c.id, body(c)); await loadLaunches(); notify('Campaña guardada.'); }
function campStageAdd() { const c = campRead(); c.etapas.push({nombre: 'Nueva etapa', tipo: 'Single', fecha: '', distribuidora: 'AMA', canciones: [], estado: 'Planificada', chequeo: {}, limites: {}}); paintLaunches(); }
function campStageRemove(i) { const c = campRead(); c.etapas.splice(i, 1); paintLaunches(); }
async function campDelete() { if (!confirm('¿Borrar esta campaña? Las canciones y discos no se tocan.')) return; await api('/api/campanas/' + camp.sel + '/borrar', body({})); camp.sel = ''; await loadLaunches(); }
async function newBlankCampaign() { const c = await api('/api/campanas', body({nombre: 'Nueva campaña', etapas: [{tipo: 'Single', nombre: 'Single'}]})); camp.sel = c.id; await loadLaunches(); }
async function homeUpcoming() {
    const list = await api('/api/campanas').catch(() => []);
    const next = list.flatMap(c => c.etapas.filter(s => s.fecha && s.estado !== 'Publicada').map(s => ({...s, campana: c}))).sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 4);
    const anchor = document.querySelector('#homeDash .home-split');
    if (!anchor || !next.length || document.getElementById('homeUpcoming')) return;
    anchor.insertAdjacentHTML('afterend', `<section id="homeUpcoming"><div class="section-head"><h2>Próximos de lanzamiento</h2><button class="btn-ghost" onclick="openLaunches().catch(report)">Ver campañas</button></div>
      <div class="up-grid">${next.map(s => `<button class="card up-card" onclick="camp.sel='${s.campana.id}';openLaunches().catch(report)"><small>📅 ${fmtD(s.fecha)}</small><strong>${esc(s.nombre)}</strong>
        <small class="${new Date(s.limites.distribuidora) < new Date() && s.estado === 'Planificada' ? 'warn-amber' : 'muted'}">Subir antes del ${fmtD(s.limites.distribuidora)} · ${esc(s.campana.nombre)}</small></button>`).join('')}</div></section>`);
}

// ── Audiovisual ──
async function renderAvLibrary(root) {
    av.list = await api('/api/audiovisual').catch(() => []);
    root.innerHTML = `<header class="prod-head"><div><div class="eyebrow">Biblioteca</div><h1>Producciones</h1></div>
        <div class="row"><div class="seg"><button onclick="prod.media='audio';renderGlobalProjects()">Audio</button><button class="is-on">Audiovisual</button></div>
          <button class="btn-primary" onclick="newAvProject()">+ Nuevo audiovisual</button></div></header>
      <div class="prod-grid">${av.list.map(v => `<article class="prod-card"><div class="prod-cover av-cover" onclick="openAv('${v.id}')">▶<span class="prod-state" style="--c:#5AA7FF">${esc(v.estado)}</span></div>
        <button class="prod-copy" onclick="openAv('${v.id}')"><strong>${esc(v.nombre)}</strong><span class="muted">${esc(v.plantilla)} · ${esc({cancion: 'desde canción', independiente: 'independiente', audio_desde_video: 'el audio nace del video'}[v.origen])}</span></button>
        <span class="prod-meta">${v.canciones_det.map(s => '♫ ' + esc(s.titulo)).join(' · ') || esc(v.cliente || '')}</span></article>`).join('') || '<p class="muted">Todavía no hay audiovisuales.</p>'}</div>`;
}
async function newAvProject(songId) {
    av.opts ||= await api('/api/audiovisual/opciones');
    const songs = await api('/api/composicion/letras');
    formDialog('Nuevo audiovisual', `<label>Nombre<input name="nombre" required></label>
      <label>Origen<select name="origen"><option value="cancion">Desde una canción (videoclip, lyric video)</option><option value="independiente">Independiente (entrevista, institucional, redes)</option><option value="audio_desde_video">El audio nace del video (sesión en vivo, recital)</option></select></label>
      <label>Plantilla<select name="plantilla">${av.opts.plantillas.map(p => `<option>${p}</option>`).join('')}</select></label>
      <label>Canción (si parte de una)<select name="cancion"><option value="">—</option>${songs.map(s => `<option value="${s.id}" ${s.id === songId ? 'selected' : ''}>${esc(s.titulo)}</option>`).join('')}</select></label>`,
      async data => { const v = await api('/api/audiovisual', body({nombre: data.nombre, origen: data.origen, plantilla: data.plantilla, canciones: data.cancion ? [data.cancion] : []})); openAv(v.id); });
}
async function openAv(id) {
    av.sel = id; go('avPane');
    [av.list, av.opts, av.artists] = await Promise.all([api('/api/audiovisual'), av.opts || api('/api/audiovisual/opciones'), api('/api/personas').catch(() => [])]);
    av.master = await api('/api/audiovisual/' + id + '/master').catch(() => null);
    paintAv();
}
function avLinkFor(songId) {
    const v = (av.list || []).find(x => x.canciones?.includes(songId));
    return v ? `<button class="link" onclick="openAv('${v.id}')">▶ ${esc(v.plantilla)} · ${esc(v.estado)}</button>` : `<button class="link" onclick="newAvProject('${songId}')">+ Crear audiovisual</button>`;
}
api('/api/audiovisual').then(list => { av.list = list; }).catch(() => {});
function rowsEditor(key, cols, list) {
    return `<table class="matrix av-rows" data-rows="${key}"><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>
      ${list.map((r, i) => `<tr>${cols.map(([k, , opts]) => `<td>${opts ? `<select data-r="${i}" data-c="${k}">${opts.map(o => `<option ${r[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>` : `<input data-r="${i}" data-c="${k}" value="${esc(r[k] || '')}">`}</td>`).join('')}
        <td><button class="btn-ghost" onclick="avRows('${key}','del',${i})">✕</button></td></tr>`).join('')}</tbody></table>
      <button class="btn-ghost" onclick="avRows('${key}','add')">+ Fila</button>`;
}
const AV_COLS = {secciones: [['nombre', 'Sección'], ['inicio', 'Inicio (m:ss)'], ['fin', 'Fin (m:ss)']],
    planos: [['codigo', 'Plano'], ['seccion', 'Sección / escena'], ['descripcion', 'Descripción'], ['tipo', 'Tipo', ['Lip-sync', 'Banda', 'Recurso', 'Entrevista', 'Otro']], ['estado', 'Estado', ['Pendiente', 'Filmado', 'Descartado']]],
    tomas: [['plano', 'Plano'], ['numero', 'Toma'], ['camara', 'Cámara / audio'], ['ruta', 'Archivo (ruta)'], ['calificacion', 'Calif.', ['★ seleccionada', 'B buena', 'A alternativa', 'R repetir']]],
    versiones: [['numero', 'Versión'], ['tipo', 'Tipo', ['Armado', 'Rough cut', 'Fine cut', 'Lock']], ['ruta', 'Archivo (ruta)'], ['estado', 'Estado', ['En edición', 'Enviada al artista', 'Aprobada']]]};
function paintAv() {
    const v = av.list.find(x => x.id === av.sel);
    const root = $('avPane');
    if (!v) { root.innerHTML = '<p class="muted">Audiovisual no encontrado.</p>'; return; }
    const tabs = [['resumen', 'Resumen'], ['mapa', 'Mapa y planos'], ['tomas', 'Tomas'], ['versiones', 'Versiones'], ['entregas', 'Entregas'], ['desprender', 'Desprender música']];
    const m = av.master;
    root.innerHTML = `<header class="prod-head"><div><div class="eyebrow">Audiovisual · ${esc(v.plantilla)}</div><h1>${esc(v.nombre)}</h1>
        <p class="muted">${v.canciones_det.map(s => '♫ ' + esc(s.titulo)).join(' · ') || 'Independiente'}${m?.estado === 'nuevo' ? ` · <span class="warn-amber">Hay un master nuevo (${esc(m.vigente.nombre)}): reemplazá el audio en el proyecto de edición.</span>` : m?.estado === 'al-dia' ? ' · <span class="ok-green">Audio al día con el master</span>' : ''}</p></div>
      <div class="row"><button class="alt" onclick="prod.media='audiovisual';openArtistManager(true)">← Audiovisuales</button><button class="btn-primary" onclick="avSave().catch(report)">Guardar</button></div></header>
      <div class="seg tabs">${tabs.map(([id, l]) => `<button class="${av.tab === id ? 'is-on' : ''}" onclick="avRead();av.tab='${id}';paintAv()">${l}</button>`).join('')}</div>
      <section class="card av-body">${{
        resumen: `<div class="cr-grid">${field('Estado', `<select data-f="estado">${['En desarrollo', 'En preproducción', 'Rodaje', 'Postproducción', 'Entregado', 'Publicado'].map(s => `<option ${v.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
            ${field('Estreno', `<input type="date" data-f="estreno" value="${esc(v.estreno || '')}">`)}${field('Responsable', `<input data-f="responsable" value="${esc(v.responsable || '')}">`)}
            ${field('Cliente', `<input data-f="cliente" value="${esc(v.cliente || '')}">`)}${field('Proyecto del editor (Premiere, DaVinci, Final Cut)', `<input data-f="proyecto_editor" value="${esc(v.proyecto_editor || '')}" placeholder="Ruta del proyecto">`)}</div>
          <div class="av-stages">${v.etapas.map((s, i) => `<div class="av-stage"><strong>${esc(s.nombre)}</strong>${s.tareas.map((t, j) => `<label class="check"><input type="checkbox" data-task="${i}:${j}" ${t.hecha ? 'checked' : ''}> ${esc(t.nombre)}</label>`).join('')}</div>`).join('')}</div>
          <p class="insp-help">AudioTaller gestiona, no edita: los archivos quedan donde están y se abren con su programa.</p>`,
        mapa: `<span class="insp-label">Mapa de la canción (secciones)</span>${rowsEditor('secciones', AV_COLS.secciones, v.secciones)}<span class="insp-label">Planos por sección</span>${rowsEditor('planos', AV_COLS.planos, v.planos)}`,
        tomas: `${rowsEditor('tomas', AV_COLS.tomas, v.tomas)}<p class="insp-help">Una toma puede tener varias filas (cámara A, B y audio). Los archivos se referencian por ruta; nunca se mueven.</p>`,
        versiones: `${rowsEditor('versiones', AV_COLS.versiones, v.versiones)}<p class="insp-help">Las devoluciones del artista sobre los cortes usarán el mismo portal y el mismo semáforo cuando el portal admita video.</p>`,
        entregas: `${av.opts.entregas.map(p => `<label class="check"><input type="checkbox" data-del="${esc(p)}" ${v.entregas?.[p] ? 'checked' : ''}> ${esc(p)}</label>`).join('')}`,
        desprender: `<p class="muted">Elegí los audios del rodaje: AudioTaller crea una canción por cada uno en la etapa Mezcla, vinculada a este video. Cuando se masterice, el video avisa que hay audio nuevo.</p>
          ${field('Artista', `<select id="avArtist">${av.artists.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')}</select>`)}
          <div id="avSplit">${[0, 1, 2].map(i => `<div class="cr-row"><input data-split-t="${i}" placeholder="Título de la canción"><input data-split-r="${i}" placeholder="Ruta del audio (C:\\Rodaje\\Mezcla\\tema1.wav)"></div>`).join('')}</div>
          <button class="btn-primary" onclick="avSplit().catch(report)">Desprender música</button>`,
      }[av.tab]}</section>`;
}
function avRead() {
    const v = av.list.find(x => x.id === av.sel); if (!v) return v;
    document.querySelectorAll('#avPane [data-f]').forEach(el => { v[el.dataset.f] = el.value; });
    document.querySelectorAll('#avPane [data-task]').forEach(el => { const [i, j] = el.dataset.task.split(':'); v.etapas[i].tareas[j].hecha = el.checked; });
    document.querySelectorAll('#avPane [data-del]').forEach(el => { (v.entregas ||= {})[el.dataset.del] = el.checked; });
    document.querySelectorAll('#avPane [data-rows]').forEach(table => { const key = table.dataset.rows; table.querySelectorAll('[data-r]').forEach(el => { v[key][el.dataset.r][el.dataset.c] = el.value; }); });
    return v;
}
function avRows(key, op, i) { const v = avRead(); if (op === 'add') v[key].push({}); else v[key].splice(i, 1); paintAv(); }
async function avSave() {
    const v = avRead();
    const {id, canciones_det, ...data} = v; void canciones_det;
    await api('/api/audiovisual/' + id, body(data));
    av.list = await api('/api/audiovisual'); paintAv(); notify('Audiovisual guardado.');
}
async function avSplit() {
    const items = [0, 1, 2].map(i => ({titulo: document.querySelector(`[data-split-t="${i}"]`).value.trim(), ruta: document.querySelector(`[data-split-r="${i}"]`).value.trim()})).filter(x => x.titulo || x.ruta);
    const result = await api('/api/audiovisual/' + av.sel + '/desprender', body({artista_id: $('avArtist').value, canciones: items}));
    av.list = await api('/api/audiovisual'); paintAv();
    notify(`${countLabel(result.canciones.length, 'canción creada', 'canciones creadas')} en Mezcla y vinculadas al video.`);
}

// ── Asistente Claude ──
const chat = {open: false, msgs: [], busy: false};
function chatToggle() { chat.open = !chat.open; paintChat(); }
function paintChat() {
    let box = $('chatBox');
    if (!box) { box = document.createElement('div'); box.id = 'chatBox'; document.body.appendChild(box); }
    box.innerHTML = `<button id="chatFab" aria-label="Asistente Claude" title="Asistente Claude" onclick="chatToggle()">✳</button>
      ${chat.open ? `<section class="chat-panel" role="dialog" aria-label="Asistente Claude"><div class="cr-sub"><strong>✳ Asistente</strong><span class="row-tight"><button class="btn-ghost" onclick="openConfig()">Configuración</button><button class="btn-ghost" onclick="chatToggle()">✕</button></span></div>
        <div class="chat-msgs">${chat.msgs.map(m => `<p class="msg ${m.rol}">${esc(m.texto)}</p>`).join('') || '<p class="muted">Preguntá sobre lo que estás viendo: «¿Qué le falta a este disco para subirlo a AMA?», «Redactá un pitch para el single», «Armá un mensaje de WhatsApp para pedir devoluciones».</p>'}${chat.busy ? '<p class="muted">Pensando…</p>' : ''}</div>
        <form onsubmit="event.preventDefault();chatSend(this.q.value).catch(e=>{chat.busy=false;chat.msgs.push({rol:'assistant',texto:e.message});paintChat()})"><textarea name="q" rows="2" placeholder="Escribí tu pregunta…"></textarea><button class="btn-primary">Enviar</button></form></section>` : ''}`;
}
async function chatSend(text) {
    if (!text.trim() || chat.busy) return;
    chat.msgs.push({rol: 'user', texto: text}); chat.busy = true; paintChat();
    const context = `Pantalla: ${trail.at(-1)}. Ruta: ${$('crumbPath')?.textContent || ''}. Contenido visible: ${(document.querySelector('main section:not([hidden])')?.innerText || '').slice(0, 5000)}`;
    const result = await api('/api/asistente/mensaje', body({mensajes: chat.msgs.slice(-20), contexto: context}));
    chat.busy = false; chat.msgs.push({rol: 'assistant', texto: result.texto}); paintChat();
}
async function openConfig() {
    go('configPane');
    const c = await api('/api/asistente/config');
    $('configPane').innerHTML = `<header class="prod-head"><div><div class="eyebrow">Configuración</div><h1>Claude</h1>
      <p class="muted">El asistente usa tu propia clave de API de la Claude Console (se factura aparte de la suscripción a claude.ai). La clave se guarda cifrada en esta PC.</p></div></header>
      <form class="card cr-form" onsubmit="event.preventDefault();saveConfig(this).catch(report)">
        <div class="cr-grid">${field('Clave de API', `<input name="api_key" type="password" placeholder="${c.clave ? '•••••• guardada (escribí otra para cambiarla)' : 'sk-ant-…'}">`)}
          ${field('Modelo', `<input name="modelo" value="${esc(c.modelo)}">`)}
          ${field('Nivel', `<select name="nivel">${[['leer', 'Solo leer y responder'], ['sugerir', 'Sugerir cambios'], ['actuar', 'Actuar con confirmación']].map(([v, l]) => `<option value="${v}" ${c.nivel === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
          ${field('Tope mensual (tokens)', `<input name="tope_tokens" inputmode="numeric" value="${c.tope_tokens}">`)}</div>
        <label class="check"><input type="checkbox" name="confirmar" ${c.confirmar ? 'checked' : ''}> Pedir confirmación antes de cualquier cambio</label>
        <label class="check"><input type="checkbox" name="compartir_audio" ${c.compartir_audio ? 'checked' : ''}> Permitir enviar audios para análisis</label>
        <span class="muted">Uso este mes: ${Number(c.usados || 0).toLocaleString('es-AR')} de ${Number(c.tope_tokens).toLocaleString('es-AR')} tokens. WhatsApp nunca se envía solo: el asistente redacta y vos enviás.</span>
        <div class="form-actions"><button class="btn-primary">Guardar</button></div></form>`;
}
async function saveConfig(form) {
    const d = Object.fromEntries(new FormData(form));
    const payload = {modelo: d.modelo, nivel: d.nivel, tope_tokens: Number(d.tope_tokens) || 0, confirmar: !!d.confirmar, compartir_audio: !!d.compartir_audio};
    if (d.api_key) payload.api_key = d.api_key;
    await api('/api/asistente/config', body(payload)); notify('Configuración guardada.'); openConfig();
}
paintChat();
