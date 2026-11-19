# AudioTaller

Aplicación local de escritorio para organizar artistas, discos, canciones y tomas de audio.

## Continuar el desarrollo con colaboradores u otras IAs

Empezá por el [handover técnico y funcional](docs/HANDOVER_COLABORADORES.md) y el [prompt listo para otra IA](docs/PROMPT_PARA_IA.md). Incluyen la rama integrada, arquitectura, pruebas, decisiones y pendientes.

## Portal del artista e instructivo

El [instructivo ilustrado en PDF](docs/AudioTaller_Instructivo_Portal_del_Artista.pdf) explica cómo configurar Firebase y Drive, publicar una playlist, copiar la invitación para el artista y recibir sus devoluciones. Incluye un recorrido para recuperar una conexión ya configurada.

Esta versión incorpora fichas de canción con metadata, catálogo de audios, playlists, publicación web y devoluciones por audio con seguimiento privado del productor. Actualizar una playlist publicada conserva su enlace y el historial de comentarios.

La integración web es un piloto con proyecto propio Firebase Spark y copias de audio públicas por enlace en Drive. La preparación técnica y las limitaciones están en [Portal Firebase](PORTAL_FIREBASE.md). El alta universal para cualquier productor sigue pendiente de verificación OAuth y provisión de espacios independientes. Las credenciales, los audios y las bases de datos locales no forman parte de este repositorio.

## Arranque en Windows

La versión instalable de prueba es **0.2.0 beta para Windows x64**. Su compilación,
componentes incluidos y validaciones se describen en
[Instalador de Windows](packaging/README.md). No requiere Python ni VS Code en la
computadora de destino. La integración del portal sigue siendo un piloto.

Desde la carpeta del repositorio, con Python instalado:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Abrí `Iniciar_AudioTaller.vbs` con doble clic. La ventana usa Edge WebView2.

Para trabajar en el código, `desktop.py` inicia la ventana y `app.py` contiene el servidor local. La interfaz está en `static`. Cada instalación guarda sus datos y rutas de sesiones en `%LOCALAPPDATA%\AudioTaller`.

Para colaborar, creá una rama por cambio y abrí un pull request.

## Comprobaciones de desarrollo

Con el entorno activado, ejecutá `python -m unittest discover -s tests -q`. Las 40 pruebas actuales cubren migraciones, producción, catálogo, publicación y devoluciones; las conexiones externas se simulan para no publicar material durante los tests.

## Composición y entidades

La beta de desarrollo integra el aporte de Zharelly: Beats con listas independientes, Partituras PDF/PNG/JPG y Letras TXT/DOCX organizadas en colecciones. Las colecciones guardan referencias y no eliminan los archivos originales.

La sección Entidades incorpora los logos aportados por Silvio y accesos a SADAIC, AADI, CAPIF SGC, INAMU y AMA. Los detalles de procedencia, adaptación y respaldo están en [Integración de aportes](docs/INTEGRACION_COMPOSICION_Y_ENTIDADES.md).
