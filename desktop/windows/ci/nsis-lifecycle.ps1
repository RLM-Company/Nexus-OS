param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Fresh", "Upgrade")]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$CurrentInstaller,

  [Parameter(Mandatory = $true)]
  [string]$CurrentVersion,

  [string]$BaselineInstaller,
  [string]$BaselineVersion,

  [Parameter(Mandatory = $true)]
  [string]$WorkRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-ExistingFile([string]$Value, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Label is required."
  }
  $resolved = Resolve-Path -LiteralPath $Value -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
    throw "$Label is not a file: $Value"
  }
  return $resolved.Path
}

function Wait-DirectoryRemoved([string]$PathValue) {
  for ($attempt = 0; $attempt -lt 80 -and (Test-Path -LiteralPath $PathValue); $attempt++) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $PathValue) {
    Get-ChildItem -LiteralPath $PathValue -Recurse -Force -ErrorAction SilentlyContinue |
      Select-Object -First 50 |
      Format-Table -AutoSize
    throw "NSIS uninstall left the installation directory behind: $PathValue"
  }
}

function Invoke-Installer([string]$Installer, [string]$InstallDir) {
  $process = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "NSIS install failed with exit code $($process.ExitCode): $Installer"
  }

  $app = Join-Path $InstallDir "Cosmora.exe"
  if (-not (Test-Path -LiteralPath $app -PathType Leaf)) {
    throw "Installed Cosmora.exe was not found at $app."
  }

  $uninstaller = Get-ChildItem -LiteralPath $InstallDir -Filter "Uninstall*.exe" -File |
    Select-Object -First 1
  if (-not $uninstaller) {
    throw "NSIS uninstaller was not found in $InstallDir."
  }

  return @{
    App = $app
    Uninstaller = $uninstaller.FullName
  }
}

