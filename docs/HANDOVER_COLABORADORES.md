# AudioTaller — Handover para colaboradores e IAs

Fecha de corte: **18 de noviembre de 2026**. Versión del producto: **0.2.0 beta**.
Base de código integrada: **01ba742c89ab5eb68406381a35509aa31207c686**.

## 1. Por dónde empezar

- Repositorio principal: https://github.com/pramirezzz00-crypto/AUDIOTALLER
- **Rama que contiene la integración: `feature/gestion-y-produccion`.** No asumir que `main` contiene estos cambios.
- Código integrado: https://github.com/pramirezzz00-crypto/AUDIOTALLER/tree/feature/gestion-y-produccion
- ZIP: https://github.com/pramirezzz00-crypto/AUDIOTALLER/archive/refs/heads/feature/gestion-y-produccion.zip
- Prompt para iniciar otra IA: [PROMPT_PARA_IA.md](PROMPT_PARA_IA.md).

Este documento describe la **versión de desarrollo**. Un instalador descargado anteriormente puede contener una versión anterior del código aunque muestre el mismo número 0.2.0 beta. Para reproducir un cambio, registrar también su commit.

## 2. Objetivo del producto y decisiones del usuario

AudioTaller es una aplicación de escritorio para productores musicales: organiza personas, discos, canciones, sesiones de DAW, archivos y entregas de escucha al artista. Se busca que pueda descargarse y usarse gratis, con un flujo sencillo y una estética consistente de fondo oscuro y acentos turquesa.

El núcleo trabaja localmente. El portal de escucha es un complemento conectado a servicios de Google; no convertir toda la aplicación en un servicio web ni sustituir su tecnología sin acordar ese cambio.

Decisiones funcionales que deben conservarse:

- La navegación usa **Artistas y producciones**, **Arreglos**, **Composición**, **Entidades**, **Playlist** y **Catálogo**.
- Dentro de un disco, el encabezado corresponde al disco; el artista aparece como subtítulo y las canciones como listado.
- La ficha de canción reúne metadata, letra, créditos, publicación, etiquetas y notas.
- Preproducción y Producción se alternan con pestañas: no volver a poner ambos paneles completos en paralelo.
- Etapas: Demo, Maquetado, Grabación, Mezcla y Mastering. Cada una conserva sesiones y notas.
- Las sesiones del DAW conservan rutas y un registro de versiones; copiar una sesión no equivale a recrear su formato propietario.
- Los originales de audio y documentos se preservan. Distinguir **importar una copia** de **vincular un original**.
- Los códigos profesionales y editoriales son opcionales; no inventarlos ni generarlos como si fueran oficiales.
- Las listas de Beats de Composición son distintas de las playlists de entrega al artista.
- El usuario aceptó explícitamente que los audios del portal sean públicos por enlace en Drive. La contraseña restringe la consulta del portal, no vuelve privados los WAV.
- No enviar automáticamente correos ni WhatsApp: la app prepara una invitación que el productor copia y comparte.

## 3. Qué está implementado

| Área | Comportamiento actual |
|---|---|
| Personas | Artistas, bandas, músicos y otros roles; contactos, redes, instrumentos, especialidades, integrantes, participaciones y créditos. |
| Producciones | Discos y canciones sueltas; creación, asociación de canciones a disco, filtros por tipo y estado, ficha de lanzamiento y créditos. |
| Datos de canción | Edición por pestañas, letra, créditos, datos de obra y grabaciones, ISWC/ISRC cuando el usuario los tenga, exportación editorial ZIP. |
| Flujo de producción | Cinco etapas, importación/vínculos, notas, favoritos de archivos concretos, forma de onda y reproducción según el formato disponible. |
| DAW | Búsqueda de sesiones en carpeta, sesión válida por etapa, apertura en DAW, duplicación con versión, selección de plantilla y creación de sesión. REAPER admite proyecto vacío; otros DAW requieren plantilla nativa. |
| Organización de carpetas | Vista previa de copia completa, trabajo en segundo plano, verificación SHA-256 y reasociación de rutas después de verificar. No es una reescritura interna de los proyectos del DAW. |
| Arreglos | Exploración y escucha de tomas encontradas en las carpetas vinculadas; no realiza separación de instrumentos por IA. |
| Catálogo | Audios con clasificación y versión, favoritos, encabezados WAV y búsqueda por metadata, créditos, letra y etiquetas. |
| Playlist | Selección y orden de audios existentes; entregas locales y publicación web; actualización de la web manteniendo su dirección. |
| Portal del artista | Inicio con correo/contraseña, escucha, vencimiento, revocación y devoluciones por audio con momento de escucha opcional. |
| Devoluciones | Sincronización hacia AudioTaller y seguimiento privado del productor; conservar la referencia a la versión comentada. |
| Composición | Beats con listas independientes; Partituras PDF/PNG/JPG/JPEG; Letras TXT/DOCX por colecciones, orden, visores y apertura de ubicación original. No incluye un editor de letras ni de partituras. |
| Entidades | Logos y accesos a SADAIC, AADI, CAPIF SGC, INAMU y AMA; no ejecuta registros ni distribuye canciones automáticamente. |

