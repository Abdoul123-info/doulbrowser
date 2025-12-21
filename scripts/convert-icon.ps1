# Script PowerShell pour convertir DoulBrowser.JPG en icône
$sourceImage = "src\DoulBrowser.JPG"
$resourcesDir = "resources"
$buildDir = "build"

# Vérifier si l'image source existe
if (-not (Test-Path $sourceImage)) {
    Write-Host "❌ Image source non trouvée: $sourceImage" -ForegroundColor Red
    exit 1
}

Write-Host "📸 Image source trouvée: $sourceImage" -ForegroundColor Green

# Créer les dossiers s'ils n'existent pas
if (-not (Test-Path $resourcesDir)) {
    New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null
}
if (-not (Test-Path $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
}

Write-Host "🔄 Copie de l'image..." -ForegroundColor Yellow

# Copier l'image vers resources/icon.png
Copy-Item -Path $sourceImage -Destination "$resourcesDir\icon.png" -Force
Write-Host "✅ Image copiée vers: $resourcesDir\icon.png" -ForegroundColor Green

# Copier l'image vers build/icon.png
Copy-Item -Path $sourceImage -Destination "$buildDir\icon.png" -Force
Write-Host "✅ Image copiée vers: $buildDir\icon.png" -ForegroundColor Green

Write-Host ""
Write-Host "✨ Opération terminée!" -ForegroundColor Green
Write-Host "⚠️  Note: Pour une meilleure qualité, convertissez manuellement le JPG en PNG 512x512px" -ForegroundColor Yellow
Write-Host "   Vous pouvez utiliser un outil en ligne comme: https://convertio.co/jpg-png/" -ForegroundColor Cyan







