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
