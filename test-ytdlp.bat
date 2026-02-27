@echo off
echo ========================================
echo Test yt-dlp - Diagnostic YouTube
echo ========================================
echo.

REM Tester une video publique connue
set VIDEO_URL=https://www.youtube.com/watch?v=dQw4w9WgXcQ

echo Test 1: Version de yt-dlp
"%APPDATA%\doul-browser\yt-dlp.exe" --version
echo.

echo Test 2: Liste des formats disponibles
"%APPDATA%\doul-browser\yt-dlp.exe" --list-formats "%VIDEO_URL%"
echo.

echo Test 3: Tentative de telechargement simple (sans cookies)
"%APPDATA%\doul-browser\yt-dlp.exe" -f "best[height<=720]" --skip-download "%VIDEO_URL%"
echo.

echo Test 4: Avec client tv_embedded
"%APPDATA%\doul-browser\yt-dlp.exe" -f best --skip-download --extractor-args youtube:player_client=tv_embedded "%VIDEO_URL%"
echo.

pause
