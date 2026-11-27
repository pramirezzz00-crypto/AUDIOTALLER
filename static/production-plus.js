// Vista de producción: filtro de validadas, arrastrar entre etapas, renombrado estandarizado y notas de sesión.
const CLIP_MIME = 'text/x-audiotaller-clip';
const prodView = {validOnly: false};
try { prodView.validOnly = localStorage.getItem('audiotaller-solo-validadas') === '1'; } catch {}

// ── Filtro: solo sesiones validadas y vigentes ──
function visibleSessions() {
    const all = workflow?.sesiones || [];
    return prodView.validOnly ? all.filter(s => s.vigente || s.validada) : all;
}
function prodToolbar() {
    const all = workflow?.sesiones || [];
    const marked = all.filter(s => s.vigente || s.validada).length;
    return `<div class="prod-toolbar" role="toolbar" aria-label="Vista de sesiones">
      <div class="seg prod-filter"><button class="${prodView.validOnly ? '' : 'is-on'}" aria-pressed="${!prodView.validOnly}" onclick="setValidOnly(false)">Todas las sesiones <b>${all.length}</b></button>
        <button class="${prodView.validOnly ? 'is-on' : ''}" aria-pressed="${prodView.validOnly}" onclick="setValidOnly(true)">Solo validadas y vigentes <b>${marked}</b></button></div>
      <span class="prod-legend"><i class="lg-vig"></i>Vigente de la etapa <i class="lg-val"></i>Validada</span>
      <span class="spacer"></span>
      <span class="insp-help">Arrastrá una sesión a otra etapa para moverla o copiarla, o al «+» para duplicarla.</span>
      <button class="mk-btn" onclick="renameSessionsDialog().catch(report)" ${all.length ? '' : 'disabled'}>Aa Renombrar sesiones…</button></div>`;
}
function setValidOnly(on) {
    prodView.validOnly = on;
    try { localStorage.setItem('audiotaller-solo-validadas', on ? '1' : '0'); } catch {}
    renderWorkflow();
    if (on && !visibleSessions().length) notify('Todavía no hay sesiones validadas ni vigentes en esta canción.');
}
async function setSessionValidated(id, on) {
    await api('/api/produccion/' + currentSong.id + '/sesiones/' + id + '/validada', body({activa: on}));
    const s = sessionById(id); if (s) s.validada = on;
    renderWorkflow();
}

// ── Elegir entre opciones (Mover / Copiar) ──
function appChoice({title, message, detail = '', options}) {
    let dialog = document.getElementById('appChoiceDialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'appChoiceDialog'; dialog.className = 'app-confirm app-choice'; document.body.append(dialog); }
    dialog.innerHTML = `<h2 class="app-confirm-title">${esc(title)}</h2><p class="app-confirm-message">${esc(message)}</p>${detail ? `<p class="app-confirm-detail">${esc(detail)}</p>` : ''}
      <div class="choice-list">${options.map(o => `<button type="button" class="choice ${o.primary ? 'is-primary' : ''}" data-choice="${o.id}"><b>${esc(o.label)}</b>${o.help ? `<small>${esc(o.help)}</small>` : ''}</button>`).join('')}</div>
      <div class="app-confirm-actions"><button type="button" class="alt" data-choice="">Cancelar</button></div>`;
    return new Promise(resolve => {
        dialog.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => { dialog.close(); resolve(b.dataset.choice || null); });
        dialog.oncancel = () => resolve(null);
        dialog.showModal();
    });
}

