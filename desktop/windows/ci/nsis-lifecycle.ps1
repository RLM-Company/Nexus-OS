param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Fresh", "Upgrade")]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$CurrentInstaller,

  [Parameter(Mandatory = $true)]
  [string]$CurrentVersion,

  [string]$BaselineInstaller,

  [Parameter(Mandatory = $true)]
  [string]$WorkRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# This script installs/uninstalls an app and clears its profile. It is exclusively
# for disposable GitHub-hosted Windows VMs, never a developer's real profile.
if ($env:GITHUB_ACTIONS -ne "true" -or $env:RUNNER_ENVIRONMENT -ne "github-hosted") {
  throw "Installer lifecycle requires a disposable GitHub-hosted runner."
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  throw "RUNNER_TEMP is required."
}
$runnerRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\', '/')
$checkedWorkRoot = [IO.Path]::GetFullPath($WorkRoot).TrimEnd('\', '/')
if (-not $checkedWorkRoot.StartsWith($runnerRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "WorkRoot must be a child directory of RUNNER_TEMP."
}

function Resolve-ExistingFile([string]$Value, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Label is required." }
  $resolved = Resolve-Path -LiteralPath $Value -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
    throw "$Label is not a file: $Value"
  }
  return $resolved.Path
}

function Invoke-Installer([string]$Installer, [string]$InstallDir, [string]$ProductName = "Kosmora") {
  $process = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "NSIS install failed with exit code $($process.ExitCode)." }
  $app = Join-Path $InstallDir "$ProductName.exe"
  if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "Installed $ProductName.exe was not found." }
  $uninstaller = Get-ChildItem -LiteralPath $InstallDir -Filter "Uninstall*.exe" -File | Select-Object -First 1
  if (-not $uninstaller) { throw "NSIS uninstaller was not found." }
  return @{ App = $app; Uninstaller = $uninstaller.FullName }
}

function Invoke-PackagedSmoke([string]$App, [string]$ExpectedVersion, [string]$InstallDir, [string]$Marker) {
  Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue
  $env:COSMORA_SMOKE_OUTPUT = $Marker
  try {
    $process = Start-Process -FilePath $App -ArgumentList "--cosmora-smoke-test" -WindowStyle Hidden -Wait -PassThru
  } finally {
    Remove-Item Env:COSMORA_SMOKE_OUTPUT -ErrorAction SilentlyContinue
  }
  if ($process.ExitCode -ne 0) { throw "Installed Kosmora smoke process failed." }
  if (-not (Test-Path -LiteralPath $Marker -PathType Leaf)) { throw "Smoke marker was not produced." }
  $record = Get-Content -LiteralPath $Marker -Raw | ConvertFrom-Json
  if ($record.schemaVersion -ne 1 -or $record.version -ne $ExpectedVersion -or $record.isPackaged -ne $true) {
    throw "Unexpected smoke metadata."
  }
  if ($record.platform -ne "win32" -or $record.arch -ne "x64") { throw "Unexpected packaged platform." }
  $expectedExe = [IO.Path]::GetFullPath($App)
  $actualExe = [IO.Path]::GetFullPath([string]$record.execPath)
  if (-not [string]::Equals($expectedExe, $actualExe, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Smoke executable path does not match the installed application."
  }
  $expectedAsar = [IO.Path]::GetFullPath((Join-Path $InstallDir "resources\app.asar"))
  $actualAsar = [IO.Path]::GetFullPath([string]$record.appPath)
  if (-not [string]::Equals($expectedAsar, $actualAsar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Smoke app path is not packaged app.asar."
  }
  return $record
}

function Wait-DirectoryRemoved([string]$PathValue) {
  for ($attempt = 0; $attempt -lt 80 -and (Test-Path -LiteralPath $PathValue); $attempt++) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $PathValue) { throw "NSIS uninstall left the installation directory behind." }
}

function Get-Digest([string]$PathValue) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $PathValue).Hash.ToLowerInvariant()
}

