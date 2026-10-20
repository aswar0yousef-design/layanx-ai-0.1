#Requires -Version 5.1
<#
  Uninstall LayanX for the current Windows user.

    .\scripts\windows\uninstall.ps1                 # stop LayanX, remove autostart task and desktop shortcut; KEEP your data
    .\scripts\windows\uninstall.ps1 -RemoveData     # also delete the data folder, after a verified ZIP backup on the desktop
    .\scripts\windows\uninstall.ps1 -RemoveData -NoBackup -Yes   # delete without backup or prompt (no undo)

  Never touched: this LayanX folder itself (delete it yourself afterwards), Node.js, Ollama and downloaded
  models (shared with other apps; remove them from Windows Settings > Apps, and `ollama rm <model>`).
  The backup contains the ENCRYPTED secret store and its key file: keep the ZIP private.
#>
param(
  [switch]$RemoveData,
  [switch]$NoBackup,
  [switch]$Yes,
  [string]$BackupDir = [Environment]::GetFolderPath('Desktop'),
  [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
  [string]$TaskName = 'LayanX Autostart'
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DataDir = if ($env:LAYANX_DATA_DIR) { $env:LAYANX_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'LayanX' }
function Say($m)  { Write-Host "[LayanX] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[LayanX] $m" -ForegroundColor Yellow }

# 0. With -RemoveData, validate the target before touching anything.
$full = $null
if ($RemoveData -and (Test-Path $DataDir)) {
  $full = (Resolve-Path $DataDir).Path.TrimEnd('\')
  $protected = @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:SystemRoot, $env:ProgramFiles, $Root) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') }
  if ($full.Length -le 3 -or $protected -contains $full -or $Root.StartsWith($full + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to delete '$full': it is a drive root, a system/user folder, or contains LayanX itself."
  }
  $marker = @('install.json', 'settings.json', 'secrets.enc', 'launch-ticket.json', 'store') | Where-Object { Test-Path (Join-Path $full $_) }
  if (-not $marker) { throw "Refusing to delete '$full': it does not look like a LayanX data folder." }
}

# 1. Stop LayanX and the helper servers it started (same logic as LayanX-Stop.cmd).
& (Join-Path $PSScriptRoot 'stop.ps1')

# 2. Autostart task (only ours, by name).
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Say "Removed scheduled task '$TaskName'."
}

# 3. Desktop shortcut, only if it points into this folder.
$lnk = Join-Path $DesktopDir 'LayanX.lnk'
if (Test-Path $lnk) {
  $target = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  $points = "$($target.TargetPath) $($target.Arguments) $($target.WorkingDirectory)"
  if ($points.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Remove-Item $lnk -Force; Say 'Removed the desktop shortcut.' }
  else { Warn "Kept $lnk (it points to another LayanX copy)." }
}

# 4. Data folder: kept unless -RemoveData.
if (-not $RemoveData) {
  Say "Your data is kept in $DataDir (projects, memory, settings, encrypted secrets)."
  Say "To finish, delete this folder yourself: $Root"
  exit 0
}
if (-not $full) { Say "No data folder at $DataDir."; exit 0 }
if (-not $Yes) {
  $answer = Read-Host "Type DELETE to permanently remove $full"
  if ($answer -cne 'DELETE') { Say 'Cancelled. Nothing was deleted.'; exit 1 }
}
if (-not $NoBackup) {
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $zip = Join-Path $BackupDir ("LayanX-backup-{0}.zip" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Compress-Archive -Path (Join-Path $full '*') -DestinationPath $zip -CompressionLevel Optimal
  $size = (Get-Item $zip).Length
  if ($size -le 0) { throw "Backup $zip is empty; nothing was deleted." }
  Say "Backup written: $zip ($size bytes). It contains encrypted secrets; keep it private."
}
Remove-Item -LiteralPath $full -Recurse -Force
Say "Deleted $full."
Say "To finish, delete this folder yourself: $Root"
