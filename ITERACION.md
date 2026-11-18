# Iteración de gestión y producción — 6 de noviembre de 2026

## Alcance por fase

| Fase | Archivos principales | Implementación y comprobación |
|---|---|---|
| A — análisis | Estado Git y respaldo automático | Se inspeccionó la instalación y se registró el estado inicial en la rama feature/gestion-y-produccion. Se ensayó la migración sobre una copia de la base real, comparando las filas de las tablas anteriores. |
| B — navegación | static/audio.html, navigation.js, management-ui.js | Pestañas Artistas y Proyectos con búsquedas separadas, breadcrumbs y panel de selección. Se comprobó el acceso desde la ventana de escritorio. |
| C — profesionales | management.py, migrations.py, management-ui.js | Roles múltiples, clasificaciones personalizadas, instrumentos, especialidades, participaciones históricas en grupos y créditos en producciones. Prueba integrada de altas y relaciones. |
| D — proyectos | management.py, projects.js | Exploración global de discos y canciones sueltas, acceso al disco y edición de la asociación canción/disco y del orden de pista. La prueba conserva identificador y carpeta al reasignar. |
| E — canción | production.py, workflow.js, iteration.css | Dos macroprocesos y cinco etapas con sesiones, tablas de archivos y notas independientes. Se abrió una canción y se guardó una sesión desde la ventana de escritorio. |
| F — DAW y trazabilidad | production.py, desktop.py | Selector local de archivos/carpetas, vínculos externos, DAW principal, importaciones, versiones de archivos y eventos persistidos. Las pruebas verifican rutas inaccesibles y que los originales vinculados no se modifican. |

Las fases B–F se integraron en un conjunto funcional verificado, para que los cambios de interfaz y los nuevos endpoints se incorporen juntos.

## Esquema añadido

Tablas nuevas, sin reemplazar las tablas anteriores:

- schema_audio, clasificaciones, roles_artista, etiquetas_artista.
- participaciones y creditos.
- etapas, sesion_info, archivos, eventos, notas_etapa, estado_cancion.

Las nuevas relaciones tienen referencias a los identificadores existentes. La migración crea un respaldo SQLite con fecha junto a la base antes de añadir estas tablas. Los roles anteriores Artista/Grupo/Banda se interpretan como Solista/Agrupación/Banda.

Los adjuntos históricos conocidos se catalogan sin trasladarlos. Los archivos que la versión anterior mezcló en produccion/Adjuntos se muestran como históricos sin asignarles arbitrariamente Mezcla o Mastering.

Las notas de etapa conservan borradores al alternar pestañas en la misma ventana. Guardar nota persiste el texto y agrega un evento. Los borradores no guardados requieren guardar antes de cerrar definitivamente.

## Pruebas

Ejecutar desde la carpeta del repositorio, con el entorno de AudioTaller:

    .venv\Scripts\python.exe -m unittest discover -s tests -v

La prueba utiliza una base anterior y archivos temporales. Comprueba migración y respaldo único, conservación de datos históricos, roles e integrantes, proyectos, reasignación de canción, sesiones, archivos importados y vinculados, notas, versiones y eventos. Se verificó la sintaxis de los archivos JavaScript. Se ensayó además la migración sobre una copia de la base real sin diferencias en los registros anteriores.

Se comprobó en una ventana pywebview de prueba la navegación Artistas/Proyectos → disco → canción, la distribución en dos macroprocesos y el guardado de sesión. La ventana de prueba se cerró correctamente.

## Límites actuales

