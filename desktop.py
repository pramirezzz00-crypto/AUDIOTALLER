"""Entrada de escritorio de AudioTaller para Windows y macOS."""

import ctypes
import logging
import os
from pathlib import Path
import sqlite3
import sys
from version import DISPLAY_VERSION
from runtime_paths import data_directory


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
        result={'ok':True,'version':DISPLAY_VERSION,'frozen':bool(getattr(sys,'frozen',False)),
                'datos_aislados':True,'recursos':True,**native,
                'artista_cancion_audio_playlist':True,'recursos_portal':True,'portal_sin_credenciales':True}
    Path(output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')


def main():
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

    # Identidad propia en la barra de tareas y el icono del acceso directo.
    if os.name == 'nt':
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('AudioTaller.Desktop')
    webview.create_window('AudioTaller - '+DISPLAY_VERSION, app, width=1280, height=800, js_api=Dialogs())
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
