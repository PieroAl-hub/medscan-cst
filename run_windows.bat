@echo off
title MedScan CST - Hospital Santa Teresa
echo ===============================
echo  MedScan CST
echo  Hospital Santa Teresa
echo ===============================
echo.
echo Instalando dependencias...
pip install -r requirements.txt > nul 2>&1
echo.
echo Iniciando servidor...
echo Abre http://localhost:8000 en tu navegador
echo.
python backend/main.py
pause
