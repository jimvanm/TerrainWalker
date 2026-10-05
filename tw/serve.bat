@echo off
rem Starts the local web server for Terrain Walker (see README.md, "Run it").
rem Set CADDY to where caddy is on this computer, or to just  caddy  if it is on the PATH.
set CADDY=C:\TOOLS\Caddy\caddy_windows_amd64.exe
cd /d "%~dp0"
"%CADDY%" run
pause
