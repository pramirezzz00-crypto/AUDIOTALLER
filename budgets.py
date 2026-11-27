"""Presupuestos por canción, disco o cantidad de canciones, con bloques de ítems y PDF con el logo del estudio."""
import io
import json
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from flask import jsonify, request, send_file
from redesign import doc_get, doc_list, doc_put, short_text
from metadata_export import pdf_text, text_width, wrap
from studio_profile import load_profile

UNITS = ('hs', 'UN', 'día', 'sesión', 'canción', 'mes')
STATES = ('Borrador', 'Enviado', 'Aceptado', 'Rechazado')

# Bloques del modelo de presupuesto (A–E del ejemplo) más Postproducción.
TEMPLATE = [
    dict(id='locaciones', titulo='Locaciones', items=[
        dict(concepto='Estudio de grabación (con técnico)', valor=40, cantidad=6, unidad='hs'),
        dict(concepto='Estudio de mezcla', valor=60, cantidad=1, unidad='UN')]),
    dict(id='tecnico', titulo='Personal técnico', items=[
        dict(concepto='Ingeniero de grabación', valor=300, cantidad=1, unidad='UN'),
        dict(concepto='Ingeniero de mezcla', valor=300, cantidad=1, unidad='UN')]),
    dict(id='artistico', titulo='Personal artístico', items=[
        dict(concepto='Guitarrista', valor=20, cantidad=3, unidad='hs'),
        dict(concepto='Bajista', valor=20, cantidad=3, unidad='hs')]),
    dict(id='soporte', titulo='Soporte', items=[
        dict(concepto='Disco rígido', valor=100, cantidad=1, unidad='UN')]),
    dict(id='catering', titulo='Catering', items=[
        dict(concepto='Servicio de catering', valor=25, cantidad=2, unidad='UN')]),
    dict(id='postproduccion', titulo='Postproducción', items=[
        dict(concepto='Mastering', valor=300, cantidad=1, unidad='UN', por_cancion=True)]),
]
SUGGESTIONS = {
    'locaciones': ['Estudio de grabación (con técnico)', 'Estudio de mezcla', 'Sala de ensayo', 'Estudio de mastering'],
    'tecnico': ['Ingeniero de grabación', 'Ingeniero de mezcla', 'Asistente de estudio', 'Edición y comping', 'Afinación de voces'],
    'artistico': ['Guitarrista', 'Bajista', 'Baterista', 'Tecladista', 'Violinista', 'Violista', 'Chelista', 'Percusionista', 'Vientos', 'Coros', 'Arreglador'],
    'soporte': ['Disco rígido', 'Material virgen (CD)', 'Alquiler de instrumentos', 'Alquiler de micrófonos'],
    'catering': ['Servicio de catering', 'Traslados', 'Alojamiento'],
    'postproduccion': ['Mastering', 'Mastering para vinilo', 'Stems', 'Versión instrumental', 'Dolby Atmos'],
    'produccion': ['Producción artística', 'Preproducción y maqueta', 'Arreglos', 'Dirección musical'],
}


def num(value, minimum=0, maximum=10 ** 9):
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError('Revisá los números del presupuesto.') from None
    if not minimum <= value <= maximum:
        raise ValueError('Un valor del presupuesto está fuera de rango.')
    return round(value, 2)


