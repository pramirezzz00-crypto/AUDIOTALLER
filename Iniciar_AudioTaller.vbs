' Inicia Python sin consola y encuentra el proyecto desde cualquier acceso directo.
Option Explicit
Dim archivos, shell, carpeta, python, entrada
Set archivos = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
carpeta = archivos.GetParentFolderName(WScript.ScriptFullName)
python = archivos.BuildPath(carpeta, ".venv\Scripts\pythonw.exe")
entrada = archivos.BuildPath(carpeta, "desktop.py")
If Not archivos.FileExists(python) Then
    MsgBox "Falta el entorno .venv de AudioTaller.", vbCritical, "AudioTaller"
    WScript.Quit 1
End If
shell.CurrentDirectory = carpeta
shell.Run Chr(34) & python & Chr(34) & " " & Chr(34) & entrada & Chr(34), 1, False
