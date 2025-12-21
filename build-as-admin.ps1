# Script pour exécuter le build en tant qu'administrateur
# Vérifier si on est déjà administrateur
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Élévation des privilèges nécessaires..." -ForegroundColor Yellow
    # Relancer le script en tant qu'administrateur
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Wait
    exit
}

Write-Host "Exécution en tant qu'administrateur confirmée" -ForegroundColor Green

# Définir les variables d'environnement
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:SKIP_NOTARIZATION = "true"

# Arrêter les processus qui pourraient bloquer
Write-Host "Arrêt des processus bloquants..." -ForegroundColor Yellow
Get-Process | Where-Object {$_.ProcessName -match "electron|download-manager|node|app-builder"} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Nettoyer le cache et le dossier dist
Write-Host "Nettoyage du cache et du dossier dist..." -ForegroundColor Yellow
if (Test-Path "$env:LOCALAPPDATA\electron-builder\Cache") {
    Remove-Item "$env:LOCALAPPDATA\electron-builder\Cache" -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path "dist") {
    Remove-Item "dist" -Recurse -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

# Changer vers le répertoire du projet
Set-Location $PSScriptRoot

# Exécuter le build
Write-Host "Démarrage du build..." -ForegroundColor Green
npm.cmd run build:win

Write-Host "Build terminé!" -ForegroundColor Green
Read-Host "Appuyez sur Entrée pour fermer"









