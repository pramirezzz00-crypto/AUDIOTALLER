"""Entidades argentinas de la música: qué hace cada una, procedimientos y guías en PDF.

Los pasos son orientativos y se revisaron en noviembre de 2026. Requisitos y
aranceles cambian: cada guía remite al sitio oficial para confirmarlos.
"""
from datetime import date
from metadata_export import render_pdf

ENTITIES = {
    'dnda': dict(abbr='DNDA', name='Dirección Nacional del Derecho de Autor', kind='Organismo público · registro', color='#9B8CFF',
                 short='Registra obras y fonogramas: prueba de autoría y fecha', site='https://www.argentina.gob.ar/justicia/derechodeautor',
                 what='Es el registro público de la propiedad intelectual. Registrar una obra deja constancia de quién la creó y desde cuándo; registrar un fonograma protege la grabación.',
                 gives=['Constancia de autoría con fecha cierta', 'Registro de obras publicadas y de fonogramas', 'Custodia opcional de obras inéditas'],
                 stores='Número y fecha de registro de cada obra y fonograma, y el comprobante en PDF.',
                 procs=['dnda-inedita', 'dnda-publicada', 'dnda-fonograma']),
    'sadaic': dict(abbr='SADAIC', name='Sociedad Argentina de Autores y Compositores de Música', kind='Gestión colectiva · autores', color='#5AA7FF',
                   short='Cobra los derechos de autor de la obra (composición y letra)', site='https://www.sadaic.org.ar',
                   what='Recauda y reparte lo que se paga por usar tu obra: radio, TV, shows, plataformas y otros usos. Identifica cada obra con su ISWC.',
                   gives=['Cobro de derechos de autor', 'Código ISWC de cada obra', 'Número de socio e IPI'],
                   stores='Número de socio, IPI de cada autor, ISWC y el reparto declarado de cada obra.',
                   procs=['sadaic-socio', 'sadaic-obra']),
    'aadi': dict(abbr='AADI', name='Asociación Argentina de Intérpretes', kind='Gestión colectiva · intérpretes', color='#5ED17E',
                 short='Cobra lo que corresponde a quienes tocan o cantan en la grabación', site='https://aadim.org.ar',
                 what='Representa a intérpretes y ejecutantes: cobra cuando se comunica públicamente un fonograma en el que participaste.',
                 gives=['Cobro de derechos de intérprete', 'Registro de tu participación en cada fonograma'],
                 stores='Número AADI de cada intérprete y en qué canciones participó.',
                 procs=['aadi-socio', 'aadi-fonograma']),
    'capif': dict(abbr='CAPIF', name='CAPIF · Cámara Argentina de la Música Grabada', kind='Productores fonográficos · agencia ISRC', color='#FF6B8B',
                  short='Asigna códigos ISRC y gestiona los derechos del productor del fonograma', site='https://www.capifsgc.org.ar',
                  what='Es la agencia que asigna los códigos ISRC en Argentina y, a través de su gestión colectiva, cobra los derechos del productor del fonograma (quien paga la grabación).',
                  gives=['Código de productor ISRC', 'Cobro de derechos de productor fonográfico'],
                  stores='Tu código de registrante ISRC y el ISRC de cada fonograma.',
                  procs=['capif-isrc', 'capif-fonograma']),
    'inamu': dict(abbr='INAMU', name='Instituto Nacional de la Música', kind='Organismo público de fomento', color='#FFB547',
                  short='Fomento y registro de músicos y agrupaciones', site='https://inamu.musica.ar',
                  what='Fomenta la actividad musical con convocatorias, subsidios y formación. El registro de músicos habilita sus beneficios.',
                  gives=['Registro como músico o agrupación', 'Convocatorias y subsidios de fomento', 'Manuales de formación sobre derechos'],
                  stores='Tu número de registro y las convocatorias en las que participaste.',
                  procs=['inamu-registro']),
    'ama': dict(abbr='AMA', name='AMA · Agregadora de Música Argentina', kind='Distribuidora digital pública · INAMU', color='#FFB547',
                short='Sube tu música a las plataformas y liquida las escuchas', site='https://ama.musica.ar',
                what='Es la agregadora digital pública del INAMU: distribuye tus lanzamientos a las plataformas y tiendas digitales y te liquida lo que generan las escuchas. Retiene una comisión sobre lo liquidado (confirmá el porcentaje vigente).',
                gives=['Distribución a plataformas digitales', 'Liquidación de las escuchas', 'Carga con tu código de distribución'],
                stores='Tu código de distribución, los lanzamientos subidos y los reportes de liquidación importados.',
                procs=['ama-codigo', 'ama-lanzamiento', 'ama-migrar']),
}

