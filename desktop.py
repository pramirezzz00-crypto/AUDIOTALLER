"""Entrada de escritorio de AudioTaller para Windows."""

import ctypes
import logging
import os
from pathlib import Path
import sqlite3


def main():
    # Guardamos los datos por usuario, fuera de la carpeta del programa.
    datos = Path(os.environ["LOCALAPPDATA"]) / "AudioTaller"
    datos.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=datos / "inicio.log", encoding="utf-8", level=logging.INFO)

    import webview
    from app import app

    # SQLite crea el archivo al abrirlo. Las futuras migraciones definirán
    # las tablas de proyectos y canciones cuando se implemente su gestión.
    base = datos / "audiotaller.sqlite3"
    conexion = sqlite3.connect(base)
    conexion.close()
    app.config.update(DEBUG=False, DATABASE=base)

    # pywebview sirve Flask en una dirección local y muestra la misma página
    # de bienvenida dentro de la ventana. Al cerrarla termina el proceso.
    webview.create_window("AudioTaller", app, width=1000, height=700)
    webview.start(gui="edgechromium", debug=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # pythonw.exe arranca sin consola. Mostramos el error en Windows y
        # dejamos el detalle en el registro si se pudo inicializar.
        logging.exception("Error al iniciar AudioTaller")
        ctypes.windll.user32.MessageBoxW(
            None,
            "No se pudo iniciar AudioTaller. Revisa %LOCALAPPDATA%\\AudioTaller\\inicio.log.",
            "AudioTaller",
            0x10,
        )
        raise SystemExit(1)