def clean_budget(data):
    blocks = data.get('bloques', [])
    if not isinstance(blocks, list) or len(blocks) > 30:
        raise ValueError('Demasiados bloques.')
    clean_blocks = []
    for block in blocks:
        items = block.get('items', [])
        if not isinstance(items, list) or len(items) > 80:
            raise ValueError('Demasiados ítems en un bloque.')
        clean_blocks.append(dict(id=short_text(block.get('id') or uuid.uuid4().hex[:8], 40), titulo=short_text(block.get('titulo', ''), 80) or 'Otros',
                                 items=[dict(concepto=short_text(i.get('concepto', ''), 160), valor=num(i.get('valor', 0)), cantidad=num(i.get('cantidad', 1)),
                                             unidad=i.get('unidad') if i.get('unidad') in UNITS else 'UN', por_cancion=bool(i.get('por_cancion')),
                                             nota=short_text(i.get('nota', ''), 200)) for i in items]))
    scope = data.get('alcance') or {}
    kind = scope.get('tipo', 'cantidad')
    if kind not in ('cancion', 'disco', 'cantidad'):
        raise ValueError('Elegí si el presupuesto es por canción, por disco o por cantidad de canciones.')
    currency = lambda v, d: v if v in ('USD', 'ARS') else d
    validity = data.get('validez') or {}
    return dict(titulo=short_text(data.get('titulo', ''), 150) or 'Presupuesto', cliente=short_text(data.get('cliente', ''), 150),
                artista_id=short_text(data.get('artista_id', ''), 40), numero=short_text(data.get('numero', ''), 30),
                alcance=dict(tipo=kind, cancion_id=short_text(scope.get('cancion_id', ''), 40), disco_id=short_text(scope.get('disco_id', ''), 40),
                             cantidad=int(num(scope.get('cantidad', 1), 1, 200))),
                moneda=currency(data.get('moneda'), 'USD'), moneda_pdf=currency(data.get('moneda_pdf'), 'USD'), moneda_pago=currency(data.get('moneda_pago'), 'USD'),
                cotizacion=num(data.get('cotizacion', 1000), 0.0001, 10 ** 8), cotizacion_fuente=short_text(data.get('cotizacion_fuente', ''), 80),
                validez=dict(mostrar=bool(validity.get('mostrar', True)), dias=int(num(validity.get('dias', 15), 1, 365))),
                descuento=num(data.get('descuento', 0), 0, 100), impuesto=num(data.get('impuesto', 0), 0, 100),
                impuesto_nombre=short_text(data.get('impuesto_nombre', 'IVA'), 40), adelanto=num(data.get('adelanto', 0), 0, 100),
                plan=short_text(data.get('plan', ''), 6000), notas=short_text(data.get('notas', ''), 4000),
                estado=data.get('estado') if data.get('estado') in STATES else 'Borrador', bloques=clean_blocks)


def songs_in_scope(db, doc):
    scope = doc['alcance']
    if scope['tipo'] == 'cancion':
        row = db.execute('SELECT c.titulo, a.nombre AS artista FROM canciones c JOIN artistas a ON a.id=c.artista_id WHERE c.id=?', (scope['cancion_id'],)).fetchone()
        return 1, (f"Canción «{row['titulo']}» · {row['artista']}" if row else 'Una canción')
    if scope['tipo'] == 'disco':
        row = db.execute('SELECT d.nombre, a.nombre AS artista FROM discos d JOIN artistas a ON a.id=d.artista_id WHERE d.id=?', (scope['disco_id'],)).fetchone()
        count = db.execute('SELECT COUNT(*) FROM canciones WHERE disco_id=?', (scope['disco_id'],)).fetchone()[0] if row else 0
        count = max(count, 1)
        return count, (f"Disco «{row['nombre']}» · {row['artista']} · {count} canción{'es' if count != 1 else ''}" if row else 'Un disco')
    n = scope['cantidad']
    return n, f"{n} canción{'es' if n != 1 else ''}"


def compute(doc, songs):
    blocks, subtotal = [], 0.0
    for block in doc['bloques']:
        items = []
        for item in block['items']:
            factor = songs if item['por_cancion'] else 1
            total = round(item['valor'] * item['cantidad'] * factor, 2)
            items.append(dict(item, total=total, factor=factor))
        block_total = round(sum(i['total'] for i in items), 2)
        subtotal += block_total
        blocks.append(dict(block, items=items, total=block_total))
    discount = round(subtotal * doc['descuento'] / 100, 2)
    taxed = subtotal - discount
    tax = round(taxed * doc['impuesto'] / 100, 2)
    total = round(taxed + tax, 2)
    return dict(bloques=blocks, subtotal=round(subtotal, 2), descuento=discount, impuesto=tax, total=total, adelanto=round(total * doc['adelanto'] / 100, 2))


def convert(value, source, target, rate):
    if source == target:
        return value
    return value * rate if (source, target) == ('USD', 'ARS') else value / rate


def money(value, currency):
    whole = f'{value:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    if whole.endswith(',00'):
        whole = whole[:-3]
    return f'{whole} {currency}'


