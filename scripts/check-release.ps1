$token = "" # Remplacez par votre token GitHub (GHP_...)
$repo = "Abdoul123-info/doulbrowser"
$releaseId = 291545226

$headers = @{
    Authorization = "token $token"
    Accept        = "application/vnd.github.v3+json"
}

Write-Host "Vérification des assets du release..." -ForegroundColor Yellow
$assets = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$releaseId/assets" -Headers $headers

if ($assets.Count -gt 0) {
    foreach ($a in $assets) {
        Write-Host "Asset: $($a.name) | Taille: $([math]::Round($a.size/1MB, 1)) MB | Etat: $($a.state)" -ForegroundColor Green
        Write-Host "URL: $($a.browser_download_url)" -ForegroundColor Cyan
    }
}
else {
    Write-Host "Aucun asset uploadé. Lancement de l'upload..." -ForegroundColor Yellow
    
    $exePath = "dist\doul-get-1.2.9-setup.exe"
    $fileBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $exePath))
    $uploadUrl = "https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=doul-get-1.2.9-setup.exe"
    
    $uploadHeaders = @{
        Authorization  = "token $token"
        Accept         = "application/vnd.github.v3+json"
        "Content-Type" = "application/octet-stream"
    }
    
    Write-Host "Upload de $([math]::Round($fileBytes.Length/1MB, 1)) MB en cours..." -ForegroundColor Yellow
    $result = Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $uploadHeaders -Body $fileBytes
    
    Write-Host "`nUPLOAD REUSSI !" -ForegroundColor Green
    Write-Host "URL directe: $($result.browser_download_url)" -ForegroundColor Cyan
    Write-Host "`nMettez cette URL dans Supabase (app_config, cle: update_url)" -ForegroundColor Yellow
}
