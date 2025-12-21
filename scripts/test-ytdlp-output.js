const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ytDlpPath = path.join(__dirname, '..', 'yt-dlp.exe');
const url = 'https://www.youtube.com/watch?v=TPyyDYhmkhs'; // The video user tried
const args = [
    url,
    '--newline',
    '-S', 'vcodec:h264,res,acodec:m4a',
    '-f', 'best[ext=mp4]/best',
    '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
];

console.log(`Running: ${ytDlpPath} ${args.join(' ')}`);

const child = spawn(ytDlpPath, args);
const logStream = fs.createWriteStream('ytdlp-debug-output.txt');

child.stdout.on('data', (data) => {
    const str = data.toString();
    process.stdout.write(str);
    logStream.write(str);
});

child.stderr.on('data', (data) => {
    const str = data.toString();
    process.stderr.write(str);
    logStream.write(`STDERR: ${str}`);
});

child.on('close', (code) => {
    console.log(`Child process exited with code ${code}`);
    logStream.end();
});
