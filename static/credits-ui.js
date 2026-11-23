// Créditos del disco: autoría de la obra (ISWC y reparto que suma 100 %), intérpretes, producción,
// técnica con «Aplicar a todo el disco», fonograma (ISRC), matriz personas × canciones y arte de tapa.
const credits = {album: null, tab: 'cancion', song: '', data: null, dirty: false};
const TECH_ROLES = ['Grabación', 'Edición', 'Mezcla', 'Mastering', 'Asistente'];

async function openCredits(albumId) {
    credits.album = albumId;
    go('creditsPane');
    await loadCredits();
}
async function loadCredits(keepSong) {
    credits.data = await api('/api/discos/' + credits.album + '/creditos');
    if (!keepSong || !credits.data.canciones.some(s => s.id === credits.song)) credits.song = credits.data.canciones[0]?.id || '';
    credits.dirty = false;
    renderCredits();
}
function renderCredits() {
    const root = $('creditsPane');
    if (!root || !credits.data) return;
    const {disco, canciones} = credits.data;
    $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> › <button onclick="openArtistManager(true)">Producciones</button> › <button onclick="back()">${esc(disco.nombre)}</button> › Créditos`;
    const missing = canciones.reduce((n, s) => n + s.faltan.length, 0);
    root.innerHTML = `
      <header class="prod-head"><div><div class="eyebrow">${esc(disco.tipo)} · ${esc(disco.artista)}</div><h1>Créditos · ${esc(disco.nombre)}</h1>
        <p class="muted">${missing ? `<span class="warn-amber">${countLabel(missing, 'dato faltante', 'datos faltantes')}</span> en ${countLabel(canciones.filter(s => s.faltan.length).length, 'canción', 'canciones')}` : 'Todos los datos obligatorios están completos.'}</p></div>
        <div class="row"><button class="alt" onclick="openExport('disco','${disco.id}').catch(report)">Exportar metadata</button></div></header>
      <div class="seg tabs" role="tablist">${[['cancion', 'Por canción'], ['matriz', 'Personas × canciones'], ['lanzamiento', 'Lanzamiento'], ['arte', 'Arte de tapa y licencias']].map(([id, label]) =>
        `<button role="tab" aria-selected="${credits.tab === id}" class="${credits.tab === id ? 'is-on' : ''}" onclick="credits.tab='${id}';renderCredits()">${label}</button>`).join('')}</div>
      ${credits.tab === 'cancion' ? creditsSongView() : credits.tab === 'matriz' ? creditsMatrix() : credits.tab === 'lanzamiento' ? creditsRelease() : creditsArt()}`;
    if (credits.tab === 'cancion') bindCreditsForm();
}
function creditsSongView() {
    const {canciones} = credits.data;
    const song = canciones.find(s => s.id === credits.song);
    if (!song) return '<p class="muted">Este disco todavía no tiene canciones.</p>';
    const rows = (list, fields, kind) => list.map((item, i) => `<div class="cr-row" data-kind="${kind}">${fields.map(([key, label, type]) =>
        type === 'select' ? `<select data-k="${key}" aria-label="${label}">${(key === 'rol' && kind === 'autores' ? ['Letra y música', 'Letra', 'Música'] : TECH_ROLES).map(o => `<option ${item[key] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : `<input data-k="${key}" aria-label="${label}" placeholder="${label}" value="${esc(item[key] ?? '')}" ${type === 'pct' ? 'inputmode="decimal" class="pct"' : ''}>`).join('')}
        ${kind === 'tecnica' ? `<button class="btn-ghost" type="button" onclick="applyTechToAlbum(${i})" title="Copiar este rol a todas las canciones del disco">Aplicar a todo el disco</button>` : ''}
        <button class="btn-ghost" type="button" aria-label="Quitar" onclick="this.parentElement.remove();creditsChanged()">✕</button></div>`).join('');
    const total = song.total_autoria;
    return `<div class="cr-layout">
      <aside class="cr-songs">${canciones.map(s => `<button class="${s.id === credits.song ? 'is-on' : ''}" onclick="pickCreditSong('${s.id}')">
        <span class="mono muted">${s.pista || '·'}</span><span><strong>${esc(s.titulo)}</strong>
        <small class="${s.faltan.length ? 'warn-amber' : 'ok-green'}">${s.faltan.length ? 'Falta: ' + esc(s.faltan.join(', ')) : '✓ Completo'}</small></span></button>`).join('')}</aside>
      <form id="creditsForm" class="cr-form card" onsubmit="event.preventDefault();saveCredits().catch(report)">
        <section><h2>Obra <span class="muted">(composición)</span></h2>
          <div class="cr-grid"><label>ISWC<input name="iswc" value="${esc(song.iswc)}" placeholder="T-123.456.789-0" class="${song.iswc ? '' : 'missing'}"></label>
            <label>Idioma<input name="idioma" value="${esc(song.idioma)}" placeholder="Español"></label>
            <label>Género<input name="genero" value="${esc(song.genero)}" placeholder="Folk / Pop"></label></div>
          <div class="cr-sub"><span class="insp-label">Autoría y reparto</span><span id="crTotal" class="mono ${Math.abs(total - 100) < 0.01 ? 'ok-green' : 'warn-amber'}">${formatDecimal(total, 2)} % de 100 %</span></div>
          <div id="crAutores">${rows(song.autores, [['nombre', 'Persona'], ['rol', 'Rol', 'select'], ['porcentaje', '%', 'pct'], ['sociedad', 'Sociedad (SADAIC)'], ['ipi', 'IPI']], 'autores')}</div>
          <button type="button" class="btn-ghost" onclick="addCreditRow('autores')">+ Autor/a</button></section>
        <section><h2>Intérpretes <span class="muted">(AADI)</span></h2>
          <div id="crInterpretes">${rows(song.interpretes, [['nombre', 'Persona'], ['instrumento', 'Instrumento o voz'], ['aadi', 'N.º AADI']], 'interpretes')}</div>
          <button type="button" class="btn-ghost" onclick="addCreditRow('interpretes')">+ Intérprete</button></section>
        <section><h2>Producción</h2>
          <div id="crProduccion">${rows(song.produccion, [['nombre', 'Persona'], ['rol', 'Rol (producción, arreglos…)']], 'produccion')}</div>
          <button type="button" class="btn-ghost" onclick="addCreditRow('produccion')">+ Persona</button></section>
        <section><h2>Técnica</h2>
          <div id="crTecnica">${rows(song.tecnica, [['rol', 'Rol', 'select'], ['nombre', 'Persona'], ['estudio', 'Estudio']], 'tecnica')}</div>
          <button type="button" class="btn-ghost" onclick="addCreditRow('tecnica')">+ Rol técnico</button></section>
        <section><h2>Fonograma <span class="muted">(grabación)</span></h2>
          <div class="cr-grid"><label>ISRC<input name="isrc" value="${esc(song.isrc)}" placeholder="AR-A12-26-00001" class="${song.isrc ? '' : 'missing'}"></label>
            <label>Contenido explícito<select name="explicito">${['No', 'Sí', 'Sin definir'].map(o => `<option ${song.explicito === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label></div>
          <p class="insp-help">El ISRC lo asigna CAPIF (isrc@capif.org.ar) o tu distribuidora. El ISWC sale al registrar la obra en SADAIC.</p></section>
        <div class="form-actions"><span id="crStatus" class="muted" role="status"></span><button class="btn-primary">Guardar créditos</button></div>
      </form></div>`;
}
const CREDIT_FIELDS = {autores: [['nombre', 'Persona'], ['rol', 'Rol', 'select'], ['porcentaje', '%', 'pct'], ['sociedad', 'Sociedad (SADAIC)'], ['ipi', 'IPI']],
    interpretes: [['nombre', 'Persona'], ['instrumento', 'Instrumento o voz'], ['aadi', 'N.º AADI']],
    produccion: [['nombre', 'Persona'], ['rol', 'Rol (producción, arreglos…)']], tecnica: [['rol', 'Rol', 'select'], ['nombre', 'Persona'], ['estudio', 'Estudio']]};
function addCreditRow(kind) {
    const holder = $('cr' + kind[0].toUpperCase() + kind.slice(1));
    const template = document.createElement('div');
    const song = credits.data.canciones.find(s => s.id === credits.song);
    const backup = song[kind];
    song[kind] = [{}];
    template.innerHTML = creditsSongView();
    song[kind] = backup;
    const row = template.querySelector(`.cr-row[data-kind="${kind}"]`);
    holder.appendChild(row);
    row.querySelector('input')?.focus();
    creditsChanged();
}
function collectCredits() {
    const form = $('creditsForm');
    const data = Object.fromEntries(new FormData(form));
    for (const kind of Object.keys(CREDIT_FIELDS)) {
        data[kind] = [...form.querySelectorAll(`.cr-row[data-kind="${kind}"]`)].map(row => Object.fromEntries([...row.querySelectorAll('[data-k]')].map(el => [el.dataset.k, el.value.trim()])))
            .filter(item => Object.entries(item).some(([k, v]) => v && !(k === 'rol' && kind !== 'produccion')));
    }
    return data;
}
function creditsChanged() {
    credits.dirty = true;
    const total = collectCredits().autores.reduce((n, a) => n + (Number(String(a.porcentaje).replace(',', '.')) || 0), 0);
    if ($('crTotal')) { $('crTotal').textContent = formatDecimal(total, 2) + ' % de 100 %'; $('crTotal').className = 'mono ' + (Math.abs(total - 100) < 0.01 ? 'ok-green' : 'warn-amber'); }
    if ($('crStatus')) $('crStatus').textContent = 'Sin guardar';
}
function bindCreditsForm() { $('creditsForm')?.addEventListener('input', creditsChanged); }
function pickCreditSong(id) {
    if (credits.dirty && !confirm('Hay cambios sin guardar en esta canción. ¿Descartarlos?')) return;
    credits.song = id; credits.dirty = false; renderCredits();
}
async function saveCredits() {
    await api('/api/creditos/' + credits.song, body(collectCredits()));
    await loadCredits(true);
    if ($('crStatus')) $('crStatus').textContent = '✓ Guardado';
}
async function applyTechToAlbum(index) {
    const tech = collectCredits().tecnica;
    const row = [...$('crTecnica').querySelectorAll('.cr-row')][index];
    const item = Object.fromEntries([...row.querySelectorAll('[data-k]')].map(el => [el.dataset.k, el.value.trim()]));
    if (!item.nombre) return report(Error('Escribí la persona antes de aplicarla a todo el disco.'));
    if (credits.dirty) await api('/api/creditos/' + credits.song, body(collectCredits()));
    await api('/api/discos/' + credits.album + '/creditos/tecnica', body(item));
    await loadCredits(true);
    $('crStatus').textContent = `✓ ${item.rol}: ${item.nombre} en todas las canciones`;
    void tech;
}
function creditsMatrix() {
    const {canciones} = credits.data;
    const roles = new Map();
    const add = (name, songId, tag) => { if (!name) return; const key = name.trim(); if (!roles.has(key)) roles.set(key, {}); (roles.get(key)[songId] ||= new Set()).add(tag); };
    for (const s of canciones) {
        s.autores.forEach(a => add(a.nombre, s.id, (a.rol || 'Autoría').replace('Letra y música', 'L+M') + ' ' + formatDecimal(a.porcentaje, 2) + ' %'));
        s.interpretes.forEach(p => add(p.nombre, s.id, p.instrumento || 'Intérprete'));
        s.produccion.forEach(p => add(p.nombre, s.id, p.rol || 'Producción'));
        s.tecnica.forEach(t => add(t.nombre, s.id, t.rol));
    }
    const people = [...roles.keys()].sort((a, b) => a.localeCompare(b, 'es'));
    if (!people.length) return '<p class="muted">Todavía no hay créditos cargados. Empezá por «Por canción».</p>';
    return `<div class="tracklist-scroll"><table class="matrix"><thead><tr><th>Persona</th>${canciones.map(s => `<th>${esc(s.titulo)}</th>`).join('')}</tr></thead>
      <tbody>${people.map(name => `<tr><th>${esc(name)}</th>${canciones.map(s => `<td>${[...(roles.get(name)[s.id] || [])].map(tag => `<span class="tag">${esc(tag)}</span>`).join(' ') || '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function creditsRelease() {
    const rel = credits.data.disco.lanzamiento || {};
    const field = (key, label, ph = '', type = 'text') => `<label>${label}<input name="${key}" type="${type}" value="${esc(rel[key] || '')}" placeholder="${ph}"></label>`;
    return `<form class="card cr-form" onsubmit="event.preventDefault();saveRelease(this).catch(report)">
      <div class="cr-grid">${field('upc_ean', 'UPC / EAN', 'Lo asigna la distribuidora')}${field('sello', 'Sello', 'Independiente')}${field('catalogo', 'N.º de catálogo')}
        ${field('distribuidora', 'Distribuidora', 'AMA')}${field('fecha_lanzamiento', 'Fecha de lanzamiento', '', 'date')}${field('territorios', 'Territorios', 'Mundial')}
        ${field('copyright', '℗ / ©', '2027 Luna Austral')}</div>
      <label>Notas<textarea name="notas">${esc(rel.notas || '')}</textarea></label>
      <div class="form-actions"><span id="relStatus" class="muted" role="status"></span><button class="btn-primary">Guardar</button></div></form>`;
}
async function saveRelease(form) {
    await api('/api/discos/' + credits.album + '/lanzamiento', body(Object.fromEntries(new FormData(form))));
    await loadCredits(true);
    credits.tab = 'lanzamiento'; renderCredits();
}
function creditsArt() {
    const art = credits.data.arte || {};
    const disco = credits.data.disco;
    const select = (key, label, options) => `<label>${label}<select name="${key}"><option value="">—</option>${options.map(o => `<option ${art[key] === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    return `<div class="cr-art"><div class="card art-preview">${artBox(disco.portada, disco.id, '', 'release-cover')}
        <strong>${disco.portada ? 'Portada cargada' : 'Portada genérica'}</strong>
        <span class="muted">${disco.portada ? 'Revisá que sea JPG o PNG cuadrado de al menos 3000 × 3000 px, sin logos de tiendas ni URLs.' : 'Se usa una portada abstracta hasta que cargues la real desde «Editar disco».'}</span>
        <ul class="checklist"><li>3000 × 3000 px, cuadrada</li><li>RGB, JPG o PNG</li><li>Sin textos que no sean el artista o el título</li><li>Sin logos de plataformas ni redes</li></ul></div>
      <form class="card cr-form" onsubmit="event.preventDefault();saveArt(this).catch(report)">
        <h2>Autoría y licencia del arte</h2>
        <div class="cr-grid"><label>Autor/a del arte<input name="autor" value="${esc(art.autor || '')}" placeholder="Nombre y apellido"></label>
          ${select('licencia', 'Tipo de licencia', ['Cesión total', 'Licencia exclusiva', 'Licencia no exclusiva', 'Creative Commons', 'Propia'])}
          ${select('pago', 'Pago al titular', ['Pago único', 'Porcentaje de regalías', 'Sin pago'])}
          <label>% de regalías<input name="porcentaje" value="${esc(art.porcentaje || '')}" inputmode="decimal" placeholder="Se descuenta al importar el reporte"></label>
          <label>Monto (pago único)<input name="monto" value="${esc(art.monto || '')}" placeholder="$"></label>
          <label>Vigencia<input name="vigencia" value="${esc(art.vigencia || '')}" placeholder="Ej.: 5 años desde el lanzamiento"></label></div>
        <label>Contrato (ruta del archivo)<input name="contrato" value="${esc(art.contrato || '')}" placeholder="C:\\…\\Contrato_arte.pdf"></label>
        <label>Notas<textarea name="notas">${esc(art.notas || '')}</textarea></label>
        <div class="form-actions"><button class="btn-primary">Guardar</button></div></form></div>`;
}
async function saveArt(form) {
    await api('/api/discos/' + credits.album + '/arte', body(Object.fromEntries(new FormData(form))));
    await loadCredits(true);
}
