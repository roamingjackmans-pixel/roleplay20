@echo off
rem Starts the Roleplay20 game server and the public tunnel. Keep this window open while you play.
cd /d "%~dp0"
title Roleplay20 - Dungeon Master server
if not exist node_modules (
  echo Installing for the first time...
  call npm install
)
if not exist client\dist\.vite\manifest.json (
  echo Building the app...
  call npm run build
)
node server\index.js
echo.
echo The server stopped. Press any key to close this window.
pause >nul
