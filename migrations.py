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
            migrate_session_selection(db, database)
            migrate_file_operations(db, database)
            migrate_publication(db, database)
            migrate_catalog(db, database)
            migrate_cloud_portal(db, database)
            migrate_portal_feedback(db, database)
            migrate_composition(db, database)
            migrate_redesign(db, database)
            migrate_audio_trash(db, database)
            migrate_entity_trash(db, database)
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
            db.execute('''CREATE TABLE sesion_vigente(
                cancion_id TEXT REFERENCES canciones(id), etapa TEXT REFERENCES etapas(clave),
                sesion_id TEXT NOT NULL REFERENCES sesiones(id), PRIMARY KEY(cancion_id,etapa))''')
            db.execute('INSERT INTO schema_audio VALUES(2)')
            db.commit()
            migrate_file_operations(db, database)
            migrate_publication(db, database)
            migrate_catalog(db, database)
            migrate_cloud_portal(db, database)
            migrate_portal_feedback(db, database)
            migrate_composition(db, database)
            migrate_redesign(db, database)
            migrate_audio_trash(db, database)
            migrate_entity_trash(db, database)
        except Exception:
            db.rollback()
            raise



def migrate_session_selection(db, database):
    """Guarda una sesión vigente por canción/etapa, con respaldo previo al cambio."""
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 2:
        return
    db.execute('BEGIN IMMEDIATE')
    backup = database.with_name(database.stem + '.respaldo-sesiones-' +
                                datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        db.execute("""CREATE TABLE sesion_vigente(
            cancion_id TEXT REFERENCES canciones(id), etapa TEXT REFERENCES etapas(clave),
            sesion_id TEXT NOT NULL REFERENCES sesiones(id), PRIMARY KEY(cancion_id,etapa))""")
        db.execute('UPDATE schema_audio SET version=2')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_file_operations(db, database):
    """Versionado estable, preferencias DAW y operaciones de copia recuperables."""
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 3:
        return
    db.execute('BEGIN IMMEDIATE')
    backup = database.with_name(database.stem + '.respaldo-operaciones-' +
                                datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        db.execute("""CREATE TABLE revision_sesion(
            sesion_id TEXT PRIMARY KEY REFERENCES sesiones(id), numero INTEGER NOT NULL,
            grupo TEXT NOT NULL, original_id TEXT REFERENCES sesiones(id), fecha_archivo REAL, criterio TEXT NOT NULL)""")
        db.execute("""CREATE TABLE preferencias_daw(
            id TEXT PRIMARY KEY, nombre TEXT NOT NULL, ejecutable TEXT NOT NULL,
            extension TEXT NOT NULL, plantilla TEXT DEFAULT '')""")
        db.execute("""CREATE TABLE operaciones_archivo(
            id TEXT PRIMARY KEY, cancion_id TEXT REFERENCES canciones(id), estado TEXT NOT NULL,
            datos TEXT NOT NULL, resultado TEXT, error TEXT, copiados INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0, creado TEXT DEFAULT CURRENT_TIMESTAMP, actualizado TEXT DEFAULT CURRENT_TIMESTAMP)""")
        db.execute('UPDATE schema_audio SET version=3')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_publication(db, database):
    """Ficha editorial separada: una obra puede tener varias grabaciones/ISRC.

    No se reinterpretan notas antiguas ni se asignan códigos oficiales. Las
    claves foráneas conservan los vínculos con las personas y proyectos reales.
    """
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 4:
        return
    db.execute('BEGIN IMMEDIATE')
    backup = database.with_name(database.stem + '.respaldo-publicacion-' +
                                datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        for table, parent in [('registro_persona', 'artistas'), ('registro_obra', 'canciones'),
                              ('registro_lanzamiento', 'discos')]:
            db.execute(f'CREATE TABLE {table}(id TEXT PRIMARY KEY REFERENCES {parent}(id), datos TEXT NOT NULL)')
        db.execute('''CREATE TABLE registro_grabacion(id TEXT PRIMARY KEY,
            cancion_id TEXT NOT NULL REFERENCES canciones(id), datos TEXT NOT NULL)''')
        db.execute('UPDATE schema_audio SET version=4')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_catalog(db, database):
    """Catálogo y selecciones de entrega, sin duplicar ni trasladar el audio.

    Cada favorito referencia un archivo concreto. Un enlace conserva una
    instantánea de selección y permisos, independiente de ediciones posteriores.
    """
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 5:
        return
    db.execute('BEGIN IMMEDIATE')
    backup = database.with_name(database.stem + '.respaldo-catalogo-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        statements = [
            '''CREATE TABLE ficha_cancion(id TEXT PRIMARY KEY REFERENCES canciones(id), datos TEXT NOT NULL,
               actualizado TEXT DEFAULT CURRENT_TIMESTAMP)''',
            '''CREATE TABLE catalogo_audio(archivo_id TEXT PRIMARY KEY REFERENCES archivos(id), favorito INTEGER DEFAULT 0,
               clase TEXT DEFAULT '', version TEXT DEFAULT '', notas TEXT DEFAULT '',
               grabacion_id TEXT REFERENCES registro_grabacion(id) ON DELETE SET NULL)''',
            '''CREATE TABLE playlists(id TEXT PRIMARY KEY, nombre TEXT NOT NULL, notas TEXT DEFAULT '',
               revision INTEGER DEFAULT 1, creado TEXT DEFAULT CURRENT_TIMESTAMP, actualizado TEXT DEFAULT CURRENT_TIMESTAMP)''',
            '''CREATE TABLE playlist_items(playlist_id TEXT REFERENCES playlists(id), archivo_id TEXT REFERENCES archivos(id),
               posicion INTEGER NOT NULL, PRIMARY KEY(playlist_id,archivo_id), UNIQUE(playlist_id,posicion))''',
            '''CREATE TABLE entregas_playlist(id TEXT PRIMARY KEY, playlist_id TEXT REFERENCES playlists(id), token_hash TEXT UNIQUE NOT NULL,
               nombre TEXT NOT NULL, instantanea TEXT NOT NULL, descarga INTEGER NOT NULL DEFAULT 0,
               clave_hash TEXT DEFAULT '', vence REAL NOT NULL, revocada INTEGER DEFAULT 0, creado TEXT DEFAULT CURRENT_TIMESTAMP)''',
        ]
        for statement in statements:
            db.execute(statement)
        db.execute('UPDATE schema_audio SET version=5')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_cloud_portal(db, database):
    """Registro de publicaciones externas; las credenciales se guardan fuera de SQLite."""
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 6:
        return
    db.execute('BEGIN IMMEDIATE')
    backup=database.with_name(database.stem+'.respaldo-portal-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        db.execute('CREATE TABLE portal_config(id INTEGER PRIMARY KEY CHECK(id=1),datos TEXT NOT NULL)')
        db.execute('''CREATE TABLE portal_publicaciones(id TEXT PRIMARY KEY,playlist_id TEXT NOT NULL REFERENCES playlists(id),
            proyecto TEXT NOT NULL,email TEXT NOT NULL,artist_uid TEXT DEFAULT '',url TEXT DEFAULT '',estado TEXT DEFAULT '',
            actualizado TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(playlist_id,proyecto))''')
        db.execute('''CREATE TABLE portal_drive(archivo_id TEXT REFERENCES archivos(id),proyecto TEXT NOT NULL,
            sha256 TEXT NOT NULL,datos TEXT NOT NULL,PRIMARY KEY(archivo_id,proyecto,sha256))''')
        db.execute('UPDATE schema_audio SET version=6')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_portal_feedback(db, database):
    """Devoluciones inmutables del artista y seguimiento privado del productor.

    Se conservan incluso si la próxima entrega quita el audio de la playlist.
    Ninguna contraseña ni token se almacena en esta tabla.
    """
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 7:
        return
    db.execute('BEGIN IMMEDIATE')
    backup=database.with_name(database.stem+'.respaldo-devoluciones-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        db.execute('''CREATE TABLE portal_devoluciones(
            id TEXT PRIMARY KEY,publicacion_id TEXT NOT NULL REFERENCES portal_publicaciones(id),
            playlist_id TEXT NOT NULL REFERENCES playlists(id),email TEXT NOT NULL,
            archivo_id TEXT NOT NULL,cancion_id TEXT NOT NULL,drive_id TEXT NOT NULL,
            revision INTEGER NOT NULL,etiqueta TEXT NOT NULL,texto TEXT NOT NULL,
            segundo REAL NOT NULL DEFAULT 0,creado TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'Pendiente',nota_interna TEXT NOT NULL DEFAULT '')''')
        db.execute('CREATE INDEX devoluciones_cancion ON portal_devoluciones(cancion_id,creado)')
        db.execute('UPDATE schema_audio SET version=7')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_composition(db, database):
    """Amplía la base conservando playlists, credenciales y referencias previas."""
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 8:
        return
    db.execute('BEGIN IMMEDIATE')
    backup=database.with_name(database.stem+'.respaldo-composicion-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        from composition import create_composition_schema
        create_composition_schema(db)
        db.execute('UPDATE schema_audio SET version=8')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_redesign(db, database):
    """Rediseño 0.3: seguimiento completo de devoluciones y datos de las pantallas nuevas.

    Solo agrega columnas y tablas; ningún dato existente cambia de lugar.
    """
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 9:
        return
    db.execute('BEGIN IMMEDIATE')
    backup=database.with_name(database.stem+'.respaldo-rediseno-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        for column in ("respuesta TEXT NOT NULL DEFAULT ''", "resuelve_archivo TEXT NOT NULL DEFAULT ''",
                       'bucle_inicio REAL', 'bucle_fin REAL', "actualizado TEXT NOT NULL DEFAULT ''"):
            existing = {row[1] for row in db.execute('PRAGMA table_info(portal_devoluciones)')}
            if column.split()[0] not in existing:
                db.execute('ALTER TABLE portal_devoluciones ADD COLUMN '+column)
        # Documentos JSON por tipo (campañas, proyectos audiovisuales, letras por secciones, medidas de audio…).
        db.execute('''CREATE TABLE IF NOT EXISTS rediseno_datos(tipo TEXT NOT NULL,id TEXT NOT NULL,datos TEXT NOT NULL,
            actualizado TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tipo,id))''')
        db.execute('UPDATE schema_audio SET version=9')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_audio_trash(db, database):
    """Permite ocultar y restaurar archivos sin alterar sus relaciones ni su origen."""
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 10:
        return
    db.execute('BEGIN IMMEDIATE')
    backup = database.with_name(database.stem + '.respaldo-papelera-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        columns = {row[1] for row in db.execute('PRAGMA table_info(archivos)')}
        if 'eliminado_en' not in columns:
            db.execute("ALTER TABLE archivos ADD COLUMN eliminado_en TEXT NOT NULL DEFAULT ''")
        db.execute("CREATE INDEX IF NOT EXISTS archivos_papelera ON archivos(eliminado_en) WHERE eliminado_en <> ''")
        db.execute('UPDATE schema_audio SET version=10')
        db.commit()
    except Exception:
        db.rollback()
        raise


def migrate_entity_trash(db, database):
    """Agrega papelera recuperable para artistas y proyectos sin borrar sus relaciones."""
    if db.execute('SELECT version FROM schema_audio').fetchone()[0] >= 11:
        return
    db.execute('BEGIN IMMEDIATE')
    backup = database.with_name('respaldo-papelera-entidades-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
    try:
        with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(backup)) as target:
            source.backup(target)
        db.execute('''CREATE TABLE IF NOT EXISTS entidades_papelera(
            tipo TEXT NOT NULL,id TEXT NOT NULL,grupo TEXT NOT NULL,eliminado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(tipo,id))''')
        db.execute('CREATE INDEX IF NOT EXISTS entidades_papelera_grupo ON entidades_papelera(grupo)')
        db.execute('UPDATE schema_audio SET version=11')
        db.commit()
    except Exception:
        db.rollback()
        raise
