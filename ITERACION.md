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
