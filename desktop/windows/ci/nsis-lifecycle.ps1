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

function Resolve-ExistingFile([string]$Value, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Label is required." }
  $resolved = Resolve-Path -LiteralPath $Value -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
    throw "$Label is not a file: $Value"
  }
  return $resolved.Path
}

function Resolve-NormalizedPath([string]$Value) {
  return [IO.Path]::GetFullPath($Value).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Get-CosmoraUninstallEntries([string]$ExpectedVersion = "") {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  $entries = foreach ($registryRoot in $roots) {
    if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
    Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue |
      ForEach-Object {
        try { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop } catch { $null }
      } |
      Where-Object {
        $_ -and $_.DisplayName -eq "Cosmora" -and (\n          [string]::IsNullOrWhiteSpace($ExpectedVersion) -or [string]$_.DisplayVersion -eq $ExpectedVersion\n        )
      }
  }
  return @($entries)
}

function Assert-ShortcutTarget([string]$ShortcutPath, [string]$ExpectedExecutable, [string]$Label) {
  if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) {
    throw "$Label shortcut was not created at $ShortcutPath."
  }
  $shell = New-Object -ComObject WScript.Shell
  try {
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $actual = Resolve-NormalizedPath ([string]$shortcut.TargetPath)
    $expected = Resolve-NormalizedPath $ExpectedExecutable
    if (-not [string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase)) {
      throw "$Label shortcut target $actual does not match $expected."
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
  }
}

function Assert-ShellIntegration([string]$App, [string]$InstallDir, [string]$Version) {
  $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Cosmora.lnk"
  $startMenuShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Cosmora.lnk"
  Assert-ShortcutTarget $desktopShortcut $App "Desktop"
  Assert-ShortcutTarget $startMenuShortcut $App "Start Menu"

  $entries = Get-CosmoraUninstallEntries $Version
  if ($entries.Count -ne 1) {
    throw "Expected exactly one Cosmora uninstall registry entry for $Version; found $($entries.Count)."
  }
  $entry = $entries[0]
  if ([string]::IsNullOrWhiteSpace([string]$entry.UninstallString)) {
    throw "Cosmora uninstall registry entry has no UninstallString."
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$entry.InstallLocation)) {
    $actualLocation = Resolve-NormalizedPath ([string]$entry.InstallLocation)
    $expectedLocation = Resolve-NormalizedPath $InstallDir
    if (-not [string]::Equals($actualLocation, $expectedLocation, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Cosmora InstallLocation does not match the requested installation directory."
    }
  }

  $versionInfo = (Get-Item -LiteralPath $App).VersionInfo
  if ([string]$versionInfo.ProductName -ne "Cosmora") {
    throw "Installed executable ProductName is not Cosmora."
  }
  $versionPattern = "^$([regex]::Escape($Version))(?:\.0)?$"
  if ([string]$versionInfo.ProductVersion -notmatch $versionPattern -and [string]$versionInfo.FileVersion -notmatch $versionPattern) {
    throw "Installed executable version metadata does not match $Version."
  }
}

function Assert-ShellIntegrationRemoved([string]$Version) {
  $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Cosmora.lnk"
  $startMenuShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Cosmora.lnk"
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $entries = Get-CosmoraUninstallEntries $Version
    if (-not (Test-Path -LiteralPath $desktopShortcut) -and -not (Test-Path -LiteralPath $startMenuShortcut) -and $entries.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $desktopShortcut) { throw "NSIS uninstall left the Desktop shortcut behind." }
  if (Test-Path -LiteralPath $startMenuShortcut) { throw "NSIS uninstall left the Start Menu shortcut behind." }
  if ((Get-CosmoraUninstallEntries).Count -ne 0) { throw "NSIS uninstall left a Cosmora registry entry behind." }
}

function Invoke-Installer([string]$Installer, [string]$InstallDir) {
  $process = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "NSIS install failed with exit code $($process.ExitCode)." }
  $app = Join-Path $InstallDir "Cosmora.exe"
  if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "Installed Cosmora.exe was not found." }
  $uninstaller = Get-ChildItem -LiteralPath $InstallDir -Filter "Uninstall*.exe" -File | Select-Object -First 1
  if (-not $uninstaller) { throw "NSIS uninstaller was not found." }
  return @{ App = $app; Uninstaller = $uninstaller.FullName }
}

function Invoke-PackagedSmoke([string]$App, [string]$ExpectedVersion, [string]$InstallDir, [string]$Marker) {
  Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue
  $env:COSMORA_SMOKE_OUTPUT = $Marker
  try {
    $process = Start-Process -FilePath $App -ArgumentList "--cosmora-smoke-test" -Wait -PassThru
  } finally {
    Remove-Item Env:COSMORA_SMOKE_OUTPUT -ErrorAction SilentlyContinue
  }
  if ($process.ExitCode -ne 0) { throw "Installed Cosmora smoke process failed." }
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

$current = Resolve-ExistingFile $CurrentInstaller "Current installer"
$root = [IO.Path]::GetFullPath($WorkRoot)
$installDir = Join-Path $root "install"
$marker = Join-Path $env:TEMP "cosmora-smoke-$($Mode.ToLowerInvariant())-$CurrentVersion.json"
$userData = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) "cosmora-windows-desktop"

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue

try {
  if ($Mode -eq "Upgrade") {
    $baseline = Resolve-ExistingFile $BaselineInstaller "Baseline installer"
    Invoke-Installer $baseline $installDir | Out-Null

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
  Assert-ShellIntegration $installed.App $installDir $CurrentVersion
  $record = Invoke-PackagedSmoke $installed.App $CurrentVersion $installDir $marker

  if ($Mode -eq "Upgrade") {
    $actualUserData = [IO.Path]::GetFullPath([string]$record.userDataPath)
    $expectedUserData = [IO.Path]::GetFullPath($userData)
    if (-not [string]::Equals($actualUserData, $expectedUserData, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Smoke user-data path does not match the expected profile."
    }
    if ((Get-Digest $connectionFile) -ne $beforeConnection) { throw "Upgrade mutated connection.json." }
    if ((Get-Digest $sessionFile) -ne $beforeSession) { throw "Upgrade mutated Chromium session data." }
  }

  $uninstall = Start-Process -FilePath $installed.Uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed." }
  Wait-DirectoryRemoved $installDir
  Assert-ShellIntegrationRemoved $CurrentVersion

  if ($Mode -eq "Upgrade") {
    if (-not (Test-Path -LiteralPath $connectionFile -PathType Leaf)) { throw "Uninstall removed connection.json." }
    if (-not (Test-Path -LiteralPath $sessionFile -PathType Leaf)) { throw "Uninstall removed Chromium session data." }
  }
} finally {
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue
}
