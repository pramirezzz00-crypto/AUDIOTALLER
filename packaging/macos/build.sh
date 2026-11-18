#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
ARCH="$(uname -m)"
mkdir -p build/AudioTaller.iconset output/macos
python -m pip install -r requirements.txt 'pyinstaller==6.22.3' 'Pillow>=11,<13'
python packaging/collect_licenses.py build/licenses
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" static/branding/AudioTaller.png --out "build/AudioTaller.iconset/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z "$DOUBLE" "$DOUBLE" static/branding/AudioTaller.png --out "build/AudioTaller.iconset/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns build/AudioTaller.iconset -o build/AudioTaller.icns
python -m unittest discover -s tests -v
python -m PyInstaller --noconfirm packaging/macos/AudioTaller.spec
./dist/AudioTaller.app/Contents/MacOS/AudioTaller --self-test "$PWD/output/macos/diagnostico-${ARCH}.json"
codesign --verify --deep --strict --verbose=2 dist/AudioTaller.app
mkdir -p build/dmg
# ditto conserva enlaces, permisos y firma del bundle.
ditto dist/AudioTaller.app build/dmg/AudioTaller.app
ln -s /Applications build/dmg/Applications
cp packaging/macos/LEEME.txt build/dmg/LEEME.txt
hdiutil create -volname AudioTaller -srcfolder build/dmg -format UDZO "output/macos/AudioTaller-0.2.0-beta-macos-${ARCH}.dmg"
(cd output/macos && shasum -a 256 ./*.dmg > SHA256SUMS.txt)
python -m pip freeze > "output/macos/dependencias-${ARCH}.txt"
