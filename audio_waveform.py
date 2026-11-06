"""Lectura acotada de ondas PCM WAV, conservando intacto el archivo original."""
import struct
import wave


def pcm_waveform(path, bins=1000):
    with wave.open(str(path), 'rb') as audio:
        channels = audio.getnchannels()
        width = audio.getsampwidth()
        frames = audio.getnframes()
        rate = audio.getframerate()
        if not 1 <= channels <= 32 or width not in (1, 2, 3, 4) or rate <= 0:
            raise ValueError('Formato PCM no soportado.')
        peaks = [0.0] * bins
        frame_index = 0
        scale = float(1 << (width * 8 - 1))
        for bucket in range(bins):
            end = (bucket + 1) * frames // bins
            # Cada bloque ocupa memoria acotada incluso para grabaciones largas.
            while frame_index < end:
                block = audio.readframes(min(4096, end - frame_index))
                block = block[:len(block) // (width * channels) * (width * channels)]
                if not block:
                    break
                if width == 3:
                    values = [int.from_bytes(block[pos:pos+3], 'little', signed=True)
                              for pos in range(0, len(block), 3)]
                else:
                    fmt = {1:'B', 2:'h', 4:'i'}[width]
                    values = struct.unpack('<' + str(len(block) // width) + fmt, block)
                offset = 128 if width == 1 else 0
                amplitude = max(abs(min(values) - offset), abs(max(values) - offset)) / scale
                peaks[bucket] = max(peaks[bucket], amplitude)
                frame_index += len(block) // (width * channels)
        return dict(peaks=peaks, duration=frames / rate)
