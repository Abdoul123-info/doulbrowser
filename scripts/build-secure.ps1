# DoulGet - Secure Build Script
# This script performs a clean, production-ready build of the application.

$ErrorActionPreference = "Stop"

Write-Host "==============================================" -ForegroundColor Blue
Write-Host "--- DOULGET BUILD SECURE (v1.8.0) ---" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Blue

# 1. Nettoyage
Write-Host "`n[1/4] Nettoyage des fichiers temporaires..." -ForegroundColor Yellow
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
if (Test-Path "out") { Remove-Item -Recurse -Force "out" }

# 2. Installation des dépendances (Production)
Write-Host "`n[2/4] Vérification des modules..." -ForegroundColor Yellow
npm install

# 3. Build & Compilation (Vite + TS)
Write-Host "`n[3/4] Compilation du code source (TS + Vite)..." -ForegroundColor Yellow
npm run build

# 4. Packaging (Installer Windows)
Write-Host "`n[4/4] Création de l'exécutable (Setup)..." -ForegroundColor Yellow
# On force le target windows x64 pour la stabilité
npx electron-builder --win --x64

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host "   BUILD TERMINE AVEC SUCCES !               " -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green

$distFolder = "dist"
if (Test-Path $distFolder) {
    $installer = Get-ChildItem "$distFolder\*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($installer) {
        Write-Host "`nVotre exécutable sécurisé est prêt : " -NoNewline
        Write-Host $installer.FullName -ForegroundColor Cyan
        Write-Host "`nNote : Pour le distribuer, donnez uniquement le fichier .exe à vos clients." -ForegroundColor Gray
    }
}
