# Script PowerShell pour creer le package ZIP de l'extension pour Chrome Web Store

Write-Host "Creation du package pour Chrome Web Store..." -ForegroundColor Cyan

# Creer un dossier temporaire pour le package
$packageDir = "extension-package"
$zipFile = "doulbrowser-extension-v1.0.0.zip"

# Nettoyer les anciens packages
if (Test-Path $packageDir) {
    Remove-Item -Recurse -Force $packageDir
    Write-Host "Ancien dossier nettoye" -ForegroundColor Green
}

if (Test-Path $zipFile) {
    Remove-Item -Force $zipFile
    Write-Host "Ancien ZIP nettoye" -ForegroundColor Green
}

# Creer le dossier
New-Item -ItemType Directory -Path $packageDir | Out-Null
New-Item -ItemType Directory -Path "$packageDir/icons" | Out-Null

# Copier les fichiers necessaires
Write-Host "Copie des fichiers..." -ForegroundColor Yellow

$filesToCopy = @(
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.js"
)

foreach ($file in $filesToCopy) {
    if (Test-Path $file) {
        Copy-Item $file "$packageDir/$file"
        Write-Host "  OK: $file" -ForegroundColor Green
    } else {
        Write-Host "  ERREUR: $file (non trouve)" -ForegroundColor Red
    }
}

# Copier les icones
if (Test-Path "icons") {
    Copy-Item "icons/*" "$packageDir/icons/" -Recurse
    Write-Host "  OK: Icones copiees" -ForegroundColor Green
} else {
    Write-Host "  ERREUR: Dossier icons non trouve" -ForegroundColor Red
}

# Verifier que manifest.json existe
if (-not (Test-Path "$packageDir/manifest.json")) {
    Write-Host "ERREUR: manifest.json non trouve!" -ForegroundColor Red
    exit 1
}

# Creer le ZIP
Write-Host ""
Write-Host "Creation du fichier ZIP..." -ForegroundColor Yellow

# Aller dans le dossier package et creer le ZIP de son contenu
Set-Location $packageDir
Get-ChildItem | Compress-Archive -DestinationPath "../$zipFile" -Force
Set-Location ..

# Nettoyer le dossier temporaire
Remove-Item -Recurse -Force $packageDir

Write-Host ""
Write-Host "Package cree avec succes: $zipFile" -ForegroundColor Green
Write-Host ""
Write-Host "Prochaines etapes:" -ForegroundColor Cyan
Write-Host "  1. Allez sur https://chrome.google.com/webstore/devconsole" -ForegroundColor White
Write-Host "  2. Creez un compte developpeur (5 USD)" -ForegroundColor White
Write-Host "  3. Cliquez sur 'Nouvel element'" -ForegroundColor White
Write-Host "  4. Televersez le fichier: $zipFile" -ForegroundColor White
Write-Host ""
Write-Host "Consultez PUBLISH_GUIDE.md pour plus de details" -ForegroundColor Yellow
