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
async function campDelete() { if (!await appConfirm({title: 'Borrar campaña', message: '¿Borrar esta campaña?', detail: 'Las canciones y los discos no se modifican.', confirmLabel: 'Borrar campaña'})) return; await api('/api/campanas/' + camp.sel + '/borrar', body({})); camp.sel = ''; await loadLaunches(); }
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
        <span class="prod-meta">${[v.artista, ...v.canciones_det.map(s => '♫ ' + s.titulo)].filter(Boolean).map(esc).join(' · ') || esc(v.cliente || '')}</span></article>`).join('') || '<p class="muted">Todavía no hay audiovisuales.</p>'}</div>`;
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
    av.sel = id; av.sec = null; av.cut = 0; go('avPane');
    [av.list, av.opts, av.artists] = await Promise.all([api('/api/audiovisual'), av.opts || api('/api/audiovisual/opciones'), api('/api/personas').catch(() => [])]);
    const v = av.list.find(x => x.id === id);
    if (v && !v.etapas.some(s => s.nombre === av.tab)) av.tab = (v.etapas.find(s => s.progreso < 100) || v.etapas[0] || {}).nombre;
    av.master = await api('/api/audiovisual/' + id + '/master').catch(() => null);
    av.sessions = v?.canciones?.[0] ? (await api('/api/produccion/' + v.canciones[0]).catch(() => ({sesiones: []}))).sesiones || [] : [];
    paintAv();
}
function avLinkFor(songId) {
    const v = (av.list || []).find(x => x.canciones?.includes(songId));
    return v ? `<button class="link" onclick="openAv('${v.id}')">▶ ${esc(v.plantilla)} · ${esc(v.estado)}</button>` : `<button class="link" onclick="newAvProject('${songId}')">+ Crear audiovisual</button>`;
}
api('/api/audiovisual').then(list => { av.list = list; }).catch(() => {});

