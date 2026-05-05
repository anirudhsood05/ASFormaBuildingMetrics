@echo off
SET PATH=I:\002_BIM\007_Addins\nodejs;%PATH%
cd /d "H:\forma-color-extension"
echo.
echo ========================================
echo   Starting Forma Extension Dev Server
echo ========================================
echo.
echo Server will start at: http://localhost:5173/
echo.
echo Keep this window open while developing!
echo Press Ctrl+C to stop the server.
echo.
npm run dev
pause