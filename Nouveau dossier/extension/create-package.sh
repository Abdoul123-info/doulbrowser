#!/bin/bash
# Script Bash pour créer le package ZIP de l'extension pour Chrome Web Store

echo "📦 Création du package pour Chrome Web Store..."

# Créer un dossier temporaire pour le package
PACKAGE_DIR="extension-package"
ZIP_FILE="doulbrowser-extension-v1.0.0.zip"

# Nettoyer les anciens packages
if [ -d "$PACKAGE_DIR" ]; then
    rm -rf "$PACKAGE_DIR"
    echo "✓ Ancien dossier nettoyé"
fi

if [ -f "$ZIP_FILE" ]; then
    rm -f "$ZIP_FILE"
    echo "✓ Ancien ZIP nettoyé"
fi

# Créer le dossier
mkdir -p "$PACKAGE_DIR/icons"

# Copier les fichiers nécessaires
echo "📋 Copie des fichiers..."

FILES=("manifest.json" "background.js" "content.js" "popup.html" "popup.js")

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$PACKAGE_DIR/$file"
        echo "  ✓ $file"
    else
        echo "  ✗ $file (non trouvé)"
    fi
done

# Copier les icônes
if [ -d "icons" ]; then
    cp -r icons/* "$PACKAGE_DIR/icons/"
    echo "  ✓ Icônes copiées"
else
    echo "  ✗ Dossier icons non trouvé"
fi

# Vérifier que manifest.json existe
if [ ! -f "$PACKAGE_DIR/manifest.json" ]; then
    echo "❌ ERREUR: manifest.json non trouvé!"
    exit 1
fi

# Créer le ZIP
echo ""
echo "📦 Création du fichier ZIP..."

cd "$PACKAGE_DIR"
zip -r "../$ZIP_FILE" . -q
cd ..

# Nettoyer le dossier temporaire
rm -rf "$PACKAGE_DIR"

echo ""
echo "✅ Package créé avec succès: $ZIP_FILE"
echo ""
echo "📝 Prochaines étapes:"
echo "  1. Allez sur https://chrome.google.com/webstore/devconsole"
echo "  2. Créez un compte développeur (\$5 USD)"
echo "  3. Cliquez sur 'Nouvel élément'"
echo "  4. Téléversez le fichier: $ZIP_FILE"
echo ""
echo "📖 Consultez PUBLISH_GUIDE.md pour plus de détails"





