# DoulGet - Script de publication GitHub Release
# Uploade automatiquement le .exe vers GitHub Releases via l'API REST

param (
    [string]$Version = "1.7.5",
    [string]$Token = "", # Remplacez par votre token GitHub (GHP_...)
    [string]$Repo = "Abdoul123-info/doulbrowser"
)

$ExePath = "dist/doul-get-$Version-setup.exe"

if (-not (Test-Path $ExePath)) {
    Write-Host "ERREUR: Le fichier $ExePath n'existe pas. Compilez d'abord avec build-secure.ps1" -ForegroundColor Red
    exit 1
}

$Headers = @{
    Authorization          = "token $Token"
    Accept                 = "application/vnd.github.v3+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Étape 1 : Créer le tag git
Write-Host "`n[1/3] Création du tag v$Version..." -ForegroundColor Yellow
git tag -a "v$Version" -m "Release v$Version" 2>$null
git push origin "v$Version" 2>$null | Out-Null
Write-Host "Tag v$Version créé." -ForegroundColor Green

# Étape 2 : Créer le Release GitHub
Write-Host "`n[2/3] Création du Release GitHub..." -ForegroundColor Yellow
$RELEASE_VERSION = "1.8.0"
$RELEASE_NAME = "DoulGet v1.8.0 - Background Tasks & Parallelism"
$RELEASE_BODY = @"
### Nouvelles Fonctionnalités :
- **Background Tasks 🛠️** : Vous pouvez maintenant réduire les outils (Convertisseur MP3, Compresseur) en arrière-plan et continuer à utiliser l'application.
- **Support des Redirections 🔄** : Correction du bug de mise à jour (0%) en gérant les redirections sécurisées de GitHub.
- **Version Dynamique** : Correction de l'affichage de la version dans la fenêtre "À propos".
"@
$ReleaseBody = @{
    tag_name   = "v$Version"
    name       = "$RELEASE_NAME"
    body       = "$RELEASE_BODY"
    draft      = $false
    prerelease = $false
} | ConvertTo-Json

try {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases" -Method Post -Headers $Headers -Body $ReleaseBody -ContentType "application/json"
    $UploadUrl = $Release.upload_url -replace '\{.*\}', ''
    $ReleaseId = $Release.id
    Write-Host "Release créé ! ID: $ReleaseId" -ForegroundColor Green
}
catch {
    # Le release existe peut-être déjà, on le cherche
    Write-Host "Le release existe peut-être déjà, recherche..." -ForegroundColor Yellow
    $Releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases" -Headers $Headers
    $Release = $Releases | Where-Object { $_.tag_name -eq "v$Version" } | Select-Object -First 1
    if ($Release) {
        $UploadUrl = $Release.upload_url -replace '\{.*\}', ''
        $ReleaseId = $Release.id
        Write-Host "Release trouvé ! ID: $ReleaseId" -ForegroundColor Green
    }
    else {
        Write-Host "ERREUR: Impossible de créer ou trouver le release." -ForegroundColor Red
        Write-Host $_.Exception.Message
        exit 1
    }
}

# Étape 3 : Uploader le fichier .exe
Write-Host "`n[3/3] Upload du fichier (185 MB) - Cela peut prendre quelques minutes..." -ForegroundColor Yellow
$FileBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $ExePath))
$FileName = "doul-get-$Version-setup.exe"
$UploadHeaders = @{
    Authorization  = "token $Token"
    Accept         = "application/vnd.github.v3+json"
    "Content-Type" = "application/octet-stream"
}

try {
    $Result = Invoke-RestMethod -Uri "$UploadUrl`?name=$FileName" -Method Post -Headers $UploadHeaders -Body $FileBytes
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "   UPLOAD REUSSI !" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "`nURL de téléchargement direct :" -ForegroundColor Cyan
    Write-Host $Result.browser_download_url -ForegroundColor White
    Write-Host "`nMettez cette URL dans votre Supabase (app_config, clé: update_url)" -ForegroundColor Yellow
}
catch {
    Write-Host "ERREUR lors de l'upload: $($_.Exception.Message)" -ForegroundColor Red
}
