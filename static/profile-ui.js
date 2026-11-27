// Perfil del productor o del estudio: bienvenida la primera vez y edición desde Configuración.
const prof = {data: null, logo: false, people: []};

async function loadProfile() {
    const r = await api('/api/perfil');
    prof.data = r.perfil || {}; prof.logo = r.logo; prof.people = (prof.data.productores || []).map(p => ({...p}));
    return r;
}
function profileForm(compact = false) {
    const p = prof.data || {}, studio = (p.tipo || 'productor') === 'estudio';
    const f = (name, label, attrs = '') => `<label class="fld">${label}<input name="${name}" value="${esc(p[name] || '')}" ${attrs}></label>`;
    return `<div class="pf-type">${[['productor', '🎧', 'Productor', 'Trabajo por mi cuenta: los presupuestos y mensajes salen con mi nombre.'],
        ['estudio', '🏠', 'Estudio', 'Somos un estudio con uno o más productores.']].map(([v, icon, t, d]) =>
        `<label class="pf-opt ${((p.tipo || 'productor') === v) ? 'is-on' : ''}"><input type="radio" name="tipo" value="${v}" ${((p.tipo || 'productor') === v) ? 'checked' : ''}><span class="pf-ico">${icon}</span><b>${t}</b><small>${d}</small></label>`).join('')}</div>
      <div class="pf-grid">
        <div class="pf-studio" ${studio ? '' : 'hidden'}>${f('estudio', 'Nombre del estudio', 'placeholder="Ej.: Estudio Bruma"')}</div>
        ${f('nombre', studio ? 'Tu nombre (responsable)' : 'Nombre', 'autocomplete="given-name"')}${f('apellido', 'Apellido', 'autocomplete="family-name"')}
        ${f('celular', 'Celular / WhatsApp', 'placeholder="+54 9 11 …" inputmode="tel"')}${f('email', 'Correo', 'type="email"')}
        ${compact ? '' : `${f('web', 'Página web', 'placeholder="www.tuestudio.com"')}${f('instagram', 'Instagram / redes', 'placeholder="@tuestudio"')}
        ${f('telefono', 'Otro teléfono')}${f('ciudad', 'Ciudad')}${f('direccion', 'Dirección')}${f('cuit', 'CUIT (opcional)')}`}
      </div>
      <div class="pf-people" ${studio ? '' : 'hidden'}><div class="pf-people-head"><b>Productores del estudio</b><button type="button" class="mk-btn" onclick="profAddPerson()">+ Agregar productor</button></div>
        <div id="pfPeople">${profPeopleRows()}</div></div>
      <div class="pf-logo"><div class="pf-logo-box" id="pfLogoBox">${prof.logo ? `<img src="/api/perfil/logo?${Date.now()}" alt="Logo">` : '<span>Sin logo</span>'}</div>
        <div><b>Logo</b><p class="insp-help">Aparece en los presupuestos. PNG o JPG; si tiene fondo transparente se pone sobre blanco.</p>
          <label class="mk-btn pf-file">Elegir imagen…<input type="file" accept="image/png,image/jpeg,image/webp" hidden onchange="profLogo(this.files[0]).catch(report)"></label>
          ${prof.logo ? '<button type="button" class="mk-btn" onclick="profLogoDelete().catch(report)">Quitar</button>' : ''}</div></div>`;
}
function profPeopleRows() {
    return prof.people.map((x, i) => `<div class="pf-person">${['nombre', 'apellido', 'rol', 'celular', 'email'].map(k =>
        `<input placeholder="${{nombre: 'Nombre', apellido: 'Apellido', rol: 'Rol (productor, ingeniero…)', celular: 'Celular', email: 'Correo'}[k]}" value="${esc(x[k] || '')}" oninput="prof.people[${i}].${k}=this.value">`).join('')}
        <button type="button" class="lyr-mini" aria-label="Quitar productor" onclick="prof.people.splice(${i},1);$('pfPeople').innerHTML=profPeopleRows()">✕</button></div>`).join('')
        || '<p class="insp-help">Sumá a los productores que trabajan en el estudio.</p>';
}
function profAddPerson() { prof.people.push({nombre: '', apellido: '', rol: 'Productor', celular: '', email: ''}); $('pfPeople').innerHTML = profPeopleRows(); }
function bindProfileForm(form) {
    form.querySelectorAll('input[name=tipo]').forEach(r => r.onchange = () => {
        const studio = r.value === 'estudio' && r.checked;
        form.querySelectorAll('.pf-opt').forEach(o => o.classList.toggle('is-on', o.querySelector('input').checked));
        form.querySelector('.pf-studio').hidden = !studio; form.querySelector('.pf-people').hidden = !studio;
        if (studio && !prof.people.length) profAddPerson();
    });
}
async function saveProfileForm(form) {
    const d = Object.fromEntries(new FormData(form));
    const r = await api('/api/perfil', body({...prof.data, ...d, productores: prof.people}));
    prof.data = r.perfil;
    return r;
}
async function profLogo(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(Error('No pude leer esa imagen.')); i.src = url; });
    const scale = Math.min(1, 900 / img.width, 400 / img.height);
    const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    await api('/api/perfil/logo', body({jpeg: canvas.toDataURL('image/jpeg', .92)}));
    prof.logo = true;
    $('pfLogoBox').innerHTML = `<img src="/api/perfil/logo?${Date.now()}" alt="Logo">`;
    notify('Logo guardado.');
}
async function profLogoDelete() { await api('/api/perfil/logo', body({borrar: true})); prof.logo = false; $('pfLogoBox').innerHTML = '<span>Sin logo</span>'; }

