// Radar de músicos: directorios de instrumentistas y sesionistas para encontrar a quién convocar.
const RADAR = [
    {id: 'aadi', nombre: 'AADI · Guía Musical', url: 'https://www.aadim.org.ar/guiamusical', logo: '/static/entities/aadi.png', tipo: 'Gestión colectiva',
     texto: 'Directorio de intérpretes asociados a AADI que autorizaron publicar sus datos. Buscás por nombre, nombre artístico o instrumento.', tags: ['Intérpretes', 'Por instrumento', 'Argentina']},
    {id: 'solomusicos', nombre: 'Solo Músicos', url: 'https://www.solomusicos.com/ar/busca-musicos.php', sigla: 'SM', color: '#E5484D', tipo: 'Clasificados',
     texto: 'Avisos de músicos que buscan banda o proyecto, y de proyectos que buscan músicos.', tags: ['Músicos', 'Bandas', 'Avisos']},
    {id: 'sesionstack', nombre: 'SesionStack', url: 'https://sesionstack.com/', sigla: 'SS', color: '#7C5CFF', tipo: 'Directorio verificado',
     texto: 'Directorio verificado de músicos sesionistas, productores, ingenieros de mezcla y mastering, arregladores y más, con pedidos y pagos por la plataforma.', tags: ['Sesionistas', 'Verificados', 'Argentina']},
    {id: 'medioagudo', nombre: 'MedioAgudo', url: 'https://www.medioagudo.com/', sigla: 'MA', color: '#F5A524', tipo: 'Comunidad',
     texto: 'Músicos, bandas, salas de ensayo, estudios, docentes y servicios. Cualquiera puede publicar gratis para ser encontrado.', tags: ['Músicos', 'Estudios', 'Latinoamérica']},
    {id: 'guta', nombre: 'GUTA Música · Profesionales', url: 'https://guta.musica.ar/profesionales', sigla: 'GU', color: '#22B8CF', tipo: 'Directorio',
     texto: 'Listado de profesionales de la música.', tags: ['Profesionales', 'Argentina']},
    {id: 'buscarte', nombre: 'buscARTE', url: 'https://buscarte.com.ar/buscarte_busqueda', sigla: 'bA', color: '#E64980', tipo: 'Directorio gratuito',
     texto: 'Directorio gratuito de artistas y creativos de Argentina, con búsqueda por rubro, zona y especialidad.', tags: ['Artistas', 'Por zona', 'Argentina']},
];
const RADAR_OFFICIAL = {nombre: 'INAMU · Instituto Nacional de la Música', url: 'https://inamu.musica.ar', logo: '/static/entities/inamu.png',
    texto: 'Fuente oficial del registro de músicos y agrupaciones. Su padrón no es público: sirve para chequear que alguien esté registrado o para orientarte, no como directorio de contacto.'};

function radarLogo(r) {
    return r.logo ? `<span class="radar-logo"><img src="${r.logo}" alt=""></span>` : `<span class="radar-logo radar-mono" style="--c:${r.color}">${esc(r.sigla)}</span>`;
}
function paintRadar(root) {
    root.innerHTML = `${artistsTabsHeader()}
      <p class="muted radar-intro">¿Necesitás un bajista, una violinista o un percusionista para una sesión? Estos directorios reúnen instrumentistas y sesionistas. Se abren en tu navegador.</p>
      <div class="radar-grid">${RADAR.map(r => `<a class="radar-card" href="${r.url}" target="_blank" rel="noopener noreferrer">
          <div class="radar-top">${radarLogo(r)}<div><strong>${esc(r.nombre)}</strong><small>${esc(r.tipo)}</small></div><span class="radar-go">↗</span></div>
          <p>${esc(r.texto)}</p><div class="radar-tags">${r.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div></a>`).join('')}</div>
      <section class="radar-official">${radarLogo(RADAR_OFFICIAL)}<div><span class="eyebrow">Fuente oficial · sin acceso al padrón</span><strong>${esc(RADAR_OFFICIAL.nombre)}</strong>
        <p class="muted">${esc(RADAR_OFFICIAL.texto)}</p></div><a class="mk-btn" href="${RADAR_OFFICIAL.url}" target="_blank" rel="noopener noreferrer">Abrir sitio ↗</a></section>
      <p class="insp-help">Los directorios son de terceros: AudioTaller solo te lleva a ellos. Antes de guardar datos de contacto de alguien, pedile permiso.</p>`;
}
function artistsTabsHeader() {
    const radar = ppl.view === 'radar';
    return `<header class="prod-head"><div><div class="eyebrow">Proyectos artísticos y sus integrantes</div><h1>${radar ? 'Radar de músicos' : 'Artistas'}</h1></div>
        ${radar ? '' : '<div class="row"><button class="btn-primary" onclick="startWizard()">+ Nuevo artista</button></div>'}</header>
      <div class="mig-tabs" role="tablist"><button role="tab" class="${radar ? '' : 'is-on'}" aria-selected="${!radar}" onclick="ppl.view='';paintArtists()">Mis artistas</button>
        <button role="tab" class="${radar ? 'is-on' : ''}" aria-selected="${radar}" onclick="ppl.view='radar';paintArtists()">📡 Radar de músicos</button></div>`;
}
