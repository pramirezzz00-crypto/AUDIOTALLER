// Reproductores con envolvente real, carga diferida y recursos locales.
let waveObserver;
const waveCleanups = [];
const waveCache = new Map();
let waveGeneration = 0;

function audioFilesMarkup(files, heading=true) {
    const audio = files.filter(file => file.disponible && /\.(wav|mp3|flac|ogg|m4a|aif|aiff|aac|opus)$/i.test(file.nombre));
    if (!audio.length) return '';
    return (heading ? '<h3>Audios de la etapa</h3>' : '') + audio.map(file => `
        <article class="wave-track" data-wave-file="${file.id}" data-wave-size="${file.tamano}"
                 data-wave-revision="${file.modificado || ''}">
          <div class="wave-track-head"><strong>♫ ${esc(file.nombre)}</strong><span class="audio-class">${esc(file.clase || ({demo:'Demo',maqueta:'Maqueta',grabacion:'Grabación',mezcla:'Mezcla',mastering:'Master'}[file.etapa] || 'Audio'))} ${esc(file.version_audio || file.version || '')}</span><button type="button" class="alt audio-star" data-star="${file.id}" aria-pressed="${!!file.favorito}" aria-label="Favorito: ${esc(file.nombre)}" onclick="toggleAudioFavorite('${file.id}',this).catch(report)">${file.favorito ? '★' : '☆'}</button><button type="button" class="alt" onclick="audioDetailsDialog('${file.id}').catch(report)">Clasificar / versión</button>
            <audio controls preload="metadata" aria-label="Reproducir ${esc(file.nombre)}"
                src="/api/produccion/archivo/${file.id}"></audio></div>
          <canvas class="wave-seek" tabindex="0" role="slider" aria-label="Posición de ${esc(file.nombre)}"
                  aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></canvas>
          <span class="wave-status" role="status">Cargando forma de onda…</span>
        </article>`).join('');
}

function disposeWavePlayers() {
    waveGeneration++;
    if (waveObserver) waveObserver.disconnect();
    for (const cleanup of waveCleanups.splice(0)) cleanup();
}

function setupWavePlayers(root) {
    const generation = waveGeneration;
    // Se carga solo la etapa visible, evitando decodificar todos los archivos de la canción.
    waveObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            waveObserver.unobserve(entry.target);
            bindWaveTrack(entry.target, generation);
        }
    });
    root.querySelectorAll('[data-wave-file]').forEach(track => waveObserver.observe(track));
}

