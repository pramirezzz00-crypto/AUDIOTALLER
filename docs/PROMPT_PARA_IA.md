# Prompt para continuar AudioTaller con otra IA

Copiar el siguiente texto en la otra IA y adjuntar `HANDOVER_COLABORADORES.md`, o darle acceso al repositorio y a la rama indicada. Completar la tarea al final.

---

Vas a colaborar en AudioTaller, una aplicación local de escritorio para productores musicales. El responsable del producto es Pedro. Queremos mantener una app sencilla, gratuita y con estética oscura/turquesa.

Repositorio principal: https://github.com/pramirezzz00-crypto/AUDIOTALLER
Rama integrada: `feature/gestion-y-produccion`.
Base de la integración de Composición y Entidades: commit `01ba742`.

Antes de modificar:

1. Leé `docs/HANDOVER_COLABORADORES.md`, `README.md`, los módulos de la tarea y sus tests. Revisá el estado Git y preservá los cambios locales existentes.
2. Confirmá que partís de la rama integrada y trabajá en una rama propia por tarea. No copies `app.py` o `navigation.js` completos desde un fork antiguo.
3. La app usa Python/Flask, SQLite, pywebview y HTML/CSS/JS. No la reemplaces por React/Electron ni agregues un backend público sin acordarlo.
4. Conservá los datos, identificadores, relaciones y archivos originales. El esquema actual es 8; los cambios deben ser compatibles y tener respaldo. No confundas `composition_playlists` con `playlists` del portal.
5. Trabajá con datos temporales y servicios externos simulados. No uses bases personales, credenciales ni música real del productor para pruebas.
6. El portal Firebase/Drive es un piloto funcional. La contraseña protege la consulta de la playlist; los audios de Drive son públicos por enlace. El onboarding universal todavía está pendiente. No prometas privacidad de los WAV ni una configuración automática ya resuelta.
7. No publiques secretos, audios, SQLite, JSON OAuth, tokens ni contraseñas en Git, capturas o respuestas. No actives facturación ni publiques música sin autorización del propietario.

Implementá la tarea completa respetando el flujo y el estilo actuales. Conservá la compatibilidad con Windows y macOS cuando toques rutas, selectores o apertura de DAW. Comprobá que los métodos expuestos por `desktop.py` y el orden de carga de scripts sigan siendo compatibles.

Validación mínima: `python -m unittest discover -s tests -q` desde el entorno del proyecto. La base integrada tiene 40 pruebas correctas en Windows. Hacé además una comprobación manual del flujo que cambies y distinguí lo probado de lo pendiente. Si no podés ejecutar una prueba, indicá la causa sin afirmar que pasó.

Al terminar, entregá un resumen del comportamiento final, cambios de datos/API si los hubo, pruebas y límites. Prepará un PR hacia `feature/gestion-y-produccion` cuando se te autorice subir la rama. No publiques instaladores o servicios como parte de una tarea que solo modifica el desarrollo local.

**Tarea concreta:**
[DESCRIBIR AQUÍ QUÉ SE QUIERE CAMBIAR]

**Criterios de aceptación:**
[INDICAR QUÉ DEBE PODER HACER EL USUARIO AL TERMINAR]

**Alcance autorizado para compartir o desplegar:**
[POR EJEMPLO: SOLO LOCAL / RAMA Y PR / INSTALADOR / ENTORNO DE PRUEBA]
