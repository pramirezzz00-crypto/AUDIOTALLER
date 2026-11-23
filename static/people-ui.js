// Artistas · tarjetas por proyecto artístico (redondas: solistas y alias; cuadradas: grupos),
// ficha con integrantes y roles, y alta en 4 pasos. La ficha anterior sigue disponible.
const ppl = {list: [], q: '', type: '', relation: '', sel: '', wizard: null};
const PROJECT_TYPES = ['Solista', 'Banda', 'Dúo', 'Agrupación / colectivo', 'Ensamble / orquesta', 'Proyecto o alias'];
const RELATIONS = ['Del estudio', 'Cliente', 'Colaborador'];
const PERSON_ROLES = ['Intérprete', 'Autor/a de letra', 'Autor/a de música', 'Producción / arreglos'];
const PLATFORM_LABELS = {spotify: 'Spotify', apple: 'Apple Music', youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', bandcamp: 'Bandcamp', soundcloud: 'SoundCloud', web: 'Sitio web'};
const roundType = type => type === 'Solista' || type === 'Proyecto o alias';

async function openArtistsPane() { go('artistsPane'); await loadArtistsPane(); }
async function loadArtistsPane() {
    ppl.list = await api('/api/artistas-rediseno');
    if (!ppl.list.some(a => a.id === ppl.sel)) ppl.sel = ppl.list[0]?.id || '';
    paintArtists();
}
function avatar(a, cls = 'av') {
    const shape = roundType(a.tipo_proyecto) ? 'round' : 'square';
    if (/^data:image\/(png|jpeg);base64,/.test(a.imagen || '')) return `<span class="${cls} ${shape}"><img src="${a.imagen}" alt=""></span>`;
    return `<span class="${cls} ${shape}" style="${placeholderArt(a.id, 'demo')}"><b>${esc(artistInitials(a.nombre))}</b></span>`;
}
function paintArtists() {
    const root = $('artistsPane');
    if (ppl.wizard) return paintWizard(root);
    const q = ppl.q.trim().toLowerCase();
    const list = ppl.list.filter(a => (!q || [a.nombre, ...a.personas.map(p => p.nombre)].join(' ').toLowerCase().includes(q))
        && (!ppl.type || a.tipo_proyecto === ppl.type) && (!ppl.relation || a.relacion === ppl.relation));
    const cur = ppl.list.find(a => a.id === ppl.sel);
    const keepFocus = document.activeElement?.id === 'pplQ';
    root.innerHTML = `
      <header class="prod-head"><div><div class="eyebrow">Proyectos artísticos y sus integrantes</div><h1>Artistas</h1></div>
        <div class="row"><button class="alt" onclick="openArtistManager()">Vista anterior</button><button class="btn-primary" onclick="startWizard()">+ Nuevo artista</button></div></header>
      <div class="prod-tools"><label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
          <input id="pplQ" type="search" placeholder="Buscar artista o integrante…" value="${esc(ppl.q)}"></label>
        <select aria-label="Relación" onchange="ppl.relation=this.value;paintArtists()"><option value="">Toda relación</option>${RELATIONS.map(r => `<option ${ppl.relation === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="chips">${[['', 'Todos'], ...PROJECT_TYPES.map(t => [t, t])].map(([id, label]) => `<button class="chip-btn ${ppl.type === id ? 'is-on' : ''}" onclick="ppl.type='${id}';paintArtists()">${label} <span class="mono">${id ? ppl.list.filter(a => a.tipo_proyecto === id).length : ppl.list.length}</span></button>`).join('')}</div>
      <div class="ppl-layout">
        <div class="ppl-grid">${list.map(a => `<button class="ppl-card ${a.id === ppl.sel ? 'is-on' : ''}" onclick="ppl.sel='${a.id}';paintArtists()">
            ${avatar(a)}${a.alertas.length ? '<i class="ppl-alert" title="Tiene datos pendientes"></i>' : ''}
            <strong>${esc(a.nombre)}</strong><small>${esc(a.tipo_proyecto)} · ${esc(a.relacion)}</small>
            <small class="muted">${countLabel(a.discos.length, 'disco', 'discos')} · ${countLabel(a.canciones, 'canción', 'canciones')}</small></button>`).join('')
            || `<p class="muted">${ppl.list.length ? 'Ningún artista coincide.' : 'Todavía no hay artistas. Creá el primero.'}</p>`}</div>
        ${cur ? artistDetail(cur) : ''}
      </div>`;
    const input = $('pplQ');
    input.oninput = () => { ppl.q = input.value; const pos = input.selectionStart; paintArtists(); $('pplQ').focus(); $('pplQ').setSelectionRange(pos, pos); };
    if (keepFocus) input.focus();
}
function artistDetail(a) {
    return `<aside class="card ppl-detail">
      <div class="row-tight">${avatar(a, 'av av-big')}<div><span class="insp-kicker">${esc(a.tipo_proyecto)} · ${esc(a.relacion)}</span><h2 style="margin:2px 0">${esc(a.nombre)}</h2>
        <span class="${a.completo ? 'ok-green' : 'warn-amber'}">${a.completo ? '✓ Listo para publicar' : 'Faltan datos para publicar'}</span></div></div>
      <div class="ppl-counts"><span><b>${a.discos.length}</b>discos</span><span><b>${a.canciones}</b>canciones</span><span><b>${a.videos}</b>audiovisuales</span></div>
      ${a.alertas.length ? `<div class="ppl-alerts">${a.alertas.map(t => `<span>! ${esc(t)}</span>`).join('')}</div>` : ''}
      <span class="insp-label">Integrantes</span>
      ${a.personas.map(p => `<div class="ppl-person"><strong>${esc(p.nombre)}</strong><small>${esc(p.roles.join(' · ') || 'Sin rol')}</small>
        <small class="mono muted">${[p.sadaic && 'SADAIC ' + p.sadaic, p.ipi && 'IPI ' + p.ipi, p.aadi && 'AADI ' + p.aadi, p.instrumentos].filter(Boolean).map(esc).join(' · ')}</small></div>`).join('') || '<span class="muted">Sin integrantes cargados.</span>'}
      <span class="insp-label">Producciones</span>
      <div class="row-tight">${a.discos.map(d => `<button class="chip-btn" onclick="openGlobalAlbum('${d.id}','${a.id}').catch(report)">◉ ${esc(d.nombre)}</button>`).join('') || '<span class="muted">Sin discos.</span>'}
        <button class="btn-ghost" onclick="openArtist('${a.id}',true).catch(report)">Ver todas</button></div>
      <span class="insp-label">Contacto y portal</span>
      <span class="muted">${esc([a.contacto.email, a.contacto.whatsapp || a.contacto.telefono].filter(Boolean).join(' · ') || 'Sin contacto')}${a.portal ? ' · portal: ' + esc(a.portal) : ''}</span>
      ${Object.keys(a.plataformas).length ? `<div class="row-tight">${Object.entries(a.plataformas).map(([k, url]) => `<a class="chip-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(PLATFORM_LABELS[k] || k)} ↗</a>`).join('')}</div>` : ''}
      <div class="row-tight"><button onclick="startWizard('${a.id}')">Editar</button><button class="alt" onclick="editArtist('${a.id}')">Ficha completa</button></div></aside>`;
}

// ── Alta en 4 pasos (también para editar). Se puede guardar incompleto. ──
function startWizard(id) {
    const a = ppl.list.find(x => x.id === id);
    ppl.wizard = {step: 0, id: id || '', path: 'manual', data: a ? JSON.parse(JSON.stringify({nombre: a.nombre, tipo_proyecto: a.tipo_proyecto, relacion: a.relacion,
        personas: a.personas, plataformas: a.plataformas, contacto: a.contacto, portal: a.portal})) : {nombre: '', tipo_proyecto: 'Solista', relacion: 'Cliente', personas: [{nombre: '', roles: ['Intérprete']}], plataformas: {}, contacto: {}, portal: ''}};
    paintArtists();
}
function wizardMissing(d) {
    const out = [];
    if (!d.nombre.trim()) out.push('nombre del proyecto');
    if (!d.personas.some(p => p.nombre)) out.push('al menos una persona');
    d.personas.forEach(p => { if (p.roles.some(r => r.startsWith('Autor')) && !p.sadaic) out.push(`SADAIC de ${p.nombre || 'una persona'}`); if (p.roles.includes('Intérprete') && !p.aadi) out.push(`AADI de ${p.nombre || 'una persona'}`); });
    if (!d.contacto.email && !d.contacto.whatsapp) out.push('un contacto');
    return out;
}
function paintWizard(root) {
    const w = ppl.wizard, d = w.data;
    const steps = ['Proyecto', 'Personas', 'Plataformas', 'Contacto y portal'];
    const missing = wizardMissing(d);
    root.innerHTML = `
      <header class="prod-head"><div><div class="eyebrow">${w.id ? 'Editar artista' : 'Nuevo artista'}</div><h1>${esc(d.nombre || 'Proyecto artístico')}</h1></div>
        <div class="seg"><button class="${w.path === 'manual' ? 'is-on' : ''}" onclick="ppl.wizard.path='manual';paintArtists()">Cargar a mano</button>
          <button class="${w.path === 'form' ? 'is-on' : ''}" onclick="ppl.wizard.path='form';paintArtists()">Formulario al artista</button></div></header>
      ${w.path === 'form' ? `<section class="card wiz-form"><h2>Formulario para que el artista complete sus datos</h2>
          <p class="muted">AudioTaller crea un pedido en tu portal con un enlace privado (vence a los 30 días), lo enviás por WhatsApp o mail, el artista completa desde el celular sin cuenta y después revisás e importás dato por dato. Al importar, los datos se borran del portal.</p>
          <p class="warn-amber">Para activarlo falta publicar la actualización del portal del artista (página del formulario y reglas de seguridad de Firebase). Mientras tanto, cargá los datos a mano: no se pierde nada.</p>
          <button disabled>Crear enlace y enviar</button></section>` : `
      <div class="wiz-steps">${steps.map((s, i) => `<button class="${i === w.step ? 'is-on' : i < w.step ? 'done' : ''}" onclick="wizardGo(${i})"><i>${i + 1}</i>${s}</button>`).join('')}</div>
      <section class="card wiz-body">${[wizProject, wizPeople, wizPlatforms, wizContact][w.step](d)}</section>
      <div class="wiz-foot"><span class="${missing.length ? 'warn-amber' : 'ok-green'}">${missing.length ? 'Para publicar falta: ' + esc(missing.join(', ')) : '✓ Listo para publicar'}</span>
        <span class="row-tight"><button class="alt" onclick="ppl.wizard=null;paintArtists()">Cancelar</button>
          ${w.step ? '<button onclick="wizardGo(ppl.wizard.step-1)">Anterior</button>' : ''}
          ${w.step < 3 ? '<button onclick="wizardGo(ppl.wizard.step+1)">Siguiente</button>' : ''}
          <button class="btn-primary" onclick="saveWizard().catch(report)">${missing.length ? 'Guardar incompleto' : 'Guardar'}</button></span></div>`}`;
    root.querySelectorAll('[data-w]').forEach(el => el.addEventListener('input', () => readWizard()));
    root.querySelectorAll('[data-role]').forEach(el => el.addEventListener('change', () => { readWizard(); paintArtists(); }));
}
function wizProject(d) {
    return `<div class="cr-grid"><label>Nombre con el que se publica<input data-w="nombre" value="${esc(d.nombre)}" placeholder="Luna Austral"></label>
      <label>Tipo<select data-w="tipo_proyecto">${PROJECT_TYPES.map(t => `<option ${d.tipo_proyecto === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Relación con el estudio<select data-w="relacion">${RELATIONS.map(t => `<option ${d.relacion === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <p class="insp-help">El proyecto artístico es el nombre que sale en las plataformas. Las personas reales (con sus números de SADAIC y AADI) se cargan en el paso siguiente.</p>`;
}
function wizPeople(d) {
    return d.personas.map((p, i) => `<div class="wiz-person"><div class="cr-grid">
        <label>Nombre artístico<input data-p="${i}" data-k="nombre" value="${esc(p.nombre)}"></label><label>Nombre legal<input data-p="${i}" data-k="nombre_legal" value="${esc(p.nombre_legal || '')}"></label></div>
      <div class="row-tight">${PERSON_ROLES.map(r => `<label class="check"><input type="checkbox" data-p="${i}" data-role="${r}" ${p.roles.includes(r) ? 'checked' : ''}> ${r}</label>`).join('')}</div>
      <div class="cr-grid">${p.roles.some(r => r.startsWith('Autor')) ? `<label>N.º de socio SADAIC<input data-p="${i}" data-k="sadaic" value="${esc(p.sadaic || '')}"></label><label>IPI<input data-p="${i}" data-k="ipi" value="${esc(p.ipi || '')}" inputmode="numeric"></label>` : ''}
        ${p.roles.includes('Intérprete') ? `<label>N.º AADI<input data-p="${i}" data-k="aadi" value="${esc(p.aadi || '')}"></label><label>Instrumentos<input data-p="${i}" data-k="instrumentos" value="${esc(p.instrumentos || '')}" placeholder="Voz, guitarra"></label>` : ''}</div>
      <button class="btn-ghost" onclick="readWizard();ppl.wizard.data.personas.splice(${i},1);paintArtists()">Quitar persona</button></div>`).join('')
      + `<button class="btn-ghost" onclick="readWizard();ppl.wizard.data.personas.push({nombre:'',roles:['Intérprete']});paintArtists()">+ Persona</button>
      <p class="insp-help">No se piden datos bancarios: SADAIC, AADI y la distribuidora pagan directo a cada titular. La autoría de cada canción se marca en Créditos eligiendo personas y reparto.</p>`;
}
function wizPlatforms(d) {
    return `<div class="cr-grid">${Object.entries(PLATFORM_LABELS).map(([k, label]) => `<label>${label}<input data-plat="${k}" value="${esc(d.plataformas[k] || '')}" placeholder="https://…"></label>`).join('')}</div>`;
}
function wizContact(d) {
    return `<div class="cr-grid"><label>Mail<input data-c="email" value="${esc(d.contacto.email || '')}"></label><label>WhatsApp<input data-c="whatsapp" value="${esc(d.contacto.whatsapp || '')}" placeholder="+54 9 11 …"></label>
      <label>Mail para el portal del artista<input data-w="portal" value="${esc(d.portal || '')}" placeholder="Con este mail entra a escuchar y dejar devoluciones"></label></div>`;
}
function readWizard() {
    const d = ppl.wizard.data, root = $('artistsPane');
    root.querySelectorAll('[data-w]').forEach(el => { d[el.dataset.w] = el.value; });
    root.querySelectorAll('[data-p][data-k]').forEach(el => { d.personas[el.dataset.p][el.dataset.k] = el.value; });
    const roles = {};
    root.querySelectorAll('[data-p][data-role]').forEach(el => { (roles[el.dataset.p] ||= []); if (el.checked) roles[el.dataset.p].push(el.dataset.role); });
    Object.entries(roles).forEach(([i, list]) => { d.personas[i].roles = list; });
    root.querySelectorAll('[data-plat]').forEach(el => { d.plataformas[el.dataset.plat] = el.value; });
    root.querySelectorAll('[data-c]').forEach(el => { d.contacto[el.dataset.c] = el.value; });
}
function wizardGo(step) { readWizard(); ppl.wizard.step = Math.max(0, Math.min(3, step)); paintArtists(); }
async function saveWizard() {
    readWizard();
    const w = ppl.wizard, d = w.data;
    if (!d.nombre.trim()) { w.step = 0; paintArtists(); throw Error('Escribí el nombre del proyecto artístico.'); }
    const legacyType = roundType(d.tipo_proyecto) ? 'Solista' : 'Banda';
    let id = w.id;
    if (!id) id = (await api('/api/artistas', body({nombre: d.nombre.trim(), tipo: legacyType}))).id;
    else { const current = await api('/api/artistas/' + id); if (current.nombre !== d.nombre.trim()) await api('/api/artistas/' + id, body({nombre: d.nombre.trim(), tipo: current.tipo || legacyType, imagen: current.imagen || '', perfil: current.perfil || {}})); }
    await api('/api/artistas-rediseno/' + id, body(d));
    ppl.wizard = null; ppl.sel = id;
    await loadArtistsPane();
    notify('Artista guardado.');
}
