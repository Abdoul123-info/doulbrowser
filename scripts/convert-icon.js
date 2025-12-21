// Script pour convertir DoulBrowser.JPG en icône pour Electron
const fs = require('fs');
const path = require('path');

const sourceImage = path.join(__dirname, '../src/DoulBrowser.JPG');
const resourcesDir = path.join(__dirname, '../resources');
const buildDir = path.join(__dirname, '../build');

// Créer les dossiers s'ils n'existent pas
if (!fs.existsSync(resourcesDir)) {
  fs.mkdirSync(resourcesDir, { recursive: true });
}
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Vérifier si l'image source existe
if (!fs.existsSync(sourceImage)) {
  console.error('❌ Image source non trouvée:', sourceImage);
  process.exit(1);
}

console.log('📸 Image source trouvée:', sourceImage);
console.log('🔄 Copie en cours...');

// Essayer d'utiliser sharp si disponible, sinon copier directement
let useSharp = false;
try {
  require.resolve('sharp');
  useSharp = true;
} catch (e) {
  console.log('⚠️  Sharp non disponible, copie directe de l\'image');
}

async function convertIcon() {
  try {
    if (useSharp) {
      const sharp = require('sharp');
      const iconSize = 512;
      
      // Convertir et redimensionner vers resources/icon.png
      const destIcon = path.join(resourcesDir, 'icon.png');
      await sharp(sourceImage)
        .resize(iconSize, iconSize, {
          fit: 'cover',
          position: 'center'
        })
        .png()
        .toFile(destIcon);
      console.log('✅ Icône PNG créée:', destIcon);
      
      // Créer aussi pour build/icon.png
      const buildIcon = path.join(buildDir, 'icon.png');
      await sharp(sourceImage)
        .resize(iconSize, iconSize, {
          fit: 'cover',
          position: 'center'
        })
        .png()
        .toFile(buildIcon);
      console.log('✅ Icône PNG créée:', buildIcon);
      
      // Créer icon.ico pour Windows avec plusieurs tailles
      try {
        const pngToIco = require('png-to-ico');
        const sizes = [16, 32, 48, 64, 128, 256];
        const pngBuffers = [];
        
        for (const size of sizes) {
          const buffer = await sharp(sourceImage)
            .resize(size, size, {
              fit: 'cover',
              position: 'center'
            })
            .png()
            .toBuffer();
          pngBuffers.push(buffer);
        }
        
        const buildIconIco = path.join(buildDir, 'icon.ico');
        const icoBuffer = await pngToIco(pngBuffers);
        fs.writeFileSync(buildIconIco, icoBuffer);
        console.log('✅ Icône ICO créée pour Windows:', buildIconIco);
      } catch (error) {
        console.log('⚠️  Impossible de créer icon.ico, electron-builder utilisera icon.png');
        console.log('   Erreur:', error.message);
        // Créer au moins un PNG 256x256 pour que electron-builder puisse le convertir
        const fallbackIcon = path.join(buildDir, 'icon_256.png');
        await sharp(sourceImage)
          .resize(256, 256, {
            fit: 'cover',
            position: 'center'
          })
          .png()
          .toFile(fallbackIcon);
      }
    } else {
      // Copie simple (l'utilisateur devra convertir manuellement en PNG)
      const destIcon = path.join(resourcesDir, 'icon.png');
      fs.copyFileSync(sourceImage, destIcon);
      console.log('✅ Image copiée vers:', destIcon);
      console.log('⚠️  Note: Renommez manuellement en PNG ou utilisez un convertisseur en ligne');
      
      const buildIcon = path.join(buildDir, 'icon.png');
      fs.copyFileSync(sourceImage, buildIcon);
      console.log('✅ Image copiée vers:', buildIcon);
    }
    
    console.log('✨ Opération terminée!');
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

convertIcon();

