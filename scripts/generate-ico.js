const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const sourceIcon = path.join(__dirname, '../resources/icon.png');
const buildDir = path.join(__dirname, '../build');
const destIco = path.join(buildDir, 'icon.ico');

async function generate() {
    console.log('Using source:', sourceIcon);

    if (!fs.existsSync(sourceIcon)) {
        console.error('Source icon.png not found!');
        process.exit(1);
    }

    try {
        const sizes = [16, 32, 48, 64, 128, 256];
        const pngBuffers = [];

        for (const size of sizes) {
            const buffer = await sharp(sourceIcon)
                .resize(size, size, {
                    fit: 'cover',
                    position: 'center'
                })
                .png()
                .toBuffer();
            pngBuffers.push(buffer);
        }

        const icoBuffer = await pngToIco(pngBuffers);
        fs.writeFileSync(destIco, icoBuffer);
        console.log('✅ Updated build/icon.ico from resources/icon.png');
    } catch (e) {
        console.error('Error:', e);
    }
}

generate();
