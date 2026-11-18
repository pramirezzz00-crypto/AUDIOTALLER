import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import runtime_paths
from cloud_auth import CredentialStore

class PlatformSupportTest(unittest.TestCase):
    def test_user_directories_keep_windows_and_separate_mac(self):
        home = Path('/Users/productor')
        self.assertEqual(runtime_paths.data_directory('darwin', {}, home),home/'Library/Application Support/AudioTaller')
        self.assertEqual(runtime_paths.data_directory('win32', {'LOCALAPPDATA':str(home/'Local')}, home),home/'Local/AudioTaller')

    def test_keychain_separates_stores_and_writes_no_plaintext(self):
        with tempfile.TemporaryDirectory() as folder:
            store=CredentialStore(Path(folder)/'google.dpapi')
            other=CredentialStore(Path(folder)/'artistas.dpapi')
            self.assertNotEqual(store.keychain_account(),other.keychain_account())
            backend=Mock()
            backend.get_password.return_value=None
            with patch('cloud_auth.using_keychain',return_value=True),patch('cloud_auth.mac_keyring',return_value=backend):
                self.assertEqual(store.read(),{})
                store.write({'refresh_token':'sintetico'})
                backend.get_password.return_value=backend.set_password.call_args.args[2]
                self.assertEqual(store.read(),{'refresh_token':'sintetico'})
                self.assertFalse(store.path.exists())
                backend.set_password.side_effect=RuntimeError('Llavero bloqueado')
                with self.assertRaises(RuntimeError):store.write({'refresh_token':'otro'})
                self.assertFalse(store.path.exists())

    def test_native_mac_launch_preserves_paths_with_spaces(self):
        with patch('runtime_paths.sys.platform','darwin'),patch('runtime_paths.subprocess.Popen') as launch:
            runtime_paths.launch_daw('/Applications/Cubase 14.app','/Producciones/Tema V2.cpr','/Producciones')
            self.assertEqual(launch.call_args.args[0],['/usr/bin/open','-a','/Applications/Cubase 14.app','/Producciones/Tema V2.cpr'])
            runtime_paths.open_path('/Producciones/Tema V2.cpr')
            self.assertEqual(launch.call_args.args[0],['/usr/bin/open','/Producciones/Tema V2.cpr'])