// Configuración: tarjeta del perfil
async function profileCardHtml() {
    await loadProfile();
    const p = prof.data, name = p.tipo === 'estudio' ? p.estudio : [p.nombre, p.apellido].filter(Boolean).join(' ');
    return `<section class="card pf-card" aria-labelledby="pfTitle"><div class="pf-card-row">${prof.logo ? `<img class="pf-mini" src="/api/perfil/logo?${Date.now()}" alt="">` : '<span class="pf-mini pf-mini-empty">🎧</span>'}
        <div><div class="eyebrow">Tu perfil · ${p.tipo === 'estudio' ? 'Estudio' : 'Productor'}</div><h2 id="pfTitle">${esc(name || 'Configurá tu perfil')}</h2>
          <p class="muted">${esc([p.celular, p.email, p.web].filter(Boolean).join(' · ') || 'Tus datos salen en los presupuestos, en el saludo de Inicio y en los mensajes al artista.')}</p></div></div>
        <button class="btn-primary" onclick="profileDialog().catch(report)">${p.configurado ? 'Editar perfil' : 'Configurar perfil'}</button></section>`;
}
async function profileDialog() {
    await loadProfile();
    formDialog('Tu perfil · productor o estudio', profileForm(false), async form => {
        await saveProfileForm(form instanceof HTMLFormElement ? form : $('iterationForm'));
        notify('Perfil guardado.');
        if ($('configPane') && !$('configPane').hidden) openConfig().catch(report);
    }, form => { bindProfileForm(form); $('iterationSubmit').textContent = 'Guardar perfil'; $('iterationDialog').classList.add('pf-dialog'); $('iterationDialog').addEventListener('close', () => $('iterationDialog').classList.remove('pf-dialog'), {once: true}); });
}

// Primera vez: bienvenida
async function maybeWelcome() {
    const r = await loadProfile().catch(() => null);
    if (!r || r.configurado || prof.data.omitido) return;
    let dialog = $('welcomeDialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'welcomeDialog'; dialog.className = 'welcome-dialog'; document.body.append(dialog); }
    dialog.innerHTML = `<form method="dialog" id="welcomeForm"><div class="wl-head"><div class="bars-logo">${'<i></i>'.repeat(5)}</div><div><div class="eyebrow">Bienvenido a AudioTaller</div>
        <h1>Contanos quién sos</h1><p class="muted">Con estos datos te saludamos, firmamos tus presupuestos y armamos los mensajes para tus artistas. Los podés cambiar cuando quieras desde Configuración.</p></div></div>
        ${profileForm(true)}
        <p class="error" id="welcomeError" role="alert"></p>
        <div class="app-confirm-actions"><button type="button" class="alt" id="welcomeLater">Más tarde</button><button type="submit" class="btn-primary">Guardar y empezar</button></div></form>`;
    const form = $('welcomeForm');
    bindProfileForm(form);
    $('welcomeLater').onclick = async () => { await api('/api/perfil/omitir', {method: 'POST'}).catch(() => {}); dialog.close(); };
    form.onsubmit = async event => {
        event.preventDefault();
        try { await saveProfileForm(form); dialog.close(); notify('¡Listo! Ya podés empezar.'); if (typeof renderHome === 'function' && trail.at(-1) === 'home') renderHome(); else go('home'); }
        catch (error) { $('welcomeError').textContent = error.message; }
    };
    dialog.showModal();
}
setTimeout(() => maybeWelcome().catch(() => {}), 600);
