// Exportar metadata: por disco o por canción, para la distribuidora, AMA, registros o una ficha para compartir.
// CSV, Excel (3 hojas), Word y PDF con logo de AudioTaller. Avisa qué falta antes de exportar.
const exp = {scope: 'disco', id: '', target: 'generica', fmt: 'xlsx', logo: true, letras: false, sheet: 'Lanzamiento', data: null, done: '', options: []};
const EXP_TARGETS = {
    generica: ['Distribuidora (genérica)', 'Columnas estándar que piden la mayoría de las distribuidoras.', 'xlsx'],
    ama: ['AMA', 'Ordenado como la carga de AMA: lanzamiento, pistas, autores e intérpretes.', 'xlsx'],
    registros: ['Registros (DNDA / SADAIC)', 'Obra, autores y porcentajes, letra y duración, listo para los trámites.', 'pdf'],
    ficha: ['Ficha para compartir', 'Resumen prolijo para el artista, el sello o la prensa.', 'pdf'],
};
const EXP_FORMATS = {csv: ['CSV', 'Una fila por canción con los datos del lanzamiento repetidos: lo que suelen aceptar las distribuidoras para carga masiva.'],
    xlsx: ['Excel', 'Hojas «Lanzamiento», «Pistas» y «Créditos». Lo que falta queda marcado en rojo.'],
    docx: ['Word', 'Ficha editable con portada, datos del lanzamiento, pistas, créditos y letras opcionales.'],
    pdf: ['PDF', 'La misma ficha lista para enviar o imprimir.']};

