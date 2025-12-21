# Script de construction DoulBrowser (Sans Signature) - VERSION ROBUSTE
Write-Host "Démarrage de la construction de DoulBrowser..." -ForegroundColor Cyan

# 1. Configurer l'environnement pour ignorer la signature
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
Write-Host "Signature automatique désactivée." -ForegroundColor Green

# 1.5 VERIFICATION DES DEPENDANCES CRITIQUES
Write-Host "Vérification des dépendances..." -ForegroundColor Cyan

# Vérifier ffmpeg.exe
if (-not (Test-Path "ffmpeg.exe")) {
    Write-Host "ffmpeg.exe manquant à la racine." -ForegroundColor Yellow
    if (Test-Path "resources/ffmpeg.exe") {
        Copy-Item "resources/ffmpeg.exe" -Destination "ffmpeg.exe"
        Write-Host "ffmpeg.exe restauré depuis resources/" -ForegroundColor Green
    }
    else {
        Write-Host "ERREUR: ffmpeg.exe introuvable ! Lancez 'scripts/download-ffmpeg.ps1' d'abord." -ForegroundColor Red
        Read-Host "Appuyez sur Entrée pour quitter..."
        exit 1
    }
}

# Vérifier l'icône
if (-not (Test-Path "build/icon.ico")) {
    Write-Host "ATTENTION: build/icon.ico manquant !" -ForegroundColor Yellow
    # Tenter de générer si possible ou avertir
}

# 2. Nettoyer les anciens fichiers
if (Test-Path "dist") {
    Write-Host "Nettoyage du dossier dist..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "dist" -ErrorAction SilentlyContinue
}

# 3. Lancer la construction
Write-Host "Lancement de 'npm run build:win'..." -ForegroundColor Cyan
try {
    npm run build:win
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ CONSTRUCTION TERMINÉE AVEC SUCCÈS !" -ForegroundColor Green
        Write-Host "L'installateur se trouve dans le dossier 'dist'." -ForegroundColor Green
        Invoke-Item "dist"
    }
    else {
        Write-Host "❌ Erreur lors de la construction." -ForegroundColor Red
        Read-Host "Appuyez sur Entrée pour quitter..."
    }
}
catch {
    Write-Host "❌ Erreur critique : $_" -ForegroundColor Red
    Read-Host "Appuyez sur Entrée pour quitter..."
}
