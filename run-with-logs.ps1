# Script pour lancer DoulBrowser avec capture des logs
# Usage: .\run-with-logs.ps1 [dev|prod]

param(
    [string]$Mode = "dev"
)

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = "logs_${Mode}_${timestamp}.txt"

Write-Host "Démarrage de DoulBrowser en mode $Mode..." -ForegroundColor Cyan
Write-Host "Les logs seront sauvegardés dans: $logFile" -ForegroundColor Green

if ($Mode -eq "prod") {
    # Lancer l'application empaquetée
    $exePath = "dist\win-unpacked\doul-browser.exe"
    
    if (-not (Test-Path $exePath)) {
        Write-Host "ERREUR: L'application empaquetée n'existe pas à: $exePath" -ForegroundColor Red
        Write-Host "Lancez d'abord 'npm run build:unpack'" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "Lancement de: $exePath" -ForegroundColor Cyan
    & $exePath *>&1 | Tee-Object -FilePath $logFile
}
else {
    # Mode développement
    Write-Host "Lancement en mode développement..." -ForegroundColor Cyan
    
    # S'assurer qu'ELECTRON_RUN_AS_NODE n'est pas défini
    $env:ELECTRON_RUN_AS_NODE = $null
    
    # Lancer avec capture des logs
    npm run dev 2>&1 | Tee-Object -FilePath $logFile
}

Write-Host "`nLogs sauvegardés dans: $logFile" -ForegroundColor Green
Write-Host "Appuyez sur une touche pour afficher les logs..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Get-Content $logFile
