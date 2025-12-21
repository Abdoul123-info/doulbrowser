# Script pour créer l'application sans electron-builder
Write-Host "Creation de l'application manuellement..."

# Nettoyer le dossier dist
if (Test-Path "dist") {
    Remove-Item -Path "dist" -Recurse -Force
}

# Creer la structure
New-Item -ItemType Directory -Path "dist\win-unpacked" -Force | Out-Null
New-Item -ItemType Directory -Path "dist\win-unpacked\resources" -Force | Out-Null

# Copier les fichiers Electron (si disponibles)
$electronPath = "node_modules\electron\dist"
if (Test-Path $electronPath) {
    Write-Host "Copie des fichiers Electron..."
    Copy-Item -Path "$electronPath\*" -Destination "dist\win-unpacked\" -Recurse -Force -Exclude "resources"
}

# Creer app.asar depuis le dossier out
Write-Host "Creation de app.asar..."
$asarPath = "node_modules\.bin\asar.cmd"
if (Test-Path $asarPath) {
    & $asarPath pack "out" "dist\win-unpacked\resources\app.asar"
} else {
    Write-Host "asar non trouve, installation..."
    npm install -g asar
    asar pack "out" "dist\win-unpacked\resources\app.asar"
}

Write-Host "Application creee dans dist\win-unpacked\"
Write-Host "Vous pouvez executer: dist\win-unpacked\electron.exe"










