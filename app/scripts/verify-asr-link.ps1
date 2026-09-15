param([string]$Executable)
$ErrorActionPreference = 'Stop'
$appDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Executable) {
    $targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $appDir 'src-tauri/target-release' }
    $Executable = Join-Path $targetDir 'release/markpdf.exe'
}
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Built executable not found: $Executable" }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio Build Tools are required to audit native exports.' }
$dumpbin = & $vswhere -latest -products '*' -find 'VC/Tools/MSVC/**/bin/Hostx64/x64/dumpbin.exe' | Select-Object -First 1
if (-not $dumpbin) { throw 'dumpbin.exe was not found in Visual Studio Build Tools.' }
$exports = & $dumpbin /exports $Executable
if ($LASTEXITCODE -ne 0) { throw 'Native executable export inspection failed.' }
if ($exports -match '(?i)espeak|piper|phonemiz') {
    throw 'The executable retains TTS exports. Do not release it; use the verified ASR-only native SDK.'
}
Write-Host 'Native export audit passed: no eSpeak / Piper / phonemizer exports.'