## 4. Aportes integrados y procedencia

- **Zharelly:** https://github.com/zharevd/AUDIOTALLER1 — commit de referencia `7931e84`. Aportó Composición con Beats, Partituras y Letras.
- **Silvio:** https://github.com/silviohp2023-tech/AUDIOTALLER — commit de referencia `46ae0bc`. Aportó Entidades y sus logos.
- La integración se realizó sobre nuestra beta existente, sin sustituir sus módulos por las versiones anteriores de los forks.
- Detalle: [INTEGRACION_COMPOSICION_Y_ENTIDADES.md](INTEGRACION_COMPOSICION_Y_ENTIDADES.md).

Conflicto importante ya resuelto: el fork de Composición usaba una tabla `playlists` para Beats. Nuestra app ya usaba `playlists` para entregas. La integración usa tablas `composition_*` y conserva las playlists del portal.

## 5. Ejecutar desde el código

Usar **Python 3.12 o posterior**. La base se ha probado en Windows con Python 3.14 y el empaquetado Mac usa Python 3.12. `requirements.txt` contiene las dependencias de ejecución; no obliga a instalar herramientas de empaquetado.

```sh
git clone --branch feature/gestion-y-produccion --single-branch https://github.com/pramirezzz00-crypto/AUDIOTALLER.git
cd AUDIOTALLER
```

### Windows / PowerShell

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe desktop.py
```

También puede abrirse `Iniciar_AudioTaller.vbs`. El escritorio usa Edge WebView2; su instalación local debe estar disponible. La integración nativa de pywebview utiliza .NET en Windows.

### macOS

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python desktop.py
```

El escritorio Mac utiliza Cocoa/WebKit. `keyring` se instala solo en macOS para el Llavero. Los DAW deben estar instalados en cada computadora. Que exista una ruta alternativa para Linux en `runtime_paths.py` no significa que el lanzador Linux esté soportado o probado.

Para revisar únicamente la interfaz en el navegador puede ejecutarse `python app.py` y abrir `http://127.0.0.1:5000`. Los selectores y la apertura de carpetas que dependen del puente pywebview requieren la ventana de escritorio.

**Atención:** el arranque normal abre o crea los datos del usuario actual. Para pruebas funcionales usar las bases temporales de los tests o un perfil aislado; no experimentar sobre la biblioteca personal del productor.

## 6. Arquitectura y mapa de archivos

Aplicación Python/Flask + SQLite + pywebview. La interfaz local usa HTML, CSS y JavaScript, sin un proyecto React ni compilación Node obligatoria. Los scripts comparten funciones globales: el orden de carga importa.

