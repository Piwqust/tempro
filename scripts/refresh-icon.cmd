@echo off
rem Windows keeps icons by file path: after an icon change the same tempro.exe still shows the old
rem picture in Start, on the desktop and the taskbar. This touches Tempro's shortcuts and asks
rem Explorer to rebuild its icon cache. Run outside packaged apps (by hand or via Task Scheduler).
setlocal
set "LOG=%~dp0refresh-icon.log"
echo %date% %time% > "%LOG%"
for %%L in ("%APPDATA%\Microsoft\Windows\Start Menu\Programs\Tempro.lnk" "%USERPROFILE%\Desktop\Tempro.lnk" "%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Tempro.lnk") do (
  if exist %%L (copy /b %%L +,, %%L > nul & echo touched %%L >> "%LOG%")
)
ie4uinit.exe -show >> "%LOG%" 2>&1
echo ie4uinit exit %errorlevel% >> "%LOG%"
