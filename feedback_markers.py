"""Marcadores de devoluciones para el DAW: MIDI estándar, CSV de REAPER y copia .rpp.

Nunca se modifica una sesión existente: el .rpp con marcadores se escribe como
la siguiente versión, junto al original.
"""
import csv
import io
import re
import struct
from pathlib import Path

PPQ = 480
TEMPO = 500000  # 120 BPM: 1 segundo = 960 ticks.


def placed(notes):
    """Los comentarios generales (sin minuto) no tienen lugar en la línea de tiempo."""
    return sorted((n for n in notes if float(n.get('segundo') or 0) > 0), key=lambda n: float(n['segundo']))


def _vlq(value):
    value = int(value)
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(out))


def marker_label(note):
    text = re.sub(r'\s+', ' ', str(note.get('texto', ''))).strip()
    second = int(max(0, float(note.get('segundo') or 0)))
    when = f'{second // 60}:{second % 60:02d}' if second else 'General'
    state = 'Resuelto' if note.get('estado') == 'Resuelta' else note.get('estado', 'Pendiente')
    return f"{when} · {state} · {text}"[:200]


def clock(seconds):
    seconds = max(0, float(seconds or 0))
    return f'{int(seconds // 60)}:{seconds % 60:06.3f}'


def midi_markers(notes, offset=0.0, name='Devoluciones'):
    events = []
    events.append((0, b'\xff\x03' + _vlq(len(name.encode())) + name.encode()))
    events.append((0, b'\xff\x51\x03' + TEMPO.to_bytes(3, 'big')))
    for note in placed(notes):
        tick = round(max(0.0, float(note['segundo']) + offset) * PPQ * 1_000_000 / TEMPO)
        text = marker_label(note).encode('utf-8')
        events.append((tick, b'\xff\x06' + _vlq(len(text)) + text))
    track, last = b'', 0
    for tick, data in sorted(events, key=lambda e: e[0]):
        track += _vlq(tick - last) + data
        last = tick
    track += b'\x00\xff\x2f\x00'
    return b'MThd' + struct.pack('>IHHH', 6, 0, 1, PPQ) + b'MTrk' + struct.pack('>I', len(track)) + track


def csv_markers(notes, offset=0.0):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(['#', 'Name', 'Start', 'End', 'Length', 'Color'])
    for index, note in enumerate(placed(notes), 1):
        writer.writerow([f'M{index}', marker_label(note), clock(float(note['segundo']) + offset), '', '', ''])
    return '﻿' + buffer.getvalue()


def next_version_path(path):
    path = Path(path)
    match = re.search(r'(.*?)[_ -]?V(\d+)$', path.stem, re.I)
    base, number, width = (match.group(1), int(match.group(2)), len(match.group(2))) if match else (path.stem, 1, 3)
    while True:
        number += 1
        candidate = path.with_name(f'{base}_V{number:0{width}d}{path.suffix}')
        if not candidate.exists():
            return candidate


def rpp_with_markers(source, notes, offset=0.0):
    """Devuelve la ruta de una copia nueva del .rpp con un marcador por devolución."""
    source = Path(source)
    content = source.read_text(encoding='utf-8', errors='replace')
    end = content.rstrip().rfind('>')
    if not content.lstrip().startswith('<REAPER_PROJECT') or end < 0:
        raise ValueError('El archivo no parece un proyecto de REAPER.')
    used = [int(n) for n in re.findall(r'^\s*MARKER\s+(\d+)', content, re.M)]
    start = max(used, default=0) + 1
    lines = []
    for index, note in enumerate(placed(notes)):
        label = marker_label(note).replace('"', "'")
        lines.append(f'  MARKER {start + index} {float(note["segundo"]) + offset:.6f} "{label}" 0 0 1 B\n')
    target = next_version_path(source)
    target.write_text(content[:end] + ''.join(lines) + content[end:], encoding='utf-8')
    return target
