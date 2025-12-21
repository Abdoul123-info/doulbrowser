# Script pour copier l'icône DoulBrowser vers l'extension
$sourceIcon = "..\resources\icon.png"
$extensionDir = "icons"

if (-not (Test-Path $sourceIcon)) {
    Write-Host "❌ Icône source non trouvée: $sourceIcon" -ForegroundColor Red
    Write-Host "   Veuillez exécuter d'abord: npm run convert-icon" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $extensionDir)) {
    New-Item -ItemType Directory -Path $extensionDir -Force | Out-Null
}

Write-Host "📸 Copie de l'icône DoulBrowser..." -ForegroundColor Yellow

Copy-Item -Path $sourceIcon -Destination "$extensionDir\icon16.png" -Force
Copy-Item -Path $sourceIcon -Destination "$extensionDir\icon48.png" -Force
Copy-Item -Path $sourceIcon -Destination "$extensionDir\icon128.png" -Force

Write-Host "✅ Icônes copiées avec succès dans $extensionDir\" -ForegroundColor Green
Write-Host "   Note: Pour un meilleur rendu, redimensionnez manuellement les icônes à 16x16, 48x48 et 128x128 pixels" -ForegroundColor Cyan







