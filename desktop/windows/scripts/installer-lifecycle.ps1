param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$InstallPrefix = "cosmora-installed"
)

$ErrorActionPreference = "Stop"

function Resolve-NormalizedPath([string]$Value) {
  return [IO.Path]::GetFullPath($Value).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Get-CosmoraUninstallEntries([string]$ExpectedVersion) {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )

  $entries = foreach ($root in $roots) {
    if (-not (Test-Path $root)) {
      continue
    }

    Get-ChildItem -Path $root -ErrorAction SilentlyContinue |
      ForEach-Object {
        try {
          Get-ItemProperty -Path $_.PSPath -ErrorAction Stop
        } catch {
          $null
        }
      } |
      Where-Object {
        $_ -and
        $_.DisplayName -eq "Cosmora" -and
        [string]$_.DisplayVersion -eq $ExpectedVersion
      }
  }

  return @($entries)
}

function Assert-ShortcutTarget(
  [string]$ShortcutPath,
  [string]$ExpectedExecutable,
  [string]$Label
) {
  if (-not (Test-Path $ShortcutPath -PathType Leaf)) {
    throw "$Label shortcut was not created at $ShortcutPath."
  }

  $shell = New-Object -ComObject WScript.Shell
  try {
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $actualTarget = Resolve-NormalizedPath([string]$shortcut.TargetPath)
    $expectedTarget = Resolve-NormalizedPath $ExpectedExecutable

    if (-not [string]::Equals(
      $actualTarget,
      $expectedTarget,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      throw "$Label shortcut target $actualTarget does not match $expectedTarget."
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
  }
}

$installer = (Resolve-Path $InstallerPath).Path
$installDir = Join-Path $env:RUNNER_TEMP "$InstallPrefix-$Version"
$marker = Join-Path $env:TEMP "cosmora-smoke-$InstallPrefix-$Version.json"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Cosmora.lnk"
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Cosmora.lnk"

Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $marker -Force -ErrorAction SilentlyContinue

$install = Start-Process -FilePath $installer -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) {
  throw "NSIS install failed with exit code $($install.ExitCode)."
}

$app = Join-Path $installDir "Cosmora.exe"
if (-not (Test-Path $app -PathType Leaf)) {
  throw "Installed Cosmora.exe was not found at $app."
}

$uninstaller = Get-ChildItem -Path $installDir -Filter "Uninstall*.exe" -File |
  Select-Object -First 1
if (-not $uninstaller) {
  throw "NSIS uninstaller was not found in $installDir."
}

Assert-ShortcutTarget -ShortcutPath $desktopShortcut -ExpectedExecutable $app -Label "Desktop"
Assert-ShortcutTarget -ShortcutPath $startMenuShortcut -ExpectedExecutable $app -Label "Start Menu"

$uninstallEntries = Get-CosmoraUninstallEntries -ExpectedVersion $Version
if ($uninstallEntries.Count -ne 1) {
  throw "Expected exactly one Cosmora uninstall registry entry for $Version; found $($uninstallEntries.Count)."
}

$uninstallEntry = $uninstallEntries[0]
if ([string]::IsNullOrWhiteSpace([string]$uninstallEntry.UninstallString)) {
  throw "Cosmora uninstall registry entry has no UninstallString."
}
$normalizedUninstaller = Resolve-NormalizedPath $uninstaller.FullName
$registryUninstall = [string]$uninstallEntry.UninstallString
if ($registryUninstall -notmatch [regex]::Escape($normalizedUninstaller)) {
  throw "Cosmora uninstall registry entry does not point to the installed uninstaller."
}
if (-not [string]::IsNullOrWhiteSpace([string]$uninstallEntry.InstallLocation)) {
  $registryLocation = Resolve-NormalizedPath ([string]$uninstallEntry.InstallLocation)
  $expectedLocation = Resolve-NormalizedPath $installDir
  if (-not [string]::Equals(
    $registryLocation,
    $expectedLocation,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Cosmora InstallLocation does not match the requested installation directory."
  }
}

$versionInfo = (Get-Item $app).VersionInfo
if ([string]$versionInfo.ProductName -ne "Cosmora") {
  throw "Installed executable ProductName is not Cosmora."
}
if (
  [string]$versionInfo.ProductVersion -ne $Version -and
  [string]$versionInfo.FileVersion -ne $Version
) {
  throw "Installed executable version metadata does not include $Version."
}

$env:COSMORA_SMOKE_OUTPUT = $marker
try {
  $smoke = Start-Process -FilePath $app -ArgumentList "--cosmora-smoke-test" -Wait -PassThru
} finally {
  Remove-Item Env:COSMORA_SMOKE_OUTPUT -ErrorAction SilentlyContinue
}
if ($smoke.ExitCode -ne 0) {
  throw "Installed Cosmora smoke process failed with exit code $($smoke.ExitCode)."
}
if (-not (Test-Path $marker -PathType Leaf)) {
  throw "Installed Cosmora did not produce the smoke marker."
}

$record = Get-Content $marker -Raw | ConvertFrom-Json
if ($record.schemaVersion -ne 1) {
  throw "Unexpected smoke schema version $($record.schemaVersion)."
}
if ($record.version -ne $Version) {
  throw "Installed version $($record.version) does not match package version $Version."
}
if ($record.isPackaged -ne $true) {
  throw "Installed Cosmora did not report packaged mode."
}
if ($record.platform -ne "win32" -or $record.arch -ne "x64") {
  throw "Installed Cosmora reported an unexpected platform or architecture."
}

$expectedExe = Resolve-NormalizedPath $app
$actualExe = Resolve-NormalizedPath ([string]$record.execPath)
if (-not [string]::Equals($expectedExe, $actualExe, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Smoke executable path does not match the installed application."
}

$expectedResources = Resolve-NormalizedPath (Join-Path $installDir "resources")
$actualResources = Resolve-NormalizedPath ([string]$record.resourcesPath)
if (-not [string]::Equals(
  $expectedResources,
  $actualResources,
  [StringComparison]::OrdinalIgnoreCase
)) {
  throw "Smoke resources path does not match the installed application."
}

$expectedAsar = Resolve-NormalizedPath (Join-Path $expectedResources "app.asar")
$actualAppPath = Resolve-NormalizedPath ([string]$record.appPath)
if (-not [string]::Equals($expectedAsar, $actualAppPath, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Smoke app path is not the packaged app.asar."
}

$uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
if ($uninstall.ExitCode -ne 0) {
  throw "NSIS uninstall failed with exit code $($uninstall.ExitCode)."
}

for ($attempt = 0; $attempt -lt 80 -and (Test-Path $installDir); $attempt++) {
  Start-Sleep -Milliseconds 250
}
if (Test-Path $installDir) {
  Get-ChildItem -Path $installDir -Recurse -Force |
    Select-Object -First 50 |
    Format-Table -AutoSize
  throw "NSIS uninstall left the installation directory behind."
}

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $remainingEntries = Get-CosmoraUninstallEntries -ExpectedVersion $Version
  if (
    -not (Test-Path $desktopShortcut) -and
    -not (Test-Path $startMenuShortcut) -and
    $remainingEntries.Count -eq 0
  ) {
    break
  }
  Start-Sleep -Milliseconds 250
}

if (Test-Path $desktopShortcut) {
  throw "NSIS uninstall left the Desktop shortcut behind."
}
if (Test-Path $startMenuShortcut) {
  throw "NSIS uninstall left the Start Menu shortcut behind."
}
$remainingEntries = Get-CosmoraUninstallEntries -ExpectedVersion $Version
if ($remainingEntries.Count -ne 0) {
  throw "NSIS uninstall left the Cosmora registry entry behind."
}

Remove-Item $marker -Force -ErrorAction SilentlyContinue

Write-Output "Cosmora installer lifecycle verified: install, shell integration, packaged launch, uninstall cleanup."
