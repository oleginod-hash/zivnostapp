@echo off
title Zivnostapp
cd /d "%~dp0"

if not exist "node_modules" (
  echo Prve spustenie - instalujem zavislosti, chvilu to potrva...
  call npm install
  if errorlevel 1 goto chyba
)

if not exist "dist\index.html" (
  echo Pripravujem aplikaciu...
  call npm run build
  if errorlevel 1 goto chyba
)

echo.
echo   Zivnostapp bezi na http://localhost:3000
echo   Toto okno nechaj otvorene. Appku vypnes zatvorenim okna.
echo.

start "" http://localhost:3000
call npm start

echo.
echo Appka sa ukoncila.
pause
exit /b 0

:chyba
echo.
echo Nieco sa pokazilo - pozri chybu vyssie.
pause
exit /b 1
