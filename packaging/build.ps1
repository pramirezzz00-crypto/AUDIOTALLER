param(
    [Parameter(Mandatory=$true)][string]$Python,
    [Parameter(Mandatory=$true)][string]$Iscc,
    [Parameter(Mandatory=$true)][string]$ToolsRoot,
    [Parameter(Mandatory=$true)][string]$BuildRoot,
    [Parameter(Mandatory=$true)][string]$OutputRoot
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$Python=(Resolve-Path -LiteralPath $Python).Path
$Iscc=(Resolve-Path -LiteralPath $Iscc).Path
$ToolsRoot=(Resolve-Path -LiteralPath $ToolsRoot).Path
$BuildRoot=[IO.Path]::GetFullPath($BuildRoot)
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
$config=Get-Content -Raw -LiteralPath "$repo\artist_web\public\config.json" | ConvertFrom-Json
if ($config.projectId -or $config.apiKey -or $config.driveApiKey) { throw 'La distribución debe incluir configuración vacía, sin conexión del desarrollador.' }
if (!(Test-Path -LiteralPath "$repo\static\branding\AudioTaller.ico")) { throw 'Falta el icono de Windows.' }
foreach ($file in @('MicrosoftEdgeWebview2Setup.exe')) {
    $signature=Get-AuthenticodeSignature -LiteralPath (Join-Path $ToolsRoot $file)
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft*') { throw 'Firma del componente de Microsoft no válida.' }
}
& $Python -m PyInstaller --noconfirm --distpath $BuildRoot --workpath (Join-Path $BuildRoot '_work') "$PSScriptRoot\AudioTaller.spec"
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de AudioTaller.' }
& $Python "$PSScriptRoot\stage_resources.py" (Join-Path $BuildRoot 'AudioTaller')
if ($LASTEXITCODE -ne 0) { throw 'Falló la verificación de recursos.' }
& $Python "$PSScriptRoot\collect_licenses.py" (Join-Path $BuildRoot 'AudioTaller')
if ($LASTEXITCODE -ne 0) { throw 'Falló la recopilación de licencias.' }
& $Iscc "/DBuildRoot=$BuildRoot" "/DToolsRoot=$ToolsRoot" "/DOutputRoot=$OutputRoot" "$PSScriptRoot\installer.iss"
if ($LASTEXITCODE -ne 0) { throw 'Falló la generación del instalador.' }
$installer=Join-Path $OutputRoot 'AudioTaller-0.2.0-beta-Setup-x64.exe'
(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash+'  '+(Split-Path -Leaf $installer) | Set-Content -Encoding ascii -LiteralPath (Join-Path $OutputRoot 'SHA256SUMS.txt')
Write-Output $installer
