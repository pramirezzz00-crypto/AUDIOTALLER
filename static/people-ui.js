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
        <div class="row"><button class="btn-primary" onclick="startWizard()">+ Nuevo artista</button></div></header>
      <div class="prod-tools"><label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
          <input id="pplQ" type="search" placeholder="Buscar artista o integrante…" value="${esc(ppl.q)}"></label>
        <select aria-label="Relación" onchange="ppl.relation=this.value;paintArtists()"><option value="">Toda relación</option>${RELATIONS.map(r => `<option ${ppl.relation === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="chips">${[['', 'Todos'], ...PROJECT_TYPES.map(t => [t, t])].map(([id, label]) => `<button class="chip-btn ${ppl.type === id ? 'is-on' : ''}" onclick="ppl.type='${id}';paintArtists()">${label} <span class="mono">${id ? ppl.list.filter(a => a.tipo_proyecto === id).length : ppl.list.length}</span></button>`).join('')}</div>
      <div class="ppl-layout">
        <div class="ppl-grid">${list.map(a => `<button class="ppl-card ${a.id === ppl.sel ? 'is-on' : ''}" onclick="if(ppl.sel!=='${a.id}'){ppl.sel='${a.id}';paintArtists()}" ondblclick="openArtist('${a.id}',true).catch(report)" title="Doble clic para ver todas sus producciones">
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
      <div class="row-tight"><label class="ppl-photo" title="${a.imagen ? 'Cambiar foto' : 'Agregar foto'}">${avatar(a, 'av av-big')}<span class="ppl-photo-cta">${a.imagen ? 'Cambiar' : '＋ Foto'}</span><input type="file" accept="image/jpeg,image/png" hidden onchange="artistPhoto('${a.id}',this.files[0]).catch(report)"></label>
        <div><span class="insp-kicker">${esc([a.tipo_proyecto, a.genero, a.relacion].filter(Boolean).join(' · '))}</span><h2 style="margin:2px 0">${esc(a.nombre)}</h2>${a.ciudad ? `<small class="muted">${esc(a.ciudad)}${a.sello ? ' · ' + esc(a.sello) : ''}</small><br>` : ''}
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
      ${a.bio ? `<span class="insp-label">Biografía</span><p class="muted" style="margin:0">${esc(a.bio)}</p>` : ''}
      <div class="row-tight"><button class="btn-primary" onclick="startWizard('${a.id}')">Editar ficha</button><button class="alt" onclick="startWizard('${a.id}',1)">Integrantes</button><button class="trash-permanent" onclick="moveEntityToTrash('artista','${a.id}').catch(report)">Mover a Papelera</button></div></aside>`;
}

// ── Alta en 4 pasos (también para editar), igual al mockup. Se puede guardar incompleto. ──
const WIZ_STEPS = [['Proyecto artístico', 'Foto, nombre, tipo, género'], ['Personas', 'Integrantes y autores'], ['Plataformas', 'Spotify, Apple, YouTube'], ['Contacto y portal', 'WhatsApp, mail, acceso']];
function newArtist() { go('artistsPane'); (ppl.list.length ? Promise.resolve() : loadArtistsPane()).then(() => startWizard()).catch(report); }
function startWizard(id, step = 0) {
    if (trail.at(-1) !== 'artistsPane') go('artistsPane');
    const a = ppl.list.find(x => x.id === id);
    const pick = a ? JSON.parse(JSON.stringify({nombre: a.nombre, imagen: a.imagen || '', tipo_proyecto: a.tipo_proyecto, relacion: a.relacion, genero: a.genero || '', ciudad: a.ciudad || '',
        sello: a.sello || '', bio: a.bio || '', personas: a.personas, plataformas: a.plataformas, contacto: a.contacto, portal: a.portal, portal_activo: a.portal_activo !== false,
        primer_lanzamiento: !!a.primer_lanzamiento})) : null;
    ppl.wizard = {step, id: id || '', path: 'manual', open: 0, data: pick || {nombre: '', imagen: '', tipo_proyecto: 'Solista', relacion: 'Cliente', genero: '', ciudad: '', sello: '', bio: '',
        personas: [{nombre: '', roles: ['Intérprete']}], plataformas: {}, contacto: {}, portal: '', portal_activo: true, primer_lanzamiento: false}};
    paintArtists();
}
function wizardMissing(d) {
    const out = [];
    if (!d.nombre.trim()) out.push('nombre del proyecto');
    if (!d.imagen) out.push('foto o logo');
    if (!d.personas.some(p => p.nombre)) out.push('al menos una persona');
    d.personas.filter(p => p.nombre).forEach(p => {
        if (p.roles.some(r => r.startsWith('Autor')) && !p.sadaic && p.sadaic_estado !== 'No') out.push(`SADAIC de ${p.nombre}`);
        if (p.roles.includes('Intérprete') && !p.aadi && p.aadi_estado !== 'No') out.push(`AADI de ${p.nombre}`);
    });
    if (!d.primer_lanzamiento) { if (!d.plataformas.spotify) out.push('perfil de Spotify'); if (!d.plataformas.apple) out.push('enlace de Apple Music'); }
    if (!d.contacto.email && !d.contacto.whatsapp) out.push('un contacto');
    return out;
}
function wizSummary(d) {
    const missing = wizardMissing(d), total = 6 + d.personas.length * 2, pct = Math.max(5, Math.round(100 * (1 - Math.min(missing.length, total) / total)));
    return `<span class="avx-lbl">${missing.length ? 'Para publicar' : 'Listo para publicar'}</span><span class="wz-bar"><i style="width:${missing.length ? pct : 100}%;background:${missing.length ? '#FFB547' : '#5ED17E'}"></i></span>
      <span>${missing.length ? 'Faltan: ' + esc(missing.join(', ')) : '✓ Tiene todo lo necesario'}</span><small class="muted">Se puede guardar incompleto: lo que falte se pide después o por formulario.</small>`;
}
// Actualiza solo el resumen mientras se escribe (sin redibujar la pantalla, para no perder el foco ni el clic).
function wizRefresh() { readWizard(); const box = $('wzSum'); if (box) box.innerHTML = wizSummary(ppl.wizard.data); }
function wizStepDone(d, i) {
    return [() => d.nombre.trim() && d.imagen, () => d.personas.some(p => p.nombre), () => d.primer_lanzamiento || d.plataformas.spotify, () => d.contacto.email || d.contacto.whatsapp][i]();
}
function paintWizard(root) {
    const w = ppl.wizard, d = w.data;
    root.innerHTML = `<div class="wz">
      <header class="wz-head"><button class="btn-ghost" onclick="ppl.wizard=null;paintArtists()">← Artistas</button>
        <h1>${w.id ? 'Editar · ' + esc(d.nombre || 'artista') : 'Nuevo artista'}</h1>
        <div class="wz-paths"><button class="wz-path ${w.path === 'manual' ? 'on' : ''}" onclick="readWizard();ppl.wizard.path='manual';paintArtists()"><b>✎ Cargar los datos yo</b><span>Completás vos la ficha: proyecto, integrantes y autores, plataformas y contacto. Podés guardarla incompleta.</span></button>
          <button class="wz-path ${w.path === 'form' ? 'on' : ''}" onclick="readWizard();ppl.wizard.path='form';paintArtists()"><b>✆ Enviar un formulario al artista</b><span>Le llega un enlace por WhatsApp o mail, lo completa desde el celular y vos revisás e importás lo que mandó.</span></button></div></header>
      ${w.path === 'form' ? `<section class="card wiz-form"><h2>Formulario para que el artista complete sus datos</h2>
          <p class="muted">AudioTaller crea un pedido en tu portal con un enlace privado (vence a los 30 días), lo enviás por WhatsApp o mail, el artista completa desde el celular sin cuenta y después revisás e importás dato por dato.</p>
          <p class="warn-amber">Esta opción se activa cuando se publique la actualización del portal del artista. Mientras tanto, cargá los datos a mano: no se pierde nada.</p>
          <button class="btn-primary" onclick="ppl.wizard.path='manual';paintArtists()">Cargar los datos yo</button></section>` : `
      <div class="wz-body">
        <aside class="wz-side">${WIZ_STEPS.map(([t, sub], i) => `<button class="wz-step ${i === w.step ? 'on' : ''}" onclick="wizardGo(${i})"><i class="${wizStepDone(d, i) && i !== w.step ? 'done' : ''}">${wizStepDone(d, i) && i !== w.step ? '✓' : i + 1}</i><span><b>${t}</b><small>${sub}</small></span></button>`).join('')}
          <div class="wz-sum" id="wzSum">${wizSummary(d)}</div></aside>
        <div class="wz-main"><section class="card wz-card">${[wizProject, wizPeople, wizPlatforms, wizContact][w.step](d)}</section>
          <div class="wz-foot">${w.step ? '<button class="alt" onclick="wizardGo(ppl.wizard.step-1)">← Anterior</button>' : '<span></span>'}
            <span class="row-tight"><button class="alt" onclick="saveWizard(true).catch(report)">${w.id ? 'Guardar' : 'Guardar borrador'}</button>
              ${w.step < 3 ? '<button class="btn-primary" onclick="wizardGo(ppl.wizard.step+1)">Siguiente →</button>' : `<button class="btn-primary" onclick="saveWizard().catch(report)">${w.id ? 'Guardar cambios' : 'Crear artista'}</button>`}</span></div></div>
      </div>`}</div>`;
    root.querySelectorAll('[data-w],[data-p][data-k],[data-plat],[data-c]').forEach(el => el.addEventListener('input', () => readWizard()));
    root.querySelectorAll('[data-repaint]').forEach(el => el.addEventListener('change', () => { readWizard(); paintArtists(); }));
    root.querySelectorAll('[data-p][data-k],[data-plat],[data-c],[data-w]').forEach(el => el.addEventListener('input', () => wizRefresh()));
    const zone = $('wzPhoto');
    if (zone) {
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('over'));
        zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) wizardPhoto(f).catch(report); });
    }
}
// Achica la foto en la PC antes de guardarla (máx. 900 px), así nunca supera el límite de 2 MB.
async function wizardPhoto(file) {
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) throw Error('Elegí una imagen JPG o PNG.');
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(Error('No se pudo leer la imagen.')); i.src = url; });
        const k = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * k); canvas.height = Math.round(img.height * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const png = file.type === 'image/png' && file.size < 600_000;
        readWizard(); ppl.wizard.data.imagen = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88);
        paintArtists();
    } finally { URL.revokeObjectURL(url); }
}
const wzField = (label, html, wide) => `<label class="wz-f ${wide ? 'wide' : ''}"><span>${label}</span>${html}</label>`;
const wzIn = (key, val, ph = '', attrs = '') => `<input data-w="${key}" value="${esc(val || '')}" placeholder="${esc(ph)}" ${attrs}>`;
function wizProject(d) {
    const shape = roundType(d.tipo_proyecto) ? 'round' : 'square';
    return `<div class="avx-cardhead"><strong>Proyecto artístico</strong><span class="muted">El nombre con el que sale en las plataformas. Las personas reales se cargan en el paso siguiente.</span></div>
      <div class="wz-proj">
        <label id="wzPhoto" class="wz-photo ${shape}" title="Elegí o arrastrá la foto">${d.imagen ? `<img src="${d.imagen}" alt="Foto de ${esc(d.nombre)}">` : `<span>＋<b>Foto o logo</b><small>JPG o PNG · arrastrala o hacé clic</small></span>`}
          <input type="file" accept="image/jpeg,image/png" onchange="wizardPhoto(this.files[0]).catch(report)" hidden></label>
        <div class="wz-grid">
          ${wzField('Nombre artístico', wzIn('nombre', d.nombre, 'Luna Austral', 'maxlength="150"'), true)}
          <div class="wz-f wide"><span>Tipo</span><div class="wz-chips">${PROJECT_TYPES.map(t => `<button type="button" class="wz-chip ${d.tipo_proyecto === t ? 'on' : ''}" onclick="readWizard();ppl.wizard.data.tipo_proyecto='${t}';paintArtists()">${t}</button>`).join('')}</div></div>
          ${wzField('Género principal', wzIn('genero', d.genero, 'Pop alternativo'))}
          ${wzField('Ciudad y país', wzIn('ciudad', d.ciudad, 'Mar del Plata, Argentina'))}
          ${wzField('Relación con el estudio', `<select data-w="relacion">${RELATIONS.map(t => `<option ${d.relacion === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
          ${wzField('Sello (si tiene)', wzIn('sello', d.sello, 'Independiente'))}
          ${wzField('Biografía corta (para la ficha y el pitch)', `<textarea data-w="bio" rows="3" maxlength="2000" placeholder="Dos o tres líneas sobre el proyecto">${esc(d.bio || '')}</textarea>`, true)}
        </div>
        ${ppl.wizard.id ? `<p class="insp-help wide">¿Músico o técnico con especialidades, formación o notas? <button class="link" onclick="editArtistLegacy('${ppl.wizard.id}')">Datos adicionales</button></p>` : ''}
        ${d.imagen ? `<div class="wz-photoacts"><button class="link" onclick="$('wzPhoto').querySelector('input').click()">Cambiar foto</button> · <button class="link" onclick="readWizard();ppl.wizard.data.imagen='';paintArtists()">Quitar</button></div>` : ''}
      </div>`;
}
function wizPeople(d) {
    const open = ppl.wizard.open;
    const badge = (ok, label, need) => need ? `<span class="wz-badge ${ok ? 'ok' : 'warn'}">${label}${ok ? ' ✓' : ' · falta'}</span>` : '';
    return `<div class="avx-cardhead"><strong>Personas: integrantes y autores</strong><span class="muted">Una persona puede ser intérprete, autora o las dos cosas. Se cargan una vez y sirven para todas las canciones.</span></div>
      ${d.personas.map((p, i) => { const author = p.roles.some(r => r.startsWith('Autor')), perf = p.roles.includes('Intérprete');
        return `<div class="wz-person ${open === i ? 'open' : ''}">
          <button type="button" class="wz-phead" onclick="readWizard();ppl.wizard.open=${open === i ? -1 : i};paintArtists()"><span class="wz-ini">${esc(artistInitials(p.nombre || '?'))}</span>
            <span><b>${esc(p.nombre || 'Persona nueva')}</b><small>${esc([p.nombre_legal, p.roles.join(', ')].filter(Boolean).join(' · ') || 'Sin roles')}</small></span>
            <span class="wz-badges">${badge(p.sadaic || p.sadaic_estado === 'No', 'SADAIC', author)}${badge(p.aadi || p.aadi_estado === 'No', 'AADI', perf)}</span><span>${open === i ? '▲' : '▼'}</span></button>
          ${open === i ? `<div class="wz-pbody">
            <span class="avx-lbl">Roles</span><div class="wz-chips">${PERSON_ROLES.map(r => `<button type="button" class="wz-chip ${p.roles.includes(r) ? 'on' : ''}" onclick="wizRole(${i},'${r}')">${p.roles.includes(r) ? '✓ ' : ''}${r}</button>`).join('')}</div>
            <span class="avx-lbl">Identidad</span><div class="wz-grid four">
              ${wzField('Nombre artístico', `<input data-p="${i}" data-k="nombre" value="${esc(p.nombre)}">`)}${wzField('Nombre y apellido legal', `<input data-p="${i}" data-k="nombre_legal" value="${esc(p.nombre_legal || '')}">`)}
              ${wzField('CUIT / CUIL', `<input data-p="${i}" data-k="cuit" value="${esc(p.cuit || '')}" inputmode="numeric">`)}${wzField('Nacionalidad', `<input data-p="${i}" data-k="nacionalidad" value="${esc(p.nacionalidad || '')}" placeholder="Argentina">`)}
              ${wzField('Mail', `<input data-p="${i}" data-k="email" value="${esc(p.email || '')}" type="email">`)}${wzField('Teléfono', `<input data-p="${i}" data-k="telefono" value="${esc(p.telefono || '')}">`)}</div>
            ${author ? `<span class="avx-lbl">Autoría · para SADAIC y la metadata</span><div class="wz-grid">
              ${wzField('¿Socia/o de SADAIC?', `<select data-p="${i}" data-k="sadaic_estado" data-repaint>${['', 'Sí', 'No', 'En trámite', 'No sé'].map(o => `<option value="${o}" ${(p.sadaic_estado || '') === o ? 'selected' : ''}>${o || 'Elegir…'}</option>`).join('')}</select>`)}
              ${p.sadaic_estado !== 'No' ? wzField('N.º de socio SADAIC', `<input data-p="${i}" data-k="sadaic" value="${esc(p.sadaic || '')}">`) + wzField('Código IPI (autor)', `<input data-p="${i}" data-k="ipi" value="${esc(p.ipi || '')}" inputmode="numeric" placeholder="9 a 11 dígitos">`) : ''}</div>` : ''}
            ${perf ? `<span class="avx-lbl">Interpretación · para AADI</span><div class="wz-grid">
              ${wzField('¿Asociada/o a AADI?', `<select data-p="${i}" data-k="aadi_estado" data-repaint>${['', 'Sí', 'No', 'En trámite', 'No sé'].map(o => `<option value="${o}" ${(p.aadi_estado || '') === o ? 'selected' : ''}>${o || 'Elegir…'}</option>`).join('')}</select>`)}
              ${p.aadi_estado !== 'No' ? wzField('N.º AADI', `<input data-p="${i}" data-k="aadi" value="${esc(p.aadi || '')}">`) : ''}
              ${wzField('Instrumentos habituales', `<input data-p="${i}" data-k="instrumentos" value="${esc(p.instrumentos || '')}" placeholder="Voz, guitarra">`)}</div>` : ''}
            <button class="link" onclick="readWizard();ppl.wizard.data.personas.splice(${i},1);ppl.wizard.open=-1;paintArtists()">Quitar persona</button></div>` : ''}</div>`; }).join('')}
      <div class="row-tight"><button class="alt" onclick="readWizard();ppl.wizard.data.personas.push({nombre:'',roles:['Intérprete']});ppl.wizard.open=ppl.wizard.data.personas.length-1;paintArtists()">+ Agregar persona</button>
        <button class="btn-ghost" onclick="go('entidades')">Buscar en Entidades</button></div>
      <p class="insp-help">No se piden datos bancarios: SADAIC, AADI y la distribuidora pagan directo a cada titular. «No sé» está bien: se completa después.</p>`;
}
function wizRole(i, role) {
    readWizard();
    const roles = ppl.wizard.data.personas[i].roles;
    ppl.wizard.data.personas[i].roles = roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role];
    paintArtists();
}
function wizPlatforms(d) {
    const main = [['spotify', 'Spotify (enlace o URI)'], ['apple', 'Apple Music (enlace)'], ['youtube', 'YouTube (canal)'], ['instagram', 'Instagram']];
    const more = Object.keys(PLATFORM_LABELS).filter(k => !main.some(m => m[0] === k));
    return `<div class="avx-cardhead"><strong>Perfiles en plataformas</strong><span class="muted">Sirven para que cada lanzamiento caiga en el perfil correcto (AMA los pide). Si es su primer lanzamiento, marcalo abajo.</span></div>
      <div class="wz-grid four">${main.map(([k, l]) => wzField(l, `<input data-plat="${k}" value="${esc(d.plataformas[k] || '')}" placeholder="${d.primer_lanzamiento ? 'Se crea en el lanzamiento' : 'Falta'}">`)).join('')}</div>
      <details class="avx-edit"><summary>Más plataformas</summary><div class="wz-grid four">${more.map(k => wzField(PLATFORM_LABELS[k], `<input data-plat="${k}" value="${esc(d.plataformas[k] || '')}" placeholder="https://…">`)).join('')}</div></details>
      <label class="wz-check"><input type="checkbox" data-w="primer_lanzamiento" data-repaint ${d.primer_lanzamiento ? 'checked' : ''}> Es su primer lanzamiento: crear perfiles nuevos en las plataformas</label>`;
}
function wizContact(d) {
    return `<div class="avx-cardhead"><strong>Contacto y portal</strong><span class="muted">Con quién hablás y cómo escucha y comenta las mezclas.</span></div>
      <div class="wz-grid">${wzField('Persona de contacto', `<input data-c="nombre" value="${esc(d.contacto.nombre || '')}" placeholder="Manager o integrante">`)}
        ${wzField('WhatsApp', `<input data-c="whatsapp" value="${esc(d.contacto.whatsapp || '')}" placeholder="+54 9 11 …">`)}
        ${wzField('Mail', `<input data-c="email" value="${esc(d.contacto.email || '')}" type="email">`)}</div>
      <span class="avx-lbl">Portal de escucha</span>
      <div class="wz-chips"><button type="button" class="wz-chip ${d.portal_activo ? 'on' : ''}" onclick="readWizard();ppl.wizard.data.portal_activo=true;paintArtists()">Crear acceso al portal</button>
        <button type="button" class="wz-chip ${!d.portal_activo ? 'on' : ''}" onclick="readWizard();ppl.wizard.data.portal_activo=false;paintArtists()">Sin portal por ahora</button></div>
      ${d.portal_activo ? wzField('Mail con el que entra al portal', wzIn('portal', d.portal || d.contacto.email, 'Con este mail escucha y deja devoluciones'), true) : ''}`;
}
function readWizard() {
    const d = ppl.wizard.data, root = $('artistsPane');
    root.querySelectorAll('[data-w]').forEach(el => { d[el.dataset.w] = el.type === 'checkbox' ? el.checked : el.value; });
    root.querySelectorAll('[data-p][data-k]').forEach(el => { d.personas[el.dataset.p][el.dataset.k] = el.value; });
    root.querySelectorAll('[data-plat]').forEach(el => { d.plataformas[el.dataset.plat] = el.value; });
    root.querySelectorAll('[data-c]').forEach(el => { d.contacto[el.dataset.c] = el.value; });
}
function wizardGo(step) { readWizard(); ppl.wizard.step = Math.max(0, Math.min(3, step)); paintArtists(); }
async function saveWizard(stay) {
    readWizard();
    const w = ppl.wizard, d = w.data;
    if (!d.nombre.trim()) { w.step = 0; paintArtists(); throw Error('Escribí el nombre del proyecto artístico.'); }
    const legacyType = roundType(d.tipo_proyecto) ? 'Solista' : 'Banda';
    if (!w.id) w.id = (await api('/api/artistas', body({nombre: d.nombre.trim(), tipo: legacyType}))).id;
    await api('/api/artistas-rediseno/' + w.id, body({...d, nombre: d.nombre.trim()}));
    ppl.sel = w.id;
    if (stay) { ppl.list = await api('/api/artistas-rediseno'); paintArtists(); notify('Guardado. Podés seguir completando.'); return; }
    ppl.wizard = null;
    await loadArtistsPane();
    notify('Artista guardado.');
}
// Cambiar la foto desde la ficha, sin entrar al alta.
async function artistPhoto(id, file) {
    const a = ppl.list.find(x => x.id === id); if (!a) return;
    startWizard(id); await wizardPhoto(file);
    await api('/api/artistas-rediseno/' + id, body({...ppl.wizard.data}));
    ppl.wizard = null; await loadArtistsPane(); notify('Foto actualizada.');
}
