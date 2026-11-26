"""Exporta la metadata de un disco o una canción en CSV, Excel, Word o PDF.

Sin dependencias externas: los formatos Office se arman como paquetes OOXML
mínimos y el PDF se escribe a mano con fuentes estándar. Las plantillas
(distribuidora genérica, AMA, registros, ficha) cambian columnas y orden.
"""
import csv
import io
import re
import zipfile
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

LOGO_PNG = Path(__file__).resolve().parent / 'static' / 'branding' / 'AudioTaller.png'
DESTINATIONS = {
    'generica': 'Distribuidora (genérica)',
    'ama': 'AMA · Agregadora de Música Argentina',
    'registros': 'Registros DNDA / SADAIC',
    'ficha': 'Ficha para compartir',
}


def authors_text(song):
    return '; '.join(f"{a.get('nombre', '')} ({a.get('rol') or 'autoría'} {fmt_pct(a.get('porcentaje'))})" for a in song['autores']) or ''


def fmt_pct(value):
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return ''
    return (f'{number:.2f}'.rstrip('0').rstrip('.')).replace('.', ',') + ' %'


def people(items, key='rol'):
    return '; '.join(f"{p.get('nombre', '')}" + (f" ({p.get(key)})" if p.get(key) else '') for p in items)


def tech(song, role):
    return ', '.join(t['nombre'] for t in song['tecnica'] if t.get('rol') == role and t.get('nombre'))


def release_rows(data):
    rel = data['lanzamiento']
    year = (rel.get('fecha_lanzamiento') or '')[:4] or str(date.today().year)
    return [
        ('UPC / EAN', rel.get('upc_ean') or 'pendiente (lo asigna la distribuidora)'),
        ('Título del lanzamiento', data['titulo']),
        ('Tipo', data['tipo']),
        ('Artista principal', data['artista']),
        ('Fecha de lanzamiento', fmt_date(rel.get('fecha_lanzamiento', ''))),
        ('Sello', rel.get('sello') or 'Independiente'),
        ('℗ / ©', rel.get('copyright') or f"{year} {data['artista']}"),
        ('Distribuidora', rel.get('distribuidora') or '—'),
        ('Territorios', rel.get('territorios') or 'Mundial'),
        ('Portada', 'cargada' if data.get('portada') else 'falta'),
        ('Arte de tapa', ', '.join(x for x in (data['arte'].get('autor', ''), data['arte'].get('licencia', '')) if x) or '—'),
    ]


def fmt_date(value):
    match = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', value or '')
    return f'{match.group(3)}/{match.group(2)}/{match.group(1)}' if match else (value or '')


def track_table(data, destination, lyrics, flat=False):
    rel = data['lanzamiento']
    if destination == 'ama':
        header = ['N.º de pista', 'Título de la pista', 'Versión', 'ISRC', 'Artista principal', 'Autores (letra/música y %)',
                  'Intérpretes', 'Productor', 'Duración', 'Contenido explícito', 'Idioma de la letra', 'ISWC', 'Archivo de audio']
        rows = [[s['n'], s['titulo'], '', s['isrc'], data['artista'], authors_text(s), people(s['interpretes'], 'instrumento'),
                 people(s['produccion']), s['duracion'], s['explicito'] or 'No', s['idioma'], s['iswc'], s['master']] for s in data['canciones']]
    elif destination == 'registros':
        header = ['N.º', 'Título de la obra', 'ISWC', 'Autores y compositores', 'Duración', 'Género', 'Idioma', 'ISRC del fonograma']
        rows = [[s['n'], s['titulo'], s['iswc'], authors_text(s), s['duracion'], s['genero'], s['idioma'], s['isrc']] for s in data['canciones']]
    else:
        header = ['#', 'Título', 'ISRC', 'ISWC', 'Duración', 'Explícito', 'Autores y reparto', 'Intérpretes', 'Producción',
                  'Mezcla', 'Mastering', 'Archivo master']
        rows = [[s['n'], s['titulo'], s['isrc'], s['iswc'], s['duracion'], s['explicito'] or 'No', authors_text(s),
                 people(s['interpretes'], 'instrumento'), people(s['produccion']), tech(s, 'Mezcla'), tech(s, 'Mastering'), s['master']]
                for s in data['canciones']]
    if lyrics:
        header.append('Letra')
        for row, song in zip(rows, data['canciones']):
            row.append(song['letra'])
    if flat:
        # CSV: una fila por pista con los datos del lanzamiento repetidos (carga masiva).
        extra = ['UPC', 'Lanzamiento', 'Tipo', 'Artista', 'Fecha', 'Sello']
        values = [rel.get('upc_ean', ''), data['titulo'], data['tipo'], data['artista'], fmt_date(rel.get('fecha_lanzamiento', '')),
                  rel.get('sello') or 'Independiente']
        header = extra + header
        rows = [values + row for row in rows]
    return header, [[str(v) if v is not None else '' for v in row] for row in rows]


