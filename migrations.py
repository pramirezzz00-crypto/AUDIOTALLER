"""Migraciones incrementales. Toda ampliación conserva los identificadores y rutas previas."""
from contextlib import closing
import json
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path

LOCK = threading.Lock()
CATEGORIES = ('Solista', 'Banda', 'Agrupación', 'Músico', 'Arreglista', 'Productor / Técnico')
STAGES = (
    ('demo', '01. Demo', 'pre', '01. DEMO'),
    ('maqueta', '02. Maquetado', 'pre', '02. MAQUETADO'),
    ('grabacion', '03. Grabación', 'prod', '03. GRABACIÓN'),
    ('mezcla', '04. Mezcla', 'prod', '04. PRODUCCIÓN/Mezcla'),
    ('mastering', '05. Mastering', 'prod', '04. PRODUCCIÓN/Mastering'),
)
LEGACY_STAGE = {'01. DEMO': 'demo', '02. MAQUETADO': 'maqueta', '03. GRABACIÓN': 'grabacion',
                'Mezcla': 'mezcla', 'Mastering': 'mastering'}


def migrate(db, database):
    """Serializa la migración y respalda una instantánea antes del primer DDL nuevo."""
    with LOCK:
        exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='schema_audio'").fetchone()
        if exists and db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 1:
            return
        db.execute('BEGIN IMMEDIATE')
        backup = database.with_name(database.stem + '.respaldo-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
        try:
            with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
                source.backup(target)
            # execute conserva la transacción. executescript haría un COMMIT anticipado.
            statements = [
                'CREATE TABLE schema_audio(version INTEGER NOT NULL)',
                'CREATE TABLE clasificaciones(nombre TEXT PRIMARY KEY)',
                '''CREATE TABLE roles_artista(artista_id TEXT REFERENCES artistas(id), nombre TEXT REFERENCES clasificaciones(nombre),
                   PRIMARY KEY(artista_id,nombre))''',
                '''CREATE TABLE etiquetas_artista(artista_id TEXT REFERENCES artistas(id), clase TEXT CHECK(clase IN ('instrumento','especialidad')),
                   nombre TEXT NOT NULL, PRIMARY KEY(artista_id,clase,nombre))''',
                '''CREATE TABLE participaciones(id TEXT PRIMARY KEY, grupo_id TEXT REFERENCES artistas(id), persona_id TEXT REFERENCES artistas(id),
                   funcion TEXT, desde TEXT, hasta TEXT, estado TEXT, UNIQUE(grupo_id,persona_id,desde))''',
                '''CREATE TABLE creditos(id TEXT PRIMARY KEY, persona_id TEXT REFERENCES artistas(id), disco_id TEXT REFERENCES discos(id),
                   cancion_id TEXT REFERENCES canciones(id), rol TEXT NOT NULL,
                   CHECK((disco_id IS NULL) != (cancion_id IS NULL)))''',
                'CREATE TABLE etapas(clave TEXT PRIMARY KEY, nombre TEXT, macro TEXT, carpeta TEXT)',
                '''CREATE TABLE sesion_info(id TEXT PRIMARY KEY REFERENCES sesiones(id), nombre TEXT NOT NULL,
                   principal INTEGER NOT NULL DEFAULT 0, modo TEXT DEFAULT 'administrada')''',
                '''CREATE TABLE archivos(id TEXT PRIMARY KEY, cancion_id TEXT REFERENCES canciones(id), etapa TEXT REFERENCES etapas(clave),
                   sesion_id TEXT REFERENCES sesiones(id), nombre TEXT NOT NULL, ruta TEXT NOT NULL, modo TEXT NOT NULL,
                   creado TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(cancion_id,etapa,ruta))''',
                '''CREATE TABLE eventos(id TEXT PRIMARY KEY, cancion_id TEXT REFERENCES canciones(id), etapa TEXT,
                   tipo TEXT NOT NULL, referencia TEXT, detalle TEXT, creado TEXT DEFAULT CURRENT_TIMESTAMP)''',
                '''CREATE TABLE notas_etapa(cancion_id TEXT REFERENCES canciones(id), etapa TEXT REFERENCES etapas(clave),
                   texto TEXT NOT NULL, PRIMARY KEY(cancion_id,etapa))''',
                '''CREATE TABLE estado_cancion(id TEXT PRIMARY KEY REFERENCES canciones(id), estado TEXT DEFAULT 'En producción',
                   actualizado TEXT DEFAULT CURRENT_TIMESTAMP)''',
            ]
            for statement in statements:
                db.execute(statement)
            db.executemany('INSERT INTO clasificaciones VALUES(?)', [(name,) for name in CATEGORIES])
            db.executemany('INSERT INTO etapas VALUES(?,?,?,?)', STAGES)
            mapping = {'Artista': 'Solista', 'Grupo': 'Agrupación', 'Banda': 'Banda'}
            for artist in db.execute('SELECT id,tipo FROM artistas').fetchall():
                role = mapping.get(artist['tipo'], 'Solista')
                db.execute('INSERT INTO roles_artista VALUES(?,?)', (artist['id'], role))
            for row in db.execute('SELECT * FROM sesiones').fetchall():
                db.execute('INSERT INTO sesion_info(id,nombre) VALUES(?,?)',
                           (row['id'], Path(row['ruta']).stem or 'Sesión anterior'))
            # Se catalogan los adjuntos históricos administrados. Las carpetas externas solo se vinculan.
            legacy_paths = {'demo': ['01. DEMO/Adjuntos', 'demo/Adjuntos'],
                            'maqueta': ['02. MAQUETADO/Adjuntos', 'maqueta/Adjuntos'],
                            'grabacion': ['03. GRABACIÓN/Adjuntos', 'grabacion/Adjuntos'],
                            'mezcla': ['04. PRODUCCIÓN/Mezcla/Adjuntos'],
                            'mastering': ['04. PRODUCCIÓN/Mastering/Adjuntos']}
            for song in db.execute('SELECT id,carpeta FROM canciones').fetchall():
                root = Path(song['carpeta'])
                for stage, folders in legacy_paths.items():
                    for folder in folders:
                        directory = root / folder
                        if not directory.is_dir():
                            continue
                        for file in directory.iterdir():
                            if file.is_file() and not file.is_symlink():
                                db.execute('INSERT OR IGNORE INTO archivos VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
                                           (uuid.uuid4().hex, song['id'], stage, None, file.name, str(file.resolve()), 'importado'))
                # La versión anterior mezclaba Mezcla y Mastering en esta carpeta.
                directory = root / 'produccion/Adjuntos'
                if directory.is_dir():
                    db.execute("INSERT OR IGNORE INTO etapas VALUES('historico','Adjuntos históricos sin etapa','prod','produccion')")
                    for file in directory.iterdir():
                        if file.is_file() and not file.is_symlink():
                            db.execute('INSERT OR IGNORE INTO archivos(id,cancion_id,etapa,nombre,ruta,modo) VALUES(?,?,?,?,?,?)',
                                       (uuid.uuid4().hex, song['id'], 'historico', file.name, str(file.resolve()), 'importado'))
            db.execute('INSERT INTO schema_audio VALUES(1)')
            db.commit()
        except Exception:
            db.rollback()
            raise