// Guarda un cambio parcial y vuelve a pintar con lo que devolvió el servidor (no hay botón Guardar: todo queda guardado al instante).
async function avSet(patch, quiet) {
    const updated = await api('/api/audiovisual/' + av.sel, body(patch));
    const i = av.list.findIndex(x => x.id === av.sel); if (i >= 0) av.list[i] = updated;
    paintAv(); if (!quiet) notify('Guardado.');
}
const avCur = () => av.list.find(x => x.id === av.sel);
const avClone = key => JSON.parse(JSON.stringify(avCur()[key] || []));
const avBase = path => String(path || '').split(/[\\/]/).pop();
const avClock = t => { const m = String(t || '').match(/^(\d+):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
async function avOpen(campo, indice, carpeta) {
    await api('/api/audiovisual/' + av.sel + '/abrir', body({campo, indice, carpeta: !!carpeta}));
}
async function avChoose(title, current, hint, folder) {
    if (window.pywebview?.api?.choose_path) {
        try { const p = await window.pywebview.api.choose_path(!!folder); if (p) return p; return null; } catch { /* sigue con el diálogo */ }
    }
    return new Promise(resolve => formDialog(title, `<label>Ruta del archivo<input name="ruta" value="${esc(current || '')}" placeholder="${esc(hint)}" required></label>`, async d => resolve(d.ruta.trim())));
}
async function avLinkEditor() {
    const v = avCur();
    const path = await avChoose('Proyecto de edición', v.proyecto_editor, 'C:\\Videos\\Mareas\\Mareas_clip.prproj');
    if (path) await avSet({proyecto_editor: path});
}
async function avLinkAudio() {
    const v = avCur();
    const daw = av.sessions.filter(s => /\.(cpr|rpp|ptx|als|song|flp|npr|wpr)$/i.test(s.ruta || ''));
    if (!daw.length) { const path = await avChoose('Sesión de audio del clip', v.sesion_audio, 'C:\\Sesiones\\Mareas\\Mareas_Mezcla.cpr'); if (path) await avSet({sesion_audio: path}); return; }
    formDialog('Sesión de audio del clip', `<p class="muted">Elegí una sesión de la canción o una ruta propia (por ejemplo, la sesión de Cubase con el audio del video).</p>
      <label>Sesión<select name="ruta">${daw.map(s => `<option value="${esc(s.ruta)}" ${s.ruta === v.sesion_audio ? 'selected' : ''}>${esc(s.nombre || avBase(s.ruta))} · ${esc(s.daw || '')} · ${esc(s.etapa)}${s.vigente ? ' · vigente' : ''}</option>`).join('')}<option value="__otra">Otra sesión (elegir archivo)…</option></select></label>`,
      async d => { if (d.ruta === '__otra') { const path = await avChoose('Sesión de audio del clip', v.sesion_audio, 'C:\\Sesiones\\Mareas.cpr'); if (path) await avSet({sesion_audio: path}); } else await avSet({sesion_audio: d.ruta}); });
}
async function avEditData() {
    const v = avCur();
    const songs = await api('/api/composicion/letras').catch(() => []);
    formDialog('Datos del audiovisual', `<label>Nombre<input name="nombre" value="${esc(v.nombre)}" required maxlength="150"></label>
      <label>Artista<select name="artista_id"><option value="">— Sin artista —</option>${av.artists.map(a => `<option value="${a.id}" ${a.id === v.artista_id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></label>
      <label>Canción<select name="cancion"><option value="">— Independiente —</option>${songs.map(s => `<option value="${s.id}" ${v.canciones?.[0] === s.id ? 'selected' : ''}>${esc(s.titulo)}</option>`).join('')}</select></label>
      <label>Dirección<input name="direccion" value="${esc(v.direccion || '')}" maxlength="150"></label>
      <label>Edición<input name="edicion" value="${esc(v.edicion || '')}" maxlength="150"></label>
      <label>Estreno<input type="date" name="estreno" value="${esc(v.estreno || '')}"></label>
      <label>Dónde se estrena<input name="plataforma_estreno" value="${esc(v.plataforma_estreno || '')}" placeholder="YouTube, Instagram…" maxlength="100"></label>
      <label>Estado<select name="estado">${['En desarrollo', 'En preproducción', 'Rodaje', 'Postproducción', 'Entregado', 'Publicado'].map(x => `<option ${v.estado === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`,
      async d => { const {cancion, ...rest} = d; await avSet({...rest, canciones: cancion ? [cancion, ...(v.canciones || []).filter(x => x !== cancion)] : (v.canciones || []).slice(1)}); });
}
function avSplitDialog() {
    const v = avCur();
    formDialog('Desprender música', `<p class="muted">Elegí los audios del rodaje: AudioTaller crea una canción por cada uno en la etapa Mezcla, vinculada a este video. Cuando se masterice, el video avisa que hay audio nuevo.</p>
      <label>Artista<select name="artista_id">${av.artists.map(a => `<option value="${a.id}" ${a.id === v.artista_id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></label>
      ${[0, 1, 2].map(i => `<div class="cr-row"><input name="t${i}" placeholder="Título de la canción"><input name="r${i}" placeholder="Ruta del audio (C:\\Rodaje\\Mezcla\\tema1.wav)"></div>`).join('')}`,
      async d => {
          const items = [0, 1, 2].map(i => ({titulo: (d['t' + i] || '').trim(), ruta: (d['r' + i] || '').trim()})).filter(x => x.titulo || x.ruta);
          const result = await api('/api/audiovisual/' + av.sel + '/desprender', body({artista_id: d.artista_id, canciones: items}));
          await openAv(av.sel);
          notify(`${countLabel(result.canciones.length, 'canción creada', 'canciones creadas')} en Mezcla y vinculadas al video.`);
      });
}
// Tareas de la etapa abierta: marcar, responsable, agregar y quitar.
function avTask(op, j, value) {
    const etapas = avClone('etapas').map(({color, progreso, ...s}) => s);
    const st = etapas.find(s => s.nombre === av.tab); if (!st) return;
    if (op === 'toggle') st.tareas[j].hecha = !st.tareas[j].hecha;
    if (op === 'who') st.tareas[j].responsable = value;
    if (op === 'del') st.tareas.splice(j, 1);
    if (op === 'add' && value) st.tareas.push({nombre: value, hecha: false, responsable: ''});
    return avSet({etapas}, true);
}
// Filas genéricas (planos, tomas, versiones, referencias, jornadas, plataformas, secciones).
function avRow(key, op, i, col, value) {
    const rows = avClone(key);
    if (op === 'add') rows.push(value || {});
    if (op === 'del') rows.splice(i, 1);
    if (op === 'set') rows[i][col] = value;
    return avSet({[key]: rows}, true);
}
async function avRowFile(key, i, col = 'ruta') {
    const path = await avChoose('Elegir archivo', avCur()[key]?.[i]?.[col], 'C:\\Rodaje\\CAM_A_0107.mov');
    if (path) await avRow(key, 'set', i, col, path);
}
async function avDeliveryFile(profile) {
    const v = avCur();
    const path = await avChoose('Archivo entregado · ' + profile, v.entregas_rutas?.[profile], 'C:\\Entregas\\Mareas_YouTube.mp4');
    if (path) await avSet({entregas_rutas: {...(v.entregas_rutas || {}), [profile]: path}});
}
const avIn = (key, i, col, val, ph = '', w = '') => `<input class="avx-in" ${w ? `style="flex:0 0 ${w}"` : ''} value="${esc(val || '')}" placeholder="${esc(ph)}" onchange="avRow('${key}','set',${i},'${col}',this.value).catch(report)">`;
const avSel = (key, i, col, val, opts) => `<select class="avx-in" onchange="avRow('${key}','set',${i},'${col}',this.value).catch(report)">${opts.map(o => `<option ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const avDel = (key, i) => `<button class="avx-x" aria-label="Quitar" onclick="avRow('${key}','del',${i}).catch(report)">✕</button>`;
const avAdd = (key, label, seed = '{}') => `<button class="avx-add" onclick='avRow("${key}","add",0,"",${seed}).catch(report)'>+ ${label}</button>`;
const AV_SEC_COLORS = {intro: '#5C5C66', outro: '#5C5C66', verso: '#5AA7FF', estribillo: '#2FD8BF', puente: '#9B8CFF'};
const avSecColor = name => { const n = String(name || '').toLowerCase(); const k = Object.keys(AV_SEC_COLORS).find(x => n.startsWith(x)); return k ? AV_SEC_COLORS[k] : '#FFB547'; };
const AV_SHOT_STATES = ['Pendiente', 'Filmado', 'Repetir', 'Descartado'];
const AV_RATES = [['★ seleccionada', '#2FD8BF'], ['B buena', '#5ED17E'], ['A alternativa', '#FFB547'], ['R repetir', '#E5484D']];
const AV_CUT_STATES = ['En edición', 'Revisión interna', 'Enviada al artista', 'Cambios pedidos', 'Aprobada'];

function avMap(v) {
    const secs = v.secciones || [];
    const spans = secs.map(s => [avClock(s.inicio), avClock(s.fin)]);
    const timed = spans.length && spans.every(([a, b]) => a !== null && b !== null && b > a);
    const notes = {Desarrollo: 'Referencia para el tratamiento', 'Preproducción': 'Clic en una sección para filtrar los planos', Rodaje: 'Cobertura por sección', 'Postproducción': 'Estructura sobre la que se arma el corte', Entregas: 'El estribillo es el recorte sugerido para formatos verticales', 'Distribución': 'Secciones del tema'};
    return `<section class="avx-card avx-map"><div class="avx-cardhead"><div><strong>Mapa de la canción</strong> <span class="muted">· todo el clip se organiza sobre las secciones del tema</span></div><span class="muted">${notes[av.tab] || ''}</span></div>
      ${secs.length ? `<div class="avx-bar">${secs.map((s, k) => `<button style="flex:${timed ? spans[k][1] - spans[k][0] : 1};--c:${avSecColor(s.nombre)}" class="${av.sec === k ? 'on' : av.sec !== null ? 'dim' : ''}" title="${esc(s.nombre)}" onclick="av.sec=av.sec===${k}?null:${k};paintAv()"><b>${esc(s.nombre)}</b><span>${esc(s.inicio || '')}${s.fin ? '–' + esc(s.fin) : ''}</span></button>`).join('')}</div>` : '<p class="muted">Todavía no cargaste las secciones del tema. Sumalas abajo (por ejemplo Intro 0:00–0:12) y los planos se organizan sobre ellas.</p>'}
      <details class="avx-edit"><summary>Editar secciones</summary><div class="avx-rows">${secs.map((s, i) => `<div class="avx-r">${avIn('secciones', i, 'nombre', s.nombre, 'Sección')}${avIn('secciones', i, 'inicio', s.inicio, '0:00', '80px')}${avIn('secciones', i, 'fin', s.fin, '0:12', '80px')}${avDel('secciones', i)}</div>`).join('')}</div>${avAdd('secciones', 'Sección')}</details></section>`;
}
function avTasks(stage) {
    return `<section class="avx-card"><div class="avx-cardhead"><strong>Tareas de ${esc(stage.nombre.toLowerCase())}</strong><span class="muted">${stage.tareas.filter(t => t.hecha).length} de ${stage.tareas.length}</span></div>
      <div class="avx-tasks">${stage.tareas.map((t, j) => `<div class="avx-task"><label><input type="checkbox" ${t.hecha ? 'checked' : ''} onchange="avTask('toggle',${j}).catch(report)"> ${esc(t.nombre)}</label>
        <input class="avx-who" value="${esc(t.responsable || '')}" placeholder="Responsable" onchange="avTask('who',${j},this.value).catch(report)"><button class="avx-x" aria-label="Quitar tarea" onclick="avTask('del',${j}).catch(report)">✕</button></div>`).join('') || '<p class="muted">Sin tareas en esta etapa.</p>'}</div>
      <form class="avx-newtask" onsubmit="event.preventDefault();avTask('add',0,this.t.value.trim()).catch(report)"><input name="t" placeholder="Nueva tarea…"><button class="btn-ghost">Agregar</button></form>
      <p class="insp-help">Las tareas se activan o desactivan por proyecto: un clip simple no necesita guion literario.</p></section>`;
}
function avFileCell(key, i, path) {
    return path ? `<span class="avx-file" title="${esc(path)}">${esc(avBase(path))}</span><button class="link" onclick="avOpen('${key === 'versiones' ? 'version' : key === 'tomas' ? 'toma' : 'referencia'}',${i}).catch(report)">Abrir</button><button class="link" onclick="avRowFile('${key}',${i}).catch(report)">Cambiar</button>`
        : `<button class="link" onclick="avRowFile('${key}',${i}).catch(report)">Vincular archivo…</button>`;
}
function avStageBody(v, stage) {
    const secs = v.secciones || [];
    const secName = av.sec !== null ? secs[av.sec]?.nombre : null;
    switch (stage.nombre) {
    case 'Desarrollo': return `<div class="avx-cols">
        <section class="avx-card"><strong>Concepto</strong><textarea class="avx-text" rows="7" placeholder="De qué trata el clip, la idea visual, el tratamiento…" onchange="avSet({concepto:this.value},true).catch(report)">${esc(v.concepto || '')}</textarea></section>
        <section class="avx-card"><strong>Referencias y moodboard</strong><div class="avx-rows">${(v.referencias || []).map((r, i) => `<div class="avx-r">${avIn('referencias', i, 'nombre', r.nombre, 'Referencia')}${/^https?:/i.test(r.ruta || '') ? `<a href="${esc(r.ruta)}" target="_blank" rel="noopener">Ver enlace</a>` : avFileCell('referencias', i, r.ruta)}${avDel('referencias', i)}</div>`).join('') || '<p class="muted">Tratamiento, moodboard, enlaces de YouTube o Pinterest.</p>'}</div>${avAdd('referencias', 'Referencia')}</section>
        ${avTasks(stage)}</div>`;
    case 'Preproducción': {
        const shots = (v.planos || []).map((p, i) => [p, i]).filter(([p]) => !secName || p.seccion === secName);
        return `<div class="avx-cols avx-wide">
        <section class="avx-card"><div class="avx-cardhead"><strong>Shot list ${secName ? '· ' + esc(secName) : ''}</strong>${secName ? `<button class="link" onclick="av.sec=null;paintAv()">Ver todos</button>` : ''}</div>
          <div class="avx-table">${shots.map(([p, i]) => `<div class="avx-r">${avIn('planos', i, 'codigo', p.codigo, 'P01', '60px')}${avSel('planos', i, 'seccion', p.seccion, ['', ...new Set(secs.map(s => s.nombre))])}${avIn('planos', i, 'descripcion', p.descripcion, 'Qué se ve')}${avIn('planos', i, 'tipo', p.tipo, 'Plano / lente', '130px')}${avIn('planos', i, 'locacion', p.locacion, 'Locación · cámara', '150px')}${avSel('planos', i, 'estado', p.estado || 'Pendiente', AV_SHOT_STATES)}${avDel('planos', i)}</div>`).join('') || '<p class="muted">Sin planos todavía.</p>'}</div>
          ${avAdd('planos', 'Plano', JSON.stringify({codigo: 'P' + String((v.planos || []).length + 1).padStart(2, '0'), seccion: secName || '', estado: 'Pendiente'}))}</section>
        <section class="avx-card"><strong>Jornadas de rodaje</strong><div class="avx-rows">${(v.jornadas || []).map((d, i) => `<div class="avx-r">${`<input class="avx-in" type="date" value="${esc(d.fecha || '')}" onchange="avRow('jornadas','set',${i},'fecha',this.value).catch(report)" style="width:150px">`}${avIn('jornadas', i, 'titulo', d.titulo, 'Jornada 1 · playa y muelle')}${avIn('jornadas', i, 'detalle', d.detalle, 'Planos, equipo, horario')}${avSel('jornadas', i, 'estado', d.estado || 'Planificada', ['Planificada', 'Confirmada', 'Filmada', 'Suspendida'])}${avDel('jornadas', i)}</div>`).join('') || '<p class="muted">Scouting, pruebas de cámara y jornadas.</p>'}</div>${avAdd('jornadas', 'Jornada')}</section>
        ${avTasks(stage)}</div>`;
    }
    case 'Rodaje': {
        const kinds = [...new Set((v.planos || []).map(p => p.tipo || 'Sin tipo'))];
        const good = t => /seleccionada|buena/i.test(t.calificacion || '');
        const count = (kind, sec) => (v.tomas || []).filter(t => good(t)).filter(t => { const p = (v.planos || []).find(x => x.codigo === t.plano); return p && (p.tipo || 'Sin tipo') === kind && p.seccion === sec; }).length;
        return `<div class="avx-cols avx-wide">
        <section class="avx-card"><div class="avx-cardhead"><strong>Cobertura por sección</strong><span class="muted">tomas buenas o seleccionadas por tipo de plano</span></div>
          ${secs.length && kinds.length ? `<div class="avx-cov" style="grid-template-columns:160px repeat(${secs.length},minmax(0,1fr))"><span></span>${secs.map(s => `<span class="muted avx-covh">${esc(s.nombre)}</span>`).join('')}
            ${kinds.map(k => `<span class="avx-covk">${esc(k)}</span>${secs.map(s => { const n = count(k, s.nombre); return `<span class="avx-cell ${n === 0 ? 'bad' : n === 1 ? 'mid' : 'ok'}" title="${esc(k)} · ${esc(s.nombre)}: ${n}">${n || '—'}</span>`; }).join('')}`).join('')}</div>` : '<p class="muted">Cargá las secciones y los planos (con su tipo) para ver qué partes del tema están cubiertas.</p>'}</section>
        <section class="avx-card"><strong>Tomas</strong><div class="avx-table">${(v.tomas || []).map((t, i) => `<div class="avx-r">${avIn('tomas', i, 'numero', t.numero, 'J1-T07', '90px')}${avSel('tomas', i, 'plano', t.plano, ['', ...(v.planos || []).map(p => p.codigo)])}${avIn('tomas', i, 'camara', t.camara, 'CAM A / audio', '120px')}${avFileCell('tomas', i, t.ruta)}${avSel('tomas', i, 'calificacion', t.calificacion || 'B buena', AV_RATES.map(r => r[0]))}${avDel('tomas', i)}</div>`).join('') || '<p class="muted">Una toma puede tener varias filas (cámara A, B y audio). Los archivos se referencian por ruta; nunca se mueven.</p>'}</div>${avAdd('tomas', 'Toma', JSON.stringify({calificacion: 'B buena'}))}</section>
        ${avTasks(stage)}</div>`;
    }
    case 'Postproducción': return `<div class="avx-cols avx-wide">
        <section class="avx-card"><strong>Cortes y versiones</strong><div class="avx-table">${(v.versiones || []).map((c, i) => `<div class="avx-r">${avIn('versiones', i, 'numero', c.numero, 'Rough cut · V2', '170px')}${avSel('versiones', i, 'tipo', c.tipo || 'Armado', ['Armado', 'Rough cut', 'Fine cut', 'Lock'])}${avFileCell('versiones', i, c.ruta)}${avSel('versiones', i, 'estado', c.estado || 'En edición', AV_CUT_STATES)}${avDel('versiones', i)}</div>`).join('') || '<p class="muted">Primer armado, rough cut, fine cut y lock, cada uno con su archivo exportado.</p>'}</div>${avAdd('versiones', 'Versión', JSON.stringify({numero: 'V' + ((v.versiones || []).length + 1), estado: 'En edición'}))}
          <p class="insp-help">Las devoluciones del artista sobre los cortes usarán el mismo portal y el mismo semáforo cuando el portal admita video.</p></section>
        <section class="avx-card"><strong>Proyecto de edición y audio</strong>
          ${avSessionRow('Proyecto de edición', v.proyecto_editor, v.editor_disponible, 'proyecto_editor', 'avLinkEditor()', v.editor_programa ? 'Abrir en ' + v.editor_programa : 'Abrir')}
          ${avSessionRow('Sesión de audio del clip', v.sesion_audio, v.sesion_disponible, 'sesion_audio', 'avLinkAudio()', 'Abrir sesión')}
          <p class="insp-help">AudioTaller gestiona, no edita: los archivos quedan donde están y se abren con su programa.</p></section>
        ${avTasks(stage)}</div>`;
    case 'Entregas': return `<div class="avx-cols avx-wide">
        <section class="avx-card"><strong>Formatos de entrega</strong><div class="avx-table">${av.opts.entregas.map(p => { const path = v.entregas_rutas?.[p]; return `<div class="avx-r"><label class="avx-chk"><input type="checkbox" ${v.entregas?.[p] ? 'checked' : ''} onchange="avSet({entregas:{...(avCur().entregas||{}),'${esc(p)}':this.checked}},true).catch(report)"> ${esc(p)}</label>
          ${path ? `<span class="avx-file" title="${esc(path)}">${esc(avBase(path))}</span><button class="link" onclick="avOpen('entrega','${esc(p)}').catch(report)">Abrir</button><button class="link" onclick="avOpen('entrega','${esc(p)}',true).catch(report)">Carpeta</button>` : ''}<button class="link" onclick="avDeliveryFile('${esc(p)}').catch(report)">${path ? 'Cambiar' : 'Vincular archivo…'}</button></div>`; }).join('')}</div>
          <p class="insp-help">El estribillo es el recorte sugerido para Shorts, Reels y Spotify Canvas.</p></section>
        ${avTasks(stage)}</div>`;
    case 'Distribución': return `<div class="avx-cols avx-wide">
        <section class="avx-card"><strong>Publicaciones</strong><div class="avx-table">${(v.plataformas || []).map((d, i) => `<div class="avx-r">${avSel('plataformas', i, 'plataforma', d.plataforma || 'YouTube', ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Spotify Canvas', 'Vimeo', 'Otra'])}<input class="avx-in" type="date" value="${esc(d.fecha || '')}" style="width:150px" onchange="avRow('plataformas','set',${i},'fecha',this.value).catch(report)">${avIn('plataformas', i, 'enlace', d.enlace, 'https://…')}${avSel('plataformas', i, 'estado', d.estado || 'Programada', ['Programada', 'Publicada', 'Pendiente'])}${avDel('plataformas', i)}</div>`).join('') || '<p class="muted">Estreno, recortes para redes y Canvas.</p>'}</div>${avAdd('plataformas', 'Publicación', JSON.stringify({plataforma: v.plataforma_estreno || 'YouTube', fecha: v.estreno || '', estado: 'Programada'}))}</section>
        ${avTasks(stage)}</div>`;
    default: return avTasks(stage);
    }
}
function avSessionRow(label, path, ok, campo, link, openLabel) {
    return `<div class="avx-sess"><div><span class="avx-lbl">${label}</span>${path ? `<code title="${esc(path)}">${esc(avBase(path))}</code>${ok ? '' : '<span class="warn-amber"> · no se encuentra el archivo</span>'}` : '<span class="muted">Sin vincular</span>'}</div>
      <div class="row-tight">${path ? `<button class="btn-ghost" onclick="avOpen('${campo}').catch(report)" ${ok ? '' : 'disabled'}>${openLabel}</button><button class="link" onclick="avOpen('${campo}',null,true).catch(report)">Carpeta</button>` : ''}<button class="link" onclick="${link}.catch(report)">${path ? 'Cambiar' : 'Vincular…'}</button></div></div>`;
}
function paintAv() {
    const v = avCur();
    const root = $('avPane');
    if (!v) { root.innerHTML = '<p class="muted">Audiovisual no encontrado.</p>'; return; }
    const stage = v.etapas.find(s => s.nombre === av.tab) || v.etapas[0];
    if (stage) av.tab = stage.nombre;
    const m = av.master;
    const lastCut = [...(v.versiones || [])].reverse().find(c => c.ruta);
    const lastCutIndex = lastCut ? v.versiones.indexOf(lastCut) : -1;
    const origin = {cancion: 'desde canción', independiente: 'independiente', audio_desde_video: 'el audio nace del video'}[v.origen] || '';
    const crumbs = [v.artista, v.disco, v.canciones_det[0]?.titulo].filter(Boolean);
    const audioOk = m?.estado === 'al-dia', audioNew = m?.estado === 'nuevo';
    const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('es-AR', {day: 'numeric', month: 'short'}) : '';
    root.innerHTML = `<div class="avx">
      <div class="avx-top"><button class="btn-ghost" onclick="prod.media='audiovisual';openArtistManager(true)">← Audiovisuales</button><button class="menu-danger" onclick="moveEntityToTrash('audiovisual','${v.id}').catch(report)">Mover a Papelera</button></div>
      <header class="avx-hero">
        <button class="avx-thumb" ${lastCut ? `onclick="avOpen('version',${lastCutIndex}).catch(report)" title="Abrir ${esc(avBase(lastCut.ruta))}"` : 'disabled title="Vinculá un corte en Postproducción para verlo desde acá"'}><span class="avx-play">▶</span>${lastCut ? `<span class="avx-cutlbl">${esc(lastCut.numero || lastCut.tipo || 'Corte')}</span>` : ''}</button>
        <div class="avx-info"><div class="eyebrow">${esc(v.plantilla)} · ${esc(origin)}</div><h1>${esc(v.nombre)}</h1>
          <div class="avx-chips"><button class="avx-chip" onclick="avEditData().catch(report)" title="Cambiar artista y canción">${crumbs.length ? '♪ ' + crumbs.map(esc).join(' › ') : '＋ Elegir artista y canción'}</button>
            <span class="avx-kv">Dirección: <b>${esc(v.direccion || '—')}</b></span><span class="avx-kv">Edición: <b>${esc(v.edicion || v.responsable || '—')}</b></span>
            <button class="link" onclick="avEditData().catch(report)">Editar datos</button></div>
          ${v.estreno || v.plataforma_estreno ? `<div class="avx-chips"><span class="avx-chip accent">Estreno${v.plataforma_estreno ? ' en ' + esc(v.plataforma_estreno) : ''}${v.estreno ? ' · ' + esc(fmtDate(v.estreno)) : ''}</span><span class="avx-kv">${esc(v.estado)}</span></div>` : `<div class="avx-chips"><span class="avx-kv">${esc(v.estado)}</span></div>`}</div>
        <div class="avx-side">
          <div class="avx-audio ${audioNew ? 'warn' : audioOk ? 'ok' : ''}"><span class="avx-lbl">Audio del clip</span>
            <code>${esc(m?.usado?.nombre || m?.vigente?.nombre || (v.canciones?.length ? 'Sin master todavía' : 'Sin canción vinculada'))}</code>
            <span>${audioNew ? `⚠ Hay un master más nuevo (${esc(m.vigente.nombre)}). El clip no se cambia solo: revisá y reemplazá el audio en ${esc(v.editor_programa || 'el editor')}.` : audioOk ? '✓ Coincide con el master vigente de la canción' : m?.estado === 'sin-master' ? 'La canción todavía no tiene master' : 'Vinculá una canción para seguir su master'}</span></div>
          ${v.proyecto_editor ? `<button class="btn-ghost avx-open" onclick="avOpen('proyecto_editor').catch(report)" ${v.editor_disponible ? '' : 'disabled title="No se encuentra el archivo"'}>↗ Abrir en ${esc(v.editor_programa)}</button><code class="avx-path" title="${esc(v.proyecto_editor)}">${esc(avBase(v.proyecto_editor))}${v.editor_disponible ? '' : ' · no encontrado'}</code> <button class="link" onclick="avLinkEditor().catch(report)">Cambiar proyecto</button>`
            : `<button class="btn-primary avx-open" onclick="avLinkEditor().catch(report)">＋ Vincular proyecto de Premiere</button>`}
          <div class="avx-audiosess">${v.sesion_audio ? `<button class="link" onclick="avOpen('sesion_audio').catch(report)" ${v.sesion_disponible ? '' : 'disabled'}>♪ Abrir sesión de audio · ${esc(avBase(v.sesion_audio))}</button> <button class="link" onclick="avLinkAudio().catch(report)">Cambiar</button>` : `<button class="link" onclick="avLinkAudio().catch(report)">＋ Vincular sesión de audio (Cubase)</button>`}
            · <button class="link" onclick="avSplitDialog()">Desprender música</button></div>
        </div>
      </header>
      <nav class="avx-tabs" aria-label="Etapas">${v.etapas.map(s => `<button class="${s.nombre === av.tab ? 'on' : ''}" onclick="av.tab='${esc(s.nombre)}';paintAv()"><span class="avx-tabname"><i style="background:${s.color}"></i>${esc(s.nombre)}</span><span class="avx-prog"><i style="width:${s.progreso}%;background:${s.color}"></i></span><span class="avx-pct">${s.progreso} %</span></button>`).join('')}</nav>
      ${avMap(v)}
      ${stage ? avStageBody(v, stage) : ''}
    </div>`;
}
// Compatibilidad: llamadas viejas.
function avRead() { return avCur(); }
async function avSave() { notify('Los cambios se guardan solos.'); }

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
function setTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = selected;
    try { localStorage.setItem('audiotaller-theme', selected); } catch {}
    api('/api/preferencias', body({tema: selected})).catch(() => notify('No se pudo guardar el tema. Probá de nuevo.'));
}

async function openConfig() {
    go('configPane');
    const c = await api('/api/asistente/config');
    const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    $('configPane').innerHTML = `<section class="card appearance-settings" aria-labelledby="appearanceTitle">
        <div><div class="eyebrow">Interfaz</div><h2 id="appearanceTitle">Apariencia</h2>
          <p class="muted">Elegí el tema claro u oscuro. La elección se guarda en este dispositivo.</p></div>
        <label class="fld appearance-control" for="themeMode">Tema
          <select id="themeMode" onchange="setTheme(this.value)">
            <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>Oscuro</option>
            <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>Claro</option>
          </select>
        </label>
      </section><section class="card mig-card" aria-labelledby="migTitle">
        <div><div class="eyebrow">Computadora nueva</div><h2 id="migTitle">Migrar a otra computadora</h2>
          <p class="muted">Exportá en un solo archivo la biblioteca de AudioTaller, los proyectos del disco interno y los plugins gratuitos. En la computadora nueva lo importás y AudioTaller te dice qué plugins con licencia reinstalar y con qué central.</p></div>
        <div class="mig-card-actions"><button class="btn-primary" onclick="openMigration('exportar').catch(report)">Exportar todo</button>
          <button class="mk-btn" onclick="openMigration('importar').catch(report)">Importar migración</button>
          <button class="mk-btn" onclick="openMigration('plugins').catch(report)">Plugins para reinstalar</button></div>
      </section><header class="prod-head"><div><div class="eyebrow">Configuración</div><h1>Claude</h1>
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
