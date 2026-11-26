// Portal de escucha del artista. Página estática sin secretos del productor: Firebase Auth y las
// reglas de Firestore controlan el acceso; los audios se leen por enlace público de Drive.
// Todo dato que llega de Firestore se muestra como texto (textContent), nunca como HTML.
'use strict';
const el = id => document.getElementById(id);
const portalId = location.pathname.split('/').filter(Boolean).at(-1);
const STATUS = {Pendiente: 'pendiente', 'En revisión': 'en-revision', Resuelta: 'resuelta', 'Sin cambios': 'sin-cambios'};
const STATUS_LABEL = {Pendiente: 'Pendiente', 'En revisión': 'En revisión', Resuelta: 'Resuelto', 'Sin cambios': 'Sin cambios'};
const STATUS_COLOR = {Pendiente: 'var(--bad)', 'En revisión': 'var(--warn)', Resuelta: 'var(--ok)', 'Sin cambios': 'var(--blue)'};
let config, account = null, data = null, items = [], notes = [], replies = {}, signature = '';
let current = 0, abSide = 'B', abPair = null, stampSec = 0, general = false, sending = false, seenAt = '';
const audio = el('audio');

const clock = s => { s = Math.max(0, Math.floor(Number(s) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const showError = message => { el('error').textContent = message || ''; };
const sessionKey = () => 'audiotaller-artist-' + config.projectId;
const seenKey = () => 'audiotaller-seen-' + portalId;
const driveUrl = id => 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&key=' + encodeURIComponent(config.driveApiKey);
const validDrive = id => /^[a-zA-Z0-9_-]{1,200}$/.test(id || '');
const plain = doc => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, Object.values(v)[0]]));
const store = {get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } }, set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch {} }, del: (k, s = localStorage) => { try { s.removeItem(k); } catch {} }};

// ── Acceso ──
async function authCall(operation, values) {
    const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:' + operation + '?key=' + encodeURIComponent(config.apiKey),
        {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(values)});
    const result = await response.json();
    if (!response.ok) throw Error('No se pudo ingresar. Revisá correo y contraseña o consultá a tu productor.');
    return result;
}
function saveAccount(value) { account = value; store.set(sessionKey(), JSON.stringify(value), sessionStorage); }
async function refreshAccount() {
    if (!account || account.expires > Date.now() + 60000) return;
    const response = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(config.apiKey),
        {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: account.refreshToken})});
    const value = await response.json();
    if (!response.ok) { logout(); throw Error('La sesión venció. Volvé a ingresar.'); }
    saveAccount({...account, idToken: value.id_token, refreshToken: value.refresh_token, expires: Date.now() + Number(value.expires_in) * 1000});
}
function logout() {
    audio.pause(); audio.removeAttribute('src'); account = null; data = null; signature = '';
    store.del(sessionKey(), sessionStorage);
    el('app').hidden = true; el('access').hidden = false; el('logout').hidden = true; el('who').textContent = ''; el('notice').hidden = true;
}
el('accessForm').onsubmit = async event => {
    event.preventDefault(); el('login').disabled = true; showError('');
    try {
        const email = el('email').value.trim();
        const value = await authCall('signInWithPassword', {email, password: el('password').value, returnSecureToken: true});
        saveAccount({idToken: value.idToken, refreshToken: value.refreshToken, uid: value.localId, email, expires: Date.now() + Number(value.expiresIn) * 1000});
        el('password').value = ''; await load();
    } catch (error) { showError(error.message); } finally { el('login').disabled = false; }
};
el('logout').onclick = logout;