function Get-AppUninstallEntries([string]$InstallDir) {
  $registry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  if (-not (Test-Path -LiteralPath $registry)) { return @() }
  return @(Get-ChildItem -LiteralPath $registry | ForEach-Object {
    $entry = Get-ItemProperty -LiteralPath $_.PSPath
    if (($entry.PSObject.Properties.Name -contains "DisplayName") -and
        ($entry.PSObject.Properties.Name -contains "UninstallString") -and
        ($entry.DisplayName -like "Kosmora*" -or $entry.DisplayName -like "Cosmora*")) {
      # NSIS stores InstallLocation in its application key, not the uninstall key.
      # Bind this uninstall record to our actual quoted uninstaller path instead.
      $match = [regex]::Match([string]$entry.UninstallString, '^"([^"]+)"')
      if ($match.Success -and [string]::Equals(
        [IO.Path]::GetDirectoryName($match.Groups[1].Value).TrimEnd('\'),
        $InstallDir.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        $entry
      }
    }
  })
}

function Assert-InstallMetadata([string]$App, [string]$InstallDir, [string]$ExpectedVersion) {
  $info = (Get-Item -LiteralPath $App).VersionInfo
  $expected = [Version]$ExpectedVersion
  Write-Host "Installed metadata: product=$($info.ProductName) version=$($info.ProductVersion)"
  # Windows PE resources may display 0.9.0.0 for package version 0.9.0.
  if ($info.ProductName -ne "Kosmora" -or
      $info.ProductMajorPart -ne $expected.Major -or
      $info.ProductMinorPart -ne $expected.Minor -or
      $info.ProductBuildPart -ne $expected.Build -or
      $info.ProductPrivatePart -ne [Math]::Max(0, $expected.Revision)) {
    throw "Installed product name/version metadata is incorrect: $($info.ProductName) / $($info.ProductVersion)."
  }
  foreach ($shortcut in @(
    (Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) "Kosmora.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Kosmora.lnk")
  )) {
    if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { throw "Expected shortcut is missing: $shortcut" }
  }
  $entries = @(Get-AppUninstallEntries $InstallDir)
  if ($entries.Count -ne 1 -or $entries[0].DisplayVersion -ne $ExpectedVersion) {
    throw "Installed uninstall registry/version metadata is incorrect (matched records: $($entries.Count))."
  }
}

$current = Resolve-ExistingFile $CurrentInstaller "Current installer"
$root = $checkedWorkRoot
$installDir = Join-Path $root "install"
$marker = Join-Path $env:TEMP "cosmora-smoke-$($Mode.ToLowerInvariant())-$CurrentVersion.json"
$userData = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) "cosmora-windows-desktop"

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue

try {
  if ($Mode -eq "Upgrade") {
    $baseline = Resolve-ExistingFile $BaselineInstaller "Baseline installer"
    Invoke-Installer $baseline $installDir "Cosmora" | Out-Null

    New-Item -ItemType Directory -Path $userData -Force | Out-Null
    $connectionFile = Join-Path $userData "connection.json"
    $sessionFile = Join-Path $userData "Partitions\cosmora\Network\upgrade-session.sentinel"
    New-Item -ItemType Directory -Path (Split-Path $sessionFile -Parent) -Force | Out-Null
    Set-Content -LiteralPath $connectionFile -Value '{"origin":"https://upgrade-smoke.invalid"}' -Encoding utf8NoBOM
    Set-Content -LiteralPath $sessionFile -Value "cosmora-upgrade-session-sentinel-v1" -Encoding utf8NoBOM
    $beforeConnection = Get-Digest $connectionFile
    $beforeSession = Get-Digest $sessionFile
  }

  $installed = Invoke-Installer $current $installDir
  $record = Invoke-PackagedSmoke $installed.App $CurrentVersion $installDir $marker
  Assert-InstallMetadata $installed.App $installDir $CurrentVersion

  if ($Mode -eq "Upgrade") {
    $actualUserData = [IO.Path]::GetFullPath([string]$record.userDataPath)
    $expectedUserData = [IO.Path]::GetFullPath($userData)
    if (-not [string]::Equals($actualUserData, $expectedUserData, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Smoke user-data path does not match the expected profile."
    }
    if ((Get-Digest $connectionFile) -ne $beforeConnection) { throw "Upgrade mutated connection.json." }
    if ((Get-Digest $sessionFile) -ne $beforeSession) { throw "Upgrade mutated Chromium session data." }
  }

  $uninstall = Start-Process -FilePath $installed.Uninstaller -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed." }
  Wait-DirectoryRemoved $installDir
  if (@(Get-AppUninstallEntries $installDir).Count -ne 0) { throw "Uninstall registry entry remains." }
  foreach ($shortcut in @(
    (Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) "Kosmora.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Kosmora.lnk")
  )) {
    if (Test-Path -LiteralPath $shortcut) { throw "Uninstall left a shortcut behind: $shortcut" }
  }

  if ($Mode -eq "Upgrade") {
    if (-not (Test-Path -LiteralPath $connectionFile -PathType Leaf)) { throw "Uninstall removed connection.json." }
    if (-not (Test-Path -LiteralPath $sessionFile -PathType Leaf)) { throw "Uninstall removed Chromium session data." }
    if ((Get-Digest $connectionFile) -ne $beforeConnection -or (Get-Digest $sessionFile) -ne $beforeSession) {
      throw "Uninstall mutated preserved user data."
    }
  }
} finally {
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue
}
