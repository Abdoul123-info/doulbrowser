# Script pour installer yt-dlp sur Windows
Write-Host "Installation de yt-dlp..."

# Télécharger yt-dlp depuis GitHub
$ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$ytdlpPath = "$env:USERPROFILE\.local\bin\yt-dlp.exe"
$localBinDir = "$env:USERPROFILE\.local\bin"

# Créer le dossier s'il n'existe pas
if (-not (Test-Path $localBinDir)) {
    New-Item -ItemType Directory -Path $localBinDir -Force | Out-Null
}

# Télécharger yt-dlp
Write-Host "Telechargement de yt-dlp..."
try {
    Invoke-WebRequest -Uri $ytdlpUrl -OutFile $ytdlpPath -UseBasicParsing
    Write-Host "yt-dlp installe avec succes dans: $ytdlpPath"
    Write-Host ""
    Write-Host "Ajoutez ce chemin a votre PATH pour l'utiliser globalement:"
    Write-Host "[System.Environment]::SetEnvironmentVariable('Path', [System.Environment]::GetEnvironmentVariable('Path', 'User') + ';$localBinDir', 'User')"
} catch {
    Write-Host "Erreur lors du telechargement: $_"
    Write-Host ""
    Write-Host "Alternative: Installez yt-dlp manuellement depuis:"
    Write-Host "https://github.com/yt-dlp/yt-dlp/releases/latest"
}










