const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');

async function updateYtDlp() {
    console.log('Downloading latest yt-dlp binary...');
    const destination = path.join(__dirname, '..', 'yt-dlp.exe');

    try {
        // Download latest release
        await YTDlpWrap.downloadFromGithub(destination);
        console.log(`Successfully downloaded yt-dlp to ${destination}`);

        // Verify version
        const ytDlpWrap = new YTDlpWrap(destination);
        const version = await ytDlpWrap.getVersion();
        console.log(`yt-dlp version: ${version}`);

    } catch (error) {
        console.error('Error updating yt-dlp:', error);
        process.exit(1);
    }
}

updateYtDlp();
