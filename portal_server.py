"""Servidor público separado, pendiente de configurar alojamiento y HTTPS.

No importa las API de administración. Lee la copia de datos y medios autorizados
del servidor. No debe publicarse app.py ni una carpeta completa de producciones.
"""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from flask import Flask
from listening_portal import portal_blueprint


def create_app():
    database=Path(os.environ['AUDIOTALLER_PORTAL_DB']).resolve()

    @contextmanager
    def read_only():
        db=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)
        db.row_factory=sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    portal=Flask(__name__,static_folder=None)
    portal.register_blueprint(portal_blueprint(read_only))
    portal.config.update(DEBUG=False,MAX_CONTENT_LENGTH=8192)
    return portal
