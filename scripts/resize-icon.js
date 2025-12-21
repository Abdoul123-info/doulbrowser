const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

async function resizeIcon() {
    // Try both source paths
    let inputPath = path.join(__dirname, '..', 'resources', 'icon-removebg-preview.png');
    if (!fs.existsSync(inputPath)) {
        inputPath = path.join(__dirname, '..', 'resources', 'icon.png');
    }
    const outputPath = path.join(__dirname, '..', 'resources', 'icon.png');

    console.log('📂 Loading:', inputPath);
    const image = await loadImage(inputPath);

    // 1. Get Bounding Box (Trim transparency)
    // We need to find the actual content to ignore the huge empty margins
    const tempCanvas = createCanvas(image.width, image.height);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(image, 0, 0);
    const pixels = tempCtx.getImageData(0, 0, image.width, image.height).data;

    let minX = image.width, minY = image.height, maxX = 0, maxY = 0;
    let found = false;

    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const alpha = pixels[(y * image.width + x) * 4 + 3];
            if (alpha > 10) { // Threshold to ignore near-transparent noise
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                found = true;
            }
        }
    }

    if (!found) {
        console.error("❌ No content found (blank image)");
        return;
    }

    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;

    console.log(`✂️ Content Bounds: ${contentWidth}x${contentHeight} at (${minX},${minY})`);

    // 2. Resize to 110% of the canvas
    const targetSize = 512;
    const fillPercentage = 1.10; // 110% as requested! Super big.
    const targetContentSize = targetSize * fillPercentage;

    const scale = Math.min(
        targetContentSize / contentWidth,
        targetContentSize / contentHeight
    );

    const newWidth = Math.floor(contentWidth * scale);
    const newHeight = Math.floor(contentHeight * scale);

    console.log(`🚀 Scaling to: ${newWidth}x${newHeight} (${fillPercentage * 100}%)`);

    // 3. Draw Centered
    const canvas = createCanvas(targetSize, targetSize);
    const ctx = canvas.getContext('2d');

    // Center it
    const x = (targetSize - newWidth) / 2;
    const y = (targetSize - newHeight) / 2;

    // Draw
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw only the trimmed content, scaled up
    ctx.drawImage(image, minX, minY, contentWidth, contentHeight, x, y, newWidth, newHeight);

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ Saved SUPER-SIZED (Trimmmed + 110%) icon to: ${outputPath}`);
}

resizeIcon().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
