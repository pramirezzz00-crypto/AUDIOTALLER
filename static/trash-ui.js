const TRASH_STAGE_NAMES = {
    demo: '01 Demo', maqueta: '02 Maquetado', grabacion: '03 Grabación',
    mezcla: '04 Mezcla', mastering: '05 Mastering', historico: 'Histórico'
};

async function loadTrash() {
    const root = $('trashList');
    if (!root) return;
    try {
        const [files, entities] = await Promise.all([api('/api/papelera'), api('/api/papelera-entidades')]);
        const entityCards = entities.map(item => `<article class="trash-card" data-trash-type="${item.tipo}">
          <div class="trash-main"><div><span class="trash-kind">${({artista:'ARTISTA',disco:'DISCO',cancion:'CANCIÓN',audiovisual:'AUDIOVISUAL'})[item.tipo]}</span>
            <h2>${esc(item.nombre)}</h2><p class="muted">${item.elementos ? `${item.elementos} producciones relacionadas; también volverán al restaurar.` : 'Perfil o proyecto conservado para restaurarlo.'}</p>
            <small class="muted">En Papelera desde ${esc(item.eliminado_en)}</small></div>
            <div class="trash-actions"><button class="alt" onclick="restoreTrashEntity('${item.grupo}').catch(report)">Restaurar</button>
              <button class="trash-permanent" onclick="permanentlyDeleteTrashEntity('${item.grupo}').catch(report)">Eliminar definitivamente</button></div>
          </div></article>`).join('');
        const fileCards = files.map(file => `<article class="trash-card" data-trash-type="archivo">
          <div class="trash-main"><div><span class="trash-kind">${file.modo === 'vinculado' ? 'VÍNCULO' : 'COPIA'}</span>
            <h2>${esc(file.nombre)}</h2><p class="muted">${esc(file.artista)} · ${esc(file.titulo)} · ${esc(TRASH_STAGE_NAMES[file.etapa] || file.etapa)}</p>
            <small class="muted">En Papelera desde ${esc(file.eliminado_en)}</small></div>
            <div class="trash-actions"><button class="alt" onclick="restoreTrashFile('${file.id}').catch(report)">Restaurar</button>
              <button class="trash-permanent" onclick="permanentlyDeleteTrashFile('${file.id}').catch(report)">${file.modo === 'vinculado' ? 'Eliminar registro' : 'Eliminar definitivamente'}</button></div>
          </div>
          ${file.playlists ? `<p class="trash-note">Estaba incluido en ${file.playlists} playlist${file.playlists === 1 ? '' : 's'}. Al restaurarlo, volverá a aparecer allí.</p>` : ''}
          ${file.publicaciones ? `<p class="trash-note">Tiene ${file.publicaciones} entrega${file.publicaciones === 1 ? '' : 's'} publicada${file.publicaciones === 1 ? '' : 's'}. Los archivos ya publicados en el portal no se borrarán desde aquí.</p>` : ''}
        </article>`).join('');
        root.innerHTML = entityCards + fileCards || '<article class="card trash-empty"><strong>La Papelera está vacía</strong><p class="muted">Los archivos, perfiles y proyectos que quites aparecerán acá y podrás restaurarlos.</p></article>';
        $('trashTypeFilter').onchange = applyTrashTypeFilter;
        applyTrashTypeFilter();
    } catch (error) {
        root.innerHTML = `<p class="add-error">${esc(error.message)}</p>`;
    }
}

async function moveEntityToTrash(tipo, identity) {
    const labels = {artista:'el perfil y sus producciones',disco:'el disco y sus canciones',cancion:'la canción',audiovisual:'la producción audiovisual'};
    let nombre = '';
    if (tipo === 'artista') nombre = ppl.list.find(item => item.id === identity)?.nombre || 'artista';
    else if (tipo === 'disco') nombre = (await api('/api/proyectos')).discos.find(item => item.id === identity)?.nombre || 'disco';
    else if (tipo === 'cancion') nombre = currentSong?.id === identity ? currentSong.titulo : (await api('/api/proyectos')).canciones.find(item => item.id === identity)?.titulo || 'canción';
    else nombre = av.list.find(item => item.id === identity)?.nombre || 'producción audiovisual';
    const accepted = await appConfirm({title:'Mover a Papelera',message:`¿Mover “${nombre}” a la Papelera?`,detail:`Se conservarán los datos, archivos y relaciones. Podrás restaurar ${labels[tipo]} desde la Papelera.`,confirmLabel:'Mover a Papelera'});
    if (!accepted) return;
    await api(`/api/papelera-entidades/${tipo}/${identity}`, body({}));
    go('trashPane');
}

function applyTrashTypeFilter() {
    const filter = $('trashTypeFilter')?.value || '';
    document.querySelectorAll('#trashList [data-trash-type]').forEach(card => {
        card.hidden = !!filter && card.dataset.trashType !== filter;
    });
}

async function restoreTrashEntity(group) {
    await api(`/api/papelera-entidades/${encodeURIComponent(group)}/restaurar`, body({}));
    await loadTrash();
}

async function permanentlyDeleteTrashEntity(group) {
    const items = await api('/api/papelera-entidades');
    const item = items.find(row => row.grupo === group);
    if (!item) return;
    const effects = {
        artista: 'Se borrarán definitivamente el perfil, sus discos, canciones y audiovisuales relacionados de AudioTaller.',
        disco: 'Se borrarán definitivamente el disco y sus canciones de AudioTaller.',
        cancion: 'Se borrará definitivamente la canción y sus datos de AudioTaller.',
        audiovisual: 'Se borrará definitivamente esta producción audiovisual de AudioTaller.'
    };
    const detail = `${effects[item.tipo]}\n\nLas carpetas y archivos del equipo se conservarán. Esta acción no se puede deshacer.`;
    if (!await appConfirm({title:'Eliminar definitivamente',message:`¿Eliminar “${item.nombre}” de forma permanente?`,detail,confirmLabel:'Eliminar definitivamente'})) return;
    await api(`/api/papelera-entidades/${encodeURIComponent(group)}`, {method:'DELETE'});
    await loadTrash();
}

async function restoreTrashFile(identity) {
    await api('/api/papelera/' + identity + '/restaurar', body({}));
    await loadTrash();
}

async function permanentlyDeleteTrashFile(identity) {
    const files = await api('/api/papelera');
    const file = files.find(item => item.id === identity);
    if (!file) return;
    const effect = file.modo === 'vinculado'
        ? 'Solo se borrará el registro de AudioTaller. El archivo original en tu equipo permanecerá intacto.'
        : 'Se borrará definitivamente la copia administrada por AudioTaller si sigue dentro de la carpeta del proyecto. El original de origen no se toca.';
    const published = file.publicaciones
        ? '\n\nLas copias que ya están publicadas en el portal no se borrarán desde aquí.'
        : '';
    if (!await appConfirm({title: 'Eliminar definitivamente', message: `¿Eliminar “${file.nombre}” de forma permanente?`, detail: `${effect}${published}\n\nEsta acción no se puede deshacer.`, confirmLabel: 'Eliminar definitivamente'})) return;
    await api('/api/papelera/' + identity, {method: 'DELETE'});
    await loadTrash();
}