| Archivo o carpeta | Responsabilidad |
|---|---|
| `desktop.py` | Ventana nativa, selectores de archivos, puente JS/Python y diagnósticos. |
| `runtime_paths.py` | Carpeta de datos por sistema y apertura nativa de archivos/DAW. |
| `app.py` | Aplicación Flask, conexión SQLite, rutas base y registro de módulos. |
| `migrations.py` | Ampliaciones del esquema, respaldo previo y serialización de migraciones. |
| `management.py` | Personas, roles, relaciones y gestión global de producciones. |
| `production.py` | Etapas, sesiones, archivo válido, archivos y notas de producción. |
| `daw_operations.py` | Detección/asociación de DAW, revisión estable y creación/copia de sesiones. |
| `folder_migration.py` | Plan y ejecución de la copia completa de carpetas con verificación. |
| `audio_waveform.py` | Lectura y preparación de formas de onda de audio compatible. |
| `publication.py` | Información profesional, editorial, grabaciones y lanzamientos. |
| `song_hub.py` | Ficha unificada de canción, guardado y exportación editorial. |
| `catalog.py` | Catálogo, metadata técnica, favoritos y playlists de entrega. |
| `composition.py` | Colecciones de Beats, Partituras y Letras; lectura de TXT/DOCX. |
| `listening_portal.py`, `portal_server.py` | Entregas locales y servidor público separado del prototipo local. |
| `cloud_auth.py` | OAuth de escritorio y almacenamiento protegido de credenciales. |
| `cloud_portal.py` | Publicación, subida a Drive, despliegue de Hosting y tareas. |
| `portal_feedback.py` | Recuperación de devoluciones y acceso a la invitación guardada. |
| `static/audio.html` | Estructura de las pantallas, controles y orden de scripts. |
| `static/navigation.js` | Estado de navegación, historial, `pages`, `go()`, breadcrumbs y auxiliares compartidos. |
| `static/workflow.js`, `session-operations.js`, `waveforms.js` | Interfaz de canción, sesiones, operaciones y audio. |
| `static/song-data.js`, `publication.js`, `album.js` | Ficha unificada y presentación del disco/lanzamiento. |
| `static/catalog-ui.js`, `cloud-ui.js` | Catálogo, playlists y asistente del portal. |
| `static/composition.js`, `composition.css` | Interfaz del aporte de Composición. |
| `static/entities/` | Cinco logos; nombres en minúsculas para funcionar en sistemas sensibles a mayúsculas. |
| `artist_web/public/` | Sitio estático del artista: `index.html`, `portal.js`, `portal.css`, configuración vacía de distribución. |
| `artist_web/firestore.rules` | Restricciones de acceso y creación de devoluciones. |
| `tests/` | Pruebas automatizadas con datos temporales y servicios simulados. |
| `packaging/`, `.github/workflows/macos.yml` | Empaquetado Windows y compilación nativa para las dos arquitecturas Mac. |

Al añadir una pantalla: registrar su sección en `audio.html`, incluirla en `pages`, ajustar navegación/breadcrumbs y carga de datos. Si recibe archivos del escritorio, revisar también los métodos expuestos por `desktop.py`.

## 7. Datos, esquema y compatibilidad

### Ubicaciones

- Windows: `%LOCALAPPDATA%\AudioTaller`.
- Mac: `~/Library/Application Support/AudioTaller`.
- Base: `audiotaller.sqlite3`.
- La instalación del programa y sus datos son independientes.
- El clon del repositorio no incluye la biblioteca de Pedro ni las rutas/archivos existentes de sus canciones.

### Esquema actual: versión 8

`schema_audio` registra la versión. Las migraciones son incrementales y crean respaldos SQLite con fecha antes de ampliar el esquema.

| Versión | Incorporación |
|---|---|
| 1–2 | Gestión, roles, créditos, etapas, archivos y selección de sesión válida. |
| 3 | Revisiones de sesiones, preferencias DAW y operaciones de carpetas. |
| 4 | Registros profesionales, obra, grabaciones y lanzamiento. |
| 5 | Ficha ampliada, catálogo, playlists, elementos y entregas locales. |
| 6 | Configuración/publicaciones del portal y referencias de Drive. |
| 7 | Devoluciones del artista y seguimiento del productor. |
| 8 | `composition_playlists`, `composition_beats`, `composition_score_collections`, `composition_scores`, `composition_lyric_collections`, `composition_lyrics`. |

No reutilizar `playlists` para Beats. No confundir el favorito de un audio con el favorito de todas las versiones de una canción. Mantener identificadores y relaciones al mover una canción de disco.

La actualización local de la integración se validó comparando los registros de las **36 tablas preexistentes** antes y después: se conservaron. Esto no reemplaza los respaldos que cada colaborador debe realizar sobre sus propios datos.

## 8. Portal web: modelo y estado real

Flujo: **AudioTaller local → copias autorizadas en Drive + documento de playlist en Firestore → web estática en Firebase Hosting**. Firebase Authentication autentica al artista. El productor administra/publica con su OAuth e IAM; el artista no recibe esos permisos.

