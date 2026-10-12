@echo off
cd /d "%~dp0"
if not exist .venv-yolo\Scripts\python.exe python -m venv .venv-yolo
.venv-yolo\Scripts\python.exe -m pip install -r requirements-yolo.txt
pause