GUIDES = {
    'dnda-inedita': dict(entidad='dnda', titulo='Registrar una obra inédita', cuando='Opcional · antes de publicarla',
        resumen='Deja la obra en custodia con fecha cierta. Sirve como prueba si alguien discute la autoría.',
        pasos=['Prepará la letra (si tiene) y la partitura o una grabación de referencia.',
               'Ingresá a Trámites a Distancia (TAD) con tu clave fiscal y buscá «Registrá tu primera canción» o el registro de obra inédita musical.',
               'Completá los datos de autores y adjuntá los archivos.', 'Pagá el arancel si corresponde y guardá el comprobante.',
               'Cargá el número de registro en AudioTaller (Créditos o Entidades).'],
        enlaces=['https://www.argentina.gob.ar/justicia/derechodeautor', 'https://tramitesadistancia.gob.ar']),
    'dnda-publicada': dict(entidad='dnda', titulo='Registrar una obra publicada', cuando='Obligatorio · al publicarla',
        resumen='Una obra publicada (por ejemplo, editada en un disco) debe registrarse en la DNDA.',
        pasos=['Tené a mano la ficha de la obra: título, autores, porcentajes y fecha de publicación.', 'Iniciá el trámite de registro de obra publicada por TAD.',
               'Adjuntá la ficha exportada desde AudioTaller («Registros DNDA / SADAIC») y la letra.', 'Guardá el comprobante y cargá el número en AudioTaller.'],
        enlaces=['https://www.argentina.gob.ar/justicia/derechodeautor', 'https://tramitesadistancia.gob.ar']),
    'dnda-fonograma': dict(entidad='dnda', titulo='Registrar un fonograma', cuando='Obligatorio · por lanzamiento',
        resumen='El fonograma (la grabación) también se registra. El fonograma digital se tramita 100 % en línea.',
        pasos=['Exportá la ficha del lanzamiento con ISRC de cada pista.', 'Reuní los audios masterizados y el arte de tapa.',
               'Iniciá el registro de fonograma por TAD y adjuntá audios, arte y ficha.', 'Guardá el comprobante y marcá el estado en Entidades.'],
        enlaces=['https://www.argentina.gob.ar/justicia/derechodeautor', 'https://tramitesadistancia.gob.ar']),
    'sadaic-socio': dict(entidad='sadaic', titulo='Asociarte a SADAIC', cuando='Una vez',
        resumen='Para cobrar derechos de autor necesitás ser socio o administrado.',
        pasos=['Revisá en el sitio de SADAIC los requisitos de admisión vigentes.', 'Presentá tu documentación personal y las obras que declarás.',
               'Recibí tu número de socio e IPI y cargalos en AudioTaller (Artistas › persona).'], enlaces=['https://www.sadaic.org.ar']),
    'sadaic-obra': dict(entidad='sadaic', titulo='Declarar una obra', cuando='Por canción',
        resumen='Se declara cada obra con sus autores y el reparto. SADAIC le asigna el ISWC.',
        pasos=['Completá en AudioTaller la autoría y el reparto (debe sumar 100 %).', 'Completá el boletín de declaración de obra de SADAIC con esos datos.',
               'Adjuntá la letra y, si te la piden, la partitura o la grabación.', 'Cuando te asignen el ISWC, cargalo en Créditos.'], enlaces=['https://www.sadaic.org.ar']),
    'aadi-socio': dict(entidad='aadi', titulo='Asociarte a AADI', cuando='Una vez por intérprete',
        resumen='Cada intérprete se asocia individualmente para cobrar por su participación.',
        pasos=['Revisá los requisitos en el sitio de AADI.', 'Presentá la documentación y obtené tu número de asociado.',
               'Cargá el número AADI de cada intérprete en Créditos.'], enlaces=['https://aadim.org.ar']),
    'aadi-fonograma': dict(entidad='aadi', titulo='Declarar participación en un fonograma', cuando='Por lanzamiento',
        resumen='Se informa quién tocó o cantó en cada grabación para repartir lo recaudado.',
        pasos=['Revisá en Créditos los intérpretes de cada canción.', 'Exportá la ficha del disco con intérpretes e ISRC.',
               'Presentala ante AADI según su procedimiento vigente.'], enlaces=['https://aadim.org.ar']),
    'capif-isrc': dict(entidad='capif', titulo='Pedir códigos ISRC', cuando='Una vez (código de registrante)',
        resumen='CAPIF es la agencia ISRC de Argentina. Con tu código de registrante podés asignar los ISRC de tus grabaciones.',
        pasos=['Escribí a isrc@capif.org.ar pidiendo tu código de registrante.', 'Asigná un ISRC distinto a cada grabación (cada versión es otro ISRC).',
               'Cargalos en Créditos › Fonograma. Si usás AMA u otra distribuidora, también pueden asignarlos.'], enlaces=['https://www.capifsgc.org.ar']),
    'capif-fonograma': dict(entidad='capif', titulo='Registrar fonogramas para gestión colectiva', cuando='Por lanzamiento',
        resumen='El productor fonográfico declara sus grabaciones para cobrar por su comunicación pública.',
        pasos=['Exportá la ficha del lanzamiento con ISRC y titular del master.', 'Presentala por la gestión colectiva de CAPIF.'], enlaces=['https://www.capifsgc.org.ar']),
    'inamu-registro': dict(entidad='inamu', titulo='Registrarte como músico o agrupación', cuando='Una vez',
        resumen='El registro habilita convocatorias y beneficios del INAMU.',
        pasos=['Ingresá al sitio del INAMU y completá el registro de músicos.', 'Si sos una agrupación, registrá también a cada integrante.',
               'Guardá tu número de registro en AudioTaller.'], enlaces=['https://inamu.musica.ar']),
    'ama-codigo': dict(entidad='ama', titulo='Obtener el código de distribución', cuando='Una vez',
        resumen='AMA otorga un código para cargar tus lanzamientos.',
        pasos=['Revisá en el sitio de AMA las convocatorias o el modo de solicitar el código.', 'Guardá el código en Configuración o en la ficha del artista.'], enlaces=['https://ama.musica.ar']),
    'ama-lanzamiento': dict(entidad='ama', titulo='Subir un lanzamiento', cuando='Por lanzamiento',
        resumen='Cargá audio, arte y metadatos con al menos cuatro semanas de anticipación.',
        pasos=['Exportá la metadata desde AudioTaller con la plantilla «AMA» (Excel).', 'Verificá portada 3000 × 3000 px, ISRC de cada pista y autores con porcentaje.',
               'Subí los WAV masterizados (sin pico verdadero por encima de −1 dBTP).', 'Elegí la fecha de salida y enviá a revisión.'], enlaces=['https://ama.musica.ar']),
    'ama-migrar': dict(entidad='ama', titulo='Migrar fonogramas desde otra distribuidora', cuando='Opcional',
        resumen='Para no perder escuchas ni listas, se migra con el mismo audio y los mismos metadatos.',
        pasos=['Usá exactamente el mismo audio, ISRC y UPC que en la distribuidora anterior.', 'Subí el lanzamiento en AMA indicando que es una migración.',
               'Esperá unos 20 días de convivencia antes de dar de baja la distribución anterior.'], enlaces=['https://ama.musica.ar']),
}


def guide_pdf(key):
    guide = GUIDES[key]
    entity = ENTITIES[guide['entidad']]
    blocks = [('kicker', f"Guía paso a paso · {entity['abbr']}"), ('title', guide['titulo']), ('p', f"{guide['cuando']}. {guide['resumen']}"),
              ('h', 'Pasos')]
    blocks += [('p', f'{index}. {step}') for index, step in enumerate(guide['pasos'], 1)]
    blocks += [('h', 'Enlaces oficiales')] + [('p', link) for link in guide['enlaces']]
    blocks += [('small', f'Guía armada por AudioTaller el {date.today().strftime("%d/%m/%Y")}. Requisitos y aranceles pueden cambiar: confirmalos en el sitio oficial antes de iniciar el trámite.')]
    return render_pdf(blocks, guide['titulo'])


def entities_payload():
    return [dict(id=key, **{k: v for k, v in value.items() if k != 'procs'},
                 procs=[dict(id=p, titulo=GUIDES[p]['titulo'], cuando=GUIDES[p]['cuando'], resumen=GUIDES[p]['resumen']) for p in value['procs']])
            for key, value in ENTITIES.items()]
