# AudioTaller — instrucciones para asistentes de código

App de escritorio para productores musicales (Windows y Mac). Python 3.12+ · Flask · SQLite · pywebview · HTML/CSS/JS sin compilación. Responsable del producto: Pedro.

## Flujo de trabajo

- Rama base: `redisenio-sala-de-control` (0.3.0 beta). Antes de empezar: `git checkout redisenio-sala-de-control && git pull`.
- Trabajá siempre en una rama propia `<nombre>/<tema>` y entregá con un Pull Request hacia `redisenio-sala-de-control`. No hagas push directo a `redisenio-sala-de-control` ni a `main`.
- Leé `docs/HANDOVER_COLABORADORES.md` y `docs/REDISENO_SALA_DE_CONTROL.md` antes de cambios grandes. Prompt para colaboradores: `docs/PROMPT_PARA_IA.md`.

## Comandos

- Pruebas: `python -m unittest discover -s tests -q` (111 pruebas actuales; este entorno Windows tiene un fallo conocido de codificación en `test_clasifica_y_crea_sesiones_nuevas_sin_tocar_la_original`; Linux puede tener además el fallo conocido del almacén seguro).
- App de escritorio: `python desktop.py`. Solo interfaz en navegador: `python app.py` → http://127.0.0.1:5000.
- Sintaxis JS: `node --check static/<archivo>.js`.

## Reglas

- Cambios chicos; no reescribas `app.py`, `static/audio.html` ni `static/navigation.js` completos. Los JS de `static/` comparten funciones globales y el orden de carga importa.
- Esquema en versión 11. Datos nuevos: migración compatible en `migrations.py` o documentos en `rediseno_datos` con `doc_get`/`doc_put`/`doc_list` (`redesign.py`).
- Nunca borrar, mover ni sobrescribir archivos originales del usuario; se guardan rutas y se abren con `runtime_paths.open_path`.
- `perfil` en un JSON debe ser objeto (usar `perfil_id` para ids). No usar `jsonify(dict, clave=...)`.
- Probar con datos temporales (tests), no con la biblioteca real. No subir `.venv`, SQLite, audios, `*.dpapi`, credenciales ni contraseñas.
- Pantalla nueva: sección en `audio.html`, entrada en `pages` de `navigation.js`, breadcrumbs y carga de datos.
- Estética: variables de `static/theme.css`, componentes existentes (`card`, `btn-primary`, `mk-btn`, `seg`, `mig-tabs`), tema oscuro y claro, textos con voseo. Estilos nuevos al final de `static/studio.css`.
- Al terminar, el PR lleva el «Informe de integración» de `docs/PROMPT_PARA_IA.md` con las alertas de funcionalidad, estética y trabajo deshecho.