def credits_table(data):
    header = ['#', 'Título', 'Autores y reparto', 'Intérpretes', 'Producción', 'Grabación', 'Mezcla', 'Mastering']
    rows = [[str(s['n']), s['titulo'], authors_text(s), people(s['interpretes'], 'instrumento'), people(s['produccion']),
             tech(s, 'Grabación'), tech(s, 'Mezcla'), tech(s, 'Mastering')] for s in data['canciones']]
    return header, rows


def checks(data):
    out = []
    for s in data['canciones']:
        missing = list(s['faltan'])
        if not s['master']:
            missing.append('sin master')
        if missing:
            out.append(f"{s['titulo']}: {', '.join(missing)}")
    return out


def slug(text):
    return re.sub(r'[^A-Za-z0-9áéíóúñÁÉÍÓÚÑ_-]+', '_', text).strip('_') or 'metadata'


# ── CSV ──
def build_csv(data, options):
    header, rows = track_table(data, options['destino'], options['letras'], flat=True)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerows(rows)
    return ('﻿' + buffer.getvalue()).encode('utf-8')


# ── Excel (OOXML mínimo) ──
def col_name(index):
    name = ''
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(65 + rest) + name
    return name


def sheet_xml(header, rows, widths=None):
    def cell(ref, value, style=0):
        text = escape(str(value)).replace('\n', '&#10;')
        attr = ' s="%d"' % style if style else ''
        return f'<c r="{ref}" t="inlineStr"{attr}><is><t xml:space="preserve">{text}</t></is></c>'
    lines = []
    for r, row in enumerate([header] + rows, 1):
        style = 1 if r == 1 else (2 if any(v in ('', 'falta') for v in row[:4]) and r > 1 and False else 0)
        cells = ''.join(cell(f'{col_name(c)}{r}', v, 1 if r == 1 else (3 if v in ('', 'falta') else 0)) for c, v in enumerate(row))
        lines.append(f'<row r="{r}">{cells}</row>')
    widths = widths or [min(60, max(10, max(len(str(row[i])) for row in [header] + rows) + 2)) for i in range(len(header))]
    cols = ''.join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            f'<cols>{cols}</cols><sheetData>{"".join(lines)}</sheetData></worksheet>')


def build_xlsx(data, options):
    sheets = []
    if len(data['canciones']) > 1 or data['tipo'] != 'Single':
        sheets.append(('Lanzamiento', ['Campo', 'Valor'], [list(r) for r in release_rows(data)]))
    header, rows = track_table(data, options['destino'], options['letras'])
    sheets.append(('Pistas', header, rows))
    sheets.append(('Créditos', *credits_table(data)))
    if len(sheets) == 2:
        sheets.insert(0, ('Lanzamiento', ['Campo', 'Valor'], [list(r) for r in release_rows(data)]))
    files = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets) + 1))
            + '</Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            + ''.join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, _, _) in enumerate(sheets, 1))
            + '</sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1))
            + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
            '<font><b/><sz val="11"/><color rgb="FFC0392B"/><name val="Calibri"/></font></fonts>'
            '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
            '<fill><patternFill patternType="solid"><fgColor rgb="FF0F6E63"/></patternFill></fill>'
            '<fill><patternFill patternType="solid"><fgColor rgb="FFFDECEA"/></patternFill></fill></fills>'
            '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
            '<cellXfs count="4"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf/>'
            '<xf fontId="2" fillId="3" applyFont="1" applyFill="1"/></cellXfs></styleSheet>',
    }
    for i, (_, header, rows) in enumerate(sheets, 1):
        files[f'xl/worksheets/sheet{i}.xml'] = sheet_xml(header, rows)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as package:
        for name, content in files.items():
            package.writestr(name, content)
    return buffer.getvalue()