async function openExport(scope, id) {
    exp.scope = scope; exp.id = id; exp.done = '';
    if (scope === 'cancion') { const song = await api('/api/creditos/' + id); exp.album = song.disco_id || ''; }
    else exp.album = id;
    go('exportPane');
    await loadExport();
}
async function loadExport() {
    exp.data = await api(`/api/exportar/vista?alcance=${exp.scope}&id=${encodeURIComponent(exp.id)}`);
    if (exp.album) {
        try { exp.options = (await api('/api/discos/' + exp.album + '/creditos')).canciones.map(s => [s.id, s.titulo]); } catch { exp.options = []; }
    }
    renderExport();
}
function expUrl(save) {
    return `/api/exportar/archivo?alcance=${exp.scope}&id=${encodeURIComponent(exp.id)}&destino=${exp.target}&formato=${exp.fmt}&logo=${exp.logo ? 1 : 0}&letras=${exp.letras ? 1 : 0}${save ? '&guardar=1' : ''}`;
}
function renderExport() {
    const root = $('exportPane');
    if (!root || !exp.data) return;
    const d = exp.data;
    $('crumbPath').innerHTML = `<button onclick="go('home')">Inicio</button> › <button onclick="openArtistManager(true)">Producciones</button> › <button onclick="back()">${esc(d.titulo)}</button> › Exportar metadata`;
    const issues = d.canciones.map(s => ({titulo: s.titulo, faltan: [...s.faltan, ...(s.master ? [] : ['sin master'])]})).filter(s => s.faltan.length);
    const table = exp.fmt === 'csv' || exp.fmt === 'xlsx';
    root.innerHTML = `
      <header class="prod-head"><div><div class="eyebrow">Metadata para distribuidoras y registros</div><h1>Exportar metadata</h1>
        <p class="muted">Todo lo que AudioTaller sabe de la obra y del fonograma, en el formato que te pidan.</p></div></header>
      <div class="exp-layout">
        <div class="exp-config">
          <section class="card"><span class="insp-label">1 · Qué exportar</span>
            <div class="seg">${[['disco', 'Disco completo'], ['cancion', 'Una canción']].map(([id, label]) => `<button class="${exp.scope === id ? 'is-on' : ''}" ${id === 'disco' && !exp.album ? 'disabled' : ''}
              onclick="expScope('${id}')">${label}</button>`).join('')}</div>
            ${exp.scope === 'cancion' && exp.options.length ? `<select aria-label="Canción" onchange="exp.id=this.value;exp.done='';loadExport().catch(report)">${exp.options.map(([id, t]) => `<option value="${id}" ${id === exp.id ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
            <span class="muted">${esc(d.titulo)} · ${esc(d.artista)} · ${countLabel(d.canciones.length, 'canción', 'canciones')}</span></section>
          <section class="card"><span class="insp-label">2 · Para quién</span>
            ${Object.entries(EXP_TARGETS).map(([id, [name, desc]]) => `<button class="exp-target ${exp.target === id ? 'is-on' : ''}" onclick="exp.target='${id}';exp.fmt='${EXP_TARGETS[id][2]}';exp.done='';renderExport()">
              <strong>${name}</strong><span>${desc}</span></button>`).join('')}</section>
          <section class="card"><span class="insp-label">3 · Formato</span>
            <div class="seg">${Object.entries(EXP_FORMATS).map(([id, [label]]) => `<button class="${exp.fmt === id ? 'is-on' : ''}" onclick="exp.fmt='${id}';exp.done='';renderExport()">${label}</button>`).join('')}</div>
            <span class="muted">${EXP_FORMATS[exp.fmt][1]}</span>
            <label class="check"><input type="checkbox" ${exp.logo ? 'checked' : ''} onchange="exp.logo=this.checked;renderExport()"> Incluir el logo de AudioTaller (PDF y Word)</label>
            <label class="check"><input type="checkbox" ${exp.letras ? 'checked' : ''} onchange="exp.letras=this.checked;renderExport()"> Incluir las letras</label></section>
          <section class="card ${issues.length ? 'exp-warn' : ''}"><span class="insp-label">Revisión antes de exportar</span>
            ${issues.length ? issues.map(i => `<span class="exp-issue"><b>!</b> <strong>${esc(i.titulo)}</strong> · ${esc(i.faltan.join(', '))}</span>`).join('') : '<span class="ok-green">✓ No falta ningún dato obligatorio.</span>'}
            ${exp.album ? `<div class="row-tight"><button class="btn-ghost" onclick="openCredits('${exp.album}').catch(report)">Completar en Créditos</button><button class="btn-ghost" onclick="go('entidades')">Ver registros</button></div>` : ''}</section>
          <div class="row-tight"><button class="btn-primary exp-go" onclick="exportSave().catch(report)">Exportar ${EXP_FORMATS[exp.fmt][0]} ${exp.scope === 'disco' ? 'del disco' : 'de la canción'}</button>
            <a class="btn-link" href="${expUrl(false)}" download>Descargar</a></div>
          ${exp.done ? `<span class="ok-green">✓ ${esc(exp.done)}</span>` : ''}
          ${issues.length ? '<span class="muted">Se puede exportar igual: lo que falta sale marcado.</span>' : ''}
        </div>
        <div class="exp-preview"><span class="insp-label">Vista previa · ${EXP_FORMATS[exp.fmt][0]}${table && exp.fmt === 'xlsx' ? ' · 3 hojas' : ''}</span>
          ${table ? expTablePreview(d) : expDocPreview(d)}</div>
      </div>`;
}
async function expScope(scope) {
    if (scope === exp.scope) return;
    exp.scope = scope; exp.done = '';
    exp.id = scope === 'disco' ? exp.album : (exp.options[0]?.[0] || exp.id);
    await loadExport();
}
async function exportSave() {
    const result = await api(expUrl(true));
    exp.done = `${result.nombre} guardado en la carpeta «Entregas» del ${exp.scope === 'disco' ? 'disco' : 'proyecto'}.`;
    renderExport();
}
function expAuthors(s) { return s.autores.map(a => `${a.nombre} (${a.rol || 'autoría'} ${formatDecimal(a.porcentaje, 2)} %)`).join('; '); }
function expTablePreview(d) {
    const sheets = exp.fmt === 'xlsx' ? ['Lanzamiento', 'Pistas', 'Créditos'] : ['Pistas'];
    if (!sheets.includes(exp.sheet)) exp.sheet = sheets[0];
    const rel = d.lanzamiento || {};
    let head, rows;
    if (exp.sheet === 'Lanzamiento') {
        head = ['Campo', 'Valor'];
        rows = [['UPC / EAN', rel.upc_ean || 'pendiente'], ['Título', d.titulo], ['Tipo', d.tipo], ['Artista principal', d.artista], ['Fecha', rel.fecha_lanzamiento ? fmtDay(rel.fecha_lanzamiento) : 'falta'],
            ['Sello', rel.sello || 'Independiente'], ['℗ / ©', rel.copyright || ''], ['Distribuidora', rel.distribuidora || ''], ['Portada', d.portada ? 'cargada' : 'falta']];
    } else if (exp.sheet === 'Créditos') {
        head = ['#', 'Título', 'Autores y reparto', 'Intérpretes', 'Mezcla', 'Mastering'];
        rows = d.canciones.map(s => [s.n, s.titulo, expAuthors(s) || 'falta', s.interpretes.map(p => p.nombre).join(', '),
            s.tecnica.filter(t => t.rol === 'Mezcla').map(t => t.nombre).join(', ') || 'falta', s.tecnica.filter(t => t.rol === 'Mastering').map(t => t.nombre).join(', ') || 'falta']);
    } else {
        head = (exp.fmt === 'csv' ? ['Lanzamiento', 'Artista'] : []).concat(exp.target === 'registros' ? ['N.º', 'Obra', 'ISWC', 'Autores', 'Duración'] : ['#', 'Título', 'ISRC', 'ISWC', 'Duración', 'Autores', 'Archivo master']).concat(exp.letras ? ['Letra'] : []);
        rows = d.canciones.map(s => (exp.fmt === 'csv' ? [d.titulo, d.artista] : []).concat(exp.target === 'registros'
            ? [s.n, s.titulo, s.iswc || 'falta', expAuthors(s) || 'falta', s.duracion || 'falta']
            : [s.n, s.titulo, s.isrc || 'falta', s.iswc || 'falta', s.duracion || 'falta', expAuthors(s) || 'falta', s.master || 'falta']).concat(exp.letras ? [s.letra ? 'Sí' : '—'] : []));
    }
    return `${sheets.length > 1 ? `<div class="sheet-tabs">${sheets.map(name => `<button class="${exp.sheet === name ? 'is-on' : ''}" onclick="exp.sheet='${name}';renderExport()">${name}</button>`).join('')}</div>` : ''}
      <div class="tracklist-scroll"><table class="exp-table"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(v => `<td class="${v === 'falta' ? 'missing' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function expDocPreview(d) {
    const rel = d.lanzamiento || {};
    return `<div class="doc-page">
      <div class="doc-head">${exp.logo ? '<span class="doc-logo"><img src="/static/branding/AudioTaller.png" alt=""> AudioTaller</span>' : '<span></span>'}<small>${exp.target === 'registros' ? 'Ficha para registro de obras' : 'Ficha de metadata'} · ${new Date().toLocaleDateString('es-AR')}</small></div>
      <div class="doc-hero">${artBox('', d.titulo, '', 'doc-cover')}<div><small>${esc(d.tipo)}${rel.fecha_lanzamiento ? ' · sale el ' + esc(fmtDay(rel.fecha_lanzamiento)) : ''}</small><h2>${esc(d.titulo)}</h2><span>${esc(d.artista)}</span></div></div>
      <dl>${[['Sello', rel.sello || 'Independiente'], ['UPC', rel.upc_ean || 'pendiente'], ['Distribuidora', rel.distribuidora || '—']].map(([k, v]) => `<dt>${k}</dt><dd class="${v === 'pendiente' ? 'missing' : ''}">${esc(v)}</dd>`).join('')}</dl>
      <table><thead><tr><th>#</th><th>Título</th><th>ISRC</th><th>ISWC</th><th>Dur.</th></tr></thead><tbody>
        ${d.canciones.map(s => `<tr><td>${s.n}</td><td><strong>${esc(s.titulo)}</strong><small>${esc(expAuthors(s))}</small></td><td class="${s.isrc ? 'mono' : 'missing'}">${esc(s.isrc || 'falta')}</td><td class="${s.iswc ? 'mono' : 'missing'}">${esc(s.iswc || 'falta')}</td><td>${esc(s.duracion || '—')}</td></tr>`).join('')}</tbody></table>
      <small class="doc-foot">Siguen los créditos completos de cada canción${exp.letras ? ' y las letras' : ''}. Lo que falta sale en rojo.</small></div>`;
}
