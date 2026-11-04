// El reproductor comparte transporte entre tomas para escuchar una a la vez.
let arrangementSongs = [];
let selectedArrangement;
let arrangementRequest = 0;

async function openArrangements() {
    go('arrangements');
    arrangementSongs = await api('/api/arreglos/canciones');
    renderArrangementSongs();
    $('arrangementSearch').focus();
}

function renderArrangementSongs() {
    const query = projectText($('arrangementSearch').value.trim());
    const songs = arrangementSongs.filter(song => projectText([song.titulo, song.artista, song.disco].join(' ')).includes(query));
    $('arrangementSongs').innerHTML = songs.map(song => `
        <div class="item"><div><strong>${esc(song.titulo)}</strong><br>
          <small class="muted">${esc([song.artista, song.disco].filter(Boolean).join(' · '))}</small></div>
          <button class="alt" aria-pressed="${song.id === selectedArrangement}" onclick="loadTakes('${song.id}')">Ver tomas</button>
        </div>`).join('') || '<p class="muted">No hay canciones que coincidan.</p>';
}

async function loadTakes(id) {
    const sequence = ++arrangementRequest;
    selectedArrangement = id;
    renderArrangementSongs();
    $('arrangementTitle').textContent = arrangementSongs.find(song => song.id === id)?.titulo || 'Tomas';
    $('refreshTakes').hidden = false;
    const player = $('takePlayer');
    player.pause();
    player.removeAttribute('src');
    player.load();
    $('takeTransport').hidden = true;
    $('arrangementTakes').replaceChildren();
    const status = $('arrangementStatus');
    status.textContent = 'Buscando archivos de audio…';
    try {
        const {tomas, carpetas_inaccesibles} = await api('/api/arreglos/canciones/' + id + '/tomas');
        if (sequence !== arrangementRequest) return;
        const summary = tomas.length ? countLabel(tomas.length, 'archivo de audio', 'archivos de audio') :
            'No se encontraron archivos de audio. Revisá la carpeta de la canción y las rutas de las sesiones vinculadas.';
        status.textContent = summary + (carpetas_inaccesibles ? ' · ' +
            countLabel(carpetas_inaccesibles, 'ruta inaccesible', 'rutas inaccesibles') : '');
        for (const take of tomas) {
            const row = document.createElement('div');
            row.className = 'item';
            row.innerHTML = `<div style="min-width:0;overflow-wrap:anywhere"><strong>${esc(take.nombre)}</strong><br>
                <small class="muted">${esc(take.origen)}${take.carpeta === '.' ? '' : ' · ' + esc(take.carpeta)}</small></div>
                <button class="alt" aria-label="Reproducir ${esc(take.nombre)}">▶ Play</button>`;
            row.querySelector('button').onclick = () => {
                $('takeTransport').hidden = false;
                $('takeNow').textContent = take.nombre;
                player.src = '/api/arreglos/audio/' + encodeURIComponent(take.token);
                player.play().catch(error => {
                    if (error.name !== 'AbortError') {
                        $('takeNow').textContent = take.nombre + ' · No se pudo reproducir este archivo.';
                    }
                });
            };
            $('arrangementTakes').append(row);
        }
    } catch (error) {
        if (sequence === arrangementRequest) status.textContent = error.message;
    }
}

$('arrangementSearch').oninput = renderArrangementSongs;
$('refreshTakes').onclick = () => loadTakes(selectedArrangement);
