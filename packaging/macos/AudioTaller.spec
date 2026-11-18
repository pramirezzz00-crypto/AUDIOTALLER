# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import copy_metadata
root = Path(SPECPATH).parents[1]
datas = [(str(root/'static'),'static'), (str(root/'artist_web'),'artist_web'),
         (str(root/'docs'),'docs'), (str(root/'packaging/macos/LEEME.txt'),'.'),
         (str(root/'build/licenses/_internal/third_party'),'third_party')]
for package in ('pywebview','Flask','bottle','keyring'):
    datas += copy_metadata(package)
a = Analysis([str(root/'desktop.py')], pathex=[str(root)], binaries=[], datas=datas,
    hiddenimports=['webview.platforms.cocoa','keyring.backends.macOS'],
    excludes=['clr','clr_loader','pythonnet','webview.platforms.winforms','webview.platforms.edgechromium',
              'PyQt5','PyQt6','PySide2','PySide6','gi','webview.platforms.gtk','webview.platforms.qt'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz,a.scripts,[],exclude_binaries=True,name='AudioTaller',console=False,
          strip=False,upx=False,argv_emulation=False, target_arch=None, codesign_identity=None)
coll = COLLECT(exe,a.binaries,a.datas,strip=False,upx=False,name='AudioTaller')
app = BUNDLE(coll,name='AudioTaller.app',icon=str(root/'build/AudioTaller.icns'),
    bundle_identifier='org.audiotaller.desktop',version='0.2.0',
    info_plist={'CFBundleDisplayName':'AudioTaller','CFBundleShortVersionString':'0.2.0',
                'NSHighResolutionCapable':True,'LSMinimumSystemVersion':'13.0'})
