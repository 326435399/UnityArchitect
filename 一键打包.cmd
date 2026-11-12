@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在打包 Unity Architect（网页版 + exe 便携版）...
echo.
call npm run release
echo.
pause