# ── Documento (contenido común para Word y PDF) ──
def document_blocks(data, options):
    """Lista de bloques: ('title'|'h'|'p'|'kv'|'table'|'small'|'break', contenido)."""
    rel = data['lanzamiento']
    kind = 'Ficha para registro de obras' if options['destino'] == 'registros' else 'Ficha de metadata'
    blocks = [('kicker', f"{kind} · {DESTINATIONS.get(options['destino'], '')}"), ('title', data['titulo']),
              ('p', f"{data['artista']} · {data['tipo']}" + (f" · sale el {fmt_date(rel.get('fecha_lanzamiento'))}" if rel.get('fecha_lanzamiento') else ''))]
    if options['destino'] != 'registros':
        blocks.append(('kv', release_rows(data)))
    blocks.append(('h', 'Pistas'))
    blocks.append(('table', (['#', 'Título', 'ISRC', 'ISWC', 'Dur.'],
                             [[str(s['n']), s['titulo'], s['isrc'] or 'falta', s['iswc'] or 'falta', s['duracion'] or '—'] for s in data['canciones']],
                             [24, 200, 110, 110, 40])))
    pending = checks(data)
    if pending:
        blocks.append(('warn', 'Datos incompletos en AudioTaller: ' + ' · '.join(pending)))
    blocks.append(('h', 'Créditos'))
    for s in data['canciones']:
        blocks.append(('h2', f"{s['n']}. {s['titulo']}"))
        lines = [('Autoría', authors_text(s) or 'falta'), ('Intérpretes', people(s['interpretes'], 'instrumento') or '—'),
                 ('Producción', people(s['produccion']) or '—')]
        for role in ('Grabación', 'Mezcla', 'Mastering'):
            lines.append((role, tech(s, role) or '—'))
        lines += [('ISWC', s['iswc'] or 'falta'), ('ISRC', s['isrc'] or 'falta')]
        blocks.append(('kv', lines))
    if options['letras']:
        for s in data['canciones']:
            if s['letra'].strip():
                blocks.append(('break', ''))
                blocks.append(('h', f"Letra · {s['titulo']}"))
                blocks.append(('small', authors_text(s)))
                for line in s['letra'].splitlines():
                    blocks.append(('lyric', line))
    return blocks


# ── Word (OOXML mínimo) ──
def build_docx(data, options):
    def run(text, bold=False, size=None, color=None):
        props = ''.join(x for x in ('<w:b/>' if bold else '', f'<w:color w:val="{color}"/>' if color else '',
                                    f'<w:sz w:val="{size}"/>' if size else '') if x)
        return f'<w:r>{f"<w:rPr>{props}</w:rPr>" if props else ""}<w:t xml:space="preserve">{escape(str(text))}</w:t></w:r>'

    def para(content, spacing=120, keep=False, page_break=False):
        props = f'<w:spacing w:after="{spacing}"/>' + ('<w:keepNext/>' if keep else '') + ('<w:pageBreakBefore/>' if page_break else '')
        return f'<w:p><w:pPr>{props}</w:pPr>{content}</w:p>'

    body = []
    has_logo = options['logo'] and LOGO_PNG.is_file()
    if has_logo:
        emu = 457200  # 1,27 cm
        body.append('<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
                    f'<wp:extent cx="{emu}" cy="{emu}"/><wp:docPr id="1" name="Logo AudioTaller"/>'
                    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
                    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>'
                    '<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
                    f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu}" cy="{emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
                    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
                    + run('  AudioTaller', True, 28, '0F6E63') + run(f'   ·   generada el {date.today().strftime("%d/%m/%Y")}', False, 18, '777777') + '</w:p>')
    next_break = False
    for kind, content in document_blocks(data, options):
        if kind == 'break':
            next_break = True
            continue
        if kind == 'kicker':
            body.append(para(run(content.upper(), True, 16, '777777'), 40))
        elif kind == 'title':
            body.append(para(run(content, True, 44), 80))
        elif kind == 'h':
            body.append(para(run(content, True, 28), 100, True, next_break))
        elif kind == 'h2':
            body.append(para(run(content, True, 22), 60, True))
        elif kind in ('p', 'small', 'lyric'):
            body.append(para(run(content, False, 18 if kind == 'small' else 22, '555555' if kind == 'small' else None), 0 if kind == 'lyric' else 120))
        elif kind == 'warn':
            body.append(para(run(content, True, 20, 'C0392B'), 160))
        elif kind in ('kv', 'table'):
            header, rows, widths = (None, content, [2400, 6600]) if kind == 'kv' else content
            if kind == 'table':
                widths = [w * 18 for w in widths]
            total = sum(widths)
            grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)

            def tc(text, width, bold=False, shade=None):
                missing = text == 'falta'
                return (f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>' + (f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>' if shade else '')
                        + f'</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>{run(text, bold or missing, 18, "C0392B" if missing else ("FFFFFF" if shade == "0F6E63" else None))}</w:p></w:tc>')
            rows_xml = ''
            if header:
                rows_xml += '<w:tr>' + ''.join(tc(h, w, True, '0F6E63') for h, w in zip(header, widths)) + '</w:tr>'
            for row in rows:
                cells = list(row)
                rows_xml += '<w:tr>' + ''.join(tc(str(v), w, kind == 'kv' and i == 0) for i, (v, w) in enumerate(zip(cells, widths))) + '</w:tr>'
            body.append(f'<w:tbl><w:tblPr><w:tblW w:w="{total}" w:type="dxa"/><w:tblBorders><w:bottom w:val="single" w:sz="4" w:color="DDDDDD"/>'
                        f'<w:insideH w:val="single" w:sz="4" w:color="DDDDDD"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/>'
                        f'<w:bottom w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{rows_xml}</w:tbl>')
            body.append(para('', 120))
        next_break = False if kind != 'break' else next_break
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
                'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
                f'<w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
                '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>')
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
              '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>')
    files = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Default Extension="png" ContentType="image/png"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            + ('<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' if has_logo else '')
            + '</Relationships>',
        'word/document.xml': document,
        'word/styles.xml': styles,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as package:
        for name, content in files.items():
            package.writestr(name, content)
        if has_logo:
            package.write(LOGO_PNG, 'word/media/logo.png')
    return buffer.getvalue()


