// Migrar a otra computadora: exportar todo, importar y lista de plugins para reinstalar.
const mig = {plan: null, preview: null, timer: null, tab: 'exportar'};
const migSize = n => { n = Number(n) || 0; return n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB' : n >= 1024 ** 2 ? Math.round(n / 1024 ** 2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
const MIG_DISK = {interno: ['Disco interno', 'ok'], otro: ['Otro disco', 'warn'], externo: ['Disco externo', 'warn'], red: ['Red', 'warn']};
const MIG_LICENSE = {central: 'Se reinstala con su central: iniciás sesión y la central descarga y activa todo.', ilok: 'Se reinstala desde el sitio del fabricante; la licencia va en tu iLok (USB, nube o esta computadora).',
    clave: 'Se reinstala desde el sitio del fabricante y se activa con tu número de serie o archivo de licencia.', copia: 'AudioTaller los copia y los instala solo en la computadora nueva.'};

function migShell(content) {
    $('configPane').innerHTML = `<header class="prod-head"><div><div class="eyebrow"><button class="link" onclick="openConfig().catch(report)">Configuración</button> › Migrar</div>
        <h1>Migrar a otra computadora</h1><p class="muted">Llevá tus proyectos, la biblioteca de AudioTaller y tus plugins a una computadora nueva con un solo archivo.</p></div></header>
      <div class="mig-tabs" role="tablist">${[['exportar', '1 · Exportar desde esta computadora'], ['importar', '2 · Importar en esta computadora'], ['plugins', 'Plugins para reinstalar']].map(([k, l]) =>
        `<button role="tab" aria-selected="${mig.tab === k}" class="${mig.tab === k ? 'is-on' : ''}" onclick="openMigration('${k}').catch(report)">${l}</button>`).join('')}</div>
      <div id="migBody">${content}</div>`;
}

async function openMigration(tab = 'exportar') {
    if (typeof go === 'function' && !$('configPane').offsetParent) go('configPane');
    mig.tab = tab;
    const state = await api('/api/migracion/estado');
    if (state.activo) return migProgress(state);
    if (tab === 'importar') return migImportStart();
    if (tab === 'plugins') return migPlugins();
    migShell(`<div class="card mig-wait"><span class="spin"></span> Revisando tus proyectos, la biblioteca y los plugins instalados… puede tardar un minuto.</div>`);
    mig.plan = await api('/api/migracion/plan');
    migExportView();
}

function migPluginGroups(groups, selectable) {
    return groups.map(g => `<details class="mig-group" ${g.licencia === 'copia' ? 'open' : ''}><summary><span class="mig-badge ${g.licencia}">${{central: 'Central', ilok: 'iLok', clave: 'Licencia', copia: 'Copia'}[g.licencia] || 'Manual'}</span>
        <b>${esc(g.central)}</b><small>${g.plugins.length} plugin${g.plugins.length === 1 ? '' : 's'} · ${esc(g.fabricantes.slice(0, 4).join(', '))}${g.fabricantes.length > 4 ? '…' : ''}</small>
        ${g.total !== undefined ? `<span class="mig-count ${g.instalados === g.total ? 'ok' : ''}">${g.instalados} de ${g.total} instalados</span>` : ''}</summary>
      <p class="muted">${MIG_LICENSE[g.licencia] || 'No se identificó el fabricante: instalalo desde su sitio.'}${g.enlace ? ` <a href="${esc(g.enlace)}" target="_blank" rel="noopener noreferrer">Abrir ${esc(g.central)}</a>` : ''}</p>
      <table class="mk-table"><tbody>${g.plugins.map(p => `<tr>${selectable ? `<td><input type="checkbox" data-plugin="${esc(p.id)}" ${p.copiar ? 'checked' : ''} ${p.copiable ? '' : 'disabled'} aria-label="Copiar ${esc(p.nombre)}"></td>` : `<td>${p.instalado ? '<span class="mig-ok">✓</span>' : '<span class="mig-miss">○</span>'}</td>`}
        <td><strong>${esc(p.nombre)}</strong>${p.licencia === 'clave' && selectable ? '<small>Copiable · necesita tu licencia</small>' : ''}</td><td class="mono">${esc(p.formato)}</td><td>${esc(p.fabricante)}</td><td class="mono right">${migSize(p.tamano)}</td></tr>`).join('')}</tbody></table></details>`).join('');
}

function migExportView() {
    const p = mig.plan;
    const projects = p.proyectos.map(x => `<tr><td><input type="checkbox" data-project="${x.id}" ${x.incluir ? 'checked' : ''} aria-label="Incluir ${esc(x.nombre)}"></td>
        <td><strong>${esc(x.nombre)}</strong><small class="mono">${esc(x.ruta)}</small></td><td><span class="mig-disk ${MIG_DISK[x.disco]?.[1] || ''}">${MIG_DISK[x.disco]?.[0] || x.disco}</span></td>
        <td class="mono right">${x.archivos}</td><td class="mono right">${migSize(x.tamano)}</td></tr>`).join('');
    migShell(`<div class="mig-summary" id="migSummary"></div>
      <section class="card mig-section"><h2>Proyectos</h2>
        <p class="muted">Van tildadas las carpetas que están en el disco de esta computadora. Las de discos externos no viajan en el archivo: quedan vinculadas, y en la computadora nueva alcanza con conectar ese disco.</p>
        ${p.proyectos.length ? `<table class="mk-table"><thead><tr><th></th><th>Carpeta o archivo</th><th>Dónde está</th><th class="right">Archivos</th><th class="right">Tamaño</th></tr></thead><tbody>${projects}</tbody></table>` : '<p>No hay carpetas de proyectos fuera de la biblioteca de AudioTaller.</p>'}
        ${p.faltan_total ? `<details class="mig-missing"><summary>${p.faltan_total} ruta${p.faltan_total === 1 ? '' : 's'} guardada${p.faltan_total === 1 ? '' : 's'} en AudioTaller ya no existe${p.faltan_total === 1 ? '' : 'n'} en esta computadora</summary><ul>${p.no_encontrados.map(r => `<li class="mono">${esc(r)}</li>`).join('')}</ul></details>` : ''}
        <p class="mig-note">La biblioteca de AudioTaller (artistas, canciones, catálogo, playlists, devoluciones y ajustes) siempre va completa: ${migSize(p.datos.tamano)}.</p></section>
      <section class="card mig-section"><h2>Plugins instalados <small class="muted">${p.plugins.length}</small></h2>
        <p class="muted">Los gratuitos se copian dentro del archivo. Los que tienen licencia no se pueden copiar: en la computadora nueva AudioTaller te muestra cuáles faltan y con qué central reinstalarlos.</p>
        ${p.plugins.length ? migPluginGroups(p.centrales, true) : '<p>No encontré plugins en las carpetas estándar.</p>'}</section>
      ${p.avisos.length ? `<section class="card mig-section mig-warn"><h2>Antes de dejar esta computadora</h2><ul>${p.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul></section>` : ''}
      <div class="mig-actions"><span class="muted">El archivo es un .zip común: lo podés guardar en un disco externo o pendrive.</span>
        <button class="btn-primary" onclick="migExport().catch(report)">Guardar archivo de migración…</button></div>`);
    $('configPane').querySelectorAll('[data-project],[data-plugin]').forEach(box => box.onchange = migTotals);
    migTotals();
}

function migChosen() {
    const pick = attr => [...$('configPane').querySelectorAll(`[${attr}]:checked`)].map(b => b.getAttribute(attr));
    return {proyectos: pick('data-project'), plugins: pick('data-plugin')};
}

function migTotals() {
    const p = mig.plan, chosen = migChosen();
    const projects = p.proyectos.filter(x => chosen.proyectos.includes(x.id)), plugins = p.plugins.filter(x => chosen.plugins.includes(x.id));
    const sum = list => list.reduce((a, x) => a + x.tamano, 0);
    const total = p.datos.tamano + sum(projects) + sum(plugins);
    $('migSummary').innerHTML = [['Biblioteca de AudioTaller', migSize(p.datos.tamano)], ['Proyectos', `${projects.length} · ${migSize(sum(projects))}`],
        ['Plugins que se copian', `${plugins.length} · ${migSize(sum(plugins))}`], ['Tamaño del archivo', '≈ ' + migSize(total)]]
        .map(([l, v], i) => `<div class="${i === 3 ? 'is-total' : ''}"><small>${l}</small><b>${v}</b></div>`).join('');
}

async function migExport() {
    const chosen = migChosen();
    let destino = '';
    if (window.pywebview?.api?.choose_migration_destination) destino = await window.pywebview.api.choose_migration_destination(mig.plan.nombre_sugerido);
    else destino = prompt('Ruta completa donde guardar el archivo de migración (.zip):', mig.plan.carpeta_sugerida + '/' + mig.plan.nombre_sugerido) || '';
    if (!destino) return;
    migProgress(await api('/api/migracion/exportar', body({destino, ...chosen})));
}

function migProgress(state) {
    clearTimeout(mig.timer);
    const pct = state.total ? Math.min(100, Math.floor(state.hecho * 100 / state.total)) : 0;
    const secs = state.inicio ? Date.now() / 1000 - state.inicio : 0;
    const eta = pct > 2 && pct < 100 ? Math.round(secs * (100 - pct) / pct / 60) : null;
    const title = {exportar: 'Generando el archivo de migración', importar: 'Importando la migración', plugins: 'Instalando plugins'}[state.tipo] || 'Migración';
    migShell(`<section class="card mig-run" aria-live="polite"><h2>${title}</h2><p>${esc(state.fase)}</p>
        <div class="mig-bar"><i style="width:${pct}%"></i></div><p class="muted mono">${pct}% · ${migSize(state.hecho)} de ${migSize(state.total)}${eta !== null ? ` · faltan unos ${eta || 1} min` : ''}${state.archivo ? ' · ' + esc(state.archivo) : ''}</p>
        <p class="muted">Podés seguir usando AudioTaller, pero no lo cierres hasta que termine.</p>
        <button class="mk-btn" onclick="api('/api/migracion/cancelar',{method:'POST'}).catch(report)">Cancelar</button></section>`);
    mig.timer = setTimeout(async () => {
        const next = await api('/api/migracion/estado').catch(() => state);
        if (next.activo) return migProgress(next);
        if (next.error) return migShell(`<section class="card mig-run"><h2>${next.fase === 'Cancelada' ? 'Migración cancelada' : 'No se pudo completar'}</h2><p>${esc(next.error)}</p>
            <button class="mk-btn" onclick="openMigration('${mig.tab}').catch(report)">Volver</button></section>`);
        ({exportar: migExportDone, importar: migImportDone, plugins: () => openMigration('plugins')}[next.tipo] || (() => openMigration()))(next.resultado);
    }, 700);
}

function migExportDone(r) {
    migShell(`<section class="card mig-run mig-done"><h2>✓ Archivo de migración listo</h2>
        <p><b class="mono">${esc(r.archivo)}</b> · ${migSize(r.tamano)}</p>
        <p>${r.proyectos} carpeta${r.proyectos === 1 ? '' : 's'} de proyectos y ${r.plugins} plugin${r.plugins === 1 ? '' : 's'} gratuito${r.plugins === 1 ? '' : 's'}, más toda la biblioteca de AudioTaller.</p>
        ${window.pywebview?.api?.show_in_folder ? `<button class="mk-btn" onclick="window.pywebview.api.show_in_folder(${esc(JSON.stringify(r.archivo))})">Mostrar en la carpeta</button>` : ''}
        <h3>Qué sigue</h3><ol><li>Copiá el archivo a la computadora nueva (disco externo, pendrive o la nube).</li><li>Instalá AudioTaller ahí y abrilo.</li>
          <li>Entrá a <b>Configuración → Migrar a otra computadora → Importar</b> y elegí el archivo.</li></ol>
        ${r.avisos?.length ? `<h3>Antes de dejar esta computadora</h3><ul>${r.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
        ${r.omitidos?.length ? `<details><summary>${r.omitidos.length} elemento(s) no se pudieron copiar (sin permiso o accesos directos)</summary><ul>${r.omitidos.map(o => `<li class="mono">${esc(o)}</li>`).join('')}</ul></details>` : ''}</section>`);
}

function migImportStart() {
    migShell(`<section class="card mig-section"><h2>Importar una migración</h2>
        <p>Elegí el archivo <b>.zip</b> que generaste con «Exportar» en tu otra computadora. Antes de cambiar nada te muestro qué va a pasar.</p>
        ${window.pywebview?.api?.choose_migration_file ? '' : '<label class="fld">Ruta del archivo<input id="migFile" placeholder="/ruta/AudioTaller migración.zip"></label>'}
        <button class="btn-primary" onclick="migChooseFile().catch(report)">Elegir archivo de migración…</button></section>`);
}

async function migChooseFile() {
    const archivo = window.pywebview?.api?.choose_migration_file ? await window.pywebview.api.choose_migration_file() : $('migFile').value.trim();
    if (!archivo) return;
    mig.preview = await api('/api/migracion/revisar', body({archivo}));
    const v = mig.preview;
    migShell(`<section class="card mig-section"><h2>Esto es lo que se va a importar</h2>
        <p class="muted">Archivo creado el ${esc(new Date(v.creado).toLocaleString('es-AR'))} · ${migSize(v.tamano)}</p>
        ${v.canciones_actuales ? `<p class="mig-warnline">Esta computadora ya tiene ${v.canciones_actuales} canción${v.canciones_actuales === 1 ? '' : 'es'} en AudioTaller. Se reemplazan por las de la migración y la base actual queda respaldada en la carpeta de datos (respaldos-migracion).</p>` : ''}
        ${v.mismo_sistema ? '' : '<p class="mig-warnline">La migración viene de otro sistema operativo: los proyectos se importan, pero los plugins no se pueden instalar. Te dejo la lista para reinstalarlos.</p>'}
        <h3>Proyectos (${v.proyectos.length})</h3>${v.proyectos.length ? `<table class="mk-table"><thead><tr><th>Proyecto</th><th>Se copia en</th><th class="right">Tamaño</th></tr></thead><tbody>${v.proyectos.map(x =>
            `<tr><td><strong>${esc(x.nombre)}</strong></td><td class="mono">${esc(x.destino)}${x.cambia ? ' <span class="mig-disk warn">ruta nueva</span>' : ''}</td><td class="mono right">${migSize(x.tamano)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Solo la biblioteca de AudioTaller.</p>'}
        ${v.no_incluidos.length ? `<p class="muted">${v.no_incluidos.length} ubicación${v.no_incluidos.length === 1 ? '' : 'es'} de discos externos no viene${v.no_incluidos.length === 1 ? '' : 'n'} en el archivo: conectá esos discos y AudioTaller los usa desde ahí.</p>` : ''}
        <h3>Plugins (${v.plugins_total})</h3>
        ${v.plugins_copiados ? `<label class="check"><input type="checkbox" id="migPlugins" checked> Instalar los ${v.plugins_copiados} plugins gratuitos que vienen en el archivo</label>
          <p class="muted">Nunca reemplazo un plugin que ya esté instalado.${navigator.platform.startsWith('Win') ? ' Windows te va a pedir permiso de administrador para copiarlos en la carpeta de plugins.' : ''}</p>` : ''}
        <p class="muted">Los ${v.plugins_total - v.plugins_copiados} restantes se reinstalan con su central; al terminar te muestro la lista.</p>
        <div class="mig-actions"><button class="mk-btn" onclick="migImportStart()">Elegir otro archivo</button><button class="btn-primary" onclick="migImport().catch(report)">Importar todo</button></div></section>`);
}

async function migImport() {
    migProgress(await api('/api/migracion/importar', body({archivo: mig.preview.archivo, plugins: $('migPlugins')?.checked ?? false})));
}

function migImportDone(r) {
    const pl = r.plugins || {};
    migShell(`<section class="card mig-run mig-done"><h2>✓ Migración importada</h2>
        <p>${r.proyectos} carpeta${r.proyectos === 1 ? '' : 's'} de proyectos copiada${r.proyectos === 1 ? '' : 's'} y ${r.rutas_actualizadas} registro${r.rutas_actualizadas === 1 ? '' : 's'} actualizado${r.rutas_actualizadas === 1 ? '' : 's'} con las rutas de esta computadora.</p>
        ${pl.instalados || pl.existentes ? `<p>Plugins gratuitos: ${pl.instalados || 0} instalado${pl.instalados === 1 ? '' : 's'}${pl.existentes ? `, ${pl.existentes} ya estaba${pl.existentes === 1 ? '' : 'n'}` : ''}.</p>` : ''}
        ${pl.aviso ? `<p class="mig-warnline">${esc(pl.aviso)}</p>` : ''}
        ${r.reubicados?.length ? `<details><summary>${r.reubicados.length} carpeta${r.reubicados.length === 1 ? ' quedó' : 's quedaron'} en otra ruta</summary><ul>${r.reubicados.map(x => `<li class="mono">${esc(x.antes)} → ${esc(x.ahora)}</li>`).join('')}</ul></details>` : ''}
        ${r.respaldo ? `<p class="muted">La base que tenía esta computadora quedó respaldada en <span class="mono">${esc(r.respaldo)}</span>.</p>` : ''}
        <p>Si usabas el Portal del artista, volvé a tocar <b>Autorizar Google</b> en Playlist → Conectar portal web: las claves guardadas no viajan por seguridad. Lo mismo con la clave de API del asistente.</p>
        <div class="mig-actions"><button class="mk-btn" onclick="location.reload()">Recargar AudioTaller</button><button class="btn-primary" onclick="openMigration('plugins').catch(report)">Ver plugins para reinstalar</button></div></section>`);
}

async function migPlugins() {
    migShell(`<div class="card mig-wait"><span class="spin"></span> Revisando qué plugins hay en esta computadora…</div>`);
    const c = await api('/api/migracion/plugins');
    if (!c.migracion) return migShell(`<section class="card mig-section"><h2>Todavía no importaste una migración</h2><p>Cuando importes el archivo de tu otra computadora, acá vas a ver qué plugins faltan y con qué central reinstalar cada uno.</p></section>`);
    const done = c.total - c.faltan;
    migShell(`<section class="card mig-section"><h2>Plugins de tu otra computadora</h2>
        <p><b>${done} de ${c.total}</b> ya están instalados acá.${c.faltan ? ' Instalá los que faltan con su central y tocá «Volver a revisar».' : ' ¡Está todo!'}</p>
        <div class="mig-bar"><i style="width:${c.total ? Math.round(done * 100 / c.total) : 100}%"></i></div>
        <div class="mig-actions"><button class="mk-btn" onclick="migPlugins().catch(report)">Volver a revisar</button>
          ${c.mismo_sistema && c.centrales.some(g => g.licencia === 'copia' && g.instalados < g.total) ? '<button class="mk-btn" onclick="api(\'/api/migracion/plugins/reintentar\',{method:\'POST\'}).then(migProgress).catch(report)">Reintentar instalar los gratuitos</button>' : ''}</div></section>
      <section class="card mig-section">${migPluginGroups(c.centrales, false)}</section>`);
}
