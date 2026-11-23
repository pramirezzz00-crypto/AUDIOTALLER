"""Sonoridad integrada (ITU-R BS.1770-4 / EBU R128) y pico verdadero de un WAV PCM.

Orden de preferencia:
1. Youlean Loudness Meter 2 (`ylm2`) si está instalado: se usa su medición.
2. NumPy si está disponible: cálculo rápido.
3. Python puro: más lento (se ejecuta en segundo plano y se guarda en caché).

El archivo original solo se lee; nunca se modifica.
"""
import json
import math
import os
import shutil
import struct
import subprocess
import wave
from pathlib import Path

try:  # NumPy es opcional: acelera la medición si está instalado.
    import numpy as np
except Exception:  # pragma: no cover - depende del equipo
    np = None


def k_weighting(rate):
    """Coeficientes de los dos filtros K (estante + pasa altos) para cualquier frecuencia de muestreo."""
    f0, gain, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / rate)
    vh = 10 ** (gain / 20)
    vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    shelf = ((vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0,
             2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0)
    f0, q = 38.13547087602444, 0.5003270373238773
    k = math.tan(math.pi * f0 / rate)
    a0 = 1 + k / q + k * k
    high = (1.0, -2.0, 1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0)
    return shelf, high


def read_pcm(path):
    with wave.open(str(path), 'rb') as audio:
        channels, width, rate, frames = audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()
        if width not in (2, 3, 4) or not 1 <= channels <= 8:
            raise ValueError('Formato PCM no soportado para medir.')
        raw = audio.readframes(frames)
    scale = float(1 << (width * 8 - 1))
    if np is not None:
        if width == 3:
            data = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
            values = (data[:, 0] | (data[:, 1] << 8) | (data[:, 2] << 16))
            values = np.where(values >= 1 << 23, values - (1 << 24), values).astype(np.float64)
        else:
            values = np.frombuffer(raw, dtype={2: '<i2', 4: '<i4'}[width]).astype(np.float64)
        values = values[: len(values) // channels * channels].reshape(-1, channels).T / scale
        return [values[c].tolist() for c in range(channels)], rate, width
    if width == 3:
        flat = [int.from_bytes(raw[i:i + 3], 'little', signed=True) for i in range(0, len(raw) - 2, 3)]
    else:
        flat = struct.unpack('<' + str(len(raw) // width) + {2: 'h', 4: 'i'}[width], raw[: len(raw) // width * width])
    return [[v / scale for v in flat[c::channels]] for c in range(channels)], rate, width


def _filter(samples, coeffs):
    b0, b1, b2, a1, a2 = coeffs
    out = []
    x1 = x2 = y1 = y2 = 0.0
    append = out.append
    for x in samples:
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, x, y1, y
        append(y)
    return out


def integrated_lufs(channels, rate):
    shelf, high = k_weighting(rate)
    block, step = int(0.4 * rate), int(0.1 * rate)
    powers = []
    weighted = [_filter(_filter(c, shelf), high) for c in channels[:5]]
    weights = [1.0, 1.0, 1.0, 1.41, 1.41][: len(weighted)]
    length = len(weighted[0])
    if True:
        cumulative = []
        for w in weighted:
            total, sums = 0.0, [0.0]
            for v in w:
                total += v * v
                sums.append(total)
            cumulative.append(sums)
        for start in range(0, length - block + 1, step):
            powers.append(sum(g * (s[start + block] - s[start]) / block for g, s in zip(weights, cumulative)))
    loud = lambda p: -0.691 + 10 * math.log10(p) if p > 0 else -math.inf
    gated = [p for p in powers if loud(p) > -70]
    if not gated:
        return None
    relative = loud(sum(gated) / len(gated)) - 10
    final = [p for p in gated if loud(p) > relative]
    return round(loud(sum(final) / len(final)), 1) if final else None


def true_peak_dbtp(channels):
    """Pico verdadero con sobremuestreo ×4 (interpolación sinc con ventana) cerca de los picos de muestra."""
    taps = 12
    kernel = []
    for phase in range(1, 4):
        frac = phase / 4
        row = []
        for n in range(-taps + 1, taps + 1):
            t = n - frac
            w = 0.5 + 0.5 * math.cos(math.pi * t / taps)
            row.append(math.sin(math.pi * t) / (math.pi * t) * w)
        kernel.append(row)
    best = 0.0
    for samples in channels:
        values = samples
        peak = max((abs(v) for v in values), default=0.0)
        best = max(best, peak)
        threshold = peak * 0.7
        for i, v in enumerate(values):
            if abs(v) < threshold or i < taps or i + taps >= len(values):
                continue
            window = values[i - taps + 1:i + taps + 1]
            for row in kernel:
                best = max(best, abs(sum(a * b for a, b in zip(row, window))))
    return round(20 * math.log10(best), 1) if best > 0 else None


def find_youlean():
    candidates = [shutil.which('ylm2'), shutil.which('ylm2.exe'),
                  r'C:\Program Files\Youlean\Youlean Loudness Meter 2\ylm2.exe',
                  '/Applications/Youlean Loudness Meter 2.app/Contents/MacOS/ylm2']
    return next((c for c in candidates if c and Path(c).is_file()), None)


def measure_youlean(path, exe):
    """Interpreta la salida de ylm2; si el formato no se reconoce, se devuelve None y se mide aparte."""
    try:
        result = subprocess.run([exe, '--input', str(path), '--export-json', '-'], capture_output=True, text=True, timeout=300)
        data = json.loads(result.stdout)
        lufs = data.get('integrated') or data.get('Integrated') or data.get('integrated_loudness')
        tp = data.get('true_peak') or data.get('TruePeak') or data.get('max_true_peak')
        if lufs is None:
            return None
        return dict(lufs=round(float(lufs), 1), dbtp=round(float(tp), 1) if tp is not None else None, medidor='Youlean')
    except Exception:
        return None


def measure(path):
    path = Path(path)
    with wave.open(str(path), 'rb') as audio:
        fmt = dict(frecuencia=audio.getframerate(), bits=audio.getsampwidth() * 8, canales=audio.getnchannels(),
                   duracion=audio.getnframes() / audio.getframerate())
    # ylm2: pendiente verificar sus parámetros en la PC de Pedro; mientras tanto solo con AUDIOTALLER_YOULEAN=1.
    exe = find_youlean() if os.environ.get('AUDIOTALLER_YOULEAN') == '1' else None
    result = measure_youlean(path, exe) if exe else None
    if result is None:
        channels, rate, _ = read_pcm(path)
        result = dict(lufs=integrated_lufs(channels, rate), dbtp=true_peak_dbtp(channels),
                      medidor='AudioTaller (BS.1770)')
    result.update(fmt)
    return result