- Servicios usados en el piloto: Hosting, Firestore, Authentication y Drive API. No introducir facturación, Cloud Storage, Functions o servidores pagos sin acordar el cambio.
- OAuth solicitado por el diseño actual: `drive.file` y `cloud-platform`. El segundo permiso es amplio: mantenerlo explícito, no expandirlo silenciosamente.
- Cada productor debe autorizar su propia cuenta. No distribuir la cuenta ni los tokens del desarrollador.
- Windows protege los secretos con DPAPI; Mac usa un backend explícito del Llavero. No agregar una alternativa en texto plano.
- Los archivos `portal-google.dpapi` y `portal-accesos.dpapi` son referencias del almacén local; en Mac las entradas se guardan en el Llavero, no como archivos DPAPI trasladables.
- El `config.json` del sitio que se distribuye en Git permanece vacío. La configuración real se prepara al instalar el portal del productor.
- La contraseña, el vencimiento y la revocación se validan con las reglas de Firestore. **No retiran el permiso público de los archivos de Drive.**
- La clave pública de reproducción tiene restricciones de API/origen. No cambiar la política de referencia del Hosting sin revisar esa compatibilidad.
- Actualizar una playlist conserva su dirección y el historial de devoluciones. No reinterpretar comentarios de una versión anterior como comentarios de un nuevo archivo.
- Las tareas de publicación viven en el proceso: cerrar AudioTaller interrumpe el trabajo. No se garantiza reanudación persistente de una subida a mitad de archivo.

**Estado al 18/11/2026:** además de la prueba de tono, se publicó una playlist real de dos WAV. Se verificaron inicio de sesión del artista, lectura autorizada en Firestore, respuesta de los dos audios y visualización de los campos de devolución. Se recuperó la configuración en la copia de desarrollo y se reconectó Google. No se incluyen aquí enlaces privados de escucha, usuarios, contraseñas, claves ni tokens.

**Alta universal pendiente:** el objetivo de que cualquier persona instale, conecte sus cuentas y publique sin preparación técnica todavía no está resuelto. Faltan el proceso de provisión de espacios y la verificación/distribución del cliente OAuth para usuarios externos al piloto. No presentar el asistente actual como un servicio universal listo.

Guías: [PORTAL_FIREBASE.md](../PORTAL_FIREBASE.md) y [PDF ilustrado](AudioTaller_Instructivo_Portal_del_Artista.pdf). Google puede modificar su consola: en la reconexión de noviembre ya no permitía recuperar un secreto de cliente anterior y fue necesario generar uno nuevo con autorización del propietario. No solicitar claves por chat ni incorporarlas a documentos.

## 9. Pruebas y validación

Desde la raíz del repositorio:

```powershell
# Windows
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
```

```sh
# Mac
.venv/bin/python -m unittest discover -s tests -q
```

Resultado comprobado para la integración: **40 pruebas correctas en Windows**. Cubren migraciones, sesiones, copia de carpetas, metadata, catálogo, entrega editorial, portal/devoluciones simulados, Composición y soporte por plataforma. En Mac hay pruebas específicas de DPAPI que se omiten por diseño. Los tests no deben publicar canciones ni modificar cuentas reales.

Comprobación opcional de sintaxis, si Node está instalado:

```sh
node --check static/navigation.js
node --check static/composition.js
```

Recorrido manual mínimo para cambios de interfaz:

1. Inicio → Artistas → ficha; volver a Producciones → disco → canción.
2. Alternar Preproducción/Producción y las etapas; comprobar notas y sesión válida.
3. Catálogo → favoritos → Playlist: conservar asociaciones y orden.
4. Composición: crear lista/colección, agregar archivo, seleccionarlo y ordenar; comprobar que quitarlo de la colección conserva el original.
5. Abrir Partituras y Letras; comprobar acentos, archivos ausentes y DOCX inválido.
6. Entidades: comprobar los cinco logos y sus destinos, con nombres de archivo exactos.
7. Para cambios del portal: usar un proyecto propio y material sintético; revisar reglas, acceso, audio y devoluciones. La prueba contra Google real requiere autorización separada.

Diagnósticos de escritorio para quien trabaje en empaquetado: `desktop.py --self-test <informe.json>` y `--smoke-test <informe.json>`. Usan bases temporales; en Mac el primero comprueba también el Llavero con un dato sintético temporal y el segundo abre una ventana real. Necesitan un entorno con los componentes nativos correspondientes.

## 10. Instaladores y comprobaciones por plataforma

- Windows: PyInstaller + Inno Setup; consultar [packaging/README.md](../packaging/README.md). El instalador beta existente no tiene firma de editor.
- Mac: DMG por arquitectura `arm64` y `x86_64`, instalación arrastrando la app a Aplicaciones. Compilación en GitHub Actions, no desde Windows.
- El workflow usa `macos-15` y `macos-15-intel`, Python 3.12 y artefactos con retención de 30 días. Los cambios de Python/interfaz en la rama de integración pueden dispararlo automáticamente.
- La compilación Mac anterior a Composición pasó pruebas de paquete, ventana y Llavero en ambas arquitecturas. Se recibió una captura de la app ejecutándose en una Mac, pero no constituye una validación completa con DAW y portal.
- Al preparar este handover, el workflow de la integración `01ba742` estaba **en cola**: https://github.com/pramirezzz00-crypto/AUDIOTALLER/actions/runs/44426656400 . No afirmar que terminó hasta comprobar su resultado.
- No hay Developer ID/notarización de Apple. No prometer ausencia de advertencias al instalar.
- No regenerar ni publicar instaladores por un cambio de documentación. No confundir un artefacto temporal de Actions con una release permanente.