// ── Arrastrar cajitas ──
function bindClipDrag() {
    document.querySelectorAll('[data-clip][draggable]').forEach(clip => {
        clip.ondragstart = event => {
            event.dataTransfer.setData(CLIP_MIME, clip.dataset.clip);
            event.dataTransfer.effectAllowed = 'copyMove';
            document.body.classList.add('dragging-clip');
        };
        clip.ondragend = () => { document.body.classList.remove('dragging-clip'); document.querySelectorAll('.is-dragging').forEach(z => z.classList.remove('is-dragging')); };
    });
    document.querySelectorAll('[data-stage-add]').forEach(button => {
        button.ondragover = event => { if ([...event.dataTransfer.types].includes(CLIP_MIME)) { event.preventDefault(); button.classList.add('is-dragging'); } };
        button.ondragleave = () => button.classList.remove('is-dragging');
        button.ondrop = event => {
            event.preventDefault(); button.classList.remove('is-dragging');
            const clip = event.dataTransfer.getData(CLIP_MIME);
            if (clip) dropClipOnAdd(clip, button.dataset.stageAdd).catch(report);
        };
    });
}
function clipItem(clip) {
    const [kind, id] = clip.split(':');
    return {kind, id, item: kind === 'session' ? sessionById(id) : fileById(id)};
}
async function dropClip(clip, stage) {
    const {kind, id, item} = clipItem(clip);
    if (!item) return;
    const from = item.etapa, label = STAGE_INFO[stage]?.name || stage;
    if (from === stage) return;
    const session = kind === 'session';
    const choice = await appChoice({
        title: `Llevar «${item.nombre}» a ${label}`,
        message: session ? '¿Querés mover esta sesión o crear una sesión nueva a partir de ella?' : '¿Querés mover este archivo o sumar una copia en esa etapa?',
        options: [
            {id: 'mover', label: `Mover a ${label}`, primary: true, help: session ? 'Conserva la sesión, su historial, notas y archivos asociados.' + (item.vigente ? ' Dejará de ser la vigente de su etapa.' : '') : 'Conserva el archivo, su ruta y su historial.'},
            {id: 'copiar', label: session ? `Crear una sesión nueva en ${label}` : `Copiar a ${label}`, help: session ? 'Copia el proyecto junto al original (_V00x) y la registra en la otra etapa.' : 'El original queda donde está.'},
        ]});
    if (!choice) return;
    const result = await api('/api/produccion/' + currentSong.id + '/trasladar', body({tipo: session ? 'sesion' : 'archivo', id, etapa: stage, copiar: choice === 'copiar'}));
    studioSel = {kind, id: result.id || id};
    await openSong(currentSong.id);
    notify(choice === 'copiar' ? `Copiada a ${label}.` : `Movida a ${label}.`);
}
async function dropClipOnAdd(clip, stage) {
    const {kind, id, item} = clipItem(clip);
    if (!item) return;
    if (kind === 'session' && item.etapa === stage) return duplicateSessionDialog(id);
    if (item.etapa === stage) return notify('Para duplicar arrastrá una sesión al «+» de su misma etapa.');
    return dropClip(clip, stage);
}

