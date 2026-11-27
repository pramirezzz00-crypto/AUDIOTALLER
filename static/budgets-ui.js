// Presupuestos: bloques de ítems, monedas, validez, resumen y PDF con el logo del estudio.
const bud = {list: [], sel: null, doc: null, calc: null, tpl: null, opts: null, timer: null, saving: null};
const BUD_STATES = {Borrador: '', Enviado: 'sent', Aceptado: 'ok', Rechazado: 'bad'};
const budMoney = (v, cur) => (Number(v) || 0).toLocaleString('es-AR', {maximumFractionDigits: 2}) + ' ' + cur;
const budConv = (v, from, to, rate) => from === to ? v : from === 'USD' ? v * rate : v / rate;

async function renderBudgetsPane(selectId) {
    const root = $('budgetsPane');
    if (!bud.tpl) [bud.tpl, bud.opts] = await Promise.all([api('/api/presupuestos/plantilla'), api('/api/presupuestos/opciones')]);
    bud.list = (await api('/api/presupuestos')).presupuestos;
    if (selectId) bud.sel = selectId;
    if (!bud.list.some(b => b.id === bud.sel)) bud.sel = bud.list[0]?.id || null;
    if (bud.sel) { const r = await api('/api/presupuestos/' + bud.sel); bud.doc = r.presupuesto; bud.calc = r.calculo; bud.songs = r.canciones; bud.scope = r.alcance_texto; }
    else bud.doc = null;
    root.innerHTML = `<div class="bud-layout">
      <aside class="pl-side bud-side"><div class="pl-side-head"><span class="eyebrow">Presupuestos</span><button class="link" onclick="newBudget().catch(report)">+ Nuevo</button></div>
        ${bud.list.map(b => `<button class="pl-item bud-item ${b.id === bud.sel ? 'is-on' : ''}" onclick="renderBudgetsPane('${b.id}').catch(report)">
          <span><strong>${esc(b.titulo)}</strong><small>${esc(b.cliente || 'Sin cliente')} · N.° ${esc(b.numero)}</small><small>${esc(b.alcance)}</small>
          <small class="bud-row"><span class="bud-state ${BUD_STATES[b.estado]}">${esc(b.estado)}</span><b>${budMoney(b.total, b.moneda)}</b></small></span></button>`).join('')
          || '<p class="muted">Todavía no hay presupuestos. Creá el primero con «+ Nuevo».</p>'}</aside>
      <section class="bud-main" id="budMain">${bud.doc ? budEditor() : `<div class="bud-empty"><h1>Presupuestos</h1><p class="muted">Armá el presupuesto de una canción, un disco o una cantidad de canciones: locaciones, personal técnico y artístico, soporte, catering y postproducción. Al final descargás el PDF con el logo de tu estudio.</p><button class="btn-primary" onclick="newBudget().catch(report)">+ Nuevo presupuesto</button></div>`}</section></div>`;
    if (bud.doc) bindBudget();
}
async function newBudget() {
    const r = await api('/api/presupuestos', body({}));
    await renderBudgetsPane(r.id);
}

