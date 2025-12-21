// Script pour créer les icônes de l'extension à partir de l'icône principale
const fs = require('fs');
const path = require('path');

const sourceIcon = path.join(__dirname, '../resources/icon.png');
const extensionDir = path.join(__dirname, '../extension/icons');

// Créer le dossier icons s'il n'existe pas
if (!fs.existsSync(extensionDir)) {
  fs.mkdirSync(extensionDir, { recursive: true });
}

// Vérifier si sharp est disponible
let useSharp = false;
try {
  require.resolve('sharp');
  useSharp = true;
} catch (e) {
  console.log('⚠️  Sharp non disponible, copie directe de l\'icône');
}

async function createIcons() {
  try {
    if (!fs.existsSync(sourceIcon)) {
      console.log('⚠️  Icône source non trouvée:', sourceIcon);
      console.log('   Veuillez exécuter d\'abord: npm run convert-icon');
      return;
    }

    if (useSharp) {
      const sharp = require('sharp');
      
      // Créer les icônes aux bonnes tailles
      await sharp(sourceIcon)
        .resize(16, 16, { fit: 'cover', position: 'center' })
        .png()
        .toFile(path.join(extensionDir, 'icon16.png'));
      
      await sharp(sourceIcon)
        .resize(48, 48, { fit: 'cover', position: 'center' })
        .png()
        .toFile(path.join(extensionDir, 'icon48.png'));
      
      await sharp(sourceIcon)
        .resize(128, 128, { fit: 'cover', position: 'center' })
        .png()
        .toFile(path.join(extensionDir, 'icon128.png'));
      
      console.log('✅ Icônes de l\'extension créées avec redimensionnement dans extension/icons/');
    } else {
      // Copie simple si sharp n'est pas disponible
      fs.copyFileSync(sourceIcon, path.join(extensionDir, 'icon16.png'));
      fs.copyFileSync(sourceIcon, path.join(extensionDir, 'icon48.png'));
      fs.copyFileSync(sourceIcon, path.join(extensionDir, 'icon128.png'));
      console.log('✅ Icônes de l\'extension copiées dans extension/icons/');
      console.log('   Note: Pour un meilleur rendu, installez sharp: npm install sharp --save-dev');
    }
  } catch (error) {
    console.error('❌ Erreur lors de la création des icônes:', error.message);
  }
}

createIcons();