def register_budgets(app, connect, logo_path):
    @app.get('/api/presupuestos')
    def budgets_list():
        with connect() as db:
            docs = doc_list(db, 'presupuesto')
            out = []
            for identity, doc in docs.items():
                songs, scope = songs_in_scope(db, doc)
                totals = compute(doc, songs)
                out.append(dict(id=identity, titulo=doc['titulo'], cliente=doc['cliente'], numero=doc.get('numero', ''), estado=doc['estado'],
                                total=totals['total'], moneda=doc['moneda'], alcance=scope, creado=doc.get('creado', ''), actualizado=doc.get('actualizado', '')))
        out.sort(key=lambda b: b['actualizado'] or b['creado'], reverse=True)
        return jsonify(presupuestos=out)

    @app.get('/api/presupuestos/opciones')
    def budgets_options():
        with connect() as db:
            songs = [dict(r) for r in db.execute('''SELECT c.id,c.titulo,a.nombre AS artista,COALESCE(d.nombre,'') AS disco FROM canciones c
                JOIN artistas a ON a.id=c.artista_id LEFT JOIN discos d ON d.id=c.disco_id ORDER BY a.nombre,c.titulo''')]
            albums = [dict(r) for r in db.execute('''SELECT d.id,d.nombre,a.nombre AS artista,(SELECT COUNT(*) FROM canciones c WHERE c.disco_id=d.id) AS canciones
                FROM discos d JOIN artistas a ON a.id=d.artista_id ORDER BY a.nombre,d.nombre''')]
            artists = [r['nombre'] for r in db.execute('SELECT nombre FROM artistas ORDER BY nombre')]
        return jsonify(canciones=songs, discos=albums, artistas=artists)

    @app.get('/api/presupuestos/plantilla')
    def budgets_template():
        return jsonify(bloques=TEMPLATE, sugerencias=SUGGESTIONS, unidades=UNITS, estados=STATES)

    @app.post('/api/presupuestos')
    def budget_create():
        data = request.get_json() or {}
        with connect() as db:
            count = len(doc_list(db, 'presupuesto')) + 1
            base = dict(titulo=data.get('titulo') or 'Presupuesto', cliente=data.get('cliente', ''), alcance=data.get('alcance') or dict(tipo='cantidad', cantidad=1),
                        bloques=json.loads(json.dumps(TEMPLATE)), numero=f'{date.today():%Y}-{count:03d}', moneda='USD', moneda_pdf='USD', moneda_pago='USD',
                        cotizacion=data.get('cotizacion', 1000), validez=dict(mostrar=True, dias=15), adelanto=50,
                        notas='Los valores no incluyen gastos de traslado fuera de la ciudad salvo que se indique.')
            doc = clean_budget(base)
            doc['creado'] = doc['actualizado'] = datetime.now().isoformat(timespec='seconds')
            identity = uuid.uuid4().hex[:12]
            doc_put(db, 'presupuesto', identity, doc)
        return jsonify(id=identity), 201

    @app.get('/api/presupuestos/<bid>')
    def budget_get(bid):
        with connect() as db:
            doc = doc_get(db, 'presupuesto', bid, None)
            if doc is None:
                raise ValueError('No encuentro ese presupuesto.')
            songs, scope = songs_in_scope(db, doc)
            return jsonify(presupuesto=doc, calculo=compute(doc, songs), canciones=songs, alcance_texto=scope)

    @app.post('/api/presupuestos/<bid>')
    def budget_save(bid):
        with connect() as db:
            old = doc_get(db, 'presupuesto', bid, None)
            if old is None:
                raise ValueError('No encuentro ese presupuesto.')
            doc = clean_budget(request.get_json() or {})
            doc['creado'] = old.get('creado', '')
            doc['actualizado'] = datetime.now().isoformat(timespec='seconds')
            doc_put(db, 'presupuesto', bid, doc)
            songs, scope = songs_in_scope(db, doc)
            return jsonify(presupuesto=doc, calculo=compute(doc, songs), canciones=songs, alcance_texto=scope)

    @app.post('/api/presupuestos/<bid>/duplicar')
    def budget_duplicate(bid):
        with connect() as db:
            doc = doc_get(db, 'presupuesto', bid, None)
            if doc is None:
                raise ValueError('No encuentro ese presupuesto.')
            count = len(doc_list(db, 'presupuesto')) + 1
            doc = dict(doc, titulo=doc['titulo'] + ' (copia)', estado='Borrador', numero=f'{date.today():%Y}-{count:03d}',
                       creado=datetime.now().isoformat(timespec='seconds'), actualizado=datetime.now().isoformat(timespec='seconds'))
            identity = uuid.uuid4().hex[:12]
            doc_put(db, 'presupuesto', identity, doc)
        return jsonify(id=identity), 201

    @app.post('/api/presupuestos/<bid>/borrar')
    def budget_delete(bid):
        with connect() as db:
            db.execute("DELETE FROM rediseno_datos WHERE tipo='presupuesto' AND id=?", (bid,))
        return jsonify(ok=True)

    @app.get('/api/presupuestos/<bid>.pdf')
    def budget_pdf(bid):
        with connect() as db:
            doc = doc_get(db, 'presupuesto', bid, None)
            if doc is None:
                raise ValueError('No encuentro ese presupuesto.')
            songs, scope = songs_in_scope(db, doc)
            profile = load_profile(db)
        logo = logo_path().read_bytes() if logo_path().exists() else None
        pdf = budget_pdf_bytes(doc, compute(doc, songs), scope, songs, profile, logo)
        name = ''.join(ch for ch in f"Presupuesto {doc.get('numero', '')} {doc['titulo']}" if ch.isalnum() or ch in ' -_').strip().replace(' ', '_')
        return send_file(io.BytesIO(pdf), mimetype='application/pdf', as_attachment=True, download_name=(name or 'Presupuesto') + '.pdf')


