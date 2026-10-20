@echo off
rem Double-click to uninstall LayanX. Your data is KEPT unless you run uninstall.ps1 -RemoveData.
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\uninstall.ps1" %*
endlocal
