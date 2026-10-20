#Requires -Version 5.1
<#
  Verifies autostart.ps1 and uninstall.ps1 against throw-away folders. Safe to run on your own PC:
  it uses a temporary data folder, a temporary "desktop" and a uniquely named task, and cleans up.
    .\scripts\windows\uninstall-test.ps1
#>
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $here '..\..')).Path
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("lx-uninstall-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$data = Join-Path $tmp 'data'; $desk = Join-Path $tmp 'desktop'; $backup = Join-Path $tmp 'backup'
$task = 'LayanX Autostart Test ' + [guid]::NewGuid().ToString('N').Substring(0, 6)
$failures = 0
function Check($ok, $name) { if ($ok) { Write-Host "PASS $name" } else { Write-Host "::error::FAIL $name"; $script:failures++ } }
$oldData = $env:LAYANX_DATA_DIR
try {
  New-Item -ItemType Directory -Force -Path $data, $desk | Out-Null
  $env:LAYANX_DATA_DIR = $data

  # autostart: enable -> task exists and is unattended; disable -> gone
  & (Join-Path $here 'autostart.ps1') -Enable -TaskName $task
  $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Check ($null -ne $t) 'autostart creates the task'
  Check ($t -and $t.Actions[0].Arguments -like '*-Unattended*' -and $t.Actions[0].Arguments -like '*-NoBrowser*') 'autostart task is unattended and opens no browser'
  Check ($t -and $t.Principal.RunLevel -eq 'Limited') 'autostart task runs without admin rights'
  & (Join-Path $here 'autostart.ps1') -Disable -TaskName $task
  Check ($null -eq (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)) 'autostart -Disable removes the task'

  # uninstall default: shortcut to this copy removed, other shortcut kept, data kept
  Set-Content -Path (Join-Path $data 'settings.json') -Value '{"publicPort":3000}'
  New-Item -ItemType Directory -Force -Path (Join-Path $data 'store') | Out-Null
  Set-Content -Path (Join-Path $data 'store\runtime.json') -Value '{}'
  $sh = New-Object -ComObject WScript.Shell
  $l = $sh.CreateShortcut((Join-Path $desk 'LayanX.lnk')); $l.TargetPath = (Join-Path $Root 'LayanX.cmd'); $l.WorkingDirectory = $Root; $l.Save()
  & (Join-Path $here 'autostart.ps1') -Enable -TaskName $task
  & (Join-Path $here 'uninstall.ps1') -DesktopDir $desk -TaskName $task
  Check (-not (Test-Path (Join-Path $desk 'LayanX.lnk'))) 'uninstall removes the shortcut that points here'
  Check ($null -eq (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)) 'uninstall removes the autostart task'
  Check (Test-Path (Join-Path $data 'settings.json')) 'uninstall keeps data by default'

  $other = Join-Path $tmp 'other-copy'; New-Item -ItemType Directory -Force -Path $other | Out-Null
  $l = $sh.CreateShortcut((Join-Path $desk 'LayanX.lnk')); $l.TargetPath = (Join-Path $other 'LayanX.cmd'); $l.WorkingDirectory = $other; $l.Save()
  & (Join-Path $here 'uninstall.ps1') -DesktopDir $desk -TaskName $task
  Check (Test-Path (Join-Path $desk 'LayanX.lnk')) 'uninstall keeps a shortcut of another copy'

  # -RemoveData: verified backup, then delete
  & (Join-Path $here 'uninstall.ps1') -RemoveData -Yes -BackupDir $backup -DesktopDir $desk -TaskName $task
  $zip = Get-ChildItem $backup -Filter 'LayanX-backup-*.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
  Check ($null -ne $zip -and $zip.Length -gt 0) 'backup ZIP written before deletion'
  if ($zip) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $names = [IO.Compression.ZipFile]::OpenRead($zip.FullName).Entries | ForEach-Object { $_.FullName.Replace('\', '/') }
    Check ($names -contains 'settings.json' -and ($names -contains 'store/runtime.json')) 'backup contains the data files'
  }
  Check (-not (Test-Path $data)) 'data folder deleted after backup'

  # safety: refuses folders that are not LayanX data
  $plain = Join-Path $tmp 'not-layanx'; New-Item -ItemType Directory -Force -Path $plain | Out-Null; Set-Content (Join-Path $plain 'keep.txt') 'x'
  $env:LAYANX_DATA_DIR = $plain
  $refused = $false; try { & (Join-Path $here 'uninstall.ps1') -RemoveData -Yes -NoBackup -DesktopDir $desk -TaskName $task } catch { $refused = $true }
  Check ($refused -and (Test-Path (Join-Path $plain 'keep.txt'))) 'refuses a folder without LayanX markers'
  $env:LAYANX_DATA_DIR = $env:USERPROFILE
  $refused = $false; try { & (Join-Path $here 'uninstall.ps1') -RemoveData -Yes -NoBackup -DesktopDir $desk -TaskName $task } catch { $refused = $true }
  Check ($refused -and (Test-Path $env:USERPROFILE)) 'refuses the user profile folder'
  $env:LAYANX_DATA_DIR = $Root
  $refused = $false; try { & (Join-Path $here 'uninstall.ps1') -RemoveData -Yes -NoBackup -DesktopDir $desk -TaskName $task } catch { $refused = $true }
  Check ($refused -and (Test-Path (Join-Path $Root 'package.json'))) 'refuses the LayanX folder itself'
} finally {
  $env:LAYANX_DATA_DIR = $oldData
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failures) { Write-Host "$failures uninstall/autostart check(s) failed."; exit 1 }
Write-Host 'Uninstall and autostart checks passed.'
