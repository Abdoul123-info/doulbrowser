# Script pour telecharger ffmpeg.exe et l'extraire dans le projet
Write-Host "Telechargement de ffmpeg..." -ForegroundColor Green

# URL pour telecharger ffmpeg Windows (build statique de BtbN/FFmpeg-Builds)
$ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
$projectRoot = $PSScriptRoot + "\.."
$ffmpegDir = Join-Path $projectRoot "resources"
$ffmpegZipPath = Join-Path $ffmpegDir "ffmpeg.zip"
$ffmpegExePath = Join-Path $ffmpegDir "ffmpeg.exe"

# Creer le dossier resources s'il n'existe pas
if (-not (Test-Path $ffmpegDir)) {
    New-Item -ItemType Directory -Path $ffmpegDir -Force | Out-Null
    Write-Host "Dossier 'resources' cree" -ForegroundColor Yellow
}

# Verifier si ffmpeg.exe existe deja
if (Test-Path $ffmpegExePath) {
    Write-Host "ffmpeg.exe existe deja dans resources/ffmpeg.exe" -ForegroundColor Yellow
    Write-Host "Voulez-vous le telecharger a nouveau ? (O/N)" -ForegroundColor Yellow
    $response = Read-Host
    if ($response -ne "O" -and $response -ne "o") {
        Write-Host "Telechargement annule." -ForegroundColor Yellow
        exit 0
    }
    Remove-Item $ffmpegExePath -Force
}

Write-Host "Telechargement de ffmpeg depuis GitHub..." -ForegroundColor Cyan
Write-Host "URL: $ffmpegUrl" -ForegroundColor Gray

try {
    # Telecharger le fichier ZIP
    Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZipPath -UseBasicParsing
    Write-Host "Telechargement termine" -ForegroundColor Green
    
    # Extraire ffmpeg.exe du ZIP
    Write-Host "Extraction de ffmpeg.exe..." -ForegroundColor Cyan
    
    # Utiliser Expand-Archive pour extraire
    $tempExtractDir = Join-Path $ffmpegDir "ffmpeg_temp"
    if (Test-Path $tempExtractDir) {
        Remove-Item $tempExtractDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $tempExtractDir -Force | Out-Null
    
    Expand-Archive -Path $ffmpegZipPath -DestinationPath $tempExtractDir -Force
    
    # Chercher ffmpeg.exe dans l'archive extraite
    $ffmpegExe = Get-ChildItem -Path $tempExtractDir -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
    
    if ($ffmpegExe) {
        # Copier ffmpeg.exe dans resources/
        Copy-Item $ffmpegExe.FullName -Destination $ffmpegExePath -Force
        Write-Host "ffmpeg.exe extrait avec succes dans: $ffmpegExePath" -ForegroundColor Green
        
        # Nettoyer
        Remove-Item $tempExtractDir -Recurse -Force
        Remove-Item $ffmpegZipPath -Force
        
        Write-Host ""
        Write-Host "ffmpeg.exe est maintenant dans resources/ffmpeg.exe" -ForegroundColor Green
        Write-Host "Il sera inclus automatiquement dans l'installation de l'application." -ForegroundColor Green
    } else {
        Write-Host "Erreur: ffmpeg.exe non trouve dans l'archive" -ForegroundColor Red
        Remove-Item $tempExtractDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $ffmpegZipPath -Force -ErrorAction SilentlyContinue
        exit 1
    }
} catch {
    Write-Host "Erreur lors du telechargement: $_" -ForegroundColor Red
    Remove-Item $ffmpegZipPath -Force -ErrorAction SilentlyContinue
    exit 1
}
