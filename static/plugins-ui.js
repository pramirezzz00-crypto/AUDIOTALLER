// Gestor de plugins: instalados, sugeridos y desactivados.
const plg = {data: null, tab: 'mios', q: '', fmt: '', lic: ''};
const PLG_LIC = {central: ['Central', 'c'], ilok: ['iLok', 'i'], clave: ['Licencia', 'l'], gratis: ['Gratis', 'g'], desconocida: ['Sin identificar', 'u']};
const plgSize = n => n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GB' : n >= 1024 ** 2 ? Math.round(n / 1024 ** 2) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB';

async function renderPluginsPane(reload = false) {
    const root = $('pluginsPane');
    if (!plg.data || reload) {
        root.innerHTML = `<header class="prod-head"><div><div class="eyebrow">Herramientas</div><h1>Plugins</h1></div></header><div class="card mig-wait"><span class="spin"></span> Buscando los plugins instalados en esta computadora…</div>`;
        plg.data = await api('/api/plugins');
    }
    paintPlugins();
}
function plgFiltered() {
    const q = plg.q.toLowerCase();
    return plg.data.instalados.filter(p => (!q || (p.nombre + ' ' + p.fabricante + ' ' + (p.central || '')).toLowerCase().includes(q))
        && (!plg.fmt || p.formato === plg.fmt) && (!plg.lic || p.licencia === plg.lic));
}
function paintPlugins() {
    const d = plg.data, all = d.instalados;
    const count = f => all.filter(f).length;
    const tabs = [['mios', `Mis plugins <b>${all.length}</b>`], ['sugeridos', 'Sugeridos'], ['desactivados', `Desactivados <b>${d.desactivados.length}</b>`]];
    $('pluginsPane').innerHTML = `<header class="prod-head"><div><div class="eyebrow">Herramientas</div><h1>Plugins</h1>
        <p class="muted">Todo lo que tenés instalado, de qué fabricante es y cómo se licencia. Instalá plugins sueltos, desactivá los que no usás y descubrí herramientas recomendadas.</p></div>
        <div class="row-tight"><button class="mk-btn" onclick="renderPluginsPane(true).catch(report)">↻ Volver a escanear</button><button class="btn-primary" onclick="installPluginDialog()">+ Instalar plugin…</button></div></header>
      <div class="mig-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${plg.tab === k}" class="${plg.tab === k ? 'is-on' : ''}" onclick="plg.tab='${k}';paintPlugins()">${l}</button>`).join('')}</div>
      <div id="plgBody">${plg.tab === 'mios' ? plgMine(count) : plg.tab === 'sugeridos' ? plgSuggested() : plgDisabled()}</div>`;
    const search = $('plgSearch');
    if (search) search.oninput = e => { plg.q = e.target.value; $('plgTable').innerHTML = plgRows(); };
}
function plgMine(count) {
    const all = plg.data.instalados;
    const formats = [...new Set(all.map(p => p.formato))].sort();
    return `<div class="mig-summary plg-summary">${[['Instalados', all.length], ['Con central o licencia', count(p => ['central', 'ilok', 'clave'].includes(p.licencia))], ['Gratuitos', count(p => p.licencia === 'gratis')],
        ['Fabricantes', new Set(all.map(p => p.fabricante)).size]].map(([l, v]) => `<div><small>${l}</small><b>${v}</b></div>`).join('')}</div>
      <div class="plg-filters"><input id="plgSearch" placeholder="Buscar por nombre, fabricante o central" value="${esc(plg.q)}">
        <div class="seg">${['', ...formats].map(f => `<button class="${plg.fmt === f ? 'is-on' : ''}" onclick="plg.fmt='${f}';paintPlugins()">${f || 'Todos'}</button>`).join('')}</div>
        <div class="seg">${[['', 'Todas'], ...Object.entries(PLG_LIC).map(([k, v]) => [k, v[0]])].map(([k, l]) => `<button class="${plg.lic === k ? 'is-on' : ''}" onclick="plg.lic='${k}';paintPlugins()">${l}</button>`).join('')}</div></div>
      ${all.length ? `<table class="mk-table plg-table"><thead><tr><th>Plugin</th><th>Fabricante</th><th>Formato</th><th>Licencia</th><th class="right">Tamaño</th><th></th></tr></thead><tbody id="plgTable">${plgRows()}</tbody></table>`
        : `<div class="card"><p>No encontré plugins en las carpetas estándar de esta computadora.</p><p class="insp-help">Carpetas revisadas: ${plg.data.carpetas.map(c => esc(c.ruta)).join(' · ')}</p></div>`}`;
}
function plgRows() {
    return plgFiltered().map(p => `<tr><td><strong>${esc(p.nombre)}</strong><small class="mono">${esc(p.relativo)}</small></td><td>${esc(p.fabricante)}</td><td class="mono">${esc(p.formato)}</td>
        <td><span class="plg-lic ${PLG_LIC[p.licencia]?.[1] || 'u'}">${esc(PLG_LIC[p.licencia]?.[0] || p.licencia)}</span>${p.central && p.licencia !== 'gratis' ? `<small>${p.enlace ? `<a href="${esc(p.enlace)}" target="_blank" rel="noopener noreferrer">${esc(p.central)} ↗</a>` : esc(p.central)}</small>` : ''}</td>
        <td class="mono right">${plgSize(p.tamano)}</td>
        <td class="right"><div class="row-tight plg-act"><button class="mk-btn" title="Mostrar en la carpeta" onclick="api('/api/plugins/mostrar',body({ruta:${esc(JSON.stringify(p.ruta))}})).catch(report)">📁</button>
          <button class="mk-btn" onclick="disablePlugin(${esc(JSON.stringify(p.id))}).catch(report)">Desinstalar</button></div></td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">Ningún plugin coincide con el filtro.</td></tr>';
}
function plgSuggested() {
    return `<p class="muted plg-intro">Una selección orientativa para mezclar. No hace falta tenerlos todos: los plugins son como las zapatillas, usá los que te resulten cómodos. AudioTaller no descarga nada: cada ficha lleva al sitio oficial.</p>
      ${plg.data.sugeridos.map(sec => `<section class="plg-sec"><h2>${esc(sec.titulo)}</h2><p class="muted">${esc(sec.descripcion)}</p>
        ${sec.grupos.map(g => `<h3>${esc(g.titulo)}</h3><div class="plg-grid">${g.items.map(i => `<article class="plg-card ${i.instalado ? 'is-in' : ''}">
          <div class="plg-card-top"><strong>${esc(i.nombre)}</strong><span class="plg-price ${i.precio === 'Gratis' ? 'free' : ''}">${esc(i.precio)}</span></div>
          <small>${esc(i.fabricante)}</small>${i.nota ? `<p>${esc(i.nota)}</p>` : ''}
          <div class="plg-card-foot">${i.instalado ? '<span class="plg-have">✓ Ya lo tenés</span>' : ''}<a class="btn-link" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Ver en el sitio ↗</a></div></article>`).join('')}</div>`).join('')}</section>`).join('')}`;
}
function plgDisabled() {
    const list = plg.data.desactivados;
    return `<p class="muted plg-intro">Desinstalar no borra: AudioTaller guarda el plugin en su carpeta de datos y lo podés restaurar cuando quieras. Para plugins con central (Waves, Arturia, Native Instruments…) conviene desinstalar desde la central.</p>
      ${list.length ? `<table class="mk-table plg-table"><thead><tr><th>Plugin</th><th>Fabricante</th><th>Formato</th><th>Estaba en</th><th>Desactivado</th><th></th></tr></thead><tbody>${list.map(d => `<tr>
        <td><strong>${esc(d.nombre)}</strong></td><td>${esc(d.fabricante)}</td><td class="mono">${esc(d.formato)}</td><td class="mono"><small>${esc(d.origen)}</small></td><td class="mono">${esc(d.fecha)}</td>
        <td class="right"><button class="mk-btn" ${d.disponible ? '' : 'disabled'} onclick="restorePlugin('${esc(d.uid)}').catch(report)">Restaurar</button></td></tr>`).join('')}</tbody></table>` : '<div class="card"><p>No hay plugins desactivados.</p></div>'}`;
}
async function disablePlugin(id) {
    const p = plg.data.instalados.find(x => x.id === id);
    const central = ['central', 'ilok'].includes(p.licencia) ? `\n\n${p.nombre} se administra con ${p.central}: conviene desinstalarlo desde ahí para no romper su licencia.` : '';
    if (!await appConfirm({title: 'Desinstalar plugin', message: `¿Desinstalar ${p.nombre} (${p.formato})?`, detail: `AudioTaller lo guarda en «Plugins desactivados» y lo podés restaurar. Cerrá el DAW antes.${central}${navigator.platform.startsWith('Win') ? ' Windows puede pedirte permiso de administrador.' : ''}`, confirmLabel: 'Desinstalar'})) return;
    await api('/api/plugins/desactivar', body({id}));
    notify(p.nombre + ' quedó desactivado. Lo podés restaurar desde «Desactivados».');
    await renderPluginsPane(true);
}
async function restorePlugin(uid) {
    await api('/api/plugins/restaurar', body({uid}));
    notify('Plugin restaurado en su carpeta.');
    plg.tab = 'desactivados';
    await renderPluginsPane(true);
}
function installPluginDialog() {
    formDialog('Instalar plugin', `<p>Elegí el plugin que descargaste: un <b>.zip</b>, un archivo <b>.vst3</b>, <b>.clap</b> o <b>.dll</b>, o la carpeta del plugin (<b>.vst3</b> o <b>.component</b>). AudioTaller lo copia a la carpeta estándar de su formato y nunca reemplaza uno instalado.</p>
        <p class="insp-help">Si el fabricante te dio un instalador (.exe, .msi, .pkg o .dmg), abrilo con doble clic: AudioTaller no ejecuta instaladores. Los AAX y los plugins con central se instalan desde su programa.</p>
        <label>Archivo o carpeta<input name="ruta" required placeholder="Ruta del plugin o del .zip"></label>
        <div class="row-tight"><button type="button" class="alt" id="plgPickFile">Elegir archivo…</button><button type="button" class="alt" id="plgPickFolder">Elegir carpeta…</button></div>`,
        async data => {
            const r = await api('/api/plugins/instalar', body({rutas: [data.ruta.trim()]}));
            notify((r.instalados.length ? `Instalado: ${r.instalados.map(i => i.nombre + ' (' + i.formato + ')').join(', ')}. Volvé a escanear plugins en tu DAW.` : 'No se instaló nada.')
                + (r.omitidos.length ? ' · ' + r.omitidos.map(o => `${o.nombre}: ${o.motivo}`).join(' · ') : ''));
            await renderPluginsPane(true);
        }, form => {
            const pick = async folder => { if (window.pywebview?.api?.choose_path) { const p = await window.pywebview.api.choose_path(folder); if (p) form.elements.ruta.value = p; } };
            $('plgPickFile').onclick = () => pick(false).catch(report);
            $('plgPickFolder').onclick = () => pick(true).catch(report);
            $('iterationSubmit').textContent = 'Instalar';
        });
}
