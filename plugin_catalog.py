"""Plugins sugeridos: análisis, procesamiento gratuito y referencias (en su mayoría pagas).

Selección orientativa para mezcla. Los gratuitos marcados como automáticos los descarga AudioTaller del sitio oficial; el resto se descarga desde su ficha.
"""
import plugin_downloads


def item(nombre, fabricante, url, precio='Gratis', nota='', detectar=None):
    return dict(nombre=nombre, fabricante=fabricante, url=url, precio=precio, nota=nota, detectar=detectar or [nombre])

CATALOG = [
    dict(id='analisis', titulo='Análisis', descripcion='Para ver lo que escuchás: forma de onda, espectro, fase y nivel.', grupos=[
        dict(titulo='Forma de onda (osciloscopios)', items=[
            item('Schope', 'Stillwell Audio', 'https://www.stillwellaudio.com/plugins/schope/'),
            item('Wave Observer', 'Press Play', 'https://pressplay-music.com/wave-observer/')]),
        dict(titulo='Espectro', items=[
            item('SPAN', 'Voxengo', 'https://www.voxengo.com/product/span/', nota='Probablemente el mejor analizador de espectro en plugin. Tiene versión paga: SPAN Plus.'),
            item('TDR Prism', 'Tokyo Dawn Records', 'https://www.tokyodawn.net/tdr-prism/', nota='Analizador de espectro con funciones adicionales.', detectar=['TDR Prism'])]),
        dict(titulo='Fase (goniómetros y correlatores)', items=[
            item('MAAT GON', 'MAAT', 'https://www.maat.digital/gon/', nota='Goniómetro.', detectar=['MAAT GON']),
            item('MAAT 2BusControl', 'MAAT', 'https://www.maat.digital/2buscontrol/', nota='Correlador de fase y balance estéreo, con funciones de monitoreo.', detectar=['2BusControl']),
            item('Correlometer', 'Voxengo', 'https://www.voxengo.com/product/correlometer/', nota='Correlador multibanda.'),
            item('Stereo Tool', 'FLUX', 'https://www.flux.audio/project/stereo-tool-freeware/', nota='Alternativa: goniómetro.'),
            item('GonioMeter', 'ToneBoosters', 'https://www.toneboosters.com/tb_goniometer_v1.html', nota='Alternativa: goniómetro.')]),
        dict(titulo='Medidores de nivel', items=[
            item('mvMeter2', 'TBProAudio', 'https://www.tbproaudio.de/products/mvmeter2', nota='VU, RMS, EBU R128 y PPM con estética analógica.', detectar=['mvMeter']),
            item('Youlean Loudness Meter', 'Youlean', 'https://youlean.co/youlean-loudness-meter/', nota='Medidor LUFS con análisis offline.', detectar=['Youlean']),
            item('PAZ Analyzer', 'Waves', 'https://www.waves.com/plugins/paz-analyzer', precio='Pago', nota='Los PAZ Meters vienen dentro de PAZ Analyzer.', detectar=['PAZ']),
            item('VUMT', 'Klanghelm', 'https://klanghelm.com/contents/products/VUMT', precio='Pago', nota='Alternativa paga a mvMeter.')]),
    ]),
    dict(id='gratis', titulo='Procesamiento gratuito', descripcion='Poco conocidos e increíblemente musicales.', grupos=[
        dict(titulo='Colección', items=[
            item('Analog Obsession', 'Analog Obsession', 'https://analogobsession.com/', nota='Decenas de emulaciones analógicas gratuitas.', detectar=['AnalogObsession', 'Analog Obsession'])]),
        dict(titulo='Saturadores', items=[
            item('GSat+', 'TBProAudio', 'https://www.tbproaudio.de/products/gsatplus', nota='Saturador con oversampling.', detectar=['GSat']),
            item('IVGI', 'Klanghelm', 'https://klanghelm.com/contents/products/IVGI')]),
        dict(titulo='Compresores', items=[
            item('MJUC jr', 'Klanghelm', 'https://klanghelm.com/contents/products/MJUCjr', nota='Compresor de tipo variable-mu.', detectar=['MJUC']),
            item('DC1A', 'Klanghelm', 'https://klanghelm.com/contents/products/DC1A', nota='Simple y muy versátil.'),
            item('TDR Molotok', 'Tokyo Dawn Records', 'https://www.tokyodawn.net/tdr-molotok/', nota='Con carácter propio.', detectar=['Molotok']),
            item('TDR Kotelnikov', 'Tokyo Dawn Records', 'https://www.tokyodawn.net/tdr-kotelnikov/', nota='De banda ancha, versátil y transparente.', detectar=['Kotelnikov']),
            item('XTMax', 'Kiive Audio', 'https://www.kiiveaudio.com/products/xtmax', nota='Inspirado en el Distressor.')]),
        dict(titulo='Ecualizadores', items=[
            item('TDR Nova', 'Tokyo Dawn Records', 'https://www.tokyodawn.net/tdr-nova/', nota='Ecualizador dinámico y estático, muy musical.', detectar=['TDR Nova']),
            item('TDR VOS SlickEQ', 'Tokyo Dawn Records', 'https://www.tokyodawn.net/tdr-vos-slickeq/', nota='Semiparamétrico, extremadamente musical.', detectar=['SlickEQ']),
            item('Warmy EP1A', 'Kiive Audio', 'https://www.kiiveaudio.com/products/warmy-ep1a-v2', nota='Inspirado en el Pultec EQP-1A, con oversampling.', detectar=['Warmy'])]),
        dict(titulo='Varios', items=[
            item('Kilohearts Essentials', 'Kilohearts', 'https://kilohearts.com/products/kilohearts_essentials', nota='Serie de procesadores de interfaz limpia.', detectar=['kHs']),
            item('Baby Audio freebies', 'Baby Audio', 'https://babyaud.io/freebies', nota='Colección de efectos muy interesante.', detectar=['Baby Audio', 'BABY Audio'])]),
        dict(titulo='Reverbs', items=[
            item('Magic7', 'Wave Alchemy', 'https://www.wavealchemy.co.uk/product/magic7/', nota='Basada en la Bricasti M7.'),
            item('Valhalla Supermassive', 'Valhalla DSP', 'https://valhalladsp.com/shop/reverb/valhalla-supermassive/', nota='Reverb muy creativa.', detectar=['Supermassive']),
            item('Convology XT', 'Impulse Record', 'https://impulserecord.com/convology-xt/', nota='De convolución, con una biblioteca de impulsos enorme.', detectar=['Convology'])]),
        dict(titulo='Utilidad', items=[
            item('MSED', 'Voxengo', 'https://www.voxengo.com/product/msed/', nota='Codificador y decodificador M/S.'),
            item('MidSide Matrix', 'Goodhertz', 'https://goodhertz.com/midside-matrix/', nota='Matriz Mid/Side.', detectar=['MidSide Matrix', 'Midside']),
            item('Panipulator', 'Boz Digital Labs', 'https://www.bozdigitallabs.com/product/panipulator/', nota='Monitoreo en mono, pan law y otras funciones de escucha.'),
            item('ISOL8', 'TBProAudio', 'https://www.tbproaudio.de/products/isol8', nota='Divide el espectro en 5 bandas con solo y mute.')]),
    ]),
    dict(id='referencia', titulo='Referencias para mezcla', descripcion='Herramientas que se destacan por precisión o por su color. En su mayoría pagas; «Sugerido» indica una de varias versiones del mismo equipo.', grupos=[
        dict(titulo='Digitales (transparentes)', items=[
            item('Pro-Q 4', 'FabFilter', 'https://www.fabfilter.com/', precio='Pago', nota='Ecualizador y filtros.', detectar=['Pro-Q']),
            item('Pro-C 2 / Pro-C 3', 'FabFilter', 'https://www.fabfilter.com/', precio='Pago', nota='Compresor de banda única.', detectar=['Pro-C']),
            item('Pro-MB', 'FabFilter', 'https://www.fabfilter.com/', precio='Pago', nota='Compresor multibanda.'),
            item('Pro-G', 'FabFilter', 'https://www.fabfilter.com/', precio='Pago', nota='Compuerta y expansor.')]),
        dict(titulo='Ecualizadores por modelado', items=[
            item('Harrison 32C', 'Universal Audio', 'https://www.uaudio.com/products/harrison-32c', precio='Pago', nota='Sugerido.', detectar=['Harrison 32C', '32C']),
            item('Pultec EQP-1A y MEQ-5', 'Universal Audio', 'https://www.uaudio.com/products/pultec-passive-eq-collection', precio='Pago', nota='Sugerido.', detectar=['Pultec']),
            item('API 550', 'Universal Audio', 'https://www.uaudio.com/products/api-500-series-eq-collection', precio='Pago', nota='Sugerido (A o B).', detectar=['API 550']),
            item('Neve 1084', 'Universal Audio', 'https://www.uaudio.com/products/neve-1084-preamp-eq', precio='Pago', nota='Sugerido.', detectar=['1084'])]),
        dict(titulo='Compresores por modelado', items=[
            item('Teletronix LA-2A', 'Universal Audio', 'https://www.uaudio.com/products/teletronix-la-2a-collection', precio='Pago', nota='Sugerido (Grey y/o Silver).', detectar=['LA-2A', 'LA2A']),
            item('1176 LN', 'Universal Audio', 'https://www.uaudio.com/products/1176-collection', precio='Pago', nota='Sugerido (y/o Rev A).', detectar=['1176']),
            item('API 2500', 'Universal Audio', 'https://www.uaudio.com/products/api-2500-bus-compressor', precio='Pago', nota='Sugerido.', detectar=['API-2500', 'API 2500']),
            item('Fairchild 670', 'Universal Audio', 'https://www.uaudio.com/products/fairchild-tube-limiter-collection', precio='Pago', nota='Sugerido.', detectar=['Fairchild']),
            item('Neve 2254E', 'Plugin Alliance', 'https://www.plugin-alliance.com/products/254e', precio='Pago', nota='Sugerido.', detectar=['254E', '2254']),
            item('SSL 4000 G Bus Compressor', 'Universal Audio', 'https://www.uaudio.com/products/ssl-4000-g-series-bus-compressor', precio='Pago', nota='Sugerido.', detectar=['SSL G-Series Bus', 'SSL 4000 G Bus', 'SSL G Bus'])]),
        dict(titulo='Canales de consola', items=[
            item('SSL E Channel Strip', 'Universal Audio', 'https://www.uaudio.com/products/ssl-4000-e-series-channel-strip', precio='Pago', nota='Sugerido.', detectar=['SSL E']),
            item('bx_console SSL 4000 G', 'Plugin Alliance', 'https://www.plugin-alliance.com/products/bx_console-ssl-4000-g', precio='Pago', nota='Sugerido.', detectar=['bx_console SSL 4000 G']),
            item('Lindell 80 Series', 'Plugin Alliance', 'https://www.plugin-alliance.com/products/80-series', precio='Pago', nota='Recreación impresionante de consola Neve.', detectar=['80 Series']),
            item('API Vision Channel Strip', 'Universal Audio', 'https://www.uaudio.com/products/api-vision-channel-strip-collection', precio='Pago', detectar=['API Vision'])]),
        dict(titulo='Reverbs', items=[
            item('Lexicon 224', 'Universal Audio', 'https://www.uaudio.com/products/lexicon-224', precio='Pago', detectar=['Lexicon 224']),
            item('LX480', 'Relab Development', 'https://relabdevelopment.com/lx480-essentials/', precio='Pago', nota='Sugerido: Essentials o Dual-Engine.', detectar=['LX480']),
            item('Renaissance Reverb', 'Waves', 'https://www.waves.com/plugins/renaissance-reverb', precio='Pago', detectar=['RVerb', 'R-Verb']),
            item('AKG BX 20', 'Universal Audio', 'https://www.uaudio.com/products/akg-bx-20-reverb', precio='Pago', detectar=['BX 20', 'BX20']),
            item('Sunset Sound Studio Reverb', 'IK Multimedia', 'https://www.ikmultimedia.com/products/trsunsetsound/', precio='Pago', detectar=['Sunset Sound']),
            item('Sound City Studios', 'Universal Audio', 'https://www.uaudio.com/products/uad-sound-city-studios-plug-in', precio='Pago', detectar=['Sound City']),
            item('EMT 140', 'Universal Audio', 'https://www.uaudio.com/products/emt-140', precio='Pago', detectar=['EMT 140'])]),
    ]),
]


def norm(text):
    return ''.join(ch for ch in text.lower() if ch.isalnum())


def with_installed(installed_names):
    names = [norm(n) for n in installed_names]
    out = []
    for section in CATALOG:
        groups = []
        for group in section['grupos']:
            items = []
            for entry in group['items']:
                keys = [norm(k) for k in entry['detectar'] if len(norm(k)) >= 3]
                found = any(k in n for k in keys for n in names)
                items.append(dict(entry, instalado=found, automatico=plugin_downloads.available(entry["nombre"])))
            groups.append(dict(group, items=items))
        out.append(dict(section, grupos=groups))
    return out
