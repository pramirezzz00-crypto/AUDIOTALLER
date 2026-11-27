"""Loudness Penalty: guarda el último análisis en la carpeta de datos de AudioTaller.

Es una copia del audio analizado (no toca el original) y sus mediciones. Un análisis nuevo la reemplaza;
«Reiniciar» la borra.
"""
import json
import urllib.parse
from pathlib import Path
from flask import jsonify, request, send_file

MAX_BYTES = 600 * 1024 ** 2


def register_loudness_store(app, data_folder):
    def folder():
        return Path(data_folder()) / 'Loudness Penalty'

    def paths():
        return folder() / 'ultimo.audio', folder() / 'ultimo.json'

    @app.get('/api/loudness/ultimo')
    def loudness_last():
        audio, meta = paths()
        if not (audio.is_file() and meta.is_file()):
            return jsonify(hay=False)
        try:
            data = json.loads(meta.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return jsonify(hay=False)
        return jsonify(hay=True, **data)

    @app.get('/api/loudness/ultimo/audio')
    def loudness_last_audio():
        audio, _ = paths()
        if not audio.is_file():
            raise ValueError('No hay un análisis guardado.')
        return send_file(audio, mimetype='application/octet-stream', max_age=0)

    @app.post('/api/loudness/ultimo')
    def loudness_save():
        name = (request.args.get('nombre') or 'Audio')[:200]
        try:
            result = json.loads(urllib.parse.unquote(request.headers.get('X-Resultado') or '{}'))
        except ValueError:
            raise ValueError('Resultado inválido.')
        if request.content_length and request.content_length > MAX_BYTES:
            raise ValueError('El audio es demasiado grande para guardarlo.')
        audio, meta = paths()
        folder().mkdir(parents=True, exist_ok=True)
        temp = audio.with_suffix('.tmp')
        with open(temp, 'wb') as out:
            while True:
                chunk = request.stream.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        temp.replace(audio)
        meta.write_text(json.dumps(dict(nombre=name, resultado=result), ensure_ascii=False), encoding='utf-8')
        return jsonify(ok=True)

    @app.post('/api/loudness/ultimo/borrar')
    def loudness_delete():
        for path in paths():
            path.unlink(missing_ok=True)
        return jsonify(ok=True)
