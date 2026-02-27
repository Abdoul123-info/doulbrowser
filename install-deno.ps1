# Installation de Deno pour yt-dlp
# Ce script installe Deno, le runtime JavaScript requis par yt-dlp pour résoudre les défis YouTube

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Installation de Deno pour yt-dlp" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Vérifier si Deno est déjà installé
$denoInstalled = Get-Command deno -ErrorAction SilentlyContinue

if ($denoInstalled) {
    Write-Host "✅ Deno est déjà installé!" -ForegroundColor Green
    Write-Host "Version: " -NoNewline
    deno --version
    Write-Host ""
    Write-Host "Pour mettre à jour Deno, lancez: deno upgrade" -ForegroundColor Yellow
}
else {
    Write-Host "📦 Installation de Deno en cours..." -ForegroundColor Yellow
    Write-Host ""
    
    try {
        # Installer Deno via le script officiel
        irm https://deno.land/install.ps1 | iex
        
        Write-Host ""
        Write-Host "✅ Deno installé avec succès!" -ForegroundColor Green
        Write-Host ""
        Write-Host "⚠️  IMPORTANT: Fermez et rouvrez votre terminal pour que Deno soit disponible dans le PATH" -ForegroundColor Yellow
        Write-Host ""
    }
    catch {
        Write-Host "❌ Erreur lors de l'installation de Deno:" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        Write-Host ""
        Write-Host "Installation manuelle: Téléchargez depuis https://deno.land/#installation" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Prochaines étapes:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "1. Fermez TOUS les terminaux PowerShell/CMD ouverts" -ForegroundColor White
Write-Host "2. Rouvrez un nouveau terminal" -ForegroundColor White
Write-Host "3. Vérifiez l'installation: deno --version" -ForegroundColor White
Write-Host "4. Testez DoulBrowser avec une vidéo YouTube publique" -ForegroundColor White
Write-Host ""

Read-Host "Appuyez sur Entrée pour fermer"
