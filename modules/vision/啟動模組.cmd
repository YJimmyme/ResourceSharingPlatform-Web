@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "VISION_PRODUCTION="
if not defined VISION_DATA_DIR if exist "..\..\ai-recognition-lab\yolo-data" set "VISION_DATA_DIR=%CD%\..\..\ai-recognition-lab\yolo-data"
if not defined VISION_MODEL_DIR if exist "..\..\ai-recognition-lab\models" set "VISION_MODEL_DIR=%CD%\..\..\ai-recognition-lab\models"
if exist ".venv\Scripts\python.exe" (
  .venv\Scripts\python.exe run.py
) else if exist "..\..\ai-recognition-lab\.venv-yolo\Scripts\python.exe" (
  ..\..\ai-recognition-lab\.venv-yolo\Scripts\python.exe run.py
) else (
  echo 請先執行「安裝模組.cmd」。
)
pause
