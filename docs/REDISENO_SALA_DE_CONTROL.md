# Rediseño «Sala de control» — 22 de noviembre de 2026

Versión de desarrollo 0.3.0 beta. Cambios locales, sin publicar en GitHub.

## Qué cambia para el productor

- **Tema negro** con tipografías incluidas (Inter y JetBrains Mono, licencia OFL en `static/fonts`). El turquesa queda para la acción principal, la selección y el cursor; cada etapa tiene su color de pista.
- **Barra lateral** con Inicio, Producciones, Artistas, Catálogo, Playlist, Arreglos, Composición, Entidades y las canciones recientes.
- **Inicio · Sala de control**: seguir trabajando, canciones por etapa, devoluciones pendientes y discos.
- **Canción como proyecto de DAW**: un carril por etapa con clips ubicados por fecha (audios con forma de onda, sesiones rayadas con la sigla del DAW), inspector a la derecha y transporte con comparación A/B y marcas de devolución. Doble clic: reproducir un audio o abrir una sesión. Barra espaciadora: reproducir o pausar.
- **Pasar material entre etapas**: mover o copiar archivos y sesiones desde el inspector.
- **Agregar audio o sesión**: un solo diálogo; detecta el tipo, sugiere la etapa y permite registrar un audio como versión de otro. Copiar o vincular desde su ubicación (las sesiones siempre se vinculan).
- **Disco como lanzamiento**: portada, avance de producción, versión de referencia, devoluciones y duración por canción.
- **Unidades SI** en tamaños y frecuencias (kB/MB, coma decimal).

## Datos y API

Sin cambios de esquema (sigue en la versión 8). Nuevos endpoints en `overview.py`:

- `GET /api/inicio` y `GET /api/discos/<id>/resumen`: solo lectura.
- `POST /api/produccion/<cancion>/trasladar` con `tipo` (`archivo`|`sesion`), `id`, `etapa` y `copiar`.
  Mover conserva id, ruta e historial; una sesión lleva sus archivos asociados y pierde la marca de vigente.
  Copiar un archivo importado copia sus bytes a la carpeta administrada de la etapa; uno vinculado crea otro vínculo.
  Copiar una sesión crea `_V00x` junto al original. Nunca se modifica ni borra un original.

## Pruebas

`tests/test_overview.py` (5 pruebas). Total: 45 pruebas.

## Rediseño completo (23 de noviembre de 2026, tandas 1 a 6)

Volcado del mockup navegable (https://claude.ai/artifact/MvHezeGCf1gPjgmKJ4eXSD) a la app. El mockup se conserva para mostrar el funcionamiento.

**Datos.** Migración 9 con respaldo automático: agrega columnas a `portal_devoluciones` (respuesta, versión que resuelve, bucle) y la tabla `rediseno_datos(tipo,id,datos)` para documentos JSON (créditos, letras, beats, partituras, trámites, campañas, audiovisuales, perfiles de buses, artistas, medidas de sonoridad, configuración del asistente). No se borra ni se mueve ningún dato existente. Sin dependencias nuevas.

| Pantalla | Módulos |
|---|---|
| Playlist › Devoluciones, marcadores al DAW | `portal_feedback.py`, `feedback_markers.py`, `static/feedback-ui.js` |
| Inicio, canción (transporte arriba, sub-carriles) | `static/studio-home.js`, `static/studio-song.js` |
| Producciones, Disco, Créditos, Exportar metadata | `redesign.py`, `loudness.py`, `metadata_export.py`, `static/productions-ui.js`, `studio-album.js`, `credits-ui.js`, `export-ui.js` |
| Composición y Entidades | `redesign_comp.py`, `entity_guides.py`, `static/composition-ui.js`, `entities-ui.js` |
| Arreglos y buses, Artistas, Catálogo, Playlist | `redesign_arr.py`, `static/arrangements-ui.js`, `people-ui.js`, `catalog-extra.js` |
| Lanzamientos, Audiovisual, Asistente, Configuración | `redesign_extra.py`, `static/extra-ui.js` |

**A verificar en la PC de Pedro:** importar un `.dawproject` en Cubase 14.0.20+ (probar primero); parámetros de `ylm2` (Youlean, hoy desactivado salvo `AUDIOTALLER_YOULEAN=1`; se mide con BS.1770 propio); arrastrar beats al DAW desde la ventana.

**Pendiente fuera de la app:** formulario del artista y devoluciones sobre video requieren actualizar el portal de Firebase; Pro Tools requiere el Scripting SDK de Avid; estadísticas con Soundcharts.

Pruebas: `tests/test_redesign_*.py` (19 pruebas nuevas). La falla de `test_importa_perfil_sin_aceptar_tokens_de_terceros` ya existía antes del rediseño.