// ── Datos ──
async function firestore(path, options = {}) {
    await refreshAccount();
    return fetch('https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(config.projectId) + '/databases/(default)/documents/' + path,
        {...options, headers: {Authorization: 'Bearer ' + account.idToken, ...(options.headers || {})}, cache: 'no-store'});
}
async function load() {
    if (!account || sending) return;
    try {
        const response = await firestore('portals/' + portalId);
        if (!response.ok) throw Error('Esta playlist venció, fue revocada o no corresponde a tu cuenta. Consultá a tu productor.');
        const doc = await response.json();
        const next = plain(doc);
        if (next.revoked || Date.parse(next.expiresAt) <= Date.now()) throw Error('Esta entrega ya no está vigente. Pedile a tu productor que la renueve.');
        await loadNotes();
        if (doc.updateTime === signature) { renderSide(); renderTracks(); return; }
        const first = !signature;
        signature = doc.updateTime; data = next;
        try { replies = JSON.parse(data.replies || '{}') || {}; } catch { replies = {}; }
        items = (JSON.parse(data.items || '[]') || []).filter(item => validDrive(item.driveId));
        if (/^#[a-f0-9]{6}$/i.test(data.color || '')) document.documentElement.style.setProperty('--accent', data.color);
        el('access').hidden = true; el('app').hidden = false; el('logout').hidden = false;
        el('who').textContent = account.email || '';
        el('sharedBy').textContent = '· compartido por ' + (data.producerName || 'tu productor') + ' · AudioTaller';
        el('title').textContent = data.title || 'Playlist';
        const until = new Date(data.expiresAt).toLocaleDateString('es-AR', {day: 'numeric', month: 'short'});
        const albums = [...new Set(items.map(i => i.disco).filter(Boolean))], artists = [...new Set(items.map(i => i.artista).filter(Boolean))];
        el('meta').textContent = [...albums, ...artists, items.length + (items.length === 1 ? ' audio' : ' audios'), 'disponible hasta el ' + until].join(' · ');
        el('expires').textContent = 'Este enlace vence el ' + until + '.';
        document.title = (data.title || 'Playlist') + ' · Portal de escucha';
        if (first) { seenAt = store.get(seenKey()) || ''; pick(Math.max(0, items.findIndex(i => notesFor(i).some(n => isFresh(n))))); }
        else if (!items[current]) pick(0); else { renderTracks(); renderSide(); setupAB(); }
        showNotice(); showError('');
    } catch (error) { showError(error.message); }
}
async function loadNotes() {
    let token = '', all = [];
    do {
        const query = new URLSearchParams({pageSize: '100'}); if (token) query.set('pageToken', token);
        const response = await firestore('portals/' + portalId + '/feedback?' + query);
        if (!response.ok) throw Error('No se pudieron cargar tus devoluciones.');
        const page = await response.json();
        all.push(...(page.documents || []).map(doc => ({...plain(doc), id: doc.name.split('/').at(-1)})));
        token = page.nextPageToken || '';
    } while (token);
    notes = all.filter(n => typeof n.body === 'string');
}
const reply = n => replies[n.id] || null;
const statusOf = n => (reply(n)?.status in STATUS) ? reply(n).status : 'Pendiente';
const isFresh = n => { const r = reply(n); return !!r && (r.reply || r.status !== 'Pendiente') && (!seenAt || String(r.repliedAt || '') > seenAt); };
const notesFor = item => notes.filter(n => n.songId ? n.songId === item.cancionId : n.audioId === item.id).sort((a, b) => (a.general ? -1 : 0) - (b.general ? -1 : 0) || Number(a.positionSeconds) - Number(b.positionSeconds));
const versionOf = label => String(label || '').split(' · ').slice(1, 3).filter(Boolean).join(' ') || 'una versión anterior';

function showNotice() {
    const fresh = notes.filter(isFresh);
    const box = el('notice');
    if (!fresh.length) { box.hidden = true; return; }
    box.replaceChildren();
    const text = node('span');
    text.append(node('b', '', (data.producerName || 'Tu productor') + ' respondió ' + fresh.length + (fresh.length === 1 ? ' devolución' : ' devoluciones')),
        document.createTextNode(fresh.some(n => reply(n)?.resolvedDriveId) ? '. Podés escuchar el antes y el después.' : '.'));
    const go = node('button', 'primary', 'Ver respuestas');
    go.onclick = () => { const i = items.findIndex(item => notesFor(item).some(isFresh)); if (i >= 0) pick(i); el('notes').scrollIntoView({behavior: 'smooth'}); markSeen(); };
    const close = node('button', 'link', 'Entendido'); close.onclick = markSeen;
    box.append(text, node('span', 'row')); box.lastChild.append(go, close); box.hidden = false;
}
function markSeen() {
    const latest = Object.values(replies).map(r => String(r.repliedAt || '')).sort().at(-1) || new Date().toISOString();
    store.set(seenKey(), latest); el('notice').hidden = true;
    setTimeout(() => { seenAt = latest; renderSide(); renderTracks(); }, 4000);
}

// ── Lista de audios ──
function renderTracks() {
    const box = el('tracks'); box.replaceChildren();
    items.forEach((item, i) => {
        const row = node('button', 'tr trk' + (i === current ? ' on' : ''));
        row.setAttribute('role', 'row'); row.setAttribute('aria-current', i === current ? 'true' : 'false');
        const mine = notesFor(item), fresh = mine.filter(isFresh).length;
        const counts = {}; mine.forEach(n => { counts[statusOf(n)] = (counts[statusOf(n)] || 0) + 1; });
        const summary = fresh ? fresh + (fresh === 1 ? ' respuesta nueva' : ' respuestas nuevas')
            : Object.entries(counts).map(([k, v]) => v + ' ' + STATUS_LABEL[k].toLowerCase()).join(' · ') || 'Sin devoluciones';
        const name = node('span'); name.append(node('b', '', item.titulo || item.nombre), node('small', '', [item.clase, item.version].filter(Boolean).join(' ') + (isNewVersion(item) ? ' · nueva versión' : '')));
        row.append(node('span', 'mono', String(i + 1)), name, node('span', 'sum' + (fresh ? ' new' : ''), summary), node('span', 'r mono', clock(item.duracion)));
        row.onclick = () => pick(i);
        box.append(row);
    });
}
const isNewVersion = item => Object.values(replies).some(r => r.resolvedAudioId === item.id || r.resolvedDriveId === item.driveId);

// ── Reproductor ──
function pick(i) {
    current = i; const item = items[i]; if (!item) return;
    audio.pause(); abPair = null; abSide = 'B';
    audio.src = driveUrl(item.driveId);
    el('nowTitle').textContent = [item.titulo, [item.clase, item.version].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    el('nowTag').hidden = !isNewVersion(item);
    el('tDur').textContent = clock(item.duracion); el('tNow').textContent = '0:00';
    if (!data.allowDownload) audio.setAttribute('controlsList', 'nodownload');
    setStamp(0); setGeneral(false);
    renderTracks(); renderSide(); setupAB(); drawWave();
}
function setupAB(pair) {
    const item = items[current];
    if (pair) abPair = pair;
    if (!abPair) {
        const older = notesFor(item).find(n => validDrive(n.driveId) && n.driveId !== item.driveId);
        abPair = older ? {a: older.driveId, aLabel: versionOf(older.audioLabel), b: item.driveId, bLabel: [item.clase, item.version].filter(Boolean).join(' ') || 'actual'} : null;
    }
    el('ab').hidden = !abPair;
    if (!abPair) return;
    el('abA').textContent = 'A · ' + abPair.aLabel; el('abB').textContent = 'B · ' + abPair.bLabel;
    el('abA').classList.toggle('on', abSide === 'A'); el('abB').classList.toggle('on', abSide === 'B');
}
function switchAB(side) {
    if (!abPair || side === abSide) return;
    const at = audio.currentTime || 0, playing = !audio.paused;
    abSide = side; audio.src = driveUrl(side === 'A' ? abPair.a : abPair.b);
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.min(at, audio.duration || at); if (playing) audio.play().catch(() => {}); }, {once: true});
    audio.load(); setupAB();
}
el('abA').onclick = () => switchAB('A'); el('abB').onclick = () => switchAB('B');
function drawWave() {
    const wave = el('wave'), item = items[current]; wave.replaceChildren();
    const duration = audio.duration || item.duracion || 1, pos = (audio.currentTime || 0) / duration;
    const peaks = Array.isArray(item.peaks) && item.peaks.length ? item.peaks : null;
    wave.classList.toggle('flat', !peaks);
    const top = peaks ? Math.max(...peaks.map(Number), 0.01) : 1;
    if (peaks) peaks.forEach((v, k) => { const bar = node('i', k / peaks.length < pos ? 'p' : ''); bar.style.height = Math.max(6, Number(v) / top * 100) + '%'; wave.append(bar); });
    else { wave.append(node('span', 'bar')); const fill = node('span', 'fill'); fill.style.width = (pos * 100) + '%'; wave.append(fill); }
    const head = node('span', 'head'); head.style.left = (pos * 100) + '%'; wave.append(head);
    notesFor(item).filter(n => !n.general && Number(n.positionSeconds) > 0).forEach(n => {
        const mk = node('button', 'mk'); mk.style.left = Math.min(100, Number(n.positionSeconds) / duration * 100) + '%';
        mk.style.background = STATUS_COLOR[statusOf(n)]; mk.title = clock(n.positionSeconds) + ' · ' + STATUS_LABEL[statusOf(n)] + ' · ' + n.body.slice(0, 80);
        mk.setAttribute('aria-label', 'Ir a tu devolución en ' + clock(n.positionSeconds));
        mk.onclick = event => { event.stopPropagation(); seek(Math.max(0, Number(n.positionSeconds) - 3)); };
        wave.append(mk);
    });
    wave.setAttribute('aria-valuenow', String(Math.round(audio.currentTime || 0))); wave.setAttribute('aria-valuemax', String(Math.round(duration)));
}
function seek(sec) { const d = audio.duration || items[current]?.duracion || 0; audio.currentTime = Math.max(0, Math.min(d || sec, sec)); setStamp(audio.currentTime); drawWave(); }
el('wave').addEventListener('pointerdown', event => {
    const rect = el('wave').getBoundingClientRect(), d = audio.duration || items[current]?.duracion || 0;
    if (!d) return; seek((event.clientX - rect.left) / rect.width * d);
});
el('wave').addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') { seek((audio.currentTime || 0) + 5); event.preventDefault(); }
    if (event.key === 'ArrowLeft') { seek((audio.currentTime || 0) - 5); event.preventDefault(); }
});
function togglePlay() { if (audio.paused) audio.play().catch(() => showError('No se pudo reproducir este audio. Reintentá o avisale a tu productor.')); else audio.pause(); }
el('play').onclick = togglePlay;
el('heroPlay').onclick = () => { if (!audio.src) pick(0); togglePlay(); };
el('back5').onclick = () => seek((audio.currentTime || 0) - 5);
audio.addEventListener('play', () => { el('play').textContent = '❚❚'; el('play').setAttribute('aria-label', 'Pausar'); el('heroPlay').textContent = '❚❚'; });
audio.addEventListener('pause', () => { el('play').textContent = '▶'; el('play').setAttribute('aria-label', 'Reproducir'); el('heroPlay').textContent = '▶'; if (!general) setStamp(audio.currentTime); });
audio.addEventListener('timeupdate', () => { el('tNow').textContent = clock(audio.currentTime); if (!general && !audio.paused) setStamp(audio.currentTime); drawWave(); });
audio.addEventListener('loadedmetadata', () => { el('tDur').textContent = clock(audio.duration); drawWave(); });
audio.addEventListener('ended', () => { if (current < items.length - 1 && abSide === 'B') { pick(current + 1); audio.play().catch(() => {}); } });
audio.addEventListener('error', () => { if (audio.getAttribute('src')) showError('No se pudo reproducir este audio. Reintentá o avisale a tu productor.'); });