# ── PDF ──
def jpeg_size(data):
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        length = int.from_bytes(data[i + 2:i + 4], 'big')
        if marker in (0xC0, 0xC1, 0xC2):
            return int.from_bytes(data[i + 7:i + 9], 'big'), int.from_bytes(data[i + 5:i + 7], 'big'), data[i + 9]
        i += 2 + length
    raise ValueError('No pude leer el logo.')


def budget_pdf_bytes(doc, calc, scope, songs, profile, logo):
    W, H, M = 595, 842, 48
    pages, ops = [], []
    y = H - M
    out_cur, rate, base_cur = doc['moneda_pdf'], doc['cotizacion'], doc['moneda']
    conv = lambda v: convert(v, base_cur, out_cur, rate)
    accent = (0.06, 0.43, 0.39)
    studio = profile.get('estudio') or ' '.join(filter(None, (profile.get('nombre'), profile.get('apellido')))) or 'Tu estudio'
    contact = [x for x in (profile.get('direccion'), profile.get('ciudad'), profile.get('celular'), profile.get('email'), profile.get('web'), profile.get('instagram')) if x]

    def text(x, yy, value, size=10, bold=False, color=(0.1, 0.1, 0.12), right=False):
        if right:
            x -= text_width(value, size, bold)
        ops.append(f'BT /{"F2" if bold else "F1"} {size} Tf {color[0]} {color[1]} {color[2]} rg {x:.1f} {yy:.1f} Td ({pdf_text(value).decode("latin-1")}) Tj ET')

    def footer():
        ops.append(f'0.85 0.85 0.85 RG 0.5 w {M} 40 m {W - M} 40 l S')
        text(M, 28, f'{studio} · Presupuesto {doc.get("numero", "")}', 8, False, (0.45, 0.45, 0.45))
        text(W - M, 28, f'página {len(pages) + 1}', 8, False, (0.45, 0.45, 0.45), right=True)

    def new_page():
        nonlocal ops, y
        if ops:
            pages.append(ops)
        ops, y = [], H - M
        footer()

    def need(h):
        if y - h < 60:
            new_page()

    new_page()
    # encabezado: logo + datos del estudio
    if logo:
        w, h, _ = jpeg_size(logo)
        scale = min(150 / w, 64 / h)
        ops.append(f'q {w * scale:.1f} 0 0 {h * scale:.1f} {M} {H - M - h * scale:.1f} cm /Logo Do Q')
    else:
        text(M, H - M - 22, studio, 20, True, accent)
    yy = H - M - 8
    text(W - M, yy, studio, 12, True, right=True); yy -= 14
    if profile.get('tipo') == 'estudio' and profile.get('productores'):
        text(W - M, yy, 'Producción: ' + ', '.join(' '.join(filter(None, (p['nombre'], p['apellido']))) for p in profile['productores'][:4]), 8.5, False, (0.4, 0.4, 0.4), right=True); yy -= 12
    for line in contact[:4]:
        text(W - M, yy, line, 8.5, False, (0.4, 0.4, 0.4), right=True); yy -= 12
    y = min(yy, H - M - 70) - 18
    ops.append(f'{accent[0]} {accent[1]} {accent[2]} RG 2 w {M} {y} m {W - M} {y} l S'); y -= 30
    text(M, y, 'PRESUPUESTO', 22, True); text(W - M, y + 6, f'N.° {doc.get("numero", "")}', 10, True, right=True)
    text(W - M, y - 8, 'Fecha: ' + date.today().strftime('%d/%m/%Y'), 9, False, (0.4, 0.4, 0.4), right=True); y -= 26
    rows = [('Proyecto', doc['titulo']), ('Artista / cliente', doc['cliente'] or '—'), ('Alcance', scope)]
    if doc['validez']['mostrar']:
        rows.append(('Validez', f"{doc['validez']['dias']} días · hasta el {(date.today() + timedelta(days=doc['validez']['dias'])).strftime('%d/%m/%Y')}"))
    for key, value in rows:
        text(M, y, key, 9.5, False, (0.45, 0.45, 0.45))
        for line in wrap(value, 9.5, W - 2 * M - 120):
            text(M + 120, y, line, 9.5, True); y -= 13
        y -= 2
    y -= 8
    cols = [M, M + 250, M + 335, M + 410, W - M]

    def table_head(labels):
        nonlocal y
        ops.append(f'0.94 0.96 0.95 rg {M} {y - 6} {W - 2 * M} 18 re f')
        text(cols[0] + 6, y, labels[0], 8.5, True)
        for i, label in enumerate(labels[1:], 1):
            text(cols[i + 1] - 6, y, label, 8.5, True, right=True)
        y -= 20

    letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for index, block in enumerate(calc['bloques']):
        if not block['items']:
            continue
        need(70)
        text(M, y, f"{letters[index % 26]}. {block['titulo'].upper()}", 11, True, accent); y -= 18
        table_head(['Concepto', 'Valor', 'Cantidad', 'Total'])
        for item in block['items']:
            lines = wrap(item['concepto'] + (f" (×{item['factor']} canciones)" if item['factor'] > 1 else ''), 9, cols[1] - cols[0] - 14)
            need(14 * len(lines) + 4)
            top = y
            for line in lines:
                text(cols[0] + 6, y, line, 9); y -= 12
            text(cols[2] - 6, top, money(conv(item['valor']), out_cur), 9, right=True)
            qty = f"{item['cantidad']:g} {item['unidad']}"
            text(cols[3] - 6, top, qty, 9, right=True)
            text(cols[4] - 6, top, money(conv(item['total']), out_cur), 9, True, right=True)
            y -= 2
            ops.append(f'0.88 0.88 0.88 RG 0.5 w {M} {y + 4} m {W - M} {y + 4} l S'); y -= 6
        text(cols[4] - 6, y, 'Subtotal ' + money(conv(block['total']), out_cur), 9, True, (0.3, 0.3, 0.3), right=True); y -= 22
    # totales
    need(160)
    text(M, y, f"{letters[len(calc['bloques']) % 26]}. TOTALES", 11, True, accent); y -= 18
    table_head(['Concepto', '', '', 'Total'])
    for index, block in enumerate(calc['bloques']):
        if block['items']:
            text(cols[0] + 6, y, f"{index + 1}. {block['titulo']}", 9.5)
            text(cols[4] - 6, y, money(conv(block['total']), out_cur), 9.5, right=True); y -= 15
    ops.append(f'0.7 0.7 0.7 RG 0.6 w {M} {y + 6} m {W - M} {y + 6} l S'); y -= 6
    def total_line(label, value, bold=False, size=10):
        nonlocal y
        text(cols[2] - 6, y, label, size, bold, right=False)
        text(cols[4] - 6, y, value, size, bold, right=True); y -= size + 6
    total_line('Subtotal', money(conv(calc['subtotal']), out_cur))
    if calc['descuento']:
        total_line(f"Descuento {doc['descuento']:g} %", '- ' + money(conv(calc['descuento']), out_cur))
    if calc['impuesto']:
        total_line(f"{doc['impuesto_nombre']} {doc['impuesto']:g} %", money(conv(calc['impuesto']), out_cur))
    y -= 8
    ops.append(f'{accent[0]} {accent[1]} {accent[2]} rg {cols[2] - 12} {y - 8} {W - M - cols[2] + 12} 26 re f')
    text(cols[2] - 4, y, 'TOTAL', 13, True, (1, 1, 1))
    text(cols[4] - 6, y, money(conv(calc['total']), out_cur), 13, True, (1, 1, 1), right=True); y -= 30
    other = 'ARS' if out_cur == 'USD' else 'USD'
    text(W - M, y, f"Equivale a {money(convert(calc['total'], base_cur, other, rate), other)} · cotización 1 USD = {money(rate, 'ARS')}{(' (' + doc['cotizacion_fuente'] + ')') if doc['cotizacion_fuente'] else ''}",
         8.5, False, (0.4, 0.4, 0.4), right=True); y -= 22
    conditions = [f"Forma de pago: en {'dólares estadounidenses (USD)' if doc['moneda_pago'] == 'USD' else 'pesos argentinos (ARS)'}"
                  + (f" al tipo de cambio del día de pago." if doc['moneda_pago'] != out_cur else '.')]
    if doc['adelanto']:
        conditions.append(f"Adelanto del {doc['adelanto']:g} % para reservar fechas: {money(conv(calc['adelanto']), out_cur)}.")
    if doc['validez']['mostrar']:
        conditions.append(f"Presupuesto válido por {doc['validez']['dias']} días desde su emisión.")
    need(30 + 14 * len(conditions))
    text(M, y, 'CONDICIONES', 10, True, accent); y -= 16
    for line in conditions:
        for part in wrap('• ' + line, 9.5, W - 2 * M):
            need(14); text(M, y, part, 9.5); y -= 13
    y -= 8
    for title, body in (('PLAN DE TRABAJO', doc['plan']), ('NOTAS', doc['notas'])):
        if body.strip():
            need(40)
            text(M, y, title, 10, True, accent); y -= 16
            for paragraph in body.split('\n'):
                for part in wrap(paragraph or ' ', 9.5, W - 2 * M):
                    need(14); text(M, y, part, 9.5); y -= 13
            y -= 8
    need(30)
    text(M, y - 8, 'Presupuesto generado con AudioTaller', 7.5, False, (0.55, 0.55, 0.55))
    pages.append(ops)
    # armado del archivo
    objects = ['<< /Type /Catalog /Pages 2 0 R >>', None,
               '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
               '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']
    xobject = ''
    if logo:
        w, h, comps = jpeg_size(logo)
        space = '/DeviceGray' if comps == 1 else '/DeviceCMYK' if comps == 4 else '/DeviceRGB'
        objects.append(f'<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace {space} /BitsPerComponent 8 /Filter /DCTDecode /Length {len(logo)} >>\nstream\n'.encode() + logo + b'\nendstream')
        xobject = f' /XObject << /Logo {len(objects)} 0 R >>'
    kids = []
    for page in pages:
        stream = '\n'.join(page).encode('latin-1')
        objects.append(b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream')
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>{xobject} >> /Contents {len(objects)} 0 R >>')
        kids.append(len(objects))
    objects[1] = f'<< /Type /Pages /Kids [{" ".join(f"{k} 0 R" for k in kids)}] /Count {len(kids)} >>'
    out = io.BytesIO()
    out.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(f'{number} 0 obj\n'.encode())
        out.write(obj if isinstance(obj, bytes) else obj.encode('latin-1'))
        out.write(b'\nendobj\n')
    xref = out.tell()
    out.write(f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode())
    for offset in offsets:
        out.write(f'{offset:010d} 00000 n \n'.encode())
    out.write(f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return out.getvalue()
