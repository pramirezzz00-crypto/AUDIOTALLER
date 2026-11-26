// Arreglos · escuchar las pistas crudas de la canción (multipista con M/S y versiones del arreglo)
// y armar una sesión nueva del DAW organizada por buses según un perfil editable.
const arr = {songs: [], song: '', tab: 'listen', tracks: [], buses: [], versions: [], version: 'Base', muted: new Set(), solo: new Set(),
    players: new Map(), playing: false, raf: 0, profiles: {}, profile: 'mezcla', meta: null, result: null, q: '', ab: false};
const ARR_MAX = 32;

async function openArrangements() {
    go('arrangements');
    await renderArrangementsPane();
}
async function renderArrangementsPane() {
    if (!arr.songs.length) arr.songs = await api('/api/arreglos/canciones').catch(() => []);
    if (!Object.keys(arr.profiles).length) arr.profiles = await api('/api/buses/perfiles').catch(() => ({}));
    paintArrangements();
}
async function pickArrangementSong(id) {
    arrStop();
    arr.song = id; arr.tracks = []; arr.result = null; arr.version = 'Base'; arr.muted.clear(); arr.solo.clear();
    paintArrangements();
    const [takes, meta, versions] = await Promise.all([api('/api/arreglos/canciones/' + id + '/tomas'), api('/api/creditos/' + id).catch(() => null),
        api('/api/arreglos/' + id + '/versiones').catch(() => [])]);
    arr.meta = meta; arr.versions = versions;
    let audio = takes.tomas.filter(t => /\.(wav|aif|aiff|flac)$/i.test(t.nombre));
    // Las pistas crudas salen de las carpetas de sesión; las mezclas de la carpeta de la canción no son pistas del arreglo.
    if (audio.some(t => t.origen !== 'Carpeta de la canción')) audio = audio.filter(t => t.origen !== 'Carpeta de la canción');
    const classified = await api('/api/arreglos/' + id + '/clasificar', body({perfil_id: arr.profile, pistas: audio}));
    arr.tracks = classified.pistas.map((t, i) => ({...t, origen: audio[i]?.origen || '', carpeta: audio[i]?.carpeta || ''}));
    arr.buses = classified.buses;
    paintArrangements();
}
function arrBusColor(name) { return arr.buses.find(b => b.nombre === name)?.color || '#8A8A94'; }
function paintArrangements() {
    const root = $('arrangements');
    const song = arr.songs.find(s => s.id === arr.song);
    if (!song) {
        root.innerHTML = `<header class="mk-head"><h1>Arreglos</h1><p class="muted">Escuchá las pistas crudas de cada canción sin abrir el DAW y armá una sesión nueva organizada por buses.</p></header>
          <div class="mk-tools"><label class="mk-search"><input id="arrQ" type="search" placeholder="Buscar canción, artista o disco" value="${esc(arr.q)}"></label></div>
          <div class="arr-pick">${arr.songs.filter(s => !arr.q || [s.titulo, s.artista, s.disco].join(' ').toLowerCase().includes(arr.q.toLowerCase())).map(s => `<button class="arr-song" onclick="pickArrangementSong('${s.id}').catch(report)">
            <span class="arr-cover" style="${placeholderArt(s.id, 'grabacion')}"></span><strong>${esc(s.titulo)}</strong><small>${esc([s.disco || 'Canción suelta', s.artista].join(' · '))}</small></button>`).join('') || '<p class="muted">No hay canciones.</p>'}</div>`;
        const input = $('arrQ');
        input.oninput = () => { arr.q = input.value; const pos = input.selectionStart; paintArrangements(); $('arrQ').focus(); $('arrQ').setSelectionRange(pos, pos); };
        return;
    }
    const m = arr.meta;
    const origins = [...new Set(arr.tracks.map(t => t.origen))];
    root.innerHTML = `<section class="arr-hero"><span class="arr-cover big" style="${placeholderArt(song.id, 'grabacion')}"></span>
        <div class="arr-title"><span class="eyebrow">Arreglos · grabaciones originales</span><h1>${esc(song.titulo)}</h1>
          <p class="muted">${esc([song.disco || 'Canción suelta', song.artista].join(' · '))}${m?.duracion ? ' · <span class="mono">' + esc(m.duracion) + '</span>' : ''}</p>
          ${m ? `<div class="arr-chips"><span class="mono ${m.iswc ? '' : 'warn'}">ISWC ${esc(m.iswc || 'falta')}</span><span class="mono ${m.isrc ? '' : 'warn'}">ISRC ${esc(m.isrc || 'falta')}</span>
            <span>Autoría: ${m.autores.length ? esc(m.autores.map(a => `${a.nombre} ${formatDecimal(a.porcentaje, 2)} %`).join(' · ')) : 'sin cargar'}</span>
            <span class="${Math.abs(m.total_autoria - 100) < 0.01 && !m.faltan.length ? 'ok' : 'warn'}">Créditos ${formatDecimal(Math.round((5 - Math.min(5, m.faltan.length)) / 5 * 100), 0)} %</span></div>` : ''}</div>
        <div class="arr-source"><label>Pistas tomadas de <select onchange="arr.origin=this.value;paintArrangements()"><option value="">Todas las sesiones</option>${origins.map(o => `<option ${arr.origin === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
          <small class="muted">Archivos crudos completos: sin efectos, sin recortes ni fundidos</small>
          <button class="link" onclick="arrStop();arr.song='';paintArrangements()">Cambiar de canción</button></div></section>
      <nav class="arr-tabs">${[['listen', 'Escuchar arreglos'], ['buses', 'Buses y sesión del DAW']].map(([id, label]) => `<button class="${arr.tab === id ? 'is-on' : ''}" onclick="arr.tab='${id}';paintArrangements()">${label}</button>`).join('')}</nav>
      ${!arr.tracks.length ? '<p class="muted arr-empty">Buscando pistas… Si no aparece ninguna, vinculá la sesión de grabación o de mezcla en la canción.</p>' : arr.tab === 'listen' ? arrListen() : `<div class="arr-pad">${arrBuses()}</div>`}`;
    if (arr.tab === 'listen') arrDrawWaves();
}
function arrSongView() { return ''; }
function arrVersionSet(name) {
    if (name === 'Base' || name === 'Todo lo grabado') return null;
    const version = arr.versions.find(v => v.nombre === name);
    return version ? new Set(version.pistas.map(p => p.nombre)) : null;
}
function arrInVersion(track) { const set = arrVersionSet(arr.ab ? 'Base' : arr.version); return !set || set.has(track.nombre); }
function arrAudible(track) {
    if (!arrInVersion(track)) return false;
    if (arr.solo.size) return arr.solo.has(track.token);
    return !arr.muted.has(track.token);
}
const arrLabel = name => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
function arrListen() {
    const order = arr.buses.map(b => b.nombre);
    const tracks = arr.tracks.filter(t => !arr.origin || t.origen === arr.origin).slice(0, ARR_MAX);
    const groups = {};
    tracks.forEach(t => (groups[t.bus || 'Sin reconocer'] ||= []).push(t));
    const sorted = Object.entries(groups).sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
    const versions = [['Base', 'Base · grabación', 'Lo que se grabó', tracks.length], ...arr.versions.map(v => [v.nombre, v.nombre, 'Arreglo guardado', v.pistas.length]), ['Todo lo grabado', 'Todo lo grabado', 'Todas las pistas de la sesión', arr.tracks.length]];
    const sounding = tracks.filter(arrAudible).length;
    return `<div class="arr-body"><aside class="arr-versions"><span class="eyebrow">Versiones del arreglo</span>
        ${versions.map(([id, name, desc, n]) => `<button class="arr-ver ${arr.version === id && !arr.ab ? 'is-on' : ''}" onclick="arr.version='${esc(id)}';arr.ab=false;arrApplyMix();paintArrangements()"><strong>${esc(name)}</strong><small>${esc(desc)}</small><small>${countLabel(n, 'pista', 'pistas')}</small></button>`).join('')}
        <button class="arr-save" onclick="saveArrangementVersion().catch(report)">+ Guardar la mezcla actual como arreglo</button>
        <div class="arr-compare"><strong>Comparar</strong><div class="seg"><button class="${arr.ab ? 'is-on' : ''}" onclick="arr.ab=true;arrApplyMix();paintArrangements()">A · Base</button><button class="${arr.ab ? '' : 'is-on'}" onclick="arr.ab=false;arrApplyMix();paintArrangements()">B · ${esc(arr.version)}</button></div>
          <small class="muted">Cambia entre arreglos sin cortar la reproducción.</small></div></aside>
      <section class="arr-tracks"><div class="arr-transport2"><button class="mk-bigplay" onclick="arrToggle()" aria-label="${arr.playing ? 'Pausar' : 'Reproducir'}">${arr.playing ? '❚❚' : '▶'}</button>
          <span class="arr-clock mono"><b id="arrClock">0:00</b> / <span id="arrTotal">—</span></span>
          <span>Sonando: <b>${esc(arr.ab ? 'Base' : arr.version)}</b> · ${sounding} de ${tracks.length} pistas</span><span class="spacer"></span>
          ${arr.solo.size ? '<button class="mk-btn" onclick="arr.solo.clear();arrApplyMix();paintArrangements()">Quitar solos</button>' : ''}</div>
        ${sorted.map(([bus, list]) => `<div class="arr-bus" style="--c:${arrBusColor(bus)}"><span class="arr-bus-name">${esc(bus)}</span>
          ${list.map(t => `<div class="arr-row ${arrAudible(t) ? '' : 'is-off'}"><i class="arr-bar"></i><span class="arr-name"><strong>${esc(arrLabel(t.nombre))}</strong><small class="mono">${esc(t.nombre)}</small></span>
            <button class="ms ${arr.muted.has(t.token) ? 'on-m' : ''}" onclick="arrMS('m','${t.token}')" aria-pressed="${arr.muted.has(t.token)}">M</button>
            <button class="ms ${arr.solo.has(t.token) ? 'on-s' : ''}" onclick="arrMS('s','${t.token}')" aria-pressed="${arr.solo.has(t.token)}">S</button>
            <canvas class="arr-wave" data-wave="${t.token}" onclick="arrSeekWave(event)"></canvas>${arrInVersion(t) ? '<span></span>' : '<small class="muted arr-out">fuera del arreglo</small>'}</div>`).join('')}</div>`).join('')}
      </section></div>`;
}
const arrPeaks = new Map();
async function arrDrawWaves() {
    const lead = [...arr.players.values()][0];
    const progress = lead?.duration ? lead.currentTime / lead.duration : 0;
    for (const canvas of document.querySelectorAll('canvas[data-wave]')) {
        const token = canvas.dataset.wave;
        if (!arrPeaks.has(token)) arrPeaks.set(token, api('/api/arreglos/onda/' + encodeURIComponent(token)).catch(() => ({peaks: []})));
        const data = await arrPeaks.get(token);
        if (!canvas.isConnected) continue;
        const box = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
        canvas.width = box.width * ratio; canvas.height = box.height * ratio;
        const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
        const color = getComputedStyle(canvas.closest('.arr-bus')).getPropertyValue('--c').trim() || '#8A8A94';
        const peaks = data.peaks || [], max = Math.max(...peaks, 0.01), bars = Math.floor(box.width / 6);
        const off = canvas.closest('.arr-row').classList.contains('is-off');
        for (let i = 0; i < bars; i++) {
            const v = peaks.length ? peaks[Math.floor(i / bars * peaks.length)] / max : 0.3;
            const h = Math.max(3, v * (box.height - 4));
            ctx.globalAlpha = off ? 0.18 : 1; ctx.fillStyle = color;
            ctx.fillRect(i * 6, (box.height - h) / 2, 4, h);
        }
        if (progress) { ctx.globalAlpha = 1; ctx.fillStyle = '#EDEDF0'; ctx.fillRect(progress * box.width, 0, 1.5, box.height); }
    }
}
function arrSeekWave(event) {
    const lead = [...arr.players.values()][0];
    if (!lead?.duration) { arrToggle(); return; }
    const box = event.currentTarget.getBoundingClientRect();
    const t = (event.clientX - box.left) / box.width * lead.duration;
    arr.players.forEach(p => { p.currentTime = t; });
    arrTick();
}
function arrMS(kind, token) {
    const set = kind === 'm' ? arr.muted : arr.solo;
    set.has(token) ? set.delete(token) : set.add(token);
    arrApplyMix(); paintArrangements();
}
function arrEnsurePlayers() {
    for (const t of arr.tracks.filter(t => !arr.origin || t.origen === arr.origin).slice(0, ARR_MAX)) {
        if (!arr.players.has(t.token)) { const a = new Audio('/api/arreglos/audio/' + encodeURIComponent(t.token)); a.preload = 'auto'; arr.players.set(t.token, a); }
    }
}
function arrApplyMix() { for (const t of arr.tracks) { const p = arr.players.get(t.token); if (p) p.muted = !arrAudible(t); } }
function arrToggle() {
    arrEnsurePlayers(); arrApplyMix();
    const players = [...arr.players.values()];
    if (arr.playing) { players.forEach(p => p.pause()); arr.playing = false; cancelAnimationFrame(arr.raf); }
    else { const t = players[0]?.currentTime || 0; players.forEach(p => { p.currentTime = t; p.play().catch(() => {}); }); arr.playing = true; arrTick(); }
    paintArrangements();
}
function arrTick() {
    const lead = [...arr.players.values()][0];
    if (!lead) return;
    // Corrige el desfase entre pistas cada cuadro (las pistas de una sesión arrancan juntas en 0:00).
    for (const p of arr.players.values()) if (Math.abs(p.currentTime - lead.currentTime) > 0.06 && !p.ended) p.currentTime = lead.currentTime;
    if ($('arrClock')) $('arrClock').textContent = clockText(lead.currentTime);
    if ($('arrTotal') && lead.duration) $('arrTotal').textContent = clockText(lead.duration);
    arr.frame = (arr.frame || 0) + 1; if (arr.frame % 15 === 0) arrDrawWaves();
    if (arr.playing) arr.raf = requestAnimationFrame(arrTick);
}
function arrSeek(event) {
    const lead = [...arr.players.values()][0]; if (!lead?.duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    const t = (event.clientX - box.left) / box.width * lead.duration;
    arr.players.forEach(p => { p.currentTime = t; });
    arrTick();
}
function arrStop() { arr.players.forEach(p => p.pause()); arr.players.clear(); arr.playing = false; cancelAnimationFrame(arr.raf); }
async function saveArrangementVersion() {
    const name = prompt('Nombre del arreglo (p. ej. «Arreglo de cuerdas», «Acústica»):');
    if (!name) return;
    const tokens = arr.tracks.slice(0, ARR_MAX).filter(arrAudible).map(t => t.token);
    await api('/api/arreglos/' + arr.song + '/versiones', body({nombre: name, pistas: tokens}));
    arr.versions = await api('/api/arreglos/' + arr.song + '/versiones');
    arr.version = name; arr.muted.clear(); arr.solo.clear();
    paintArrangements(); notify(`Arreglo «${name}» guardado con ${countLabel(tokens.length, 'pista', 'pistas')}.`);
}

// ── Sesión por buses ──
function arrBuses() {
    const profile = arr.profiles[arr.profile];
    const busNames = arr.buses.map(b => b.nombre);
    const versions = ['Todo lo grabado', ...arr.versions.map(v => v.nombre)];
    const set = arrVersionSet(arr.busVersion || 'Todo lo grabado');
    const list = arr.tracks.filter(t => !set || set.has(t.nombre));
    const unknown = list.filter(t => !t.bus).length;
    const bpm = arr.songs.find(s => s.id === arr.song)?.bpm;
    return `<div class="arr-buses">
      <div class="card arr-config">
        <div class="cr-grid"><label>Perfil<select onchange="arr.profile=this.value;pickArrangementSong(arr.song)">${Object.entries(arr.profiles).map(([id, p]) => `<option value="${id}" ${id === arr.profile ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
          <label>Desde el arreglo<select onchange="arr.busVersion=this.value;paintArrangements()">${versions.map(v => `<option ${v === (arr.busVersion || 'Todo lo grabado') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label>Etapa<select id="arrStage">${STAGE_ORDER.map(k => `<option value="${k}" ${k === 'mezcla' ? 'selected' : ''}>${esc(stageName(k))}</option>`).join('')}</select></label>
          <label>Nombre<input id="arrName" value="${esc(arr.busVersion && arr.busVersion !== 'Todo lo grabado' ? arr.busVersion : 'Arreglo')}"></label>
          <label>Tempo (BPM)<input id="arrTempo" inputmode="decimal" value="${esc(bpm || '120')}"></label></div>
        <span class="insp-label">DAW</span>
        <div class="daw-choice">
          <label><input type="radio" name="arrDaw" value="dawproject" checked><span><b>Cubase 14.0.20+ / Studio One / Bitwig</b><small>Archivo DAWproject · en Cubase: Archivo › Importar › DAWproject (Pro y Artist; no Elements)</small></span></label>
          <label><input type="radio" name="arrDaw" value="reaper"><span><b>REAPER</b><small>Proyecto .rpp con una carpeta por bus</small></span></label>
          <label class="is-disabled"><input type="radio" name="arrDaw" value="protools" disabled><span><b>Pro Tools</b><small>Necesita el Scripting SDK (PTSL) de Avid, gratuito: se habilita cuando esté instalado</small></span></label>
        </div>
        <span class="insp-help">Siempre se crea un proyecto NUEVO junto a la sesión: la original no se toca. Pistas crudas con nombre limpio, color y orden por bus; sin plugins. Queda registrada como versión adicional de la etapa.</span>
        ${unknown ? `<span class="warn-amber">${countLabel(unknown, 'pista sin reconocer', 'pistas sin reconocer')}: elegí su bus abajo (se aprende para la próxima).</span>` : ''}
        <button class="btn-primary" onclick="createBusSession().catch(report)">Crear sesión</button>
        ${arr.result ? `<div class="ok-green">✓ ${esc(arr.result.nombre)} creada con ${arr.result.buses} buses. <button class="link" onclick="openSong('${arr.song}').catch(report)">Ver en la canción</button></div>` : ''}
      </div>
      <div class="card"><div class="bus-head"><span>Pista</span><span>Bus</span><span>Detectado por</span></div>
        ${list.map(t => `<div class="bus-row ${t.bus ? '' : 'is-unknown'}" style="--c:${arrBusColor(t.bus)}"><span><strong>${esc(t.nombre)}</strong>${t.par ? `<span class="tag">${esc(t.par)}</span>` : ''}</span>
          <select data-bus="${t.token}" onchange="arrSetBus('${t.token}',this.value)"><option value="">¿A qué bus va?</option>${busNames.map(b => `<option ${b === t.bus ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
          <span class="muted">${t.palabra ? '«' + esc(t.palabra) + '»' : t.bus ? 'elegido a mano' : '—'}</span></div>`).join('')}
        <p class="insp-help">Perfil «${esc(profile?.nombre || '')}»: ${esc((profile?.buses || []).map(b => b.nombre).join(' · '))}. Reconoce pares L/R, DI + amplificador y multimicrófono por el nombre.</p></div>
    </div>`;
}
function arrSetBus(token, bus) {
    const t = arr.tracks.find(x => x.token === token);
    t.learned = !t.palabra && bus ? true : t.learned;
    t.bus = bus; paintArrangements();
}
async function createBusSession() {
    const daw = document.querySelector('[name=arrDaw]:checked').value;
    const set = arrVersionSet(arr.busVersion || 'Todo lo grabado');
    const list = arr.tracks.filter(t => !set || set.has(t.nombre));
    const missing = list.filter(t => !t.bus);
    if (missing.length && !confirm(`${countLabel(missing.length, 'pista no tiene bus', 'pistas no tienen bus')}: irán a «Otros». ¿Seguir?`)) return;
    const learn = {};
    for (const t of list.filter(t => t.learned && t.bus)) { const word = t.nombre.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-z0-9áéíóúñ]+/).filter(w => w.length > 2)[0]; if (word) learn[word] = t.bus; }
    arr.result = await api('/api/arreglos/' + arr.song + '/crear-sesion', body({daw, perfil_id: arr.profile, etapa: $('arrStage').value, nombre: $('arrName').value,
        tempo: $('arrTempo').value, pistas: list.map(t => ({token: t.token, bus: t.bus})), aprender: learn}));
    paintArrangements();
}
