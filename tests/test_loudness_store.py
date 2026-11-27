import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path

from flask import Flask

from loudness_store import register_loudness_store


class LoudnessStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        app = Flask(__name__)
        app.register_error_handler(ValueError, lambda e: ({'error': str(e)}, 400))
        register_loudness_store(app, lambda: self.temp.name)
        self.client = app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def save(self, name, data, result):
        return self.client.post('/api/loudness/ultimo?nombre=' + urllib.parse.quote(name), data=data,
                                headers={'X-Resultado': urllib.parse.quote(json.dumps(result))})

    def test_new_analysis_replaces_and_reset_deletes(self):
        self.assertFalse(self.client.get('/api/loudness/ultimo').get_json()['hay'])
        self.save('Mareas · mix.wav', b'RIFF1', {'integrado': -9.7})
        self.save('Faro.wav', b'RIFF22', {'integrado': -14.2})
        last = self.client.get('/api/loudness/ultimo').get_json()
        self.assertEqual((last['nombre'], last['resultado']['integrado']), ('Faro.wav', -14.2))
        self.assertEqual(self.client.get('/api/loudness/ultimo/audio').data, b'RIFF22')
        self.client.post('/api/loudness/ultimo/borrar', json={})
        self.assertFalse(self.client.get('/api/loudness/ultimo').get_json()['hay'])
        self.assertEqual(list((Path(self.temp.name) / 'Loudness Penalty').iterdir()), [])


if __name__ == '__main__':
    unittest.main()
