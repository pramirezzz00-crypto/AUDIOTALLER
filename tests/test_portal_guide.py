import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PortalGuideTest(unittest.TestCase):
    def test_instructivo_y_prompt_incluidos_en_la_app(self):
        pdf = ROOT / 'static' / 'docs' / 'Instructivo-Portal-del-artista-AudioTaller.pdf'
        self.assertTrue(pdf.read_bytes().startswith(b'%PDF'))
        prompt = (ROOT / 'static' / 'docs' / 'prompt-asistencia-ia-portal.txt').read_text(encoding='utf-8')
        self.assertIn('Portal del artista de AudioTaller', prompt)
        self.assertIn("(str(root/'static'),'static')", (ROOT / 'packaging' / 'AudioTaller.spec').read_text(encoding='utf-8'))

    def test_accesos_al_instructivo_en_playlist(self):
        html = (ROOT / 'static' / 'audio.html').read_text(encoding='utf-8')
        self.assertIn('id="sidePortalGuide"', html)
        self.assertIn('function portalGuideDialog', (ROOT / 'static' / 'cloud-ui.js').read_text(encoding='utf-8'))
        self.assertIn('def save_portal_guide', (ROOT / 'desktop.py').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