// ── Notas de la sesión: vista previa en el inspector y ventana flotante ──
async function peekSessionNotes(id) {
    const box = $('sessionNotesPeek');
    const {notas} = await api('/api/produccion/' + currentSong.id + '/sesiones/' + id + '/bitacora');
    if (!box || studioSel?.id !== id) return;
    box.innerHTML = notas.length ? notas.slice(-2).map(n => `<div class="peek-note"><span class="mono">${esc(n.legado ? 'Nota anterior' : n.fecha)}</span><p>${esc(n.texto).slice(0, 160)}${n.texto.length > 160 ? '…' : ''}</p>${n.adjuntos?.length ? `<small>📎 ${n.adjuntos.length} adjunto(s)</small>` : ''}</div>`).join('')
        : '<p class="insp-help">Anotá cambios, ideas y pendientes de esta versión. Cada nota queda con su fecha y podés adjuntar archivos.</p>';
}
const notesWin = {id: null, pending: [], q: ''};
async function openSessionNotes(id) {
    notesWin.id = id; notesWin.pending = []; notesWin.q = '';
    let win = $('sessionNotesWin');
    if (!win) {
        win = document.createElement('section');
        win.id = 'sessionNotesWin'; win.className = 'notes-win'; win.setAttribute('role', 'dialog'); win.setAttribute('aria-label', 'Notas de la sesión');
        document.body.append(win);
    }
    win.hidden = false;
    await paintNotesWin();
}
async function paintNotesWin(data) {
    const win = $('sessionNotesWin'), s = sessionById(notesWin.id);
    if (!win || !s) return;
    const notes = data || (await api('/api/produccion/' + currentSong.id + '/sesiones/' + s.id + '/bitacora')).notas;
    const q = notesWin.q.toLowerCase();
    const shown = notes.filter(n => !q || n.texto.toLowerCase().includes(q) || (n.adjuntos || []).some(a => a.nombre.toLowerCase().includes(q)));
    const draft = $('notesDraft')?.value || '';
    win.innerHTML = `<header class="notes-win-head" data-drag-handle><div><span class="insp-kicker">Notas de la sesión</span><h2>${esc(s.nombre)}</h2>
        <span class="insp-help">${esc(STAGE_INFO[s.etapa]?.name || '')} · ${countLabel(notes.length, 'nota', 'notas')}</span></div>
        <input id="notesSearch" class="notes-search" placeholder="Buscar en las notas" value="${esc(notesWin.q)}">
        <button class="notes-x" aria-label="Cerrar notas" onclick="closeSessionNotes()">✕</button></header>
      <div class="notes-list" id="notesList">${shown.map(n => `<article class="note-item ${n.legado ? 'is-legacy' : ''}" data-note="${n.id}">
          <div class="note-meta"><span class="mono">${esc(n.legado ? 'Nota anterior' : n.fecha)}</span>${n.editada ? `<small>editada ${esc(n.editada)}</small>` : ''}
            <span class="spacer"></span><button class="lyr-mini" title="Editar" onclick="editSessionNote('${n.id}')">✎</button><button class="lyr-mini" title="Borrar" onclick="deleteSessionNote('${n.id}').catch(report)">✕</button></div>
          <div class="note-text">${esc(n.texto).split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('')}</div>
          ${n.adjuntos?.length ? `<div class="note-files">${n.adjuntos.map(a => `<button class="file-chip ${a.disponible ? '' : 'is-missing'}" title="${esc(a.ruta)}" onclick="openNoteFile(${esc(JSON.stringify(a.ruta))}).catch(report)">📎 ${esc(a.nombre)}</button>`).join('')}</div>` : ''}
        </article>`).join('') || `<p class="insp-help notes-empty">${q ? 'No hay notas con ese texto.' : 'Todavía no hay notas. Escribí la primera abajo: qué cambiaste, qué falta, ideas para la próxima versión.'}</p>`}</div>
      <footer class="notes-compose"><textarea id="notesDraft" rows="3" placeholder="Escribí una nota… (Ctrl+Enter para guardar)">${esc(draft)}</textarea>
        <div class="notes-pending">${notesWin.pending.map((p, i) => `<span class="file-chip">📎 ${esc(p.split(/[\\/]/).pop())}<button class="lyr-mini" aria-label="Quitar adjunto" onclick="notesWin.pending.splice(${i},1);paintNotesWin().catch(report)">✕</button></span>`).join('')}</div>
        <div class="row-tight"><button class="mk-btn" onclick="attachToNote().catch(report)">📎 Adjuntar archivo</button><span class="spacer"></span><button class="btn-primary" onclick="addSessionNote().catch(report)">Agregar nota</button></div></footer>`;
    const list = $('notesList'); list.scrollTop = list.scrollHeight;
    $('notesDraft').onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); addSessionNote().catch(report); } };
    $('notesSearch').oninput = event => { notesWin.q = event.target.value; paintNotesWin(notes).then(() => { const i = $('notesSearch'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); };
    dragWindow(win, win.querySelector('[data-drag-handle]'));
}
function closeSessionNotes() {
    const win = $('sessionNotesWin'); if (win) win.hidden = true;
    if (studioSel?.kind === 'session') peekSessionNotes(studioSel.id).catch(() => {});
}
function dragWindow(win, handle) {
    handle.onpointerdown = event => {
        if (event.target.closest('button,input')) return;
        const box = win.getBoundingClientRect(), dx = event.clientX - box.left, dy = event.clientY - box.top;
        const move = e => { win.style.left = Math.max(0, Math.min(innerWidth - 120, e.clientX - dx)) + 'px'; win.style.top = Math.max(0, Math.min(innerHeight - 60, e.clientY - dy)) + 'px'; win.style.right = 'auto'; };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
}
async function attachToNote() {
    let path = '';
    if (window.pywebview?.api?.choose_path) path = await window.pywebview.api.choose_path(false);
    else path = prompt('Ruta completa del archivo a adjuntar:') || '';
    if (path) { notesWin.pending.push(path); await paintNotesWin(); }
}
async function addSessionNote() {
    const text = $('notesDraft').value.trim();
    const result = await api('/api/produccion/' + currentSong.id + '/sesiones/' + notesWin.id + '/bitacora', body({texto: text, adjuntos: notesWin.pending}));
    notesWin.pending = []; $('notesDraft').value = '';
    const s = sessionById(notesWin.id); if (s) s.notas_total = result.notas.length;
    await paintNotesWin(result.notas);
}
async function editSessionNote(nid) {
    const node = document.querySelector(`[data-note="${nid}"] .note-text`);
    const current = [...node.querySelectorAll('p')].map(p => p.textContent.replace(/ /g, '')).join('\n');
    node.innerHTML = `<textarea class="note-edit" rows="4">${esc(current)}</textarea><div class="row-tight"><button class="mk-btn" onclick="paintNotesWin().catch(report)">Cancelar</button><button class="btn-primary">Guardar</button></div>`;
    const area = node.querySelector('textarea'); area.focus();
    node.querySelector('.btn-primary').onclick = async () => {
        const result = await api('/api/produccion/' + currentSong.id + '/sesiones/' + notesWin.id + '/bitacora/' + nid, body({texto: area.value}));
        await paintNotesWin(result.notas);
    };
}
async function deleteSessionNote(nid) {
    if (!await appConfirm({title: 'Borrar nota', message: '¿Borrar esta nota de la sesión?', detail: 'Los archivos adjuntos no se tocan: solo se quita la nota.', confirmLabel: 'Borrar nota'})) return;
    const result = await api('/api/produccion/' + currentSong.id + '/sesiones/' + notesWin.id + '/bitacora/' + nid, body({borrar: true}));
    const s = sessionById(notesWin.id); if (s) s.notas_total = result.notas.length;
    await paintNotesWin(result.notas);
}
async function openNoteFile(path) {
    await api('/api/produccion/' + currentSong.id + '/sesiones/' + notesWin.id + '/bitacora/abrir', body({ruta: path}));
}

// ── Renombrar sesiones con un esquema (como el «Esquema de nombrado» de Cubase) ──
const NAME_BLOCKS = {fecha: 'Fecha', cancion: 'Canción', artista: 'Artista', disco: 'Disco', etapa: 'Etapa', version: 'Versión', daw: 'DAW', texto: 'Texto libre'};
const naming = {scheme: null, scope: 'una', id: null, disk: true};
function sessionDate(s) {
    const d = s.fecha_archivo ? new Date(s.fecha_archivo * 1000) : parseDate(s.creado) || new Date();
    const p = n => String(n).padStart(2, '0');
    const [y, m, day] = [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())];
    return {'AAAA-MM-DD': `${y}-${m}-${day}`, 'AAAAMMDD': `${y}${m}${day}`, 'DD-MM-AAAA': `${day}-${m}-${y}`}[naming.scheme.formato_fecha] || `${y}-${m}-${day}`;
}
function cleanPart(value) { return String(value || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim(); }
function scopeSessions() {
    const all = workflow.sesiones.slice();
    const base = naming.id ? sessionById(naming.id) : null;
    if (naming.scope === 'una' && base) return [base];
    if (naming.scope === 'etapa' && base) return all.filter(s => s.etapa === base.etapa);
    return all;
}
function proposedNames() {
    const list = scopeSessions();
    const byStage = {};
    for (const s of workflow.sesiones.slice().sort((a, b) => (a.fecha_archivo || 0) - (b.fecha_archivo || 0) || String(a.creado).localeCompare(String(b.creado)))) {
        (byStage[s.etapa] ||= []).push(s.id);
    }
    const seen = new Map();
    return list.map(s => {
        const parts = naming.scheme.bloques.map(b => cleanPart({
            fecha: sessionDate(s), cancion: currentSong.titulo, artista: currentSong.artista, disco: currentSong.disco || 'Suelta',
            etapa: STAGE_INFO[s.etapa]?.name || s.etapa, version: 'V' + String(byStage[s.etapa].indexOf(s.id) + 1).padStart(3, '0'),
            daw: s.daw || '', texto: naming.scheme.texto}[b])).filter(Boolean);
        let name = parts.join(naming.scheme.separador) || s.nombre;
        const key = name.toLowerCase();
        const n = (seen.get(key) || 0) + 1; seen.set(key, n);
        if (n > 1) name += naming.scheme.separador + n;
        return {s, name, ext: (s.ruta || '').match(/\.[^.\\/]+$/)?.[0] || ''};
    });
}
async function renameSessionsDialog(id) {
    naming.scheme = await api('/api/preferencias/nombres-sesion');
    naming.id = id || studioSel?.kind === 'session' && studioSel.id || null;
    naming.scope = naming.id ? 'una' : 'todas';
    let dialog = $('renameDialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'renameDialog'; dialog.className = 'rename-dialog'; document.body.append(dialog); }
    paintRename();
    dialog.showModal();
}
function paintRename() {
    const d = $('renameDialog'), sc = naming.scheme, base = naming.id ? sessionById(naming.id) : null;
    const rows = proposedNames();
    d.innerHTML = `<h2>Renombrar sesiones</h2><p class="muted">Armá un nombre único y ordenado para tus sesiones. Elegí los bloques en el orden que quieras.</p>
      <section class="rn-sec"><h3>Atributos</h3><div class="rn-chips">${Object.entries(NAME_BLOCKS).map(([k, l]) => `<button type="button" class="rn-chip" ${sc.bloques.includes(k) ? 'disabled' : ''} onclick="naming.scheme.bloques.push('${k}');paintRename()">+ ${l}</button>`).join('')}</div></section>
      <section class="rn-sec"><h3>Resultado</h3><div class="rn-result">${sc.bloques.map((k, i) => `<span class="rn-tag">${i ? `<button type="button" aria-label="Mover a la izquierda" onclick="rnMove(${i},-1)">‹</button>` : ''}${NAME_BLOCKS[k]}${i < sc.bloques.length - 1 ? `<button type="button" aria-label="Mover a la derecha" onclick="rnMove(${i},1)">›</button>` : ''}<button type="button" aria-label="Quitar" onclick="naming.scheme.bloques.splice(${i},1);paintRename()">✕</button></span>`).join('') || '<span class="muted">Agregá al menos un bloque.</span>'}</div></section>
      <section class="rn-sec rn-grid"><label>Separador<select id="rnSep">${[['-', 'Guion  -'], ['_', 'Guion bajo  _'], [' - ', 'Espacio guion espacio'], [' ', 'Espacio'], ['.', 'Punto  .']].map(([v, l]) => `<option value="${esc(v)}" ${sc.separador === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Formato de fecha<select id="rnDate">${['AAAA-MM-DD', 'AAAAMMDD', 'DD-MM-AAAA'].map(v => `<option ${sc.formato_fecha === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Texto libre<input id="rnText" maxlength="40" value="${esc(sc.texto)}" placeholder="Ej.: MIX, Cliente"></label></section>
      <section class="rn-sec"><h3>Aplicar a</h3><div class="seg">${[['una', 'Esta sesión', !!base], ['etapa', base ? 'Toda la etapa ' + (STAGE_INFO[base.etapa]?.name || '') : 'Toda la etapa', !!base], ['todas', 'Todas las sesiones de la canción', true]].map(([v, l, ok]) => `<button type="button" class="${naming.scope === v ? 'is-on' : ''}" ${ok ? '' : 'disabled'} onclick="naming.scope='${v}';paintRename()">${l}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" id="rnDisk" ${naming.disk ? 'checked' : ''}> Renombrar también el archivo del proyecto en su carpeta</label>
        <p class="insp-help">El archivo se renombra en su misma carpeta y nunca se pisa otro. Cerrá el proyecto en el DAW antes de renombrar. Los audios del proyecto no se tocan.</p></section>
      <section class="rn-sec"><h3>Vista previa <small class="muted">${rows.length} sesión(es)</small></h3><div class="rn-preview">${rows.map(r => `<div><span class="mono old" title="${esc(r.s.nombre)}">${esc(r.s.nombre)}</span><span>→</span><span class="mono new">${esc(r.name)}${naming.disk ? `<small>${esc(r.ext)}</small>` : ''}</span></div>`).join('')}</div></section>
      <div class="app-confirm-actions"><button type="button" class="alt" onclick="$('renameDialog').close()">Cancelar</button><button type="button" class="btn-primary" ${sc.bloques.length && rows.length ? '' : 'disabled'} onclick="applyRename().catch(report)">Renombrar ${rows.length}</button></div>`;
    $('rnSep').onchange = e => { sc.separador = e.target.value; paintRename(); };
    $('rnDate').onchange = e => { sc.formato_fecha = e.target.value; paintRename(); };
    $('rnText').oninput = e => { sc.texto = e.target.value; clearTimeout(naming.t); naming.t = setTimeout(() => { paintRename(); const i = $('rnText'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $('rnDisk').onchange = e => { naming.disk = e.target.checked; paintRename(); };
}
function rnMove(i, dir) { const b = naming.scheme.bloques; [b[i], b[i + dir]] = [b[i + dir], b[i]]; paintRename(); }
async function applyRename() {
    const rows = proposedNames().filter(r => r.name !== r.s.nombre || naming.disk);
    await api('/api/preferencias/nombres-sesion', body(naming.scheme));
    if (!rows.length) { $('renameDialog').close(); return notify('Las sesiones ya tienen esos nombres.'); }
    const result = await api('/api/produccion/' + currentSong.id + '/renombrar-sesiones', body({cambios: rows.map(r => ({id: r.s.id, nombre: r.name})), archivo: naming.disk}));
    $('renameDialog').close();
    await openSong(currentSong.id);
    notify(`${countLabel(result.renombradas.length, 'sesión renombrada', 'sesiones renombradas')}` + (result.omitidas.length ? ` · ${result.omitidas.length} sin cambios: ${result.omitidas.map(o => o.motivo).join('; ')}` : ''));
}
