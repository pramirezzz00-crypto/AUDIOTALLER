# -*- mode: python ; coding: utf-8 -*-
"""Paquete por carpeta dentro de un instalador EXE único; recursos explícitos.

No se recopila la carpeta de datos, credenciales, entornos ni archivos del DAW.
El hook oficial de webview incorpora las bibliotecas nativas WebView2 y CLR.
"""
from pathlib import Path
from PyInstaller.utils.hooks import copy_metadata
root=Path(SPECPATH).parent
datas=[(str(root/'static'),'static'),(str(root/'artist_web'),'artist_web'),
       (str(root/'docs'),'docs'),(str(root/'packaging'/'LEEME.txt'),'.')]
for package in ('pywebview','Flask','pythonnet','clr_loader','bottle'):
    datas+=copy_metadata(package)
analysis=Analysis([str(root/'desktop.py')],pathex=[str(root)],binaries=[],datas=datas,
    hiddenimports=['webview.platforms.winforms','webview.platforms.edgechromium','clr_loader.netfx'],
    excludes=['PyQt5','PyQt6','PySide2','PySide6','gi','webview.platforms.gtk','webview.platforms.qt','webview.platforms.cocoa'],
    noarchive=False)
pyz=PYZ(analysis.pure)
exe=EXE(pyz,analysis.scripts,[],exclude_binaries=True,name='AudioTaller',debug=False,
    bootloader_ignore_signals=False,strip=False,upx=False,console=False,
    icon=str(root/'static/branding/AudioTaller.ico'),version=str(root/'packaging/version_info.txt'))
coll=COLLECT(exe,analysis.binaries,analysis.datas,strip=False,upx=False,name='AudioTaller')
