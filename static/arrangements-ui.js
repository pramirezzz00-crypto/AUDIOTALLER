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
    const q = arr.q.toLowerCase();
    const song = arr.songs.find(s => s.id === arr.song);
    root.innerHTML = `
      <header class="prod-head"><div><div class="eyebrow">Arreglos</div><h1>${song ? esc(song.titulo) : 'Arreglos'}</h1>
        <p class="muted">Escuchá las pistas crudas sin abrir el DAW y armá una sesión nueva organizada por buses.</p></div></header>
      <div class="cr-layout">
        <aside class="cr-songs"><input id="arrQ" type="search" placeholder="Buscar canción…" value="${esc(arr.q)}">
          ${arr.songs.filter(s => !q || [s.titulo, s.artista, s.disco].join(' ').toLowerCase().includes(q)).map(s => `<button class="${s.id === arr.song ? 'is-on' : ''}" onclick="pickArrangementSong('${s.id}').catch(report)">
            <span><strong>${esc(s.titulo)}</strong><small class="muted">${esc([s.artista, s.disco].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</aside>
        <div class="arr-main">${song ? arrSongView() : '<p class="muted">Elegí una canción para ver sus pistas.</p>'}</div>
      </div>`;
    const input = $('arrQ');
    input.oninput = () => { arr.q = input.value; const pos = input.selectionStart; paintArrangements(); $('arrQ').focus(); $('arrQ').setSelectionRange(pos, pos); };
}
function arrSongView() {
    const m = arr.meta;
    const strip = m ? `<div class="arr-strip"><span>Obra <b class="mono ${m.iswc ? '' : 'warn-amber'}">${esc(m.iswc || 'sin ISWC')}</b></span>
        <span>Fonograma <b class="mono ${m.isrc ? '' : 'warn-amber'}">${esc(m.isrc || 'sin ISRC')}</b></span>
        <span>Autoría <b>${m.autores.length ? esc(m.autores.map(a => `${a.nombre} ${formatDecimal(a.porcentaje, 2)} %`).join(', ')) : '<span class="warn-amber">sin cargar</span>'}</b></span>
        <span>Créditos <b class="${Math.abs(m.total_autoria - 100) < 0.01 ? 'ok-green' : 'warn-amber'}">${formatDecimal(m.total_autoria, 2)} %</b></span>
        ${m.disco_id ? `<button class="btn-ghost" onclick="openCredits('${m.disco_id}').catch(report)">Créditos</button>` : ''}</div>` : '';
    return `${strip}<div class="seg tabs">${[['listen', 'Escuchar arreglos'], ['buses', 'Sesión por buses']].map(([id, label]) =>
        `<button class="${arr.tab === id ? 'is-on' : ''}" onclick="arr.tab='${id}';paintArrangements()">${label}</button>`).join('')}</div>
      ${!arr.tracks.length ? '<p class="muted">Buscando pistas… Si no aparece ninguna, vinculá la sesión de grabación o de mezcla en la canción.</p>' : arr.tab === 'listen' ? arrListen() : arrBuses()}`;
}
function arrVersionSet(name) {
    if (name === 'Base' || name === 'Todo lo grabado') return null;
    const version = arr.versions.find(v => v.nombre === name);
    return version ? new Set(version.pistas.map(p => p.nombre)) : null;
}
function arrAudible(track) {
    const set = arrVersionSet(arr.ab ? 'Base' : arr.version);
    if (set && !set.has(track.nombre)) return false;
    if (arr.solo.size) return arr.solo.has(track.token);
    return !arr.muted.has(track.token);
}
function arrListen() {
    const groups = {};
    arr.tracks.slice(0, ARR_MAX).forEach(t => (groups[t.bus || 'Sin reconocer'] ||= []).push(t));
    const versions = ['Base', ...arr.versions.map(v => v.nombre)];
    return `<div class="arr-transport card">
        <button class="t-play" onclick="arrToggle()" aria-label="${arr.playing ? 'Pausar' : 'Reproducir'}">${arr.playing ? '❚❚' : '▶'}</button>
        <span id="arrClock" class="mono">0:00</span><span class="ap-track" onclick="arrSeek(event)"><span id="arrProgress"></span></span>
        <label>Arreglo <select onchange="arr.version=this.value;arrApplyMix();paintArrangements()">${versions.map(v => `<option ${v === arr.version ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <button class="${arr.ab ? 'is-on' : ''} chip-btn" onclick="arr.ab=!arr.ab;arrApplyMix();paintArrangements()" title="Comparar con la Base sin cortar">A/B con Base</button>
        <button class="btn-ghost" onclick="saveArrangementVersion().catch(report)">Guardar lo que suena como arreglo</button></div>
      ${arr.tracks.length > ARR_MAX ? `<p class="insp-help">Se muestran ${ARR_MAX} de ${arr.tracks.length} pistas para que la escucha sea fluida.</p>` : ''}
      ${Object.entries(groups).map(([bus, list]) => `<section class="arr-group" style="--c:${arrBusColor(bus)}"><span class="insp-label">${esc(bus)}</span>
        ${list.map(t => `<div class="arr-track ${arrAudible(t) ? '' : 'is-muted'}"><span class="arr-name"><strong>${esc(t.nombre)}</strong><small>${esc(t.origen)}${t.par ? ' · ' + esc(t.par) : ''}</small></span>
          <button class="ms ${arr.muted.has(t.token) ? 'on-m' : ''}" onclick="arrMS('m','${t.token}')" aria-pressed="${arr.muted.has(t.token)}">M</button>
          <button class="ms ${arr.solo.has(t.token) ? 'on-s' : ''}" onclick="arrMS('s','${t.token}')" aria-pressed="${arr.solo.has(t.token)}">S</button></div>`).join('')}</section>`).join('')}
      <p class="insp-help">Pistas completas, sin efectos ni recortes, tal como quedaron en la carpeta de la sesión.</p>`;
}
function arrMS(kind, token) {
    const set = kind === 'm' ? arr.muted : arr.solo;
    set.has(token) ? set.delete(token) : set.add(token);
    arrApplyMix(); paintArrangements();
}
function arrEnsurePlayers() {
    for (const t of arr.tracks.slice(0, ARR_MAX)) {
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
    if ($('arrProgress') && lead.duration) $('arrProgress').style.width = (lead.currentTime / lead.duration * 100) + '%';
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