function budEditor() {
    const d = bud.doc, o = bud.opts, s = d.alcance;
    const cur = d.moneda;
    return `<header class="bud-head"><div class="bud-title"><span class="eyebrow">Presupuesto N.° <input class="inline-input bud-num" data-f="numero" value="${esc(d.numero)}"></span>
        <input class="bud-h1" data-f="titulo" value="${esc(d.titulo)}" placeholder="Nombre del presupuesto" aria-label="Nombre del presupuesto">
        <div class="bud-meta"><label>Artista / cliente <input data-f="cliente" list="budArtists" value="${esc(d.cliente)}" placeholder="Nombre del artista"></label>
          <datalist id="budArtists">${o.artistas.map(a => `<option value="${esc(a)}">`).join('')}</datalist>
          <label>Estado <select data-f="estado">${bud.tpl.estados.map(x => `<option ${x === d.estado ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div></div>
      <div class="bud-actions"><button class="btn-primary" onclick="budPdf().catch(report)">${PDF_ICON}Descargar PDF</button>
        <details class="menu"><summary class="menu-button">Más</summary><div class="menu-list"><button onclick="budDuplicate().catch(report)">Duplicar</button>
          <button class="menu-danger" onclick="budDelete().catch(report)">Borrar presupuesto</button></div></details></div></header>
      <div class="bud-body"><div class="bud-col">
        <section class="card bud-card"><h3>¿Qué se presupuesta?</h3>
          <div class="seg" id="budScope">${[['cancion', 'Una canción'], ['disco', 'Un disco'], ['cantidad', 'Cantidad de canciones']].map(([k, l]) => `<button type="button" class="${s.tipo === k ? 'is-on' : ''}" data-scope="${k}">${l}</button>`).join('')}</div>
          <div class="bud-scope-pick">${s.tipo === 'cancion' ? `<select data-f="alcance.cancion_id"><option value="">Elegí la canción…</option>${o.canciones.map(c => `<option value="${c.id}" ${c.id === s.cancion_id ? 'selected' : ''}>${esc(c.titulo)} · ${esc(c.artista)}${c.disco ? ' · ' + esc(c.disco) : ''}</option>`).join('')}</select>`
            : s.tipo === 'disco' ? `<select data-f="alcance.disco_id"><option value="">Elegí el disco…</option>${o.discos.map(c => `<option value="${c.id}" ${c.id === s.disco_id ? 'selected' : ''}>${esc(c.nombre)} · ${esc(c.artista)} · ${c.canciones} canc.</option>`).join('')}</select>`
            : `<label class="bud-inline">Cantidad de canciones <input type="number" min="1" max="200" data-f="alcance.cantidad" value="${s.cantidad}"></label>`}
            <p class="insp-help" id="budScopeText">${esc(bud.scope)} · los ítems marcados «× canción» se multiplican por ${bud.songs}.</p></div></section>
        <section class="card bud-card"><h3>Monedas</h3><div class="bud-cur">
          <label>Cargo los valores en <select data-f="moneda">${['USD', 'ARS'].map(c => `<option ${c === d.moneda ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Cotización: 1 USD = <input type="number" min="0" step="0.01" data-f="cotizacion" value="${d.cotizacion}"> ARS</label>
          <label>Fuente <input data-f="cotizacion_fuente" value="${esc(d.cotizacion_fuente)}" placeholder="Ej.: dólar oficial BNA"></label>
          <label>El PDF muestra <select data-f="moneda_pdf">${['USD', 'ARS'].map(c => `<option ${c === d.moneda_pdf ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Se paga en <select data-f="moneda_pago">${['USD', 'ARS'].map(c => `<option ${c === d.moneda_pago ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div></section>
        ${d.bloques.map((b, bi) => budBlock(b, bi, cur)).join('')}
        <div class="bud-add-block"><button class="mk-btn" onclick="budAddBlock()">+ Agregar bloque</button><span class="insp-help">Por ejemplo «Producción», «Arreglos» o «Gastos de viaje».</span></div>
        <section class="card bud-card"><h3>Plan de trabajo <small class="muted">opcional · sale en el PDF</small></h3>
          <textarea data-f="plan" rows="5" placeholder="Sesión 1: guitarra, bajo y piano…">${esc(d.plan)}</textarea>
          <button class="mk-btn" onclick="budSuggestPlan()">Sugerir un plan a partir de los ítems</button></section>
        <section class="card bud-card"><h3>Notas</h3><textarea data-f="notas" rows="3">${esc(d.notas)}</textarea></section>
      </div><aside class="bud-summary card" id="budSummary">${budSummary()}</aside></div>
      <datalist id="budSuggest">${Object.values(bud.tpl.sugerencias).flat().map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
}
function budBlock(b, bi, cur) {
    const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[bi % 26];
    return `<section class="card bud-card bud-block" data-block="${bi}"><div class="bud-block-head"><span class="bud-letter">${letter}</span>
        <input class="bud-block-title" data-b="${bi}" data-bf="titulo" value="${esc(b.titulo)}" aria-label="Nombre del bloque">
        <span class="bud-block-total mono" id="budBT${bi}">${budMoney(bud.calc?.bloques[bi]?.total ?? 0, cur)}</span>
        <button class="lyr-mini" title="Subir bloque" onclick="budMoveBlock(${bi},-1)" ${bi ? '' : 'disabled'}>↑</button><button class="lyr-mini" title="Bajar bloque" onclick="budMoveBlock(${bi},1)" ${bi < bud.doc.bloques.length - 1 ? '' : 'disabled'}>↓</button>
        <button class="lyr-mini" title="Quitar bloque" onclick="budRemoveBlock(${bi})">✕</button></div>
      <div class="bud-items"><div class="bud-row-h"><span>Concepto</span><span>Valor (${cur})</span><span>Cantidad</span><span>Unidad</span><span title="Multiplica por la cantidad de canciones">× canción</span><span>Total</span><span></span></div>
        ${b.items.map((it, ii) => `<div class="bud-row-i"><input list="budSuggest" data-b="${bi}" data-i="${ii}" data-if="concepto" value="${esc(it.concepto)}" placeholder="Concepto">
          <input type="number" min="0" step="0.01" data-b="${bi}" data-i="${ii}" data-if="valor" value="${it.valor}">
          <input type="number" min="0" step="0.5" data-b="${bi}" data-i="${ii}" data-if="cantidad" value="${it.cantidad}">
          <select data-b="${bi}" data-i="${ii}" data-if="unidad">${bud.tpl.unidades.map(u => `<option ${u === it.unidad ? 'selected' : ''}>${u}</option>`).join('')}</select>
          <label class="bud-check"><input type="checkbox" data-b="${bi}" data-i="${ii}" data-if="por_cancion" ${it.por_cancion ? 'checked' : ''}></label>
          <span class="mono bud-it-total" id="budIT${bi}_${ii}">${budMoney(bud.calc?.bloques[bi]?.items[ii]?.total ?? 0, cur)}</span>
          <span class="bud-item-act"><select class="bud-move" title="Mover a otro bloque" onchange="budMoveItem(${bi},${ii},this.value)"><option value="">⇄</option>${bud.doc.bloques.map((x, xi) => xi === bi ? '' : `<option value="${xi}">${esc(x.titulo)}</option>`).join('')}</select>
            <button class="lyr-mini" title="Quitar ítem" onclick="budRemoveItem(${bi},${ii})">✕</button></span></div>`).join('')}</div>
      <div class="bud-block-foot"><button class="mk-btn" onclick="budAddItem(${bi})">+ Ítem</button>
        ${(bud.tpl.sugerencias[b.id] || []).filter(x => !b.items.some(i => i.concepto === x)).slice(0, 5).map(x => `<button class="rn-chip" onclick="budAddItem(${bi},${esc(JSON.stringify(x))})">+ ${esc(x)}</button>`).join('')}</div></section>`;
}
function budSummary() {
    const d = bud.doc, c = bud.calc, cur = d.moneda, other = cur === 'USD' ? 'ARS' : 'USD';
    const pdf = v => budMoney(budConv(v, cur, d.moneda_pdf, d.cotizacion), d.moneda_pdf);
    return `<h3>Resumen</h3><div class="bud-sum-rows">${c.bloques.map((b, i) => `<div><span>${i + 1}. ${esc(b.titulo)}</span><b class="mono">${budMoney(b.total, cur)}</b></div>`).join('')}</div>
      <div class="bud-sum-line"><span>Subtotal</span><b class="mono">${budMoney(c.subtotal, cur)}</b></div>
      <label class="bud-sum-line">Descuento <span><input type="number" min="0" max="100" step="0.5" data-f="descuento" value="${d.descuento}"> %</span></label>
      <label class="bud-sum-line"><input class="bud-tax-name" data-f="impuesto_nombre" value="${esc(d.impuesto_nombre)}"> <span><input type="number" min="0" max="100" step="0.5" data-f="impuesto" value="${d.impuesto}"> %</span></label>
      <div class="bud-total"><span>Total</span><b class="mono">${budMoney(c.total, cur)}</b></div>
      <p class="insp-help">≈ ${budMoney(budConv(c.total, cur, other, d.cotizacion), other)} · en el PDF: <b>${pdf(c.total)}</b></p>
      <label class="bud-sum-line">Adelanto para reservar <span><input type="number" min="0" max="100" step="5" data-f="adelanto" value="${d.adelanto}"> %</span></label>
      <p class="insp-help">${d.adelanto ? 'Adelanto: ' + pdf(c.adelanto) : 'Sin adelanto'}</p>
      <div class="bud-validity"><label class="check"><input type="checkbox" data-f="validez.mostrar" ${d.validez.mostrar ? 'checked' : ''}> Imprimir período de validez</label>
        <label class="bud-inline">Válido por <input type="number" min="1" max="365" data-f="validez.dias" value="${d.validez.dias}" ${d.validez.mostrar ? '' : 'disabled'}> días</label></div>
      <button class="btn-primary bud-pdf" onclick="budPdf().catch(report)">${PDF_ICON}Descargar PDF</button>
      <p class="insp-help" id="budSaved">Los cambios se guardan solos.</p>`;
}

function setPath(obj, path, value) { const keys = path.split('.'); let o = obj; keys.slice(0, -1).forEach(k => o = o[k]); o[keys.at(-1)] = value; }
function bindBudget() {
    const main = $('budMain');
    main.oninput = main.onchange = event => {
        const el = event.target;
        const val = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        if (el.dataset.f) {
            setPath(bud.doc, el.dataset.f, val);
            if (el.dataset.f === 'validez.mostrar') document.querySelector('[data-f="validez.dias"]').disabled = !val;
            if (['moneda', 'alcance.cancion_id', 'alcance.disco_id'].includes(el.dataset.f) && event.type === 'change') return budSave(true);
        } else if (el.dataset.if) bud.doc.bloques[el.dataset.b].items[el.dataset.i][el.dataset.if] = val;
        else if (el.dataset.bf) bud.doc.bloques[el.dataset.b][el.dataset.bf] = val;
        else return;
        budSave(false);
    };
    main.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { bud.doc.alcance.tipo = b.dataset.scope; budSave(true); });
}
function budSave(rerender) {
    clearTimeout(bud.timer);
    $('budSaved') && ($('budSaved').textContent = 'Guardando…');
    bud.timer = setTimeout(async () => {
        try {
            const r = await api('/api/presupuestos/' + bud.sel, body(bud.doc));
            bud.calc = r.calculo; bud.songs = r.canciones; bud.scope = r.alcance_texto;
            if (rerender) { $('budMain').innerHTML = budEditor(); bindBudget(); }
            else budRefreshNumbers();
            const item = document.querySelector(`.bud-item.is-on`);
            if (item) { item.querySelector('strong').textContent = bud.doc.titulo; const smalls = item.querySelectorAll('small'); smalls[0].textContent = (bud.doc.cliente || 'Sin cliente') + ' · N.° ' + bud.doc.numero; smalls[1].textContent = r.alcance_texto; item.querySelector('.bud-row b').textContent = budMoney(r.calculo.total, bud.doc.moneda); item.querySelector('.bud-state').textContent = bud.doc.estado; item.querySelector('.bud-state').className = 'bud-state ' + BUD_STATES[bud.doc.estado]; }
            $('budSaved') && ($('budSaved').textContent = 'Guardado ✓');
        } catch (error) { report(error); $('budSaved') && ($('budSaved').textContent = 'No se pudo guardar: ' + error.message); }
    }, rerender ? 0 : 450);
}
function budRefreshNumbers() {
    const cur = bud.doc.moneda;
    bud.calc.bloques.forEach((b, bi) => { const t = $('budBT' + bi); if (t) t.textContent = budMoney(b.total, cur); b.items.forEach((it, ii) => { const n = $(`budIT${bi}_${ii}`); if (n) n.textContent = budMoney(it.total, cur); }); });
    const active = document.activeElement, inSummary = $('budSummary').contains(active), key = active?.dataset?.f;
    $('budSummary').innerHTML = budSummary();
    if (inSummary && key) { const again = $('budSummary').querySelector(`[data-f="${key}"]`); if (again) { again.focus(); if (again.type === 'text') again.setSelectionRange(again.value.length, again.value.length); } }
    const t = $('budScopeText'); if (t) t.textContent = `${bud.scope} · los ítems marcados «× canción» se multiplican por ${bud.songs}.`;
}
function budStructural() { budSave(true); }
function budAddItem(bi, concept = '') { bud.doc.bloques[bi].items.push({concepto: concept, valor: 0, cantidad: 1, unidad: 'UN', por_cancion: false}); budStructural(); }
function budRemoveItem(bi, ii) { bud.doc.bloques[bi].items.splice(ii, 1); budStructural(); }
function budMoveItem(bi, ii, target) { if (target === '') return; const [it] = bud.doc.bloques[bi].items.splice(ii, 1); bud.doc.bloques[Number(target)].items.push(it); budStructural(); }
function budAddBlock() { const name = prompt('Nombre del bloque nuevo:', 'Producción'); if (!name) return; bud.doc.bloques.push({id: name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '').slice(0, 20) || 'otros', titulo: name, items: []}); budStructural(); }
async function budRemoveBlock(bi) {
    const b = bud.doc.bloques[bi];
    if (b.items.length && !await appConfirm({title: 'Quitar bloque', message: `¿Quitar «${b.titulo}» y sus ${b.items.length} ítems?`, confirmLabel: 'Quitar bloque'})) return;
    bud.doc.bloques.splice(bi, 1); budStructural();
}
function budMoveBlock(bi, dir) { const list = bud.doc.bloques; [list[bi], list[bi + dir]] = [list[bi + dir], list[bi]]; budStructural(); }
function budSuggestPlan() {
    const artists = bud.doc.bloques.flatMap(b => b.items).filter(i => /ista$|ero$|coros|vientos|perc/i.test(i.concepto)).map(i => i.concepto.toLowerCase());
    const lines = ['1. Preproducción: escucha del demo, definición de forma, tonalidad y tempo; maqueta de referencia.',
        `2. Grabación: ${artists.length ? 'sesiones con ' + artists.join(', ') : 'sesiones de instrumentos y voces'}.`,
        '3. Edición y mezcla: entrega de primera versión y una ronda de devoluciones por el Portal del artista.',
        '4. Mastering y entrega de archivos finales (WAV y MP3).'];
    bud.doc.plan = lines.join('\n');
    budStructural();
}
async function budPdf() {
    clearTimeout(bud.timer);
    await api('/api/presupuestos/' + bud.sel, body(bud.doc));
    const url = '/api/presupuestos/' + bud.sel + '.pdf';
    if (typeof openPdf === 'function' && window.pywebview?.api?.open_pdf) return openPdf(url, 'Presupuesto.pdf');
    const a = document.createElement('a'); a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove();
}
async function budDuplicate() { const r = await api('/api/presupuestos/' + bud.sel + '/duplicar', {method: 'POST'}); await renderBudgetsPane(r.id); notify('Presupuesto duplicado.'); }
async function budDelete() {
    if (!await appConfirm({title: 'Borrar presupuesto', message: `¿Borrar «${bud.doc.titulo}»?`, detail: 'Esta acción no se puede deshacer.', confirmLabel: 'Borrar'})) return;
    await api('/api/presupuestos/' + bud.sel + '/borrar', {method: 'POST'}); bud.sel = null; await renderBudgetsPane();
}
