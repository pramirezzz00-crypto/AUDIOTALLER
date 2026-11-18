# Integración de aportes — 18 de noviembre de 2026

Base: AudioTaller beta de desarrollo (rama feature/gestion-y-produccion).

- Zharelly: https://github.com/zharevd/AUDIOTALLER1 — commit 7931e84. Composición con Beats, colecciones de Partituras (PDF/PNG/JPG) y Letras (TXT/DOCX), consulta, reproducción, orden y acceso a originales.
- Silvio: https://github.com/silviohp2023-tech/AUDIOTALLER — commit 46ae0bc. Entidades y sus cinco logos: SADAIC, AADI, CAPIF SGC, INAMU y AMA.

Se integraron los módulos sin sustituir la aplicación actual ni sus playlists del portal. Las tablas nuevas usan el prefijo composition_; la migración 8 crea un respaldo antes de ampliarlas. La eliminación de una colección conserva los originales. Los selectores y la apertura de carpetas funcionan mediante el puente de escritorio existente, tanto en Windows como en macOS.

Se normalizaron los nombres de los logos para evitar diferencias entre sistemas sensibles a mayúsculas. INAMU apunta a inamu.musica.ar y CAPIF SGC a capifsgc.org.ar (el sitio de la Cámara remite allí para gestión colectiva).

No se trasladaron bases, audios, credenciales ni configuraciones de los repositorios colaboradores. Los instaladores existentes no forman parte de esta actualización.