- El vínculo DAW conserva una ruta. Las sesiones propietarias siguen siendo administradas por su DAW.
- Una sesión basada en otra registra un nuevo espacio de trabajo. La copia de medios o el guardado interno del DAW requieren una operación explícita en ese programa.
- El historial muestra eventos desde esta actualización. Los adjuntos antiguos se conservan sin inventar sus fechas originales de incorporación.
- La vista Archivos del perfil profesional sigue deshabilitada. Los archivos de canción se gestionan en sus etapas.
- Las mediciones LUFS, true peak y el procesamiento de audio quedan para una integración posterior.
- Las imágenes de artistas y discos provienen de la base local. Los componentes visuales funcionan con recursos locales.
- La revisión exhaustiva en diferentes resoluciones y con sesiones reales de cada DAW queda pendiente. La reproducción concreta depende del formato admitido por WebView2.


## Sesiones nativas, versiones y copia completa

La columna Versión conserva un número estable por canción, etapa y carpeta de proyecto. Para archivos anteriores se usa la fecha de creación disponible en Windows, con modificación como alternativa y orden de registro para archivos desconectados. Es un orden inferido de archivos, no una lectura del historial propietario del DAW. Las carpetas sin archivo de proyecto muestran un guion.

Nueva versión basada en esta crea una copia exclusiva del archivo junto al original con sufijo _V001, _V002, etc. Un nombre ocupado provoca elegir el siguiente número. Después de guardar se pregunta si se desea abrirla. Las carpetas de medios siguen compartidas con la sesión original.

Nueva sesión detecta DAW locales e iconos desde sus ejecutables. REAPER permite crear un proyecto vacío; Cubase y los otros formatos propietarios requieren una plantilla de proyecto nativo. Cubase 15 proporciona plantillas locales seleccionables. Se puede asociar otro ejecutable y una plantilla personalizada. La sesión se guarda antes de iniciar el DAW.

Incorporar producción a AudioTaller prepara una vista previa de carpetas, cantidad de archivos, tamaño y destino. La copia se ejecuta en segundo plano y verifica contenidos SHA-256 y que los orígenes no hayan cambiado. Copia cada carpeta fuente completa una vez, incluyendo las subcarpetas de audio y documentación. Reasocia las rutas en SQLite únicamente después de verificar y respaldar la base. Un fallo conserva las referencias originales y deja una carpeta parcial identificada. Se puede consultar progreso o reintentar desde el mismo botón.

Las referencias relativas internas se conservan. Las referencias absolutas o medios que estén fuera de las carpetas identificadas pueden requerir relocalizar en el propio DAW. AudioTaller no reescribe las referencias binarias internas de Cubase.

Las nuevas tablas de la migración 3 son revision_sesion, preferencias_daw y operaciones_archivo. La migración realiza un respaldo previo. Los filtros globales permiten combinar discos/canciones sueltas y estados; los estados de un disco se obtienen de sus canciones, por lo que puede figurar en más de un estado. Un disco sin canciones aparece Sin estado.

Las pruebas automatizadas incluyen copias con nombre ocupado, originales conservados, creación con plantilla, proyectos REAPER, copia completa y cancelación ante cambios de archivo. Se verificaron los iconos locales, la apertura de un proyecto vacío en REAPER y los filtros desde la ventana de escritorio. La apertura de plantillas Cubase y la relocalización de una producción real completa requieren todavía una comprobación con el usuario.

## Creación global, créditos e identificación para publicación

Proyectos ofrece Nuevo disco y Nueva canción suelta. Primero se elige el artista principal entre las fichas existentes; el formulario siguiente permite agregar músicos y equipo por referencia a sus fichas, con rol explícito. Al crear o editar un disco se pueden incorporar canciones sueltas del mismo artista. El disco también ofrece Incorporar canciones sueltas. Esta asociación conserva identificadores, notas, archivos, sesiones y créditos: no mueve carpetas ni toca rutas del DAW. Una canción incorporada deja de mostrarse como suelta. Cambiar su asociación posteriormente sigue disponible en Editar canción.

Los paneles Artistas y músicos permiten consultar, agregar y quitar créditos. Los cambios se guardan en una única transacción; cancelar no modifica créditos. Los créditos del disco se conservan a nivel de disco y no se atribuyen automáticamente a cada canción.

