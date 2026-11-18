; Instalación por usuario: no modifica C:\AudioTaller ni elimina datos de trabajo.
#ifndef BuildRoot
  #error Falta BuildRoot
#endif
#ifndef ToolsRoot
  #error Falta ToolsRoot
#endif
#ifndef OutputRoot
  #error Falta OutputRoot
#endif
[Setup]
AppId={{35E28BF4-21A9-4DD2-9137-75E793F85015}
AppName=AudioTaller
AppVersion=0.2.0
AppVerName=AudioTaller 0.2.0 beta
AppPublisher=AudioTaller
AppPublisherURL=https://github.com/pramirezzz00-crypto/AUDIOTALLER
DefaultDirName={localappdata}\Programs\AudioTaller
DefaultGroupName=AudioTaller
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputRoot}
OutputBaseFilename=AudioTaller-0.2.0-beta-Setup-x64
SetupIconFile=..\static\branding\AudioTaller.ico
UninstallDisplayIcon={app}\AudioTaller.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no
InfoBeforeFile=LEEME.txt
UninstallDisplayName=AudioTaller 0.2.0 beta
[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el Escritorio"; GroupDescription: "Accesos directos:"
[Files]
Source: "{#BuildRoot}\AudioTaller\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ToolsRoot}\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy
[Icons]
Name: "{group}\AudioTaller"; Filename: "{app}\AudioTaller.exe"; AppUserModelID: "AudioTaller.Desktop"
Name: "{autodesktop}\AudioTaller"; Filename: "{app}\AudioTaller.exe"; Tasks: desktopicon; AppUserModelID: "AudioTaller.Desktop"
Name: "{group}\Instructivo del portal del artista"; Filename: "{app}\_internal\docs\AudioTaller_Instructivo_Portal_del_Artista.pdf"
Name: "{group}\Desinstalar AudioTaller"; Filename: "{uninstallexe}"
[Run]
Filename: "{app}\AudioTaller.exe"; Description: "Abrir AudioTaller"; Flags: nowait postinstall skipifsilent
[Code]
function HasWebView2: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
  if not Result then
    Result := (RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  if not HasWebView2 then begin
    WizardForm.StatusLabel.Caption := 'Preparando Microsoft Edge WebView2. Se necesita Internet...';
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then
      Result := 'No se pudo iniciar WebView2. Instalalo desde Microsoft y volvé a ejecutar este instalador.'
    else if not HasWebView2 then
      Result := 'WebView2 todavía no está disponible. Revisá la conexión a Internet o reiniciá Windows si Microsoft lo solicita. Luego reintentá.';
  end;
end;