async function bindWaveTrack(track, generation) {
    const audio = track.querySelector('audio');
    const canvas = track.querySelector('canvas');
    const status = track.querySelector('[role=status]');
    const abort = new AbortController();
    const cacheKey = [track.dataset.waveFile,track.dataset.waveSize,track.dataset.waveRevision].join(':');
    let envelope;
    let alive = true;
    let resize;
    let context;
    const current = () => alive && generation === waveGeneration && track.isConnected;
    function draw() {
        if (!current()) return;
        const bounds = canvas.getBoundingClientRect();
        if (!bounds.width) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(bounds.width * ratio);
        canvas.height = Math.round(90 * ratio);
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio,ratio);
        const middle = 45;
        ctx.strokeStyle = '#26262C';
        ctx.beginPath();
        ctx.moveTo(0,middle);
        ctx.lineTo(bounds.width,middle);
        ctx.stroke();
        if (!envelope) return;
        const progress = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
        const height = 37;
        const max = Math.max(...envelope.peaks, 0.01);
        for (let i = 0; i < envelope.peaks.length; i++) {
            const x = i / envelope.peaks.length * bounds.width;
            const amplitude = envelope.peaks[i] / max * height;
            ctx.strokeStyle = x <= progress * bounds.width ? '#2FD8BF' : '#3A3A42';
            ctx.beginPath();
            ctx.moveTo(x, middle-amplitude);
            ctx.lineTo(x, middle+amplitude);
            ctx.stroke();
        }
        ctx.fillStyle = '#EDEDF0';
        ctx.fillRect(progress * bounds.width, 3, 1, 84);
        canvas.setAttribute('aria-valuenow', Math.round(progress * 100));
        canvas.setAttribute('aria-valuetext', formatWaveTime(audio.currentTime) + ' de ' + formatWaveTime(audio.duration));
    }
    const timeUpdate = () => draw();
    const pauseOthers = () => document.querySelectorAll('main audio').forEach(other => {
        if (other !== audio) other.pause();
    });
    audio.addEventListener('play',pauseOthers);
    audio.addEventListener('timeupdate',timeUpdate);
    audio.addEventListener('loadedmetadata',timeUpdate);
    audio.addEventListener('error',() => { if (current()) status.textContent = 'No se pudo reproducir el audio. Revisá la ruta y el formato.'; });
    canvas.onclick = event => {
        if (!Number.isFinite(audio.duration)) return;
        const rect = canvas.getBoundingClientRect();
        audio.currentTime = Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)) * audio.duration;
        draw();
    };
    canvas.onkeydown = event => {
        if (!Number.isFinite(audio.duration) || !['ArrowLeft','ArrowRight','Home','End',' '].includes(event.key)) return;
        event.preventDefault();
        if (event.key === ' ') {
            if (audio.paused) audio.play().catch(() => {});
            else audio.pause();
        } else {
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? audio.duration :
                audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5);
            audio.currentTime = Math.max(0,Math.min(audio.duration,target));
            draw();
        }
    };
    waveCleanups.push(() => {
        alive = false;
        abort.abort();
        resize?.disconnect();
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (context && context.state !== 'closed') context.close().catch(() => {});
    });
    resize = new ResizeObserver(draw);
    resize.observe(canvas);
    draw();
    try {
        envelope = waveCache.get(cacheKey);
        if (!envelope) {
            const url = '/api/produccion/archivo/' + track.dataset.waveFile;
            const response = await fetch(url + '/onda',{signal:abort.signal});
            if (response.ok) {
                envelope = await response.json();
            } else if (response.status === 415) {
                // Los formatos comprimidos se decodifican con WebView2. Los WAV PCM se leen por bloques en Python.
                if (Number(track.dataset.waveSize) > 64 * 1024 * 1024) {
                    throw Error('La vista de onda de este formato admite hasta 64 MB. Podés usar el reproductor.');
                }
                await new Promise((resolve,reject) => {
                    if (audio.error) { reject(Error('No se pudo leer este formato de audio.')); return; }
                    if (audio.readyState >= 1) { resolve(); return; }
                    const done = () => { cleanup(); resolve(); };
                    const fail = () => { cleanup(); reject(Error('No se pudo leer este formato de audio.')); };
                    const cleanup = () => {
                        audio.removeEventListener('loadedmetadata',done);
                        audio.removeEventListener('error',fail);
                        abort.signal.removeEventListener('abort',fail);
                    };
                    audio.addEventListener('loadedmetadata',done,{once:true});
                    audio.addEventListener('error',fail,{once:true});
                    abort.signal.addEventListener('abort',fail,{once:true});
                });
                if (!current()) return;
                if (!Number.isFinite(audio.duration) || audio.duration > 1800) throw Error('La vista de onda de este formato admite hasta 30 minutos. Podés usar el reproductor.');
                context = new AudioContext({sampleRate:8000});
                const content = await fetch(url,{signal:abort.signal});
                if (!content.ok) throw Error('El archivo ya no está disponible.');
                const buffer = await context.decodeAudioData(await content.arrayBuffer());
                if (!current()) return;
                envelope = waveformEnvelope(buffer);
                await context.close();
            } else {
                throw Error('No se pudo cargar la forma de onda. Revisá la ruta del audio.');
            }
            if (!current()) return;
            waveCache.set(cacheKey,envelope);
            if (waveCache.size > 20) waveCache.delete(waveCache.keys().next().value);
        }
        if (current()) {
            status.textContent = formatWaveTime(envelope.duration) + ' · Tocá la onda para cambiar de posición';
            draw();
        }
    } catch (error) {
        if (current() && error.name !== 'AbortError') status.textContent = error.message || 'Este formato no permite mostrar la onda.';
    } finally {
        if (context && context.state !== 'closed') context.close().catch(() => {});
    }
}

function waveformEnvelope(buffer, bins = 1000) {
    const peaks = Array(bins).fill(0);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let bin = 0; bin < bins; bin++) {
            const start = Math.floor(bin * samples.length / bins);
            const end = Math.floor((bin+1) * samples.length / bins);
            let peak = peaks[bin];
            for (let i = start; i < end; i++) peak = Math.max(peak,Math.abs(samples[i]));
            peaks[bin] = peak;
        }
    }
    return {peaks,duration:buffer.duration};
}
function formatWaveTime(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    return Math.floor(seconds/60) + ':' + String(Math.floor(seconds%60)).padStart(2,'0');
}
