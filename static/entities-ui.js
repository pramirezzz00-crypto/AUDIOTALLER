// Entidades: qué hace cada una, procedimientos con guía en PDF, «Preparar con mis datos»
// y el estado de registro de cada canción (con buscador).
const ent = {list: [], sel: 'sadaic', rows: [], q: '', disc: '', pending: false, song: ''};
const ENT_LOGOS = {sadaic: 'sadaic', aadi: 'aadi', capif: 'capif', inamu: 'inamu', ama: 'ama'};
const ENT_COLS = [['dnda_obra', 'DNDA obra', 'dnda'], ['sadaic', 'SADAIC · ISWC', 'sadaic'], ['isrc', 'ISRC', 'capif'], ['dnda_fono', 'DNDA fonograma', 'dnda'], ['aadi', 'AADI', 'aadi']];
const ENT_STATES = {ok: ['✓', '#5ED17E', 'Registrado'], tramite: ['En trámite', '#FFB547', 'En trámite'], pendiente: ['Pendiente', '#E5484D', 'Pendiente'], 'no-aplica': ['—', '#8A8A94', 'No aplica']};

async function renderEntitiesPane() {
    try { [ent.list, ent.rows] = await Promise.all([ent.list.length ? ent.list : api('/api/entidades'), api('/api/entidades/estado')]); }
    catch (error) { return report(error); }
    if (!ent.song) ent.song = ent.rows[0]?.id || '';
    paintEntities();
}
function entLogo(e, big) {
    const file = ENT_LOGOS[e.id];
    return file ? `<span class="ent-logo ${big ? 'big' : ''}"><img src="/static/entities/${file}.png" alt="${esc(e.abbr)}"></span>`
        : `<span class="ent-logo ent-abbr ${big ? 'big' : ''}" style="--c:${e.color}">${esc(e.abbr)}</span>`;
}
function paintEntities() {
    const root = $('entidades');
    const cur = ent.list.find(e => e.id === ent.sel) || ent.list[0];
    const q = ent.q.trim().toLowerCase();
    const discs = [...new Set(ent.rows.map(r => r.disco || 'Canciones sueltas'))];
    const rows = ent.rows.filter(r => (!q || [r.titulo, r.disco, r.artista].join(' ').toLowerCase().includes(q))
        && (!ent.disc || (r.disco || 'Canciones sueltas') === ent.disc) && (!ent.pending || ENT_COLS.some(([k]) => r[k] === 'pendiente' || r[k] === 'tramite')));
    const keepFocus = document.activeElement?.id === 'entQ';
    root.innerHTML = `
      <header class="prod-head"><div><div class="eyebrow">Derechos y registros</div><h1>Entidades</h1>
        <p class="muted">Dónde se registra, se distribuye y se cobra cada parte de una canción en Argentina.</p></div></header>
      <div class="ent-map">
        <div><strong>Obra</strong><span class="muted">La composición: letra y música</span><span>DNDA registra · SADAIC cobra (ISWC)</span></div>
        <div><strong>Fonograma</strong><span class="muted">La grabación</span><span>DNDA registra · CAPIF asigna ISRC y cobra · AADI cobra por intérpretes</span></div>
        <div><strong>Distribución</strong><span class="muted">Llevarla a las plataformas</span><span>AMA (INAMU) u otra distribuidora</span></div>
      </div>
      <div class="ent-layout">
        <div class="ent-cards">${ent.list.map(e => `<button class="ent-card ${e.id === cur.id ? 'is-on' : ''}" onclick="ent.sel='${e.id}';paintEntities()">
          ${entLogo(e)}<span><strong>${esc(e.abbr)}</strong><small>${esc(e.short)}</small></span></button>`).join('')}</div>
        ${cur ? `<aside class="card ent-detail">
          <div class="row-tight">${entLogo(cur, true)}<div><span class="insp-kicker">${esc(cur.kind)}</span><h2 style="margin:2px 0">${esc(cur.name)}</h2>
            <a href="${esc(cur.site)}" target="_blank" rel="noopener noreferrer">${esc(cur.site.replace(/^https?:\/\//, ''))} ↗</a></div></div>
          <p>${esc(cur.what)}</p>
          <div class="ent-cols"><div><span class="insp-label">Qué te da</span><ul>${cur.gives.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>
            <div><span class="insp-label">Qué guarda AudioTaller</span><p class="muted">${esc(cur.stores)}</p></div></div>
          <span class="insp-label">Procedimientos</span>
          <label class="row-tight">Preparar para<select id="entSong" onchange="ent.song=this.value">${ent.rows.map(r => `<option value="${r.id}" ${r.id === ent.song ? 'selected' : ''}>${esc(r.titulo)} · ${esc(r.disco || 'suelta')}</option>`).join('')}</select></label>
          ${cur.procs.map(p => `<div class="ent-proc"><div><strong>${esc(p.titulo)}</strong><span class="tag">${esc(p.cuando)}</span><p class="muted">${esc(p.resumen)}</p></div>
            <div class="row-tight"><a class="btn-link" href="/api/entidades/guia/${p.id}.pdf" download>Guía paso a paso (PDF)</a>
              <button onclick="prepareProcedure('${cur.id}').catch(report)" ${ent.rows.length ? '' : 'disabled'}>Preparar con mis datos</button></div></div>`).join('')}
          <span class="insp-help">«Preparar con mis datos» arma la carpeta del trámite dentro de la canción: ficha en PDF con obra, autores y porcentajes, la letra y, si corresponde, una copia del audio. Requisitos y aranceles pueden cambiar: confirmalos en el sitio oficial.</span>
        </aside>` : ''}
      </div>
      <section class="card ent-matrix">
        <div class="cr-sub"><strong>Estado de registro por canción</strong>
          <span class="row-tight"><label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
            <input id="entQ" type="search" placeholder="Buscar canción, disco o artista" value="${esc(ent.q)}"></label>
            <select aria-label="Disco" onchange="ent.disc=this.value;paintEntities()"><option value="">Todos los discos</option>${discs.map(d => `<option ${ent.disc === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
            <button class="chip-btn ${ent.pending ? 'is-on' : ''}" onclick="ent.pending=!ent.pending;paintEntities()">Solo con pendientes</button></span></div>
        <span class="insp-help">ISWC, ISRC y AADI se completan solos con los datos de Créditos. Clic en DNDA (u otra celda manual) para cambiar su estado.</span>
        <div class="tracklist-scroll"><table class="matrix ent-table"><thead><tr><th>Canción</th>${ENT_COLS.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr><th><strong>${esc(r.titulo)}</strong><small>${esc(r.disco || 'Canción suelta')} · ${esc(r.artista)}</small></th>${ENT_COLS.map(([key, , entity]) => {
            const [label, color, title] = ENT_STATES[r[key]] || ENT_STATES.pendiente;
            return `<td><button class="ent-cell" style="--c:${color}" title="${title} · clic para cambiar" onclick="cycleEntity('${r.id}','${key}','${entity}')">${label}</button></td>`;
          }).join('')}</tr>`).join('') || `<tr><td colspan="6" class="muted">${ent.rows.length ? 'Ninguna canción coincide con la búsqueda.' : 'Todavía no hay canciones.'}</td></tr>`}</tbody></table></div>
      </section>`;
    const input = $('entQ');
    input.oninput = () => { ent.q = input.value; const pos = input.selectionStart; paintEntities(); $('entQ').focus(); $('entQ').setSelectionRange(pos, pos); };
    if (keepFocus) input.focus();
}
async function cycleEntity(sid, key, entity) {
    const row = ent.rows.find(r => r.id === sid);
    const order = ['pendiente', 'tramite', 'ok', 'no-aplica'];
    const next = order[(order.indexOf(row[key]) + 1) % order.length];
    await api('/api/entidades/estado/' + sid, body({[key]: next})).catch(report);
    ent.rows = await api('/api/entidades/estado');
    ent.sel = entity;
    paintEntities();
    const updated = ent.rows.find(r => r.id === sid);
    if (updated[key] !== next) notify('Este dato sale de Créditos: completá el código ahí para marcarlo como registrado.');
}
async function prepareProcedure(entity) {
    const result = await api('/api/entidades/preparar', body({entidad: entity, cancion_id: $('entSong').value}));
    notify(`Carpeta lista: ${result.archivos.join(', ')}`);
    if (window.pywebview?.api?.open_folder_for) window.pywebview.api.open_folder_for('cancion:tramites', $('entSong').value);
}
