"""Agrega la marca de AudioTaller (logo arriba a la derecha) a cada página de un PDF.

Uso: python packaging/tools/marca_pdf.py entrada.pdf salida.pdf
Se usa para las guías de entidades y el instructivo del portal que viven en static/docs.
"""
import io
import sys
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

MINT = (0.18, 0.83, 0.75)
INK = (0.06, 0.40, 0.37)


def stamp(width, height):
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(width, height))
    right, top = width - 36, height - 18
    text_w = c.stringWidth('AudioTaller', 'Helvetica-Bold', 11)
    x0 = right - text_w - 26
    c.setFillColorRGB(0.06, 0.13, 0.16)
    c.roundRect(x0, top - 18, 20, 18, 4, stroke=0, fill=1)
    c.setFillColorRGB(*MINT)
    for i, h in enumerate((5, 10, 14, 10, 5)):
        c.roundRect(x0 + 3.2 + i * 3, top - 9 - h / 2, 1.8, h, .9, stroke=0, fill=1)
    c.setFillColorRGB(*INK)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(x0 + 25, top - 13, 'AudioTaller')
    c.save()
    return PdfReader(io.BytesIO(buffer.getvalue())).pages[0]


def brand(source, target):
    reader = PdfReader(source)
    writer = PdfWriter()
    for page in reader.pages:
        box = page.mediabox
        page.merge_page(stamp(float(box.width), float(box.height)))
        writer.add_page(page)
    writer.add_metadata({'/Producer': 'AudioTaller', '/Creator': 'AudioTaller'})
    with open(target, 'wb') as output:
        writer.write(output)


if __name__ == '__main__':
    brand(sys.argv[1], sys.argv[2])
