param([string]$BundleDir)
$ErrorActionPreference = 'Stop'
$appDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $appDir 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
if (-not $BundleDir) {
    $targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $appDir 'src-tauri/target-release' }
    $BundleDir = Join-Path $targetDir 'release/bundle/nsis'
}
$installer = Join-Path $BundleDir "MarkPDF_${version}_x64-setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer not found: $installer" }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$line = "$hash  $([System.IO.Path]::GetFileName($installer))"
$checksumFile = Join-Path $BundleDir 'SHA256SUMS.txt'
[System.IO.File]::WriteAllText($checksumFile, "$line`n", [System.Text.UTF8Encoding]::new($false))
Write-Host $line
