# AudioTaller

Aplicación local de escritorio para organizar artistas, discos, canciones y tomas de audio.

## Arranque en Windows

Desde la carpeta del repositorio, con Python instalado:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Abrí `Iniciar_AudioTaller.vbs` con doble clic. La ventana usa Edge WebView2.

Para trabajar en el código, `desktop.py` inicia la ventana y `app.py` contiene el servidor local. La interfaz está en `static`. Cada instalación guarda sus datos y rutas de sesiones en `%LOCALAPPDATA%\AudioTaller`.

Para colaborar, creá una rama por cambio y abrí un pull request.