function Invoke-PackagedSmoke(
  [string]$App,
  [string]$ExpectedVersion,
  [string]$InstallDir,
  [string]$Marker,
  [string]$ExpectedUserData
) {
  Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue
  $env:COSMORA_SMOKE_OUTPUT = $Marker
  try {
    $process = Start-Process -FilePath $App -ArgumentList "--cosmora-smoke-test" -Wait -PassThru
  } finally {
    Remove-Item Env:COSMORA_SMOKE_OUTPUT -ErrorAction SilentlyContinue
  }

  if ($process.ExitCode -ne 0) {
    throw "Installed Cosmora smoke process failed with exit code $($process.ExitCode)."
  }
  if (-not (Test-Path -LiteralPath $Marker -PathType Leaf)) {
    throw "Installed Cosmora did not produce the smoke marker."
  }

  $record = Get-Content -LiteralPath $Marker -Raw | ConvertFrom-Json
  if ($record.schemaVersion -lt 1) {
    throw "Unexpected smoke schema version $($record.schemaVersion)."
  }
  if ($record.version -ne $ExpectedVersion) {
    throw "Installed version $($record.version) does not match expected version $ExpectedVersion."
  }
  if ($record.isPackaged -ne $true) {
    throw "Installed Cosmora did not report packaged mode."
  }
  if ($record.platform -ne "win32" -or $record.arch -ne "x64") {
    throw "Installed Cosmora reported an unexpected platform or architecture."
  }

  $expectedExe = [IO.Path]::GetFullPath($App)
  $actualExe = [IO.Path]::GetFullPath([string]$record.execPath)
  if (-not [string]::Equals($expectedExe, $actualExe, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Smoke executable path does not match the installed application."
  }

  $expectedResources = [IO.Path]::GetFullPath((Join-Path $InstallDir "resources"))
  $actualResources = [IO.Path]::GetFullPath([string]$record.resourcesPath)
  if (-not [string]::Equals($expectedResources, $actualResources, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Smoke resources path does not match the installed application."
  }

  $expectedAsar = [IO.Path]::GetFullPath((Join-Path $expectedResources "app.asar"))
  $actualAppPath = [IO.Path]::GetFullPath([string]$record.appPath)
  if (-not [string]::Equals($expectedAsar, $actualAppPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Smoke app path is not the packaged app.asar."
  }

  if ($record.PSObject.Properties.Name -contains "userDataPath") {
    $actualUserData = [IO.Path]::GetFullPath([string]$record.userDataPath)
    $expected = [IO.Path]::GetFullPath($ExpectedUserData)
    if (-not [string]::Equals($expected, $actualUserData, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Smoke user-data path does not match the isolated profile."
    }
  }

  return $record
}

function Get-FileDigest([string]$PathValue) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $PathValue).Hash.ToLowerInvariant()
}

$root = [IO.Path]::GetFullPath($WorkRoot)
$installDir = Join-Path $root "install"
$profileRoot = Join-Path $root "profile"
$appData = Join-Path $profileRoot "AppData\Roaming"
$localAppData = Join-Path $profileRoot "AppData\Local"
$userData = Join-Path $appData "Cosmora"
$marker = Join-Path $env:TEMP "cosmora-smoke-$($Mode.ToLowerInvariant())-$CurrentVersion.json"

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $appData -Force | Out-Null
New-Item -ItemType Directory -Path $localAppData -Force | Out-Null

$previousAppData = $env:APPDATA
$previousLocalAppData = $env:LOCALAPPDATA
$env:APPDATA = $appData
$env:LOCALAPPDATA = $localAppData

try {
  $current = Resolve-ExistingFile $CurrentInstaller "Current installer"

  if ($Mode -eq "Fresh") {
    $installed = Invoke-Installer $current $installDir
    Invoke-PackagedSmoke $installed.App $CurrentVersion $installDir $marker $userData | Out-Null

    $uninstall = Start-Process -FilePath $installed.Uninstaller -ArgumentList "/S" -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) {
      throw "NSIS uninstall failed with exit code $($uninstall.ExitCode)."
    }
    Wait-DirectoryRemoved $installDir
    return
  }

  if ([string]::IsNullOrWhiteSpace($BaselineInstaller) -or [string]::IsNullOrWhiteSpace($BaselineVersion)) {
    throw "Upgrade mode requires BaselineInstaller and BaselineVersion."
  }

  $baseline = Resolve-ExistingFile $BaselineInstaller "Baseline installer"
  if ($BaselineVersion -eq $CurrentVersion) {
    throw "Upgrade baseline and current versions must differ."
  }

  $baselineInstall = Invoke-Installer $baseline $installDir
  Invoke-PackagedSmoke $baselineInstall.App $BaselineVersion $installDir $marker $userData | Out-Null

  New-Item -ItemType Directory -Path $userData -Force | Out-Null
  $connectionFile = Join-Path $userData "connection.json"
  $credentialFile = Join-Path $userData "credentials.bin"
  $sessionFile = Join-Path $userData "Partitions\cosmora\Network\upgrade-session.sentinel"
  New-Item -ItemType Directory -Path (Split-Path $sessionFile -Parent) -Force | Out-Null

  Set-Content -LiteralPath $connectionFile -Value '{"origin":"https://upgrade-smoke.invalid"}' -Encoding utf8NoBOM
  [IO.File]::WriteAllBytes(
    $credentialFile,
    [Text.Encoding]::UTF8.GetBytes("cosmora-upgrade-credential-sentinel-v1")
  )
  Set-Content -LiteralPath $sessionFile -Value "cosmora-upgrade-session-sentinel-v1" -Encoding utf8NoBOM

  $before = @{
    connection = Get-FileDigest $connectionFile
    credentials = Get-FileDigest $credentialFile
    session = Get-FileDigest $sessionFile
  }

  $upgraded = Invoke-Installer $current $installDir
  $record = Invoke-PackagedSmoke $upgraded.App $CurrentVersion $installDir $marker $userData

  if (-not ($record.PSObject.Properties.Name -contains "userDataPath")) {
    throw "Current smoke payload does not expose userDataPath for upgrade validation."
  }

  foreach ($entry in @(
    @{ Name = "connection"; Path = $connectionFile },
    @{ Name = "credentials"; Path = $credentialFile },
    @{ Name = "session"; Path = $sessionFile }
  )) {
    if (-not (Test-Path -LiteralPath $entry.Path -PathType Leaf)) {
      throw "Upgrade removed persisted $($entry.Name) data."
    }
    $after = Get-FileDigest $entry.Path
    if ($after -ne $before[$entry.Name]) {
      throw "Upgrade mutated persisted $($entry.Name) data."
    }
  }

  $uninstall = Start-Process -FilePath $upgraded.Uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) {
    throw "Upgraded NSIS uninstall failed with exit code $($uninstall.ExitCode)."
  }
  Wait-DirectoryRemoved $installDir

  foreach ($pathValue in @($connectionFile, $credentialFile, $sessionFile)) {
    if (-not (Test-Path -LiteralPath $pathValue -PathType Leaf)) {
      throw "Uninstall unexpectedly removed preserved user data: $pathValue"
    }
  }
} finally {
  $env:APPDATA = $previousAppData
  $env:LOCALAPPDATA = $previousLocalAppData
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
