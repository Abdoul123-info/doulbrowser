# Script de téléchargement manuel de FFmpeg pour DoulGet (Version ZIP BtbN)
Write-Host "Démarrage du téléchargement manuel de FFmpeg (Source BtbN)..." -ForegroundColor Cyan

# Définir les chemins
$appDataPath = "$env:APPDATA\doul-get"
$zipPath = Join-Path $appDataPath "ffmpeg.zip"
$extractPath = Join-Path $appDataPath "ffmpeg_temp"
$ffmpegDest = Join-Path $appDataPath "ffmpeg.exe"

# Créer le dossier s'il n'existe pas
if (-not (Test-Path $appDataPath)) {
    New-Item -ItemType Directory -Path $appDataPath -Force | Out-Null
}

# URL stable BtbN (Master Latest GPL)
$url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"

Write-Host "Téléchargement en cours depuis : GitHub (BtbN)" -ForegroundColor Yellow
Write-Host "Cela peut prendre quelques minutes (environ 30-40 MB)..."

# FORCER TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {
    # 1. Télécharger le ZIP
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($url, $zipPath)
    Write-Host "✅ ZIP téléchargé." -ForegroundColor Green

    # 2. Extraire
    Write-Host "Extraction en cours..." -ForegroundColor Yellow
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

    # 3. Trouver ffmpeg.exe dans le dossier extrait
    $foundFfmpeg = Get-ChildItem -Path $extractPath -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1

    if ($foundFfmpeg) {
        # 4. Déplacer vers le dossier final
        Move-Item -Path $foundFfmpeg.FullName -Destination $ffmpegDest -Force
        Write-Host "✅ ffmpeg.exe installé dans $ffmpegDest" -ForegroundColor Green
        
        # 5. Nettoyage
        Remove-Item -Path $zipPath -Force
        Remove-Item -Path $extractPath -Recurse -Force
        
        Write-Host "🎉 INSTALLATION TERMINÉE AVEC SUCCÈS !" -ForegroundColor Green
        Write-Host "Redémarrez DoulGet maintenant."
    }
    else {
        Write-Host "❌ ECHEC : ffmpeg.exe introuvable dans le ZIP." -ForegroundColor Red
    }
}
catch {
    Write-Host "❌ ERREUR : $($_.Exception.Message)" -ForegroundColor Red
}

Read-Host "Appuyez sur Entrée pour quitter..."
