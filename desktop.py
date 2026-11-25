"""Entrada de escritorio de AudioTaller para Windows y macOS."""

import ctypes
import logging
import os
from pathlib import Path
import sqlite3
import sys
from version import DISPLAY_VERSION
from runtime_paths import data_directory, open_path


def self_test(output):
    """Diagnóstico del paquete con datos sintéticos en un directorio temporal.

    No abre bases del productor, no conecta Google y no sube ningún archivo.
    Comprueba recursos, migraciones, reproducción y módulos nativos congelados.
    """
    import io
    import json
    import tempfile
    import wave
    import app as backend
    native = {}
    if sys.platform == 'darwin':
        from webview.platforms import cocoa
        native['cocoa'] = True
        from cloud_auth import CredentialStore, mac_keyring
        import uuid
        probe = CredentialStore(Path(tempfile.gettempdir())/('audiotaller-diagnostico-'+uuid.uuid4().hex))
        try:
            probe.write({'diagnostico':'dato sintético temporal'})
            assert probe.read()=={'diagnostico':'dato sintético temporal'}
            assert not probe.path.exists()
            native['llavero'] = True
        finally:
            mac_keyring().delete_password('org.audiotaller.desktop', probe.keychain_account())
    else:
        import clr
        clr.AddReference('System.Windows.Forms')
        from webview.platforms import winforms
        native.update(clr=True, webview2_detectado=winforms._is_chromium())
    with tempfile.TemporaryDirectory(prefix='AudioTaller-diagnostico-') as folder:
        backend.DB=Path(folder)/'prueba.sqlite3'
        backend.LIBRARY=Path(folder)/'Artistas'
        client=backend.app.test_client()
        assert client.get('/').status_code==200
        for asset in ('branding/audiotaller-mark.svg','cloud-ui.js','song-data.js','waveforms.js'):
            assert client.get('/static/'+asset).status_code==200,asset
        artist=client.post('/api/artistas',json={'nombre':'Artista de prueba'}).json['id']
        song=client.post('/api/artistas/'+artist+'/canciones',json={'titulo':'Prueba instalada'}).json['id']
        raw=io.BytesIO()
        with wave.open(raw,'wb') as audio:
            audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(8000);audio.writeframes(b'\0\0'*800)
        file=client.post('/api/produccion/'+song+'/archivos/demo',data={'file':(io.BytesIO(raw.getvalue()),'Prueba.wav')}).json['id']
        assert client.get('/api/produccion/archivo/'+file).status_code==200
        playlist=client.post('/api/playlists',json={'nombre':'Escucha de prueba','archivos':[file]}).json
        assert playlist['audios'][0]['id']==file
        assert client.get('/api/portal/config').json['config']=={}
        assert client.get('/api/portal/devoluciones').json==[]
        from cloud_portal import ASSETS
        assert (ASSETS/'firestore.rules').is_file()
        for asset in ('config.json','index.html','portal.js','portal.css'):
            assert (ASSETS/'public'/asset).is_file(),'Falta recurso del portal: '+asset
        assert not any(json.loads((ASSETS/'public/config.json').read_text(encoding='utf-8')).values())
        assert (Path(__file__).parent/'docs/AudioTaller_Instructivo_Portal_del_Artista.pdf').is_file()
        # Recorre las pantallas con la base recién creada: cualquier error 500 queda en el diagnóstico.
        import logging, re as _re
        trazas=[]
        class Captura(logging.Handler):
            def emit(self, record):
                if record.exc_info:
                    import traceback
                    trazas.append(''.join(traceback.format_exception(*record.exc_info))[-1500:])
        backend.app.logger.addHandler(Captura())
        fallas=[]
        def probar(metodo, ruta, **datos):
            respuesta=getattr(client, metodo)(ruta, **datos)
            if respuesta.status_code>=500 or (respuesta.status_code>=400 and not respuesta.is_json):
                detalle=(respuesta.get_json(silent=True) or {}).get('error') or respuesta.get_data(as_text=True)[:200]
                fallas.append(f'{metodo.upper()} {ruta} -> {respuesta.status_code}: {detalle}')
            return respuesta
        nueva=probar('post','/api/playlists',json={'nombre':'CANCIONES1','notas':'','archivos':[]}).get_json(silent=True) or {}
        ids={'pid':nueva.get('id',''),'aid':artist,'sid':song,'did':'','fid':file}
        for regla in backend.app.url_map.iter_rules():
            ruta=str(regla)
            if 'GET' not in regla.methods or not ruta.startswith('/api/') or 'onda' in ruta or 'pdf' in ruta or 'audio' in ruta:
                continue
            if any(a not in ids or not ids[a] for a in regla.arguments):
                continue
            for a in regla.arguments:
                ruta=_re.sub(r'<(?:[a-z]+:)?'+a+'>', ids[a], ruta)
            probar('get', ruta)
        result_extra={'pantallas_fallidas':fallas,'trazas':trazas[:5]}
        result={'ok':True,'version':DISPLAY_VERSION,'frozen':bool(getattr(sys,'frozen',False)),
                'datos_aislados':True,'recursos':True,**native,
                'artista_cancion_audio_playlist':True,'recursos_portal':True,'portal_sin_credenciales':True}
        result.update(result_extra)
    Path(output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')


def smoke_test(output):
    """Abre una ventana real con datos aislados y comprueba que renderice la interfaz."""
    import json
    import tempfile
    import webview
    import app as backend
    with tempfile.TemporaryDirectory(prefix='AudioTaller-ventana-') as folder:
        backend.DB=Path(folder)/'prueba.sqlite3'
        backend.LIBRARY=Path(folder)/'Artistas'
        result={}
        window=webview.create_window('AudioTaller - diagnóstico',backend.app,width=1280,height=800)
        def loaded():
            try:
                result['ok']=bool(window.evaluate_js("document.body.innerText.includes('AudioTaller') && document.querySelector('nav') !== null"))
                result['ventana_nativa']=True
            except Exception as error:
                result.update(ok=False,error=str(error))
            finally:
                Path(output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
                window.destroy()
        window.events.loaded += loaded
        webview.start(gui='cocoa' if sys.platform=='darwin' else 'edgechromium',debug=False)
        assert result.get('ok'), 'La ventana no completó la carga de la interfaz'


def main():
    if len(sys.argv)==3 and sys.argv[1]=='--smoke-test':
        smoke_test(sys.argv[2]);return
    if len(sys.argv)==3 and sys.argv[1]=='--self-test':
        self_test(sys.argv[2]);return
    # Guardamos los datos por usuario, fuera de la carpeta del programa.
    datos = data_directory()
    datos.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=datos / "inicio.log", encoding="utf-8", level=logging.INFO)

    import webview
    from app import app

    # El programa y los datos viven separados. Actualizar o desinstalar la app
    # conserva esta carpeta; las migraciones de app.py realizan sus respaldos.
    base = datos / "audiotaller.sqlite3"
    conexion = sqlite3.connect(base)
    conexion.close()
    app.config.update(DEBUG=False, DATABASE=base)

    # pywebview sirve Flask en una dirección local y muestra la misma página
    # de bienvenida dentro de la ventana. Al cerrarla termina el proceso.
    class Dialogs:
        # Se devuelve la ubicación elegida, sin copiar ni mover el archivo.
        def choose_path(self, folder=False):
            kind = webview.FileDialog.FOLDER if folder else webview.FileDialog.OPEN
            result = webview.windows[0].create_file_dialog(kind, allow_multiple=False)
            return result[0] if result else ''

        def choose_audio_files(self, audio_only=False):
            # El usuario puede seleccionar varios archivos de audio en una sola operación.
            options = {'allow_multiple': True}
            if audio_only:
                options['file_types'] = (
                    'Audio (*.wav;*.mp3;*.flac;*.ogg;*.m4a;*.aac;*.opus;*.aif;*.aiff)',
                    'Todos los archivos (*.*)',
                )
            result = webview.windows[0].create_file_dialog(webview.FileDialog.OPEN, **options)
            return list(result) if result else []

        def choose_score_files(self):
            # PDF e imágenes de partituras; se conservan en su ubicación original.
            result = webview.windows[0].create_file_dialog(
                webview.FileDialog.OPEN, allow_multiple=True,
                file_types=(
                    'Partituras (*.pdf;*.png;*.jpg;*.jpeg;*.mscz;*.sib;*.dorico;*.musx;*.mus;*.musicxml;*.mxl;*.xml)',
                    'Todos los archivos (*.*)',
                )
            )
            return list(result) if result else []

        def choose_lyric_files(self):
            # TXT y DOCX; se conservan en su ubicación original.
            result = webview.windows[0].create_file_dialog(
                webview.FileDialog.OPEN, allow_multiple=True,
                file_types=('Letras (*.txt;*.docx)', 'Todos los archivos (*.*)')
            )
            return list(result) if result else []

        def open_lyric_location(self, lyric_id):
            from app import db_open
            with db_open() as db:
                row = db.execute('SELECT ruta FROM composition_lyrics WHERE id=?', (str(lyric_id),)).fetchone()
            if not row: return False
            try:
                archivo = Path(row['ruta']).resolve(strict=True)
                if not archivo.is_file(): return False
                open_path(str(archivo.parent))
                return True
            except (OSError, RuntimeError): return False

        def open_score_location(self, score_id):
            from app import db_open
            with db_open() as db:
                row = db.execute('SELECT ruta FROM composition_scores WHERE id=?', (str(score_id),)).fetchone()
            if not row:
                return False
            try:
                archivo = Path(row['ruta']).resolve(strict=True)
                if not archivo.is_file():
                    return False
                open_path(str(archivo.parent))
                return True
            except (OSError, RuntimeError):
                return False

        def open_folder_for(self, kind, identity):
            # Carpetas que arma AudioTaller (Entregas, Trámites): se resuelven desde la base, nunca desde una ruta del navegador.
            from app import db_open
            table = {'disco': 'discos', 'cancion': 'canciones'}.get(str(kind).split(':')[0])
            if not table:
                return False
            with db_open() as db:
                row = db.execute(f'SELECT carpeta FROM {table} WHERE id=?', (str(identity),)).fetchone()
            if not row:
                return False
            sub = 'Trámites' if str(kind).endswith(':tramites') else 'Entregas'
            target = Path(row['carpeta']) / sub
            if not target.is_dir():
                return False
            open_path(str(target))
            return True

        def copy_text(self, text):
            try:
                import subprocess
                if os.name == 'nt':
                    subprocess.run(['clip'], input=str(text).encode('utf-16-le'), check=True)
                elif sys.platform == 'darwin':
                    subprocess.run(['pbcopy'], input=str(text).encode(), check=True)
                else:
                    return False
                return True
            except Exception:
                return False

        def open_location(self, beat_id):
            # El ID se resuelve contra la biblioteca local; nunca se acepta una ruta del navegador.
            from app import db_open
            with db_open() as db:
                row = db.execute('SELECT ruta FROM composition_beats WHERE id=?', (str(beat_id),)).fetchone()
            if not row:
                return False
            try:
                archivo = Path(row['ruta']).resolve(strict=True)
                if not archivo.is_file():
                    return False
                open_path(str(archivo.parent))
                return True
            except (OSError, RuntimeError):
                return False


    # Identidad propia en la barra de tareas y el icono del acceso directo.
    if os.name == 'nt':
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('AudioTaller.Desktop')
    webview.create_window('AudioTaller - '+DISPLAY_VERSION, app, width=1280, height=800, js_api=Dialogs(), background_color='#000000')
    icon=Path(__file__).parent/'static'/'branding'/'AudioTaller.ico'
    webview.start(gui='cocoa' if sys.platform == 'darwin' else 'edgechromium',debug=False,
                  icon=str(icon) if os.name == 'nt' and icon.is_file() else None)


if __name__ == "__main__":
    try:
        from multiprocessing import freeze_support
        freeze_support()
        main()
    except Exception:
        if len(sys.argv)==3 and sys.argv[1]=='--self-test':
            import json
            import traceback
            Path(sys.argv[2]).write_text(json.dumps({'ok':False,'error':traceback.format_exc()},ensure_ascii=False),encoding='utf-8')
            raise SystemExit(1)
        # pythonw.exe arranca sin consola. Mostramos el error en Windows y
        # dejamos el detalle en el registro si se pudo inicializar.
        logging.exception("Error al iniciar AudioTaller")
        if os.name == 'nt':
            ctypes.windll.user32.MessageBoxW(None, 'No se pudo iniciar AudioTaller. Revisá el registro inicio.log en tu carpeta de datos.', 'AudioTaller', 0x10)
        else:
            print('No se pudo iniciar AudioTaller. Revisá '+str(data_directory()/'inicio.log'), file=sys.stderr)
        raise SystemExit(1)
