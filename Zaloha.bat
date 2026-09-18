@echo off
title Zaloha Zivnostapp
cd /d "%~dp0"
node scripts\zaloha.mjs
if errorlevel 1 (
  echo.
  echo Zaloha sa nepodarila - pozri chybu vyssie.
)
pause
