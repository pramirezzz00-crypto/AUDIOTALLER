import io
import tempfile
import unittest
import zipfile
from pathlib import Path

import plugin_downloads
import plugin_inventory
from plugin_manager import find_plugins


class FakeResponse(io.BytesIO):
    def __init__(self, data, url, headers=None):
        super().__init__(data)
        self.url, self.headers = url, headers or {}

    def geturl(self):
        return self.url

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def item(id_, name, fmt='VST3', version='', mtime=0, size=10, rel=None):
    return dict(id=id_, nombre=name, formato=fmt, relativo=rel or name + '.vst3', version=version, modificado=mtime,
                tamano=size, licencia='gratis', central='')


class DuplicatesTest(unittest.TestCase):
    def test_same_format_copies_are_grouped_and_newest_is_kept(self):
        groups = plugin_inventory.find_duplicates([
            item('a', 'TDR Nova', version='2.1'), item('b', 'TDR Nova (1)', version='2.2.3', rel='sub/TDR Nova (1).vst3'),
            item('c', 'TDR Nova', fmt='AU'), item('d', 'Pro-Q 3'), item('e', 'Pro-Q 4')])
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['conservar'], 'b')
        self.assertEqual(groups[0]['espacio'], 10)

    def test_different_formats_are_not_duplicates(self):
        self.assertEqual(plugin_inventory.find_duplicates([item('a', 'SPAN'), item('b', 'SPAN', fmt='VST2')]), [])

    def test_date_breaks_ties(self):
        groups = plugin_inventory.find_duplicates([item('a', 'DC1A', mtime=5), item('b', 'DC1A copy', mtime=9 * 86400)])
        self.assertEqual(groups[0]['conservar'], 'b')
        self.assertEqual(groups[0]['nombre'], 'DC1A')

    def test_same_day_prefers_name_without_copy_mark(self):
        groups = plugin_inventory.find_duplicates([item('a', 'SPAN copy', mtime=100), item('b', 'SPAN', mtime=50)])
        self.assertEqual(groups[0]['conservar'], 'b')


class DownloadsTest(unittest.TestCase):
    def test_only_official_https_hosts(self):
        self.assertTrue(plugin_downloads.host_allowed('https://cdn.youlean.co/x.zip'))
        self.assertFalse(plugin_downloads.host_allowed('http://youlean.co/x.zip'))
        self.assertFalse(plugin_downloads.host_allowed('https://youlean.co.evil.com/x.zip'))
        with self.assertRaises(ValueError):
            plugin_downloads.fetch('https://example.com/')

    def test_resolve_finds_current_link_on_page(self):
        page = b'<a href="https://cdn.youlean.co/wp-content/uploads/2027/01/Youlean-Loudness-Meter-2-V2.6.0-Windows.zip">Win</a>'
        url = plugin_downloads.resolve('Youlean Loudness Meter', 'win32', opener=lambda u, timeout: FakeResponse(page, u))
        self.assertIn('V2.6.0-Windows.zip', url)

    def test_resolve_tdr_and_fallback(self):
        page = '<a href="https://www.tokyodawn.net/labs/Nova/2.3.0/TDR Nova (installer).zip">i</a><a href="https://www.tokyodawn.net/labs/Nova/2.3.0/TDR Nova (no installer).zip">n</a><a href="https://www.tokyodawn.net/labs/Nova/2.3.0/TDR Nova.zip">m</a>'.encode()
        opener = lambda u, timeout: FakeResponse(page, u)
        self.assertTrue(plugin_downloads.resolve('TDR Nova', 'win32', opener).endswith('2.3.0/TDR%20Nova%20(no%20installer).zip'))
        self.assertTrue(plugin_downloads.resolve('TDR Nova', 'darwin', opener).endswith('2.3.0/TDR%20Nova.zip'))

        def broken(u, timeout):
            raise OSError('sin red')
        self.assertIn('/labs/Nova/2.2.3/', plugin_downloads.resolve('TDR Nova', 'win32', broken))

    def test_zip_with_plugins_skips_32_bit_and_finds_installers(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'p.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('TDR Nova/VST3/x64/TDR Nova.vst3/Contents/x86_64-win/TDR Nova.vst3', b'MZ')
                z.writestr('TDR Nova/VST/x86/TDR Nova.dll', b'MZ')
                z.writestr('TDR Nova/VST/x64/TDR Nova.dll', b'MZ')
            finder = lambda folder: [p for p in Path(folder).rglob('*') if p.suffix in ('.vst3', '.dll') and '.vst3' not in str(p.parent)]
            plugins, installers = plugin_downloads.prepare(archive, temp, finder, 'win32')
            names = sorted(str(p.relative_to(temp)).replace('\\', '/').split('/', 1)[1] for p in plugins)
            self.assertEqual(names, ['TDR Nova/VST/x64/TDR Nova.dll', 'TDR Nova/VST3/x64/TDR Nova.vst3'])
            self.assertEqual(installers, [])
            with zipfile.ZipFile(Path(temp) / 'y.zip', 'w') as z:
                z.writestr('Youlean Setup.exe', b'MZ....Inno Setup....')
            plugins, installers = plugin_downloads.prepare(Path(temp) / 'y.zip', temp, find_plugins, 'win32')
            self.assertEqual([i.name for i in installers], ['Youlean Setup.exe'])
            self.assertEqual(plugin_downloads.exe_flags(installers[0])[0], '/VERYSILENT')

    def test_zip_slip_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('../fuera.txt', b'x')
            with self.assertRaises(ValueError):
                plugin_downloads.safe_extract(archive, Path(temp) / 'out')

    def test_download_writes_file_with_server_name(self):
        with tempfile.TemporaryDirectory() as temp:
            response = FakeResponse(b'PK\x03\x04data', 'https://klanghelm.com/free/DC1A3dl.php?id=1',
                                    {'Content-Disposition': 'attachment; filename="DC1A_350_WIN.zip"', 'Content-Length': '10'})
            path = plugin_downloads.download('https://klanghelm.com/free/DC1A3dl.php?id=1', temp, opener=lambda u, timeout: response)
            self.assertEqual(path.name, 'DC1A_350_WIN.zip')
            self.assertEqual(plugin_downloads.kind_of(path), 'zip')


if __name__ == '__main__':
    unittest.main()
