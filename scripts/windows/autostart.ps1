#Requires -Version 5.1
<#
  Optional: start LayanX hidden when you sign in to Windows (Task Scheduler, current user only, no admin rights).

    .\scripts\windows\autostart.ps1 -Enable    # create or update the task
    .\scripts\windows\autostart.ps1 -Disable   # remove the task
    .\scripts\windows\autostart.ps1            # show the current state

  The task runs start.ps1 -NoBrowser -Unattended, so it never waits for input and never installs anything.
  It is OFF by default; nothing in LayanX enables it for you.
#>
param([switch]$Enable, [switch]$Disable, [string]$TaskName = 'LayanX Autostart')
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Start = Join-Path $Root 'scripts\windows\start.ps1'
function Say($m) { Write-Host "[LayanX] $m" -ForegroundColor Cyan }
if ($Enable -and $Disable) { throw 'Use -Enable or -Disable, not both.' }
$user = "$env:USERDOMAIN\$env:USERNAME"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Enable) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Start`" -NoBrowser -Unattended" -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Starts LayanX from $Root at sign-in." -Force | Out-Null
  Say "Autostart enabled for $user (task '$TaskName')."
  exit 0
}
if ($Disable) {
  if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Say "Autostart disabled (task '$TaskName' removed)." }
  else { Say 'Autostart was not enabled.' }
  exit 0
}
if ($existing) { Say "Autostart is ON (task '$TaskName', state $($existing.State))." } else { Say 'Autostart is OFF.' }