Las fichas nuevas abren en lectura y se habilitan con Modificar. Todos sus datos son opcionales:

- Identificación profesional: nombre legal, IPN, IPI Name/CAE, ISNI, sociedades de autores e intérpretes, número de socio/referencia, país y notas.
- Obra y grabaciones: título original, ISWC, idioma, género, editorial, sociedad, expediente local y titular/año © de la obra. La lista separada de grabaciones admite nombre, versión, ISRC, titular del máster ℗, año del fonograma, fecha de grabación, idioma, contenido explícito y notas. Cada fonograma conserva su identificador interno; no se interpreta cada versión del DAW como una grabación publicable.
- Ficha de lanzamiento: UPC/EAN, sello, catálogo, distribuidora, fecha, territorios, titular/año © y notas. Para un lanzamiento de una sola canción se puede crear un disco de tipo Single y asociarla.

Se revisaron fuentes oficiales: [SCAPR / IPN](https://www.scapr.org/Services/), [CISAC / IPI](https://www.cisac.org/services/information-services/ipi), [ISWC](https://www.iswc.org/iswc), [IFPI / ISRC y productos UPC/EAN](https://isrc.ifpi.org/faqs). ISRC identifica una grabación, ISWC una obra; IPN e IPI identifican personas o titulares en sus respectivos sistemas. ISNI es complementario. AudioTaller almacena códigos existentes y valida únicamente formatos básicos, sin asignar códigos, verificar titularidad ni registrar automáticamente ante organismos o distribuidoras. No exporta todavía una entrega de distribución.

Migración 4: registro_persona, registro_obra y registro_lanzamiento contienen fichas estructuradas independientes con claves foráneas; registro_grabacion permite varios fonogramas por canción. Se respalda SQLite antes de ampliar el esquema. No se convierten ni sobrescriben los metadatos libres anteriores.

Validación: 14 pruebas de servidor y comprobación con datos temporales en Edge WebView: creación global de disco, asociación de canción suelta, crédito, apertura en lectura, modificación y recuperación de ISWC/ISRC, independencia de notas de obra/grabación y cancelación de una eliminación de crédito.

## Vista de disco y nombre Producciones

La pestaña, el acceso de inicio y las rutas visibles ahora dicen Producciones. Los identificadores internos y las rutas API se conservan para mantener compatibilidad con los datos y funciones existentes.

Abrir un disco desde Producciones o su portada en el explorador del artista lleva a una pantalla independiente: portada cuadrada, nombre del disco como título, artista como subtítulo y canciones en una tabla a todo el ancho. La tabla incluye pista, título, artista, estado y duración cuando está registrada; las duraciones desconocidas se muestran como raya, sin inventarlas. Buscar en este disco filtra la lista. El título de cada canción y Abrir producción abren su flujo de trabajo.

Se mantienen Editar disco, Incorporar canciones sueltas, Ficha de lanzamiento, Artistas y músicos y Agregar canción. Editar/agregar actualiza la pantalla del disco. Atrás vuelve al origen de navegación; desde una canción regresa al disco. El nombre del artista permite abrir su ficha.

Comprobación en Edge WebView con base temporal: apertura directa desde Producciones sin pasar por el artista, portada cuadrada, lista debajo del encabezado, modificación del nombre, incorporación de una canción nueva, búsqueda sin resultados y navegación disco/canción/Atrás. Esta iteración solo cambia la interfaz; no modifica el esquema ni los archivos de producción.

## Ficha unificada, Catálogo y Playlist

La iteración siguiente agrega una ficha de canción con pestañas y guardado conjunto, letra, etiquetas y campos propios de nombre/valor, créditos y preparación editorial. El Catálogo relaciona los audios existentes con etapas, favoritos, clasificación, versiones y grabaciones publicables; permite filtros de metadata y reproducción con ondas. Las playlists ordenan referencias a esos archivos y preparan entregas de selección fija, clave opcional, caducidad, permiso de descarga y revocación. La vista del portal funciona localmente; todavía no se desplegó un servicio público.

La migración 5 conserva las filas anteriores y agrega cinco tablas con respaldo previo. La exportación prepara metadata JSON/CSV, letra y descripción; no sustituye la entrega a una distribuidora. La documentación, fuentes del benchmark, recorrido de uso y límites de alojamiento están en [BENCHMARK_Y_FLUJO.md](BENCHMARK_Y_FLUJO.md). Esta actualización sigue guardada localmente, sin publicar cambios en GitHub.

Corrección del inicio: la primera llamada de navegación espera DOMContentLoaded para que los módulos de audio y las constantes de redes sociales estén inicializados. Se reprodujo el error original en WebView (disposeWavePlayers aún no definido) y se comprobó el arranque corregido, la ficha y edición del artista con selector de redes y el acceso a Catálogo.

## Portal Firebase + Drive (piloto, configuración pendiente)

Se implementó publicación opcional de playlists en un sitio propio Firebase Hosting Spark, con Firebase Authentication para artistas y Firestore para selección/vigencia. Los audios se copian a Drive y se comparten por enlace público según la decisión del usuario. La consulta del portal requiere login, pero no se promete protección ni revocación de los enlaces directos de audio. Reemplazar la playlist conserva su dirección. La migración 6 agrega configuración, publicaciones y caché de copias remotas; las credenciales de Google se cifran con Windows DPAPI fuera de SQLite y del repositorio.

El código no crea un proyecto de Google ni activa facturación por sí solo. El 7 de noviembre se configuró el proyecto piloto `audiotaller-portal-artistas` en Spark y se autorizó la cuenta propietaria, con credenciales cifradas en Windows. La web y las reglas ya están desplegadas. Se publicó un tono sintético en una playlist de prueba aislada, sin subir canciones reales. Se verificó contra Google el ingreso, acceso denegado, vencimiento, revocación, restauración, URL estable y reutilización de copia. Drive devuelve el audio por rangos (206) y el usuario confirmó la escucha correcta en su navegador habitual; el navegador integrado de la herramienta presentó un fallo. Se corrigió la cabecera de referente para compatibilidad con la clave Drive restringida al dominio. La preparación inicial y los límites están en [PORTAL_FIREBASE.md](PORTAL_FIREBASE.md). La integración incluye un asistente en Playlist y se validó con 29 pruebas de servidor y ventanas de interfaz con servicios simulados.

## Devoluciones e invitaciones del portal

El portal reemplaza Abrir en Drive por notas debajo de cada audio, con momento de escucha opcional. El envío fija canción, audio, copia compartida, entrega y fecha del servidor; no se permite alterar comentarios existentes. La bandeja local descarga y conserva las devoluciones, con seguimiento Pendiente/En revisión/Resuelta y notas privadas, accesible desde Playlist y desde cada producción. Reemplazar la selección publicada conserva el enlace y el historial. La migración 7 agrega una tabla con respaldo y preserva las 35 tablas anteriores.

Publicar permite elegir al artista de la agenda, generar la contraseña y copiar una invitación completa para WhatsApp. Los accesos conocidos se guardan cifrados por usuario de Windows y se reutilizan al preparar otras entregas del mismo artista. No se envían mensajes automáticamente. Se simplificó el asistente y se agregó importación de perfil sin código. La versión universal para cualquier productor sigue pendiente de registrar/verificar el cliente OAuth común y resolver/probar el alta de espacios independientes: no se anuncia como completada.

Validación: 34 pruebas de servidor, interfaz local y formulario de artista con servicios simulados; envío real en navegador y sincronización contra Google en base de prueba. Las reglas reales bloquearon falta de login, audio ajeno, versión vieja y edición; aceptaron el comentario válido. Se versionan los recursos web y se revalida la caché para evitar mezclar formularios nuevos con JavaScript viejo. No se publicaron canciones reales ni cambios en GitHub.
