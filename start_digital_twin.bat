@echo off
rem Steel Process Digital Twin - one-click launcher
rem Starts full-plant play home (:5178) + 5 slice scenes, then opens all six tabs.

cd /d C:\AI_Lab\SteelX\web

start "FullPlant 5178" cmd /c npx vite --config src/ports/fullplant/browser/vite.fullplant.config.ts --port 5178 --strictPort ^& pause
start "Slice1 5173"   cmd /c npx vite --config vite.config.ts --port 5173 --strictPort ^& pause
start "Slice2 5174"   cmd /c npx vite --config src/ports/slice2/browser/vite.slice2.config.ts --port 5174 --strictPort ^& pause
start "Slice3 5176"   cmd /c npx vite --config vite.slice3.config.ts --port 5176 --strictPort ^& pause
start "Slice4 5175"   cmd /c npx vite --config vite.slice4.config.ts --port 5175 --strictPort ^& pause
start "Slice5 5179"   cmd /c npx vite --config src/ports/slice5/browser/vite.slice5.config.ts --port 5179 --strictPort ^& pause

timeout /t 20 /nobreak >nul
start "" http://localhost:5178
start "" http://localhost:5173
start "" http://localhost:5174
start "" http://localhost:5176
start "" http://localhost:5175
start "" http://localhost:5179
echo All six servers started. Close the black windows to stop.
