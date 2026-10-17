@echo off
rem Installs the last built Tempro for real, outside any packaged app (run it by hand from Explorer
rem or a normal terminal, or through Task Scheduler). A Tempro database that a packaged app's
rem redirected AppData kept (the Claude desktop app is one) is moved into the real AppData first,
rem but never over a real one. Log: scripts\install-outside.log
setlocal
set "HERE=%~dp0"
set "LOG=%HERE%install-outside.log"
set "DST=%LOCALAPPDATA%\Tempro"
echo %date% %time% start > "%LOG%"

taskkill /f /im tempro.exe >> "%LOG%" 2>&1
schtasks /Change /TN "Tempro\Watchdog" /DISABLE >> "%LOG%" 2>&1
timeout /t 2 /nobreak > nul

if exist "%DST%\tempro.db" (
  echo real database already there, kept >> "%LOG%"
) else (
  for /d %%P in ("%LOCALAPPDATA%\Packages\*") do (
    if exist "%%P\LocalCache\Local\Tempro\tempro.db" (
      echo moving data from %%P >> "%LOG%"
      if not exist "%DST%" mkdir "%DST%"
      copy /y "%%P\LocalCache\Local\Tempro\tempro.db*" "%DST%\" >> "%LOG%" 2>&1
      if exist "%%P\LocalCache\Local\Tempro\crash.log" copy /y "%%P\LocalCache\Local\Tempro\crash.log" "%DST%\" >> "%LOG%" 2>&1
    )
  )
)

set "SETUP="
for /f "delims=" %%F in ('dir /b /o-d "%HERE%..\app\src-tauri\target\release\bundle\nsis\*-setup.exe" 2^>nul') do if not defined SETUP set "SETUP=%HERE%..\app\src-tauri\target\release\bundle\nsis\%%F"
if not defined SETUP (echo no installer built >> "%LOG%" & exit /b 1)
echo installing %SETUP% >> "%LOG%"
"%SETUP%" /S
echo installer exit %errorlevel% >> "%LOG%"

schtasks /Change /TN "Tempro\Watchdog" /ENABLE >> "%LOG%" 2>&1
rem a new icon under the same exe path stays hidden behind Explorer's icon cache
call "%HERE%refresh-icon.cmd"
start "" "%DST%\tempro.exe" --minimized
echo started >> "%LOG%"
dir /b "%DST%" >> "%LOG%" 2>&1
echo %date% %time% done >> "%LOG%"
