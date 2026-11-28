"""Envolventes reales y formatos WAV, con memoria acotada."""
import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audio_waveform import pcm_waveform


class WaveformTest(unittest.TestCase):
    def test_detecta_transitorios_pcm_en_todos_los_canales(self):
        for width in (1,2,3,4):
            with self.subTest(width=width), tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp:
                path=Path(temp)/'prueba.wav'
                frame_count=8000
                silence=(128 if width==1 else 0).to_bytes(width,'little',signed=width!=1)
                maximum=((1 << (width*8-1))-1).to_bytes(width,'little',signed=width!=1)
                if width==1:
                    maximum=bytes([255])
                frames=bytearray(silence * (frame_count*2))
                position=(4000*2+1)*width
                frames[position:position+width]=maximum
                with wave.open(str(path),'wb') as output:
                    output.setparams((2,width,8000,0,'NONE','not compressed'))
                    output.writeframes(frames)
                data=pcm_waveform(path,bins=100)
                self.assertEqual(data['duration'],1)
                self.assertEqual(len(data['peaks']),100)
                self.assertGreater(data['peaks'][50],0.98)
                self.assertEqual(sum(value>0 for value in data['peaks']),1)
                with wave.open(str(path),'rb') as original:
                    self.assertEqual(original.readframes(frame_count),bytes(frames))

    def test_lee_coma_flotante_y_extensible_como_graba_cubase(self):
        import struct
        def write(path, tag, bits, samples, extensible=False):
            width = bits // 8
            data = struct.pack('<' + str(len(samples)) + ('f' if tag == 3 else 'h'), *samples)
            if extensible:
                fmt = struct.pack('<HHIIHHHHIH14s', 0xFFFE, 1, 8000, 8000 * width, width, bits, 22, bits, 4, tag, b'\x00' * 14)
            else:
                fmt = struct.pack('<HHIIHH', tag, 1, 8000, 8000 * width, width, bits)
            chunks = b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(data)) + data
            path.write_bytes(b'RIFF' + struct.pack('<I', 4 + len(chunks)) + b'WAVE' + chunks)
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp:
            for name, tag, bits, peak, ext in (('float.wav', 3, 32, 0.75, False), ('float_ext.wav', 3, 32, 0.5, True), ('pcm_ext.wav', 1, 16, 16384, True)):
                with self.subTest(name=name):
                    path = Path(temp) / name
                    samples = [0] * 8000
                    samples[6000] = peak
                    write(path, tag, bits, samples, ext)
                    original = path.read_bytes()
                    data = pcm_waveform(path, bins=4)
                    self.assertEqual(data['duration'], 1)
                    self.assertEqual(data['peaks'][:3], [0, 0, 0])
                    self.assertAlmostEqual(data['peaks'][3], 0.75 if name == 'float.wav' else 0.5, places=3)
                    self.assertEqual(path.read_bytes(), original)

    def test_archivos_grandes_se_muestrean_sin_leer_todo(self):
        import audio_waveform
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp:
            path = Path(temp) / 'larga.wav'
            loud = (16000).to_bytes(2, 'little', signed=True) * 4000
            with wave.open(str(path), 'wb') as output:
                output.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
                output.writeframes(bytes(16000) + loud + bytes(8000))   # 1 s de silencio, 0,5 s fuerte, 0,5 s de silencio
            original, before = path.read_bytes(), (audio_waveform.FULL_READ_BYTES, audio_waveform.SAMPLED_BYTES)
            audio_waveform.FULL_READ_BYTES, audio_waveform.SAMPLED_BYTES = 1000, 4000
            try:
                data = pcm_waveform(path, bins=4)
            finally:
                audio_waveform.FULL_READ_BYTES, audio_waveform.SAMPLED_BYTES = before
            self.assertEqual(data['duration'], 2)
            self.assertEqual(data['peaks'][:2], [0, 0])
            self.assertAlmostEqual(data['peaks'][2], 16000 / 32768, places=3)
            self.assertEqual(data['peaks'][3], 0)
            self.assertEqual(path.read_bytes(), original)

    def test_silencio_y_archivo_vacio(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temp:
            path=Path(temp)/'vacio.wav'
            with wave.open(str(path),'wb') as output:
                output.setparams((1,2,8000,0,'NONE','not compressed'))
            data=pcm_waveform(path)
            self.assertEqual(data['duration'],0)
            self.assertFalse(any(data['peaks']))


if __name__=='__main__':
    unittest.main()
