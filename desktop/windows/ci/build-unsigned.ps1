# Explicit local candidate build (no signing, publishing or installation).
# A developer must run this on Windows with Node 24+ and a trusted network.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  throw 'Нужна Windows с PowerShell, Node.js 24+ и NSIS. Linux/native acceptance здесь невозможен.'
}
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
if ($env:CSC_LINK -or $env:WIN_CSC_LINK -or $env:CSC_NAME -or $env:WIN_CSC_NAME -or $env:CSC_KEY_PASSWORD -or $env:WIN_CSC_KEY_PASSWORD) {
  throw 'Обнаружена переменная подписи: unsigned сборка требует отдельного окружения без signing credentials.'
}
$nodeMajor = [int]((node -p 'process.versions.node').Split('.')[0])
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 24) { throw 'Требуется Node.js 24+.' }
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
node ci/verify-unsigned-policy.cjs
if ($LASTEXITCODE -ne 0) { throw 'Policy preflight не пройден.' }
npm run check
if ($LASTEXITCODE -ne 0) { throw 'Node тесты не пройдены.' }
# Version pinned; dependencies must be obtained from a reviewed lock/cache in CI
# for bit-for-bit supply-chain reproducibility. This script records actual bytes.
npx --yes electron-builder@26.17.0 --win nsis --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'electron-builder не создал installer.' }
$version = node -p "require('./package.json').version"
$installer = Join-Path 'dist' "Kosmora-Setup-$version-x64.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer отсутствует: $installer" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
$leaf = Split-Path -Leaf $installer
[IO.File]::WriteAllText((Join-Path (Get-Location) 'dist/SHA256SUMS.txt'), "$hash  $leaf`n", [Text.UTF8Encoding]::new($false))
Write-Host "Unsigned installer: $installer"
Write-Host "SHA-256: $hash"
Write-Host 'Updates remain OFF (no Ed25519 publisher key); native install/upgrade/uninstall are separate acceptance gates.'
