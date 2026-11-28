"""Lectura acotada de ondas WAV (PCM entero y coma flotante), conservando intacto el archivo original."""
import os
import struct
import sys
from array import array
from functools import lru_cache

# Cada bloque ocupa memoria acotada incluso para grabaciones largas.
BLOCK_FRAMES = 65536
# Hasta este tamaño se lee todo el audio (picos exactos); más grande, se muestrea con ventanas por tramo.
FULL_READ_BYTES = 24 * 1024 * 1024
SAMPLED_BYTES = 6 * 1024 * 1024
WINDOWS = 8


def _header(handle, file_size):
    """Devuelve (formato, canales, frecuencia, bits, inicio de datos, bytes de datos)."""
    riff = handle.read(12)
    if len(riff) < 12 or riff[:4] not in (b'RIFF', b'RF64') or riff[8:12] != b'WAVE':
        raise ValueError('No es un archivo WAV.')
    fmt = None
    while True:
        head = handle.read(8)
        if len(head) < 8:
            raise ValueError('El WAV no tiene datos de audio.')
        chunk, size = head[:4], struct.unpack('<I', head[4:])[0]
        if chunk == b'fmt ':
            raw = handle.read(size)
            if len(raw) < 16:
                raise ValueError('Encabezado WAV incompleto.')
            tag, channels, rate, _, _, bits = struct.unpack('<HHIIHH', raw[:16])
            # WAVE_FORMAT_EXTENSIBLE: el formato real está en el subformato (los DAW lo usan a menudo).
            if tag == 0xFFFE and len(raw) >= 26:
                tag = struct.unpack('<H', raw[24:26])[0]
            fmt = (tag, channels, rate, bits)
            if size % 2:
                handle.read(1)
        elif chunk == b'data':
            if not fmt:
                raise ValueError('Encabezado WAV incompleto.')
            start = handle.tell()
            # RF64 o grabaciones sin cerrar dejan un tamaño inválido: se usa lo que hay en el disco.
            available = max(0, file_size - start)
            return (*fmt, start, available if size in (0, 0xFFFFFFFF) or size > available else size)
        else:
            handle.seek(size + size % 2, 1)


def _decoder(tag, bits):
    """Convierte bytes crudos en (valores, escala, desplazamiento)."""
    if tag == 3 and bits in (32, 64):
        code = 'f' if bits == 32 else 'd'
        return lambda block: _native(array(code, block)), 1.0, 0
    if tag != 1 or bits not in (8, 16, 24, 32):
        raise ValueError('Formato WAV no soportado.')
    if bits == 8:
        return lambda block: array('B', block), 128.0, 128
    if bits == 16:
        return lambda block: _native(array('h', block)), 32768.0, 0
    if bits == 32:
        return lambda block: _native(array('i', block)), 2147483648.0, 0

    def widen(block):
        # 24 bits → 32 bits con el byte bajo en cero: mismo valor relativo, operado en C.
        out = bytearray(len(block) // 3 * 4)
        out[1::4], out[2::4], out[3::4] = block[0::3], block[1::3], block[2::3]
        return _native(array('i', out))
    return widen, 2147483648.0, 0


def _native(values):
    if sys.byteorder == 'big':
        values.byteswap()
    return values


def pcm_waveform(path, bins=1000):
    path = os.fspath(path)
    stat = os.stat(path)
    cached = _cached_waveform(path, stat.st_size, stat.st_mtime_ns, bins)
    return dict(cached, peaks=list(cached['peaks']))


@lru_cache(maxsize=256)
def _cached_waveform(path, size, _mtime, bins):
    # Se recalcula solo si el archivo cambia (tamaño o fecha); abrir Arreglos de nuevo no relee los WAV.
    with open(path, 'rb') as handle:
        tag, channels, rate, bits, start, length = _header(handle, size)
        width = bits // 8
        if not 1 <= channels <= 32 or rate <= 0 or width not in (1, 2, 3, 4, 8):
            raise ValueError('Formato WAV no soportado.')
        decode, scale, offset = _decoder(tag, bits)
        frame_size = width * channels
        frames = length // frame_size
        peaks = [0.0] * bins
        if length > FULL_READ_BYTES and bins:
            # Archivos grandes (pistas crudas de varios minutos): se leen ventanas repartidas en cada tramo
            # en lugar del archivo entero. Con 32 pistas de una sesión, leer todo eran gigas y trababa la app.
            window = max(1, SAMPLED_BYTES // (bins * WINDOWS) // frame_size)
            for bucket in range(bins):
                first, last = bucket * frames // bins, (bucket + 1) * frames // bins
                for n in range(WINDOWS):
                    at = first + (last - first) * n // WINDOWS
                    handle.seek(start + at * frame_size)
                    block = handle.read(min(window, max(0, last - at)) * frame_size)
                    block = block[:len(block) // frame_size * frame_size]
                    if block:
                        values = decode(block)
                        amplitude = max(abs(min(values) - offset), abs(max(values) - offset)) / scale
                        peaks[bucket] = max(peaks[bucket], min(1.0, amplitude))
            return dict(peaks=tuple(peaks), duration=frames / rate)
        handle.seek(start)
        frame_index = 0
        for bucket in range(bins):
            end = (bucket + 1) * frames // bins
            while frame_index < end:
                block = handle.read(min(BLOCK_FRAMES, end - frame_index) * frame_size)
                block = block[:len(block) // frame_size * frame_size]
                if not block:
                    break
                values = decode(block)
                amplitude = max(abs(min(values) - offset), abs(max(values) - offset)) / scale
                peaks[bucket] = max(peaks[bucket], min(1.0, amplitude))
                frame_index += len(block) // frame_size
            if frame_index < end:
                break
        return dict(peaks=tuple(peaks), duration=frames / rate)
