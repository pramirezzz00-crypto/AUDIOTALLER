# Instalador de Windows

La beta 0.3.0 se distribuye como `AudioTaller-0.3.0-beta-Setup-x64.exe`. GitHub Actions lo compila solo (`.github/workflows/windows.yml`) y lo deja en «Artifacts» de cada ejecución.
Incluye el ejecutable sin consola, Python, Flask, pywebview, recursos de la
interfaz, icono, avisos de terceros y el instructivo PDF. Instala por usuario en
`%LOCALAPPDATA%\Programs\AudioTaller`, con desinstalador y accesos directos.
Las producciones se conservan en `%LOCALAPPDATA%\AudioTaller`; el instalador y el
desinstalador no eliminan esa carpeta ni las sesiones externas.

Requiere Windows 10/11 x64, .NET Framework 4.8 y WebView2 Runtime. Incluye el
bootstrapper oficial firmado de Microsoft: sólo se ejecuta si falta WebView2,
y entonces necesita Internet. Esa rama debe probarse además en una máquina
limpia sin el Runtime; en esta PC se comprobó la rama con WebView2 instalado.

## Compilar

1. Crear un entorno separado con Python 3.14 x64.
2. Instalar `requirements-build.lock.txt` en ese entorno.
3. Descargar Inno Setup y el bootstrapper Evergreen de WebView2 de sus sitios
   oficiales y verificar sus firmas digitales. Esta compilación usó Inno Setup
   7.1.1 y PyInstaller 6.22.3.
4. Ejecutar `build.ps1` pasando rutas absolutas para `Python`, `Iscc`, `ToolsRoot`,
   `BuildRoot` y `OutputRoot`. `ToolsRoot` debe contener el archivo original
   `MicrosoftEdgeWebview2Setup.exe`.

El script valida configuración pública vacía, genera el paquete, copia y
comprueba cada recurso por SHA-256, agrega licencias, compila el instalador y
escribe su suma de verificación. La fuente del icono está en
`static/branding/audiotaller-mark.svg`; se incluyen PNG e ICO de varios tamaños.
No se copian bases, credenciales DPAPI, entornos virtuales ni audios del usuario.

El ejecutable acepta `--self-test <informe.json>` para comprobar desde el paquete
los recursos, CLR, migraciones y creación de artista/canción/audio/playlist con
una base temporal. Ese diagnóstico no conecta Google ni abre datos personales.

## Validación de esta beta

- 34 pruebas de servidor satisfactorias.
- Diagnóstico del ejecutable congelado e instalado.
- Instalación y reinstalación sobre la misma ubicación de prueba.
- Arranque real en ventana con icono nuevo, sin consola.
- Desinstalación de la copia de prueba conservando la base y un archivo de datos.

El instalador generado no tiene firma digital del editor. Antes de una
distribución general falta comprobarlo en otras computadoras, especialmente
una sin Python y sin WebView2, y firmar los binarios si se desea un editor
verificado. El portal universal de artistas sigue pendiente de verificación
OAuth y provisión de espacios; crear el instalador no resuelve ese servicio.

## macOS

El flujo `.github/workflows/macos.yml` compila en macOS 15 nativo para arm64 e Intel. Ejecuta pruebas, empaqueta Cocoa con PyInstaller, comprueba el diagnóstico aislado y la firma ad hoc, y genera un DMG con enlace a Aplicaciones. Los artefactos duran 30 días en GitHub Actions. También puede ejecutarse `bash packaging/macos/build.sh` desde una Mac con Python 3.12.

No incluye notarización ni Developer ID: hace falta una cuenta Apple Developer para incorporar ese paso. El diagnóstico automático no reemplaza la prueba de uso en una Mac física. Datos en `~/Library/Application Support/AudioTaller`, secretos en el Llavero nativo (sin alternativa en texto plano). Windows conserva su ubicación y DPAPI.
