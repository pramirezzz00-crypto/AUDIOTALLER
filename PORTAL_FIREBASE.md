# Portal de artista · Firebase Hosting Spark + Google Drive

Esta integración está programada para proyectos propios, con interfaz estática en Hosting, acceso del artista mediante Firebase Authentication y datos de la playlist en Firestore. Las copias de audio se comparten en Drive mediante permiso `anyone / reader` sin descubrimiento por búsqueda. No utiliza Cloud Storage, Cloud Run ni Functions y no activa facturación.

**Estado del piloto (7 de noviembre de 2026):** código instalado, cuenta autorizada y web desplegada en [AudioTaller Portal Artistas](https://audiotaller-portal-artistas.web.app), proyecto `audiotaller-portal-artistas` en Spark, sin vincular facturación. Authentication usa correo/contraseña y Firestore Standard `(default)` está en `nam5`, con las reglas incluidas compiladas y desplegadas. Drive API, Firebase Hosting API y Firebase Rules API están habilitadas. El cliente y la autorización OAuth están cifrados en Windows; la cuenta propietaria es usuario de prueba. Se publicó solamente un tono sintético de cuatro segundos, con base de pruebas separada: no se subieron canciones del usuario. El acceso y las reglas funcionan contra Google real. El usuario confirmó la escucha correcta del tono en su navegador habitual. El navegador integrado de la herramienta presentó un fallo de reproducción; la prueba de escucha externa fue satisfactoria.

La clave pública de reproducción es independiente de la clave Firebase: permite únicamente Drive API y solicitudes del dominio `https://audiotaller-portal-artistas.web.app/*`. Hosting envía `Referrer-Policy: strict-origin-when-cross-origin` para identificar ese dominio sin revelar la ruta privada de la playlist. No cambiar esta cabecera a `no-referrer` manteniendo la restricción de Drive por sitio.

## Decisión de acceso

La contraseña, el vencimiento y la revocación protegen la **consulta de la playlist** mediante reglas de Firestore. Los enlaces directos del audio son públicos: una persona que conserve uno puede escuchar el archivo aunque se revoque la página. Ocultar el botón de descarga no impide obtener o guardar el audio. Este modelo fue elegido expresamente para simplificar la publicación dentro de servicios gratuitos.

Cada playlist mantiene una dirección estable. Publicarla otra vez actualiza su selección y renueva su vigencia. Los archivos de Drive ya copiados se reutilizan por identificador y SHA-256; un archivo con contenido diferente recibe otra copia. No se eliminan versiones previas ni se modifican los originales locales. Las cuotas de Drive y de los productos Firebase siguen aplicándose; gratuito significa dentro de esas cuotas, no capacidad ilimitada.

## Primera configuración del desarrollador / proyecto piloto

1. Entrar a [Firebase Console](https://console.firebase.google.com/) con la cuenta propietaria. Crear un proyecto **nuevo y exclusivo de AudioTaller**, conservando Spark. No asociar una cuenta de facturación. Se puede omitir Analytics para esta prueba.
2. Agregar una aplicación web. Guardar su `projectId` y su `apiKey` públicos. No usar una clave privada de cuenta de servicio.
3. En Authentication, inicializar el producto y habilitar el proveedor **Correo electrónico/contraseña**. El acceso del artista se crea desde AudioTaller al publicar la primera vez; no se envían correos automáticamente.
4. Crear Cloud Firestore, edición Standard, base **`(default)`**. Elegir la ubicación en la consola. Antes de compartir una playlist, instalar las reglas incluidas mediante el asistente; no dejar una base abierta en modo de prueba.
5. En el mismo proyecto de Google Cloud, habilitar Google Drive API, Firebase Hosting API y Firebase Rules API. Las APIs de Firestore y Authentication se inicializan con los pasos anteriores. Si Google informa otra API deshabilitada, habilitar únicamente la correspondiente en ese proyecto.
6. Configurar Google Auth Platform / consentimiento OAuth. Para el piloto puede quedar en modo de prueba, agregando el correo propietario como usuario de prueba. Crear credenciales OAuth de tipo **Aplicación de escritorio**, y descargar su JSON.
7. La reproducción pública usa una clave de API que permita **Google Drive API**. Puede ser la clave web si sus restricciones lo permiten; de lo contrario crear otra clave para Drive. Restringir la clave de reproducción al dominio del portal y a Drive API. El sitio se genera como `https://<siteId>.web.app`. La clave de reproducción es pública y no concede acceso a archivos privados.
8. En AudioTaller → **Playlist → Conectar portal web**, completar los datos, importar el JSON OAuth y guardar. **Autorizar Google** abre el navegador normal para que el propietario revise y acepte los permisos. El programa usa PKCE, un estado aleatorio y un callback local de uso temporal.
9. Confirmar que el proyecto es exclusivo y pulsar **Instalar / actualizar portal**. Crea el sitio si falta, instala las reglas de Firestore y despliega solo cuatro recursos estáticos: HTML, CSS, JS y configuración pública. No sube Python, la base local, tokens ni sesiones del DAW. El botón sustituye las reglas de Firestore del proyecto y la interfaz del sitio indicado: por eso no debe usarse un proyecto compartido con otras aplicaciones.

La autorización incluye `drive.file` para los archivos de la aplicación y `cloud-platform` para desplegar recursos del proyecto administrado por su dueño. No solicita un rol IAM nuevo ni una cuenta de facturación. El propietario debe tener permisos suficientes sobre su propio proyecto. Los tokens de Google se cifran con DPAPI, vinculados a su usuario de Windows, en el directorio local de datos de AudioTaller; nunca se agregan al repositorio ni a Hosting.

El modo de prueba de OAuth tiene límites y puede exigir reconectar. Antes de distribuir AudioTaller a otros productores, registrar y verificar la integración OAuth correspondiente y terminar el asistente de provisión. Esta primera versión **todavía requiere configuración inicial en las consolas de Google**: no equivale aún a un instalador universal que cree todas las cuentas con un clic.

## Primera publicación

1. Abrir una playlist y pulsar **Publicar en la web**.
2. Ingresar el correo del artista, una contraseña de al menos ocho caracteres y la vigencia. Al actualizar el mismo acceso, la contraseña se conserva y puede dejarse vacía. Para vincular por primera vez un correo que ya exista en Firebase, se verifica su contraseña actual.
3. Revisar y confirmar que los audios se compartirán por enlace. Pulsar Publicar y mantener AudioTaller abierto hasta terminar.
4. Copiar la dirección y compartir las credenciales por el medio que el productor elija. El programa no envía mensajes automáticamente.
5. Abrir el enlace en otro navegador o una ventana privada. Comprobar acceso, reproducción, avance y apertura en Drive. Probar primero con un audio de prueba que el productor haya elegido hacer público.
6. Editar la playlist y volver a publicar. Comprobar que se mantiene la URL y cambia la lista. Probar vencimiento y revocación de la página.

## Devoluciones del artista

Debajo de cada reproductor aparece **Tu devolución**, con un máximo de 4000 caracteres, un botón para marcar el momento escuchado y **Enviar devolución**. Se quitó el botón Abrir en Drive. El envío es explícito: escribir no transmite el borrador. Un error conserva el texto y el identificador de envío permite reintentar sin duplicar una nota confirmada. Los comentarios son inmutables y conservan archivo, copia Drive, canción, número de entrega y fecha del servidor. Las reglas rechazan comentarios sin acceso vigente, sobre un archivo ajeno o una entrega anterior y cualquier edición posterior. Una pestaña con texto sin enviar avisa si cambió la playlist; Actualizar playlist pide confirmar antes de descartar el texto visible.

En AudioTaller, abrir **Playlist → Devoluciones del artista → Buscar nuevas devoluciones**. También está disponible desde la producción de cada canción. La bandeja permite marcar Pendiente, En revisión o Resuelta y agregar una nota privada. Se puede ir directamente a la producción. Las devoluciones descargadas se consultan sin Internet; buscar nuevas requiere Google conectado. Sincronizar conserva el seguimiento y los comentarios de entregas anteriores aunque se retire un audio de la playlist. No hay notificaciones automáticas en segundo plano: la consulta es manual.

Para compartir la siguiente revisión, editar **la misma playlist** y pulsar **Publicar / actualizar web**. La selección remota se reemplaza en el mismo enlace y aumenta el número de entrega; las devoluciones anteriores se conservan. Crear otra playlist independiente genera otro enlace.

## Artistas e invitaciones

La publicación permite elegir un artista de la agenda y usa el correo de su ficha; si falta, se puede completar en el formulario. Generar contraseña segura prepara una clave para crear el acceso. Un correo existente conserva su cuenta y se verifica su contraseña cuando corresponde: este formulario no cambia contraseñas de Firebase. Al publicar correctamente, el acceso conocido se guarda en `portal-accesos.dpapi`, cifrado para el usuario de Windows, separado de SQLite, Hosting y Git. Esto permite **Copiar invitación para WhatsApp** con enlace, correo y contraseña, o copiar nuevamente los datos desde una publicación existente. Si la clave de una publicación antigua no fue guardada, la interfaz informa que se conserva la anterior, sin inventarla. No se envían mensajes automáticamente.

## Distribución para personas sin conocimientos técnicos

El uso cotidiano no requiere código: elegir playlist, seleccionar artista, generar acceso, publicar y copiar la invitación. El asistente muestra el estado de conexión, permite importar un perfil preparado por el responsable y oculta las claves y el cliente OAuth dentro de Configuración avanzada. Un perfil tiene el formato `audiotaller-portal-v1`, configuración pública y opcionalmente un cliente OAuth de escritorio; no admite tokens ni claves privadas de cuenta de servicio. Importarlo no transfiere autorizaciones: cada productor conecta su cuenta.

**La provisión universal todavía no está terminada.** El piloto usa un cliente OAuth en modo de prueba y un proyecto preparado manualmente. Antes de anunciar que cualquier persona puede instalar y conectar sus cuentas sin preparación, el responsable del producto debe registrar/verificar el cliente OAuth común, definir el alta del espacio propio de cada productor y probarla con una cuenta nueva que no sea propietaria de este piloto. Un perfil de conexión simplifica la configuración de un espacio preparado; no crea cuentas, cuotas ni proyectos por sí mismo. No se debe distribuir el proyecto personal del desarrollador como espacio compartido para todos los productores ni incluir tokens o contraseñas de artista en el instalador. La verificación de Google es un paso externo que esta actualización de código no completa.

La publicación verifica primero que haya un sitio desplegado y una base Firestore. Los WAV se suben por bloques. Un fallo no sustituye el documento anterior de la playlist; las copias ya completadas se conservan para reutilizarlas. Una interrupción a mitad de un archivo puede requerir subir nuevamente ese archivo; no se promete reanudación persistente de cada bloque. Si se cierra AudioTaller, la tarea en curso termina con el proceso.

## Reproductor de Drive

El reproductor utiliza la API de archivos públicos de Drive, sin exponer tokens del productor. Google puede exigir permisos adicionales, una clave de recurso, aplicar límites de descarga o no permitir reproducción directa de cierto archivo. Si falla, la página pide reintentar o avisar al productor; ya no muestra el enlace a Drive. La escucha del tono se confirmó en el navegador habitual del usuario. Falta probar WAV reales grandes y otros dispositivos. Si se requiere reproducción uniforme garantizada más adelante, incorporar un proveedor de medios apropiado o generar copias de escucha en otro alojamiento; no introducir un proxy pago silenciosamente.

## Validaciones realizadas

- 29 pruebas de servidor: regresiones locales, migraciones y cifrado DPAPI; refresco de tokens simulado; subida por bloques y reutilización de copia; publicación/reemplazo con URL estable; un fallo de subida no reemplaza la selección anterior; paquete de Hosting sin secretos ni servicios pagos.
- Ventana real de AudioTaller con servicios simulados: asistente de configuración, guardado, revisión de permiso público, publicación y presentación del enlace. La ficha de canción anterior sigue accesible.
- Ventana de la página del artista con Firebase simulado: contraseña incorrecta/correcta, lista, reproductor, alternativa Drive, denegación de acceso, cierre y reingreso, metadata tratada como texto.
- Google real: despliegue y reglas compilados, ingreso del artista, consulta sin autorización rechazada (403), consulta autorizada (200), revocación (403), vencimiento (403) y restauración (200). Repetir publicación conserva URL y reutiliza copia. Drive respondió 206 `audio/wav`, con rango y cabecera RIFF/WAVE, sin token del productor.
- Escucha efectiva: el usuario confirmó que el tono de cuatro segundos se escucha en su navegador habitual. El navegador integrado de la herramienta presentó un fallo. En esta iteración se quitó el enlace de Drive a pedido del usuario. No se probaron todavía WAV de producción grandes, móviles ni múltiples productores.
- Iteración de devoluciones: 34 pruebas de servidor y dos recorridos de interfaz con servicios simulados. Prueba real de envío desde la web y sincronización de dos notas en una base aislada. Google rechazó escritura sin login, audio ajeno, entrega vieja y edición de comentario; aceptó el comentario válido. La migración 7 respaldó la base instalada y comprobó las 35 tablas anteriores sin alterar sus filas. Las pruebas externas sólo usaron el tono sintético.

## Referencias oficiales

- [Hosting: despliegue mediante REST](https://firebase.google.com/docs/hosting/api-deploy).
- [Firestore REST: tokens y reglas](https://firebase.google.com/docs/firestore/use-rest-api).
- [Drive: permisos de alcance reducido](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- [Drive: descargas y rangos](https://developers.google.com/workspace/drive/api/guides/manage-downloads).
- [Drive: claves de recurso](https://developers.google.com/workspace/drive/api/guides/resource-keys).
- [Cuotas de Hosting](https://firebase.google.com/docs/hosting/usage-quotas-pricing).