## 11. Pendientes y mejoras propuestas

Estas son propuestas de continuidad, no funciones ya terminadas ni autorización para desplegar servicios:

1. **Onboarding del portal:** preparar y probar la instalación con una cuenta de productor nueva; simplificar recuperación de conexión y resolver la distribución/verificación OAuth.
2. **Integración Composición–canción:** hoy las colecciones son independientes. Definir cómo asociar una letra, partitura o beat a una canción sin duplicar ni sobrescribir su ficha.
3. **Experiencia de importación en Composición:** hoy se agregan originales mediante el selector nativo; el arrastre sirve para reordenar filas. Si se incorpora arrastre desde el explorador, diferenciarlo de reordenar y conservar los originales.
4. **Validación real en Mac y otras PCs:** DAW instalados, medios externos, rutas con acentos, formatos, OAuth y actualización del programa conservando datos.
5. **Publicación robusta:** progreso persistente, recuperación tras cierre y reglas explícitas de mantenimiento de copias antiguas de Drive, sin borrados silenciosos.
6. **Calidad y distribución:** completar pruebas con cuentas independientes y evaluar firmas de Windows/Mac antes de una distribución amplia.
7. **Audio y arreglos:** LUFS/true peak, formatos adicionales y separación por IA no están implementados; evaluar alcance y dependencias antes de prometerlos.
8. **Deuda de interfaz:** JS compartido y algunos módulos densos; mejorar gradualmente sin reescribir todo ni romper el puente nativo.

## 12. Forma recomendada de colaborar con otra IA

1. Partir de la rama integrada y crear una rama por tarea. Si se trabaja desde un fork, añadir el repositorio principal como remoto y traer esa rama primero.
2. Pedir a la IA que lea este documento, los archivos afectados y los tests antes de proponer cambios. Darle una tarea concreta y criterios de aceptación.
3. Respetar el estilo existente y los contratos de API. No hacer un reemplazo completo de `app.py`, `audio.html` o `navigation.js` con las versiones antiguas de los forks.
4. Probar con bases y archivos temporales. Toda ampliación de datos requiere una migración compatible y un respaldo; no editar a mano la base de otra persona.
5. Ejecutar los tests correspondientes y un recorrido manual del flujo modificado. Informar qué se verificó y qué quedó sin probar.
6. Abrir un PR hacia `feature/gestion-y-produccion`, con resumen, pruebas y cualquier migración necesaria. Resolver conflictos conservando funciones de ambos aportes.
7. No adjuntar `.venv`, SQLite, audios, rutas privadas, `*.dpapi`, JSON de clientes OAuth, cuentas de servicio ni contraseñas. Revisar los archivos preparados antes de hacer push.
8. Los cambios de código locales no autorizan publicar música real, alterar permisos de Google, usar las cuentas del productor ni enviar invitaciones a terceros.

### Qué entregar con cada cambio

- Problema resuelto y comportamiento final.
- Archivos principales y cambios de datos/API, si existen.
- Pruebas ejecutadas y resultado.
- Capturas de la interfaz cuando cambie el flujo visual.
- Límites y pasos pendientes, distinguiéndolos de lo ya implementado.

## 13. Lectura complementaria y vigencia

- [README](../README.md): ejecución general.
- [Integración de aportes](INTEGRACION_COMPOSICION_Y_ENTIDADES.md): procedencia y adaptación.
- [Portal Firebase](../PORTAL_FIREBASE.md): implementación del portal.
- [Instructivo PDF](AudioTaller_Instructivo_Portal_del_Artista.pdf): recorrido ilustrado para el productor.
- [ITERACION.md](../ITERACION.md) y [BENCHMARK_Y_FLUJO.md](../BENCHMARK_Y_FLUJO.md): antecedentes del 6 y 7 de noviembre. Algunos apartados reflejan etapas anteriores, nombres antiguos o un portal que entonces era solo local. No tratarlos como descripción única del estado actual.

No se necesita el historial completo del chat para empezar. Si una decisión no está clara, inspeccionar primero el código y consultar al responsable antes de cambiar el modelo de datos o el alcance del producto.
