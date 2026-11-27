"""Perfil del productor o del estudio: datos de contacto, productores y logo para presupuestos y saludos."""
import base64
import re
from pathlib import Path
from flask import jsonify, request, send_file
from redesign import doc_get, doc_put, short_text

FIELDS = ('nombre', 'apellido', 'estudio', 'email', 'celular', 'telefono', 'web', 'instagram', 'direccion', 'ciudad', 'cuit', 'color')


def clean_person(value):
    if not isinstance(value, dict):
        raise ValueError('Productor inválido.')
    return {k: short_text(value.get(k, ''), 120) for k in ('nombre', 'apellido', 'rol', 'celular', 'email')}


def load_profile(db):
    return doc_get(db, 'perfil_estudio', 'principal', {})


def display_name(profile):
    if not profile:
        return ''
    if profile.get('tipo') == 'estudio' and not profile.get('nombre'):
        return profile.get('estudio', '')
    return profile.get('nombre', '').split(' ')[0]


def register_studio_profile(app, connect, data_folder):
    def logo_path():
        return Path(data_folder()) / 'perfil' / 'logo.jpg'

    @app.get('/api/perfil')
    def profile_get():
        with connect() as db:
            profile = load_profile(db)
        return jsonify(perfil=profile, configurado=bool(profile.get('configurado')), logo=logo_path().exists())

    @app.post('/api/perfil')
    def profile_save():
        data = request.get_json() or {}
        kind = data.get('tipo', 'productor')
        if kind not in ('productor', 'estudio'):
            raise ValueError('Elegí productor o estudio.')
        profile = {k: short_text(data.get(k, ''), 200) for k in FIELDS}
        profile['tipo'] = kind
        if kind == 'estudio' and not profile['estudio']:
            raise ValueError('Escribí el nombre del estudio.')
        if kind == 'productor' and not profile['nombre']:
            raise ValueError('Escribí tu nombre.')
        people = data.get('productores', [])
        if not isinstance(people, list) or len(people) > 30:
            raise ValueError('Podés cargar hasta 30 productores.')
        profile['productores'] = [p for p in (clean_person(x) for x in people) if p['nombre']] if kind == 'estudio' else []
        if profile['color'] and not re.fullmatch(r'#[0-9a-fA-F]{6}', profile['color']):
            raise ValueError('Color inválido.')
        profile['configurado'] = True
        with connect() as db:
            doc_put(db, 'perfil_estudio', 'principal', profile)
        return jsonify(perfil=profile)

    @app.post('/api/perfil/omitir')
    def profile_skip():
        with connect() as db:
            profile = load_profile(db)
            profile['omitido'] = True
            doc_put(db, 'perfil_estudio', 'principal', profile)
        return jsonify(ok=True)

    @app.post('/api/perfil/logo')
    def profile_logo():
        data = request.get_json() or {}
        if data.get('borrar'):
            logo_path().unlink(missing_ok=True)
            return jsonify(ok=True)
        value = str(data.get('jpeg', ''))
        if not value.startswith('data:image/jpeg;base64,'):
            raise ValueError('El logo tiene que llegar como imagen JPEG.')
        raw = base64.b64decode(value.split(',', 1)[1])
        if len(raw) > 2_000_000 or not raw.startswith(b'\xff\xd8'):
            raise ValueError('El logo es demasiado grande o no es una imagen válida.')
        logo_path().parent.mkdir(parents=True, exist_ok=True)
        logo_path().write_bytes(raw)
        return jsonify(ok=True)

    @app.get('/api/perfil/logo')
    def profile_logo_get():
        if not logo_path().exists():
            raise ValueError('Todavía no cargaste un logo.')
        response = send_file(logo_path(), mimetype='image/jpeg')
        response.headers['Cache-Control'] = 'no-store'
        return response

    return logo_path
