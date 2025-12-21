# Installation de FFmpeg pour DoulBrowser

## Téléchargement automatique

Pour télécharger et installer ffmpeg.exe dans le projet, exécutez :

```bash
npm run download-ffmpeg
```

Ou directement avec PowerShell :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-ffmpeg.ps1
```

## Emplacement

Le script télécharge ffmpeg.exe et le place dans :
- `resources/ffmpeg.exe`

## Inclusion dans l'installation

Une fois `resources/ffmpeg.exe` présent, il sera automatiquement inclus dans l'installation de l'application grâce à la configuration dans `electron-builder.yml`.

## Vérification

Pour vérifier que ffmpeg est bien présent :

```powershell
Test-Path resources/ffmpeg.exe
```

Si la commande retourne `True`, ffmpeg est prêt à être inclus dans le build.

## Build

Après avoir téléchargé ffmpeg, construisez l'application :

```bash
npm run build:win
```

FFmpeg sera automatiquement inclus dans l'installateur et disponible lors de l'exécution de l'application.