# ── PDF (A4, Helvetica, sin dependencias) ──
HELV = {c: 556 for c in range(32, 256)}
for chars, width in (("il.,:;'|!", 222), ('I j', 278), ('ft[]()/-', 333), ('r', 333), ('mM', 833), ('W', 944), ('w', 722),
                     ('ABCDEHKNRSUVXY', 667), ('GOQ', 778), ('FTZ', 611), ('L', 556), ('P', 667), (' ', 278)):
    for ch in chars:
        HELV[ord(ch)] = width


def pdf_text(value):
    value = str(value).replace('℗', '(P)').replace('→', '->').replace('≠', '!=').replace('·', '\xb7')
    data = value.encode('cp1252', errors='replace')
    return data.replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)')


def text_width(value, size, bold=False):
    return sum(HELV.get(b, 556) for b in str(value).encode('cp1252', errors='replace')) * size / 1000 * (1.05 if bold else 1)


def wrap(value, size, width, bold=False):
    lines, current = [], ''
    for word in str(value).split(' '):
        candidate = (current + ' ' + word).strip()
        if text_width(candidate, size, bold) <= width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def build_pdf(data, options):
    return render_pdf(document_blocks(data, options), data['titulo'], options['logo'])


def render_pdf(blocks, footer_title, logo=True):
    W, H, M = 595, 842, 50
    pages, ops = [], []
    y = H - M

    def new_page():
        nonlocal ops, y
        if ops:
            pages.append(ops)
        ops, y = [], H - M
        footer = f"AudioTaller · {footer_title} · página {len(pages) + 1}"
        ops.append(f'BT /F1 8 Tf 0.5 0.5 0.5 rg {M} 28 Td ({pdf_text(footer).decode("latin-1")}) Tj ET')

    def text(x, yy, value, size=10, bold=False, color=(0.07, 0.07, 0.08)):
        ops.append(f'BT /{"F2" if bold else "F1"} {size} Tf {color[0]} {color[1]} {color[2]} rg {x:.1f} {yy:.1f} Td ({pdf_text(value).decode("latin-1")}) Tj ET')

    def need(height):
        nonlocal y
        if y - height < M + 20:
            new_page()

    new_page()
    if logo:
        ops.append('0.06 0.13 0.16 rg 50 772 28 28 re f')
        for i, (h, x) in enumerate(((8, 54), (16, 59.5), (22, 65), (16, 70.5), (8, 76))):
            ops.append(f'0.18 0.85 0.75 rg {x - 1.6:.1f} {786 - h / 2:.1f} 3.2 {h} re f')
        text(86, 781, 'AudioTaller', 15, True, (0.06, 0.43, 0.39))
        text(W - M - 150, 783, f'generada el {date.today().strftime("%d/%m/%Y")}', 8, False, (0.45, 0.45, 0.45))
        ops.append(f'0.07 0.07 0.08 RG 1.2 w {M} 762 m {W - M} 762 l S')
        y = 740
    for kind, content in blocks:
        if kind == 'break':
            new_page()
        elif kind == 'kicker':
            need(14); text(M, y, content.upper(), 8, True, (0.45, 0.45, 0.45)); y -= 26
        elif kind == 'title':
            need(30); text(M, y, content, 24, True); y -= 20
        elif kind in ('p', 'small', 'lyric', 'warn'):
            size = 9 if kind in ('small', 'warn') else 10.5
            color = (0.75, 0.22, 0.17) if kind == 'warn' else ((0.35, 0.35, 0.35) if kind == 'small' else (0.07, 0.07, 0.08))
            for line in wrap(content, size, W - 2 * M, kind == 'warn'):
                need(size + 4); text(M, y, line, size, kind == 'warn', color); y -= size + (3 if kind == 'lyric' else 5)
            y -= 2 if kind == 'lyric' else 8
        elif kind == 'h':
            need(40); y -= 8; text(M, y, content, 14, True); y -= 20
        elif kind == 'h2':
            need(30); text(M, y, content, 11, True); y -= 16
        elif kind == 'kv':
            for key, value in content:
                lines = wrap(value or '—', 9.5, W - 2 * M - 130)
                need(12 * len(lines) + 4)
                text(M, y, key, 9.5, False, (0.4, 0.4, 0.4))
                for line in lines:
                    missing = value == 'falta' or str(value).startswith('pendiente')
                    text(M + 130, y, line, 9.5, missing, (0.75, 0.22, 0.17) if missing else (0.07, 0.07, 0.08)); y -= 12
                y -= 2
            y -= 8
        elif kind == 'table':
            header, rows, widths = content
            scale = (W - 2 * M) / sum(widths)
            xs = [M]
            for w in widths[:-1]:
                xs.append(xs[-1] + w * scale)
            need(20)
            for x, h in zip(xs, header):
                text(x, y, h, 9, True)
            ops.append(f'0.07 0.07 0.08 RG 0.8 w {M} {y - 4:.1f} m {W - M} {y - 4:.1f} l S'); y -= 16
            for row in rows:
                need(16)
                for x, value, w in zip(xs, row, widths):
                    value = value if text_width(value, 9) < w * scale - 4 else value[: int(w * scale / 5)] + '…'
                    text(x, y, value, 9, value == 'falta', (0.75, 0.22, 0.17) if value == 'falta' else (0.07, 0.07, 0.08))
                ops.append(f'0.85 0.85 0.85 RG 0.5 w {M} {y - 5:.1f} m {W - M} {y - 5:.1f} l S'); y -= 16
            y -= 10
    pages.append(ops)
    objects = ['<< /Type /Catalog /Pages 2 0 R >>', None,
               '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
               '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']
    kids = []
    for page in pages:
        stream = '\n'.join(page).encode('latin-1')
        objects.append(b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream')
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {len(objects)} 0 R >>')
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


def build(data, fmt, options):
    options = dict(destino=options.get('destino', 'generica') if options.get('destino') in DESTINATIONS else 'generica',
                   logo=bool(options.get('logo')), letras=bool(options.get('letras')))
    suffix = {'generica': 'metadata', 'ama': 'AMA', 'registros': 'registro', 'ficha': 'ficha'}[options['destino']]
    base = f"{slug(data['titulo'])}_{suffix}"
    if fmt == 'csv':
        return base + '.csv', build_csv(data, options), 'text/csv'
    if fmt == 'xlsx':
        return base + '.xlsx', build_xlsx(data, options), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    if fmt == 'docx':
        return base + '.docx', build_docx(data, options), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    if fmt == 'pdf':
        return base + '.pdf', build_pdf(data, options), 'application/pdf'
    raise ValueError('Formato inválido: elegí CSV, Excel, Word o PDF.')