// ── Comentar ──
function setStamp(sec) { stampSec = Math.max(0, sec || 0); if (!general) el('stamp').textContent = clock(stampSec); }
function setGeneral(on) {
    general = on; el('general').setAttribute('aria-pressed', String(on));
    el('stamp').textContent = on ? 'General' : clock(stampSec); el('stamp').classList.toggle('general', on);
    el('text').placeholder = on ? 'Escribí un comentario general sobre este audio…' : 'Escribí tu devolución sobre este momento…';
}
el('general').onclick = () => setGeneral(!general);
el('minus').onclick = () => { if (general) setGeneral(false); setStamp(stampSec - 1); };
el('plus').onclick = () => { if (general) setGeneral(false); setStamp(stampSec + 1); };
el('text').addEventListener('focus', () => { if (!audio.paused) audio.pause(); });
el('text').addEventListener('input', () => store.set('audiotaller-draft-' + portalId + '-' + (items[current]?.id || ''), el('text').value, sessionStorage));
el('composer').onsubmit = async event => {
    event.preventDefault();
    const text = el('text').value.trim(), item = items[current];
    if (!text || !item) return;
    if (!data.revision || !item.cancionId) { el('sendStatus').textContent = 'Tu productor tiene que volver a publicar esta playlist para habilitar devoluciones.'; return; }
    sending = true; el('send').disabled = true; el('sendStatus').textContent = 'Enviando…';
    const messageId = crypto.randomUUID();
    const name = 'projects/' + config.projectId + '/databases/(default)/documents/portals/' + portalId + '/feedback/' + messageId;
    try {
        await refreshAccount();
        const playing = abSide === 'A' && abPair ? {driveId: abPair.a} : null;
        const target = playing ? (notesFor(item).find(n => n.driveId === playing.driveId) || null) : null;
        // Se comenta siempre la versión actual de la playlist; si estabas en A, se aclara en el texto.
        const body = target ? text + '\n(escuchando la versión anterior: ' + versionOf(target.audioLabel) + ')' : text;
        const fields = {artistUid: {stringValue: account.uid}, audioId: {stringValue: item.id}, songId: {stringValue: item.cancionId},
            driveId: {stringValue: item.driveId}, revision: {integerValue: String(data.revision)},
            audioLabel: {stringValue: [item.titulo, item.clase, item.version, item.nombre].filter(Boolean).join(' · ')},
            body: {stringValue: body.slice(0, 4000)}, positionSeconds: {doubleValue: general ? 0 : stampSec}, general: {booleanValue: general}};
        const response = await fetch('https://firestore.googleapis.com/v1/projects/' + config.projectId + '/databases/(default)/documents:commit',
            {method: 'POST', headers: {Authorization: 'Bearer ' + account.idToken, 'Content-Type': 'application/json'},
             body: JSON.stringify({writes: [{update: {name, fields}, currentDocument: {exists: false}, updateTransforms: [{fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME'}]}]})});
        if (!response.ok) throw Error('No se pudo enviar. La entrega puede haber cambiado o vencido. Tu texto se conserva: reintentá o consultá a tu productor.');
        el('text').value = ''; store.del('audiotaller-draft-' + portalId + '-' + item.id, sessionStorage);
        el('sendStatus').textContent = '✓ Devolución enviada' + (general ? ' como comentario general.' : ' en el minuto ' + clock(stampSec) + '.') + ' Tu productor la ve en AudioTaller.';
        setGeneral(false); await loadNotes(); renderSide(); renderTracks(); drawWave();
    } catch (error) { el('sendStatus').textContent = error.message || 'No se pudo conectar. Tu texto se conserva.'; }
    finally { sending = false; el('send').disabled = false; }
};

// ── Panel de devoluciones ──
function renderSide() {
    const item = items[current]; if (!item) return;
    const mine = notesFor(item);
    el('sideTitle').textContent = 'Tus devoluciones en «' + (item.titulo || item.nombre) + '»';
    const counts = el('counts'); counts.replaceChildren();
    Object.keys(STATUS).forEach(k => { const n = mine.filter(x => statusOf(x) === k).length; if (!n) return;
        const c = node('span'); const dot = node('i'); dot.style.background = STATUS_COLOR[k]; c.append(dot, document.createTextNode(n + ' ' + STATUS_LABEL[k].toLowerCase())); counts.append(c); });
    const box = el('notes'); box.replaceChildren();
    if (!mine.length) box.append(node('p', 'muted', 'Todavía no dejaste devoluciones en este audio. Pausá en el momento que quieras comentar y escribí abajo.'));
    mine.forEach(n => {
        const st = statusOf(n), r = reply(n);
        const card = node('article', 'note s-' + STATUS[st] + (isFresh(n) ? ' fresh' : ''));
        const head = node('div', 'note-head');
        const time = node('button', 'note-time', n.general ? 'General' : clock(n.positionSeconds));
        time.title = 'Escuchar desde este momento';
        time.onclick = () => { if (!n.general) { seek(Math.max(0, Number(n.positionSeconds) - 3)); audio.play().catch(() => {}); } };
        head.append(time, node('span', 'st s-' + STATUS[st], STATUS_LABEL[st]));
        if (isFresh(n)) head.append(node('span', 'tag', 'respuesta nueva'));
        head.append(node('span', 'when', 'comentado en ' + versionOf(n.audioLabel)));
        card.append(head, node('p', '', n.body));
        if (r && r.reply) { const rp = node('p', 'reply'); rp.append(node('b', '', '↳ ' + (data.producerName || 'Productor') + ': '), document.createTextNode(r.reply)); card.append(rp); }
        if (r && validDrive(r.resolvedDriveId) && validDrive(n.driveId) && r.resolvedDriveId !== n.driveId) {
            const ba = node('button', 'ghost ba', '▶ Escuchar antes / después');
            ba.onclick = () => {
                abSide = 'A';
                setupAB({a: n.driveId, aLabel: 'Antes · ' + versionOf(n.audioLabel), b: r.resolvedDriveId, bLabel: 'Después · ' + (r.resolvedLabel || 'versión nueva')});
                audio.src = driveUrl(n.driveId);
                audio.addEventListener('loadedmetadata', () => { audio.currentTime = n.general ? 0 : Math.max(0, Number(n.positionSeconds) - 3); audio.play().catch(() => {}); }, {once: true});
                audio.load(); setupAB();
                el('player').scrollIntoView({behavior: 'smooth', block: 'center'});
                el('sendStatus').textContent = 'Comparando: tocá A y B para alternar en el mismo momento.';
            };
            card.append(ba);
        }
        box.append(card);
    });
}

// ── Inicio ──
(async () => {
    try {
        config = await (await fetch('/config.json', {cache: 'no-store'})).json();
        if (!config.projectId || !config.apiKey) throw Error('Tu productor todavía no configuró este portal.');
        if (!/^[a-f0-9]{32}$/.test(portalId || '')) throw Error('Abrí el enlace completo de la playlist que te compartió tu productor.');
        try { account = JSON.parse(store.get(sessionKey(), sessionStorage) || 'null'); } catch { account = null; }
        if (account) await load();
        // Revisa novedades cada minuto sin interrumpir lo que estás escribiendo.
        setInterval(() => { if (account && !el('text').value.trim()) load(); }, 60000);
    } catch (error) { showError(error.message); el('login').disabled = true; }
})();
