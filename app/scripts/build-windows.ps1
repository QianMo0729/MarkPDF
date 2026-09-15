param(
    [switch]$PrepareOnly,
    [switch]$SkipInstall,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This script builds the Windows x64 installer.' }
$appDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rustDir = Join-Path $appDir 'src-tauri'
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw 'Install Node.js 24 LTS (CI uses 24.18.0).' }
# Respect an explicit toolchain or the developer's existing rustup default.
# CI sets the verified release toolchain explicitly before invoking this script.
$rustInfo = & rustc -vV
if ($LASTEXITCODE -ne 0) { throw 'Install Rust with rustup, then run: rustup toolchain install 1.98.1 --profile minimal' }
if (-not ($rustInfo -match '^host: x86_64-pc-windows-msvc$')) { throw 'Use the x86_64-pc-windows-msvc Rust toolchain and Microsoft C++ Build Tools.' }
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = Join-Path $rustDir 'target-release' }
if (-not [System.IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) { $env:CARGO_TARGET_DIR = [System.IO.Path]::GetFullPath((Join-Path $appDir $env:CARGO_TARGET_DIR)) }

$lock = Get-Content -LiteralPath (Join-Path $rustDir 'Cargo.lock') -Raw
$versionMatch = [regex]::Match($lock, '\[\[package\]\]\s*name\s*=\s*"sherpa-onnx-sys"\s*version\s*=\s*"([^"]+)"')
if (-not $versionMatch.Success) { throw 'Cannot locate sherpa-onnx-sys in Cargo.lock.' }
$sherpaVersion = $versionMatch.Groups[1].Value
$archiveStem = "sherpa-onnx-v$sherpaVersion-win-x64-static-MT-Release-no-tts-lib"
if ($env:SHERPA_ONNX_LIB_DIR) {
    if (-not (Test-Path -LiteralPath (Join-Path $env:SHERPA_ONNX_LIB_DIR 'sherpa-onnx-c-api.lib') -PathType Leaf)) { throw 'SHERPA_ONNX_LIB_DIR must contain the matching Windows x64 static libraries.' }
    foreach ($ttsLibrary in @('piper_phonemize.lib', 'espeak-ng.lib', 'ucd.lib')) {
        if (Test-Path -LiteralPath (Join-Path $env:SHERPA_ONNX_LIB_DIR $ttsLibrary)) { throw 'SHERPA_ONNX_LIB_DIR points to the full SDK. Use the official matching no-tts-lib archive.' }
    }
} elseif ($env:SHERPA_ONNX_ARCHIVE_DIR) {
    if (-not (Test-Path -LiteralPath (Join-Path $env:SHERPA_ONNX_ARCHIVE_DIR "$archiveStem.tar.bz2") -PathType Leaf)) { throw "SHERPA_ONNX_ARCHIVE_DIR must contain $archiveStem.tar.bz2" }
} elseif ($env:LOCALAPPDATA) {
    $cachedLib = Join-Path $env:LOCALAPPDATA "MarkPDF-build\$archiveStem\lib"
    if (Test-Path -LiteralPath (Join-Path $cachedLib 'sherpa-onnx-c-api.lib') -PathType Leaf) { $env:SHERPA_ONNX_LIB_DIR = $cachedLib }
}

# Export only build variables between GitHub Actions steps. No user credentials
# or application settings are inspected by this script.
if ($env:GITHUB_ENV) {
    foreach ($name in @('RUSTUP_TOOLCHAIN', 'CARGO_TARGET_DIR', 'SHERPA_ONNX_LIB_DIR', 'SHERPA_ONNX_ARCHIVE_DIR')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ($value) { Add-Content -LiteralPath $env:GITHUB_ENV -Value "$name=$value" -Encoding utf8 }
    }
}
Write-Host "Build target: $env:CARGO_TARGET_DIR"
if ($env:SHERPA_ONNX_LIB_DIR) { Write-Host 'Using the existing sherpa-onnx static library directory.' }
elseif ($env:SHERPA_ONNX_ARCHIVE_DIR) { Write-Host 'Using the supplied sherpa-onnx archive.' }
else { Write-Host "sherpa-onnx-sys will download and verify official v$sherpaVersion ASR-only libraries when needed." }
if ($PrepareOnly) { return }

Push-Location -LiteralPath $appDir
try {
    if (-not $SkipInstall) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' } }
    & node scripts/check-release-version.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Version validation failed.' }
    & node scripts/download-translation-assets.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Translation engine verification failed.' }
    if (-not $SkipTests) {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
        & cargo test --locked --lib --manifest-path src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed.' }
    }
    & npm.cmd run tauri -- build --ci --bundles nsis -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
    & (Join-Path $PSScriptRoot 'verify-asr-link.ps1')
    & (Join-Path $PSScriptRoot 'write-checksums.ps1')
    Write-Host "Installer and SHA256SUMS.txt: $env:CARGO_TARGET_DIR\release\bundle\nsis"
} finally { Pop-Location }
