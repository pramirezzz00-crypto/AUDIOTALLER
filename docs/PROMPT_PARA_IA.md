# Prompt para trabajar en AudioTaller con otra IA

Copiá el texto de abajo en tu IA (Claude Code, Cursor, Copilot, ChatGPT con acceso al repositorio, etc.) y completá los tres campos del final. Si usás Claude Code dentro de la carpeta del proyecto, ya lee `CLAUDE.md` solo; igual conviene pegar este prompt con la tarea.

---

Vas a colaborar en **AudioTaller**, una aplicación de escritorio gratuita para productores musicales (Windows y Mac). El responsable del producto es **Pedro**; yo soy un colaborador del equipo. La app es local, oscura con acentos turquesa, y debe seguir siendo sencilla.

**Repositorio:** https://github.com/pramirezzz00-crypto/AUDIOTALLER
**Rama base:** `redisenio-sala-de-control` (versión 0.3.0 beta). No partas de `main`.
**Referencia visual:** mockup navegable https://claude.ai/artifact/MvHezeGCf1gPjgmKJ4eXSD (si no podés abrirlo, guiate por las pantallas actuales).

## Cómo trabajamos (obligatorio)

1. Antes de tocar nada: `git fetch` y `git checkout redisenio-sala-de-control && git pull`. Leé `CLAUDE.md`, `docs/HANDOVER_COLABORADORES.md`, `docs/REDISENO_SALA_DE_CONTROL.md`, los archivos de la tarea y sus tests.
2. Creá una rama propia para la tarea **desde la base recién actualizada**: `git checkout -b <mi-nombre>/<tema>`. Si tu copia es vieja, no copies archivos de ella: así se deshacen cambios de otros. **Nunca hagas push a `redisenio-sala-de-control` ni a `main`.**
3. Hacé cambios chicos y enfocados en la tarea. No reescribas archivos completos (`app.py`, `static/audio.html`, `static/navigation.js`) ni copies versiones viejas de forks.
4. Al terminar: ejecutá las pruebas, subí tu rama (`git push -u origin <mi-rama>`) y abrí un **Pull Request hacia `redisenio-sala-de-control`**. Pedro recibe el aviso en GitHub, lo revisa y decide si lo incorpora. Si hay conflictos, resolvelos conservando lo de ambos lados.
5. En la descripción del PR pegá el **Informe de integración** (ver abajo) y capturas si cambia una pantalla.

## Reglas técnicas

- Stack: Python 3.12+ con Flask, SQLite y pywebview; interfaz en HTML/CSS/JS sin framework ni compilación. Los scripts de `static/` comparten funciones globales y el orden de carga en `audio.html` importa. No migrar a React/Electron ni agregar servidores sin acordarlo.
- Datos: el esquema está en la versión 11. Cualquier dato nuevo va con una migración compatible en `migrations.py` (con respaldo) o como documento JSON en `rediseno_datos` usando `doc_get`/`doc_put`/`doc_list` de `redesign.py`. Nunca borres, muevas ni sobrescribas archivos originales del usuario: AudioTaller guarda rutas y abre los archivos con su programa. La Papelera permite borrar definitivamente copias administradas, pero los originales vinculados nunca se eliminan.
- Compatibilidad: todo lo que toque rutas, selectores de archivos o apertura de programas tiene que funcionar en Windows y Mac (`runtime_paths.open_path`, métodos de `desktop.py`).
- Gotchas: la clave `perfil` en un JSON debe ser un objeto (usá `perfil_id` para ids); no uses `jsonify(dict, clave=...)`; Windows y Mac no distinguen mayúsculas en nombres de carpeta.
- Seguridad: no subas a Git `.venv`, bases SQLite, audios, `*.dpapi`, JSON de OAuth, claves ni contraseñas. No publiques música, no cambies permisos de Google ni uses cuentas del productor.

## Estética (no romperla)

- Usá siempre las variables de `static/theme.css` (`--at-bg`, `--at-panel`, `--at-raised`, `--at-line…`, `--at-text…`, `--at-accent`). No agregues colores sueltos, fuentes nuevas ni librerías de componentes.
- Reutilizá las piezas que ya existen: `prod-head` + `eyebrow` para encabezados, `card`, `btn-primary`, `mk-btn`, `seg` (segmentados), `mig-tabs` (pestañas), `mk-table`, `insp-help`, `notify()` para avisos y `appConfirm()` para confirmaciones (no `alert`).
- Todo tiene que verse bien en **tema oscuro y tema claro** (Configuración › Apariencia) y en una ventana de 1440 × 900.
- Textos en castellano rioplatense con voseo («elegí», «tocá»), cortos y claros. Una pantalla nueva sigue el mockup y las pantallas actuales: mismo espaciado, misma tipografía, mismos bordes.
- Los estilos nuevos van al final de `static/studio.css` con un comentario de sección; no edites reglas existentes de otras pantallas.

## Informe de integración (obligatorio al terminar)

Antes de abrir el PR, revisá tus propios cambios contra la rama base (`git diff origin/redisenio-sala-de-control...HEAD`) y pegá este informe **al principio de la descripción del PR**:

```
### Informe de integración
- Qué cambia para el usuario: …
- Archivos tocados: …
- ⚠️ Puede romper funcionalidades: (rutas, datos, API, orden de scripts, funciones globales con el mismo nombre, migraciones) … o «ninguna detectada»
- ⚠️ Puede contradecir la estética: (colores fijos, estilos que pisan otras pantallas, textos sin voseo, tema claro) … o «ninguna detectada»
- ⚠️ Deshace trabajo existente: (líneas borradas que no eran de esta tarea, archivos copiados de una versión vieja) … o «no»
- Pruebas: comando y resultado; qué se probó a mano en oscuro y en claro; qué quedó sin probar.
```

Si encontrás una alerta que no podés resolver, dejala escrita igual: Pedro decide antes de integrar.

## Cómo probar

```sh
# Windows (PowerShell)
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
.\.venv\Scripts\python.exe desktop.py      # abre la app

# Mac
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -q
.venv/bin/python desktop.py
```

La suite actual tiene 98 pruebas. En Windows se conoce un fallo de codificación en `test_clasifica_y_crea_sesiones_nuevas_sin_tocar_la_original`; en Linux puede fallar otra prueba que requiere el almacén seguro de Windows/Mac. Agregá tests para lo nuevo en `tests/` con datos temporales. Abrir la app usa la biblioteca real de quien la ejecuta: para probar, preferí los tests o una carpeta de datos aparte. Distinguí siempre lo que probaste de lo que no.

## Tarea

**Qué hay que cambiar:**
[DESCRIBIR AQUÍ]

**Qué debe poder hacer el usuario al terminar:**
[CRITERIOS DE ACEPTACIÓN]

**Alcance:**
[POR EJEMPLO: SOLO MI RAMA Y PR / INCLUYE MIGRACIÓN DE DATOS / SOLO INTERFAZ]
