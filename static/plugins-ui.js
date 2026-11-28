// Gestor de plugins: instalados, sugeridos y desactivados.
const plg = {data: null, tab: 'mios', q: '', fmt: '', lic: '', keep: {}, skip: new Set(), job: null};
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
    const dups = d.duplicados || [];
    const tabs = [['mios', `Mis plugins <b>${all.length}</b>`], ['optimizar', `Optimizador${dups.length ? ` <b class="side-count">${dups.length}</b>` : ''}`], ['sugeridos', 'Sugeridos'], ['desactivados', `Desactivados <b>${d.desactivados.length}</b>`]];
    $('pluginsPane').innerHTML = `<header class="prod-head"><div><div class="eyebrow">Herramientas</div><h1>Plugins</h1>
        <p class="muted">Todo lo que tenés instalado, de qué fabricante es y cómo se licencia. Instalá plugins sueltos, desactivá los que no usás y descubrí herramientas recomendadas.</p></div>
        <div class="row-tight"><button class="mk-btn" onclick="renderPluginsPane(true).catch(report)">↻ Volver a escanear</button><button class="btn-primary" onclick="installPluginDialog()">+ Instalar plugin…</button></div></header>
      <div class="mig-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${plg.tab === k}" class="${plg.tab === k ? 'is-on' : ''}" onclick="plg.tab='${k}';paintPlugins()">${l}</button>`).join('')}</div>
      ${plg.job ? plgJobCard() : ''}
      <div id="plgBody">${plg.tab === 'mios' ? plgMine(count) : plg.tab === 'optimizar' ? plgOptimizer() : plg.tab === 'sugeridos' ? plgSuggested() : plgDisabled()}</div>`;
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
        <td class="right"><div class="row-tight plg-act"><button class="mk-btn" title="Mostrar en la carpeta" onclick="plgReveal(${esc(JSON.stringify(p.ruta))})">📁</button>
          <button class="mk-btn" onclick="disablePlugin(${esc(JSON.stringify(p.id))}).catch(report)">Desinstalar</button></div></td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">Ningún plugin coincide con el filtro.</td></tr>';
}
function plgSuggested() {
    const missing = plgAutoMissing();
    return `<p class="muted plg-intro">Una selección orientativa para mezclar. No hace falta tenerlos todos: los plugins son como las zapatillas, usá los que te resulten cómodos.</p>
      <div class="card plg-mass"><div><div class="eyebrow">Instalador masivo</div><h2>${missing.length ? `${missing.length} gratuitos para instalar con un clic` : 'Tenés todos los gratuitos que AudioTaller instala solo'}</h2>
        <p class="muted">AudioTaller los descarga del sitio oficial de cada fabricante y los instala en las carpetas estándar. Nunca reemplaza un plugin que ya tengas. Los que piden cuenta o registro se descargan desde su ficha.</p></div>
        ${missing.length ? `<button class="btn-primary" onclick="plgMassDialog()" ${plg.job?.estado === 'trabajando' ? 'disabled' : ''}>Instalar gratuitos que faltan…</button>` : ''}</div>
      ${plg.data.sugeridos.map(sec => `<section class="plg-sec"><h2>${esc(sec.titulo)}</h2><p class="muted">${esc(sec.descripcion)}</p>
        ${sec.grupos.map(g => `<h3>${esc(g.titulo)}</h3><div class="plg-grid">${g.items.map(i => `<article class="plg-card ${i.instalado ? 'is-in' : ''}">
          <div class="plg-card-top"><strong>${esc(i.nombre)}</strong><span class="plg-price ${i.precio === 'Gratis' ? 'free' : ''}">${esc(i.precio)}</span></div>
          <small>${esc(i.fabricante)}</small>${i.nota ? `<p>${esc(i.nota)}</p>` : ''}
          <div class="plg-card-foot">${i.instalado ? '<span class="plg-have">✓ Ya lo tenés</span>' : i.automatico ? `<button class="mk-btn plg-auto" onclick="plgStartInstall([${esc(JSON.stringify(i.nombre))}]).catch(report)" ${plg.job?.estado === 'trabajando' ? 'disabled' : ''}>⤓ Instalar</button>` : ''}<a class="btn-link" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Ver en el sitio ↗</a></div></article>`).join('')}</div>`).join('')}</section>`).join('')}`;
}
function plgDisabled() {
    const list = plg.data.desactivados;
    return `<p class="muted plg-intro">Desinstalar no borra: AudioTaller guarda el plugin en su carpeta de datos y lo podés restaurar cuando quieras. Para plugins con central (Waves, Arturia, Native Instruments…) conviene desinstalar desde la central.</p>
      ${list.length ? `<table class="mk-table plg-table"><thead><tr><th>Plugin</th><th>Fabricante</th><th>Formato</th><th>Estaba en</th><th>Desactivado</th><th></th></tr></thead><tbody>${list.map(d => `<tr>
        <td><strong>${esc(d.nombre)}</strong></td><td>${esc(d.fabricante)}</td><td class="mono">${esc(d.formato)}</td><td class="mono"><small>${esc(d.origen)}</small></td><td class="mono">${esc(d.fecha)}</td>
        <td class="right"><div class="row-tight plg-act"><button class="mk-btn" ${d.disponible ? '' : 'disabled'} onclick="restorePlugin('${esc(d.uid)}').catch(report)">Restaurar</button>
          <button class="mk-btn plg-danger" onclick="plgDeleteForever(['${esc(d.uid)}']).catch(report)">Borrar</button></div></td></tr>`).join('')}</tbody></table>
        <div class="row-tight plg-foot"><button class="mk-btn plg-danger" onclick="plgDeleteForever(plg.data.desactivados.map(d=>d.uid)).catch(report)">Borrar definitivamente todos (${list.length})</button></div>` : '<div class="card"><p>No hay plugins desactivados.</p></div>'}`;
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

// ---------- Optimizador: copias repetidas dentro de un mismo formato ----------
function plgOptimizer() {
    const groups = plg.data.duplicados || [];
    if (!groups.length) return `<div class="card plg-clean"><h2>Sin duplicados</h2><p class="muted">No encontré plugins repetidos dentro de un mismo formato. Que un plugin esté en VST3 y en AU (o VST2) no es un duplicado: cada DAW usa el suyo.</p></div>`;
    const chosen = plgDupChoice();
    const space = chosen.reduce((t, c) => t + c.tamano, 0);
    return `<p class="muted plg-intro">Estos plugins aparecen más de una vez <b>en el mismo formato</b> (por ejemplo, dos VST3 del mismo plugin en carpetas distintas). El DAW puede cargar el viejo o mostrarlo repetido. Elegí cuál conservar: AudioTaller sugiere el de versión más nueva o, si no la declara, el más reciente.</p>
      <div class="card plg-mass"><div><div class="eyebrow">Optimizador</div><h2>${groups.length} ${groups.length === 1 ? 'plugin repetido' : 'plugins repetidos'} · ${chosen.length} ${chosen.length === 1 ? 'copia' : 'copias'} para quitar</h2>
        <p class="muted">Se liberan ${plgSize(space)}. Antes de quitar te pido confirmación. Las copias van a «Desactivados»: las podés restaurar o borrar definitivamente desde ahí.</p></div>
        <button class="btn-primary" ${chosen.length ? '' : 'disabled'} onclick="plgRemoveDuplicates().catch(report)">Quitar duplicados…</button></div>
      ${groups.map((g, gi) => { const keep = plg.keep[gi] || g.conservar, off = plg.skip.has(gi); return `<section class="card plg-dup ${off ? 'is-off' : ''}">
        <div class="plg-dup-head"><label class="chk"><input type="checkbox" ${off ? '' : 'checked'} onchange="this.checked?plg.skip.delete(${gi}):plg.skip.add(${gi});paintPlugins()"> <strong>${esc(g.nombre)}</strong></label>
          <span class="mono plg-fmt">${esc(g.formato)}</span><span class="muted">${g.copias.length} copias</span>${g.central ? `<span class="plg-warn">Se administra con ${esc(g.central)}: conviene revisar desde ahí</span>` : ''}</div>
        <table class="mk-table plg-table"><thead><tr><th>Conservar</th><th>Ubicación</th><th>Versión</th><th>Fecha</th><th class="right">Tamaño</th><th></th></tr></thead><tbody>
        ${g.copias.map(c => `<tr class="${c.id === keep ? 'is-keep' : ''}"><td><label class="chk"><input type="radio" name="keep${gi}" ${c.id === keep ? 'checked' : ''} ${off ? 'disabled' : ''} onchange="plg.keep[${gi}]=${esc(JSON.stringify(c.id))};paintPlugins()"> ${c.id === keep ? '<b>Se queda</b>' : '<span class="muted">Se quita</span>'}</label>${c.sugerido ? ' <span class="plg-lic g">Sugerido</span>' : ''}</td>
          <td><small class="mono">${esc(c.ruta)}</small></td><td class="mono">${esc(c.version || '—')}</td><td class="mono">${c.modificado ? new Date(c.modificado * 1000).toLocaleDateString('es-AR') : '—'}</td>
          <td class="mono right">${plgSize(c.tamano)}</td><td class="right"><button class="mk-btn" title="Mostrar en la carpeta" onclick="plgReveal(${esc(JSON.stringify(c.ruta))})">📁</button></td></tr>`).join('')}
        </tbody></table></section>`; }).join('')}`;
}
function plgDupChoice() {
    return (plg.data.duplicados || []).flatMap((g, gi) => plg.skip.has(gi) ? [] : g.copias.filter(c => c.id !== (plg.keep[gi] || g.conservar)));
}
async function plgRemoveDuplicates() {
    const list = plgDupChoice();
    if (!list.length) return;
    const names = list.slice(0, 8).map(c => `${c.nombre} (${c.formato}) · ${c.ruta}`).join('\n') + (list.length > 8 ? `\n… y ${list.length - 8} más` : '');
    if (!await appConfirm({title: 'Quitar duplicados', message: `¿Quitar ${list.length} ${list.length === 1 ? 'copia repetida' : 'copias repetidas'}?`,
        detail: `${names}\n\nSe mueven a «Desactivados» (se pueden restaurar). Cerrá el DAW antes.${navigator.platform.startsWith('Win') ? ' Windows puede pedirte permiso de administrador una vez.' : ''}`, confirmLabel: 'Quitar duplicados'})) return;
    await api('/api/plugins/desactivar-varios', body({ids: list.map(c => c.id)}));
    notify(`Listo: ${list.length} ${list.length === 1 ? 'copia quitada' : 'copias quitadas'}. Están en «Desactivados».`);
    plg.keep = {}; plg.skip = new Set();
    await renderPluginsPane(true);
}
async function plgDeleteForever(uids) {
    if (!uids.length) return;
    const names = plg.data.desactivados.filter(d => uids.includes(d.uid)).map(d => `${d.nombre} (${d.formato})`);
    if (!await appConfirm({title: 'Borrar definitivamente', message: `¿Borrar ${names.length === 1 ? names[0] : names.length + ' plugins'} para siempre?`,
        detail: 'Se eliminan de «Plugins desactivados» y no se pueden recuperar. Los plugins instalados no se tocan.', confirmLabel: 'Borrar definitivamente'})) return;
    const r = await api('/api/plugins/borrar', body({uids}));
    notify(`Borrados: ${r.borrados}.`);
    await renderPluginsPane(true);
}

// ---------- Instalador masivo de gratuitos ----------
function plgAutoMissing() {
    return (plg.data?.sugeridos || []).flatMap(s => s.grupos.flatMap(g => g.items)).filter(i => i.automatico && !i.instalado && i.precio === 'Gratis');
}
function plgMassDialog() {
    const list = plgAutoMissing();
    formDialog('Instalar gratuitos', `<p>AudioTaller descarga cada plugin del sitio oficial del fabricante y lo instala. Los que traen instalador se ejecutan juntos: ${navigator.platform.startsWith('Win') ? 'Windows te va a pedir permiso una sola vez' : 'macOS te va a pedir tu contraseña una sola vez'}. Cerrá el DAW antes.</p>
        <div class="plg-pick">${list.map(i => `<label class="chk"><input type="checkbox" name="n" value="${esc(i.nombre)}" checked> <span><b>${esc(i.nombre)}</b> <small class="muted">${esc(i.fabricante)}</small></span></label>`).join('')}</div>`,
        async () => {
            const names = [...$('iterationForm').querySelectorAll('input[name=n]:checked')].map(x => x.value);
            if (!names.length) throw Error('Elegí al menos uno.');
            await plgStartInstall(names);
        }, () => { $('iterationSubmit').textContent = 'Instalar'; });
}
async function plgStartInstall(names) {
    plg.job = await api('/api/plugins/instalar-gratis', body({nombres: names}));
    paintPlugins();
    plgPoll();
}
function plgPoll() {
    clearTimeout(plg.timer);
    plg.timer = setTimeout(async () => {
        if (!plg.job) return;
        try { plg.job = await api('/api/plugins/trabajos/' + plg.job.id); } catch (e) { report(e); return; }
        if (plg.job.estado === 'trabajando') {
            if ($('plgJob')) $('plgJob').outerHTML = plgJobCard(); else if ($('pluginsPane') && !$('pluginsPane').hidden) paintPlugins();
            plgPoll();
        } else {
            notify(plg.job.paso);
            const job = plg.job; await renderPluginsPane(true); plg.job = job; paintPlugins();
        }
    }, 900);
}
function plgJobCard() {
    const j = plg.job, icon = {instalado: '✓', error: '!', 'en espera': '·'};
    return `<section class="card plg-job ${j.estado}" id="plgJob"><div class="plg-dup-head">${j.estado === 'trabajando' ? '<span class="spin"></span>' : ''}<strong>${esc(j.paso || 'Instalando…')}</strong>
        ${j.estado !== 'trabajando' ? '<button class="mk-btn" onclick="plg.job=null;paintPlugins()">Cerrar</button>' : ''}</div>
      <ul class="plg-job-list">${j.plugins.map(r => `<li class="st-${esc(r.estado.replace(/ /g, '-'))}"><b>${icon[r.estado] || '…'}</b> ${esc(r.nombre)} <span class="muted">${esc(r.estado)}${r.detalle ? ' · ' + esc(r.detalle) : ''}</span></li>`).join('')}</ul></section>`;
}

// ---------- Youlean por defecto ----------
// El instalador de Windows ya lo instala. Si no está (Mac, o se destildó), se ofrece una sola vez.
async function maybeOfferYoulean() {
    const y = await api('/api/plugins/youlean').catch(() => null);
    if (!y || y.instalado || y.ofrecido || !y.automatico) return;
    if (document.querySelector('dialog[open]')) { setTimeout(maybeOfferYoulean, 8000); return; }
    await api('/api/plugins/youlean/ofrecido', body({}));
    if (!await appConfirm({title: 'Medidor de loudness', message: '¿Instalo Youlean Loudness Meter?',
        detail: 'Es gratis y es el medidor que usamos para LUFS y dBTP. AudioTaller lo descarga del sitio oficial e instala la versión gratuita. Si después no lo querés, lo desinstalás desde Plugins.',
        confirmLabel: 'Instalar Youlean', danger: false})) return;
    plg.job = await api('/api/plugins/instalar-gratis', body({nombres: ['Youlean Loudness Meter']}));
    notify('Instalando Youlean Loudness Meter. Podés seguir el avance en Plugins.');
    plgPoll();
}
setTimeout(() => maybeOfferYoulean().catch(() => {}), 6000);

// Mostrar el plugin en su carpeta (Explorador o Finder), con el plugin seleccionado.
async function plgReveal(ruta) {
    try {
        const r = window.pywebview?.api?.reveal_plugin ? await window.pywebview.api.reveal_plugin(ruta)
            : await api('/api/plugins/mostrar', body({ruta})).then(() => ({ok: true}));
        if (r && r.ok === false) notify(r.motivo || 'No se pudo abrir la carpeta.');
        else notify('Abriendo la carpeta del plugin…');
    } catch (error) { notify(error.message || 'No se pudo abrir la carpeta.'); }
}
