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
