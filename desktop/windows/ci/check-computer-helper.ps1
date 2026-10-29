$ErrorActionPreference = 'Stop'
# The caller MUST close stdin. Loading the helper compiles C# and reads EOF;
# the tests below call only pure struct builders, never Ready/SendInput/capture.
. (Join-Path $PSScriptRoot '..\computer-helper.ps1')

if ([Runtime.InteropServices.Marshal]::SizeOf([type][KosworkNative+Input]) -ne 40) { throw 'Expected x64 INPUT layout' }
$batch = [KosworkNative]::DragInputs(-100,-50,100,50,-100,-50,201,101)
if ($batch.Length -ne 11 -or $batch[1].data.mouse.flags -ne 2 -or $batch[10].data.mouse.flags -ne 4) { throw 'Unbalanced drag input batch' }
if ($batch[0].data.mouse.x -ne 0 -or $batch[0].data.mouse.y -ne 0 -or $batch[9].data.mouse.x -ne 65535 -or $batch[9].data.mouse.y -ne 65535) { throw 'Incorrect virtual desktop endpoints' }
$previous = -1
foreach ($i in @(0) + @(2..9)) {
  if ($batch[$i].type -ne 0 -or $batch[$i].data.mouse.flags -ne 0xe001 -or $batch[$i].data.mouse.x -lt $previous) { throw 'Invalid uncoalesced drag trajectory' }
  $previous = $batch[$i].data.mouse.x
}
foreach ($inserted in @(0,1,2,5,10,11)) {
  $release = @([KosworkNative]::ReleaseInputs($batch,[uint32]$inserted))
  $held = $inserted -ge 2 -and $inserted -lt 11
  if (($held -and ($release.Length -ne 1 -or $release[0].data.mouse.flags -ne 4)) -or (-not $held -and $release.Length -ne 0)) { throw 'Partial drag release does not match inserted prefix' }
}
$keyboard = [KosworkNative+Keyboard]::new()
$keyboard.vk = 17
$union = [KosworkNative+Union]::new()
$union.key = $keyboard
$key = [KosworkNative+Input]::new()
$key.type = 1
$key.data = $union
$release = @([KosworkNative]::ReleaseInputs([KosworkNative+Input[]]@($key),1))
if ($release.Length -ne 1 -or $release[0].type -ne 1 -or $release[0].data.key.vk -ne 17 -or $release[0].data.key.flags -ne 2) { throw 'Partial modifier input is not released' }
$rejected = $false
try { [void][KosworkNative]::DragInputs(-101,-50,100,50,-100,-50,201,101) } catch { $rejected = $_.Exception.Message -match 'COMPUTER_COORDS_INVALID' }
if (-not $rejected) { throw 'Out-of-bounds drag accepted' }
[Console]::WriteLine('Native helper compiled; pure drag/layout/partial-input-release checks passed. No desktop input performed.')
