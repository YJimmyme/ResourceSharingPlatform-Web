@echo off
cd /d "%~dp0"
if not exist node_modules\sharp\package.json call npm install --no-audit --no-fund
node server.mjs
pause
