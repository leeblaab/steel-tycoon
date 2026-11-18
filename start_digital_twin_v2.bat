@echo off
rem Steel Process Digital Twin - one-click launcher (detached servers; log files instead of black windows)
cd /d C:\AI_Lab\SteelX\web

start /min "" cmd /c "npx vite --config src/ports/fullplant/browser/vite.fullplant.config.ts --port 5178 --strictPort > C:\AI_Lab\SteelX\twin_5178.log 2>&1"
start /min "" cmd /c "npx vite --config vite.config.ts --port 5173 --strictPort > C:\AI_Lab\SteelX\twin_5173.log 2>&1"
start /min "" cmd /c "npx vite --config src/ports/slice2/browser/vite.slice2.config.ts --port 5174 --strictPort > C:\AI_Lab\SteelX\twin_5174.log 2>&1"
start /min "" cmd /c "npx vite --config vite.slice3.config.ts --port 5176 --strictPort > C:\AI_Lab\SteelX\twin_5176.log 2>&1"
start /min "" cmd /c "npx vite --config vite.slice4.config.ts --port 5175 --strictPort > C:\AI_Lab\SteelX\twin_5175.log 2>&1"
start /min "" cmd /c "npx vite --config src/ports/slice5/browser/vite.slice5.config.ts --port 5179 --strictPort > C:\AI_Lab\SteelX\twin_5179.log 2>&1"

echo Servers starting... opening tabs in 20 seconds.
timeout /t 20 /nobreak >nul
start "" http://localhost:5178
start "" http://localhost:5173
start "" http://localhost:5174
start "" http://localhost:5176
start "" http://localhost:5175
start "" http://localhost:5179
echo Done. Six tabs should be open. Servers keep running after this window closes.
pause
