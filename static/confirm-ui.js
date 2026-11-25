function appConfirm({title = 'Confirmar acción', message, detail = '', confirmLabel = 'Confirmar', danger = true} = {}) {
    let dialog = document.getElementById('appConfirmDialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'appConfirmDialog';
        dialog.className = 'app-confirm';
        dialog.innerHTML = `<div class="app-confirm-icon" aria-hidden="true">!</div>
          <h2 class="app-confirm-title"></h2><p class="app-confirm-message"></p>
          <p class="app-confirm-detail"></p><div class="app-confirm-actions">
            <button type="button" class="alt" data-confirm-cancel>Cancelar</button>
            <button type="button" data-confirm-accept></button></div>`;
        document.body.append(dialog);
    }
    dialog.querySelector('.app-confirm-title').textContent = title;
    dialog.querySelector('.app-confirm-message').textContent = message || '';
    const detailNode = dialog.querySelector('.app-confirm-detail');
    detailNode.textContent = detail;
    detailNode.hidden = !detail;
    const accept = dialog.querySelector('[data-confirm-accept]');
    accept.textContent = confirmLabel;
    accept.classList.toggle('danger', danger);
    return new Promise(resolve => {
        let answer = false;
        const finish = value => {
            answer = value;
            if (dialog.open) dialog.close();
        };
        const onClose = () => {
            dialog.removeEventListener('close', onClose);
            resolve(answer);
        };
        dialog.addEventListener('close', onClose, {once: true});
        dialog.querySelector('[data-confirm-cancel]').onclick = () => finish(false);
        accept.onclick = () => finish(true);
        dialog.oncancel = event => { event.preventDefault(); finish(false); };
        dialog.showModal();
        accept.focus();
    });
}
