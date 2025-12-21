const { spawn } = require('child_process');
const path = require('path');

const url = 'https://www.youtube.com/watch?v=YvaPnQboov4';
const ytDlpPath = path.join(process.env.APPDATA, 'doul-browser/yt-dlp.exe');
const nodeDir = 'C:\\Program Files\\nodejs';

async function test(name, extraArgs) {
    console.log(`\n--- Testing: ${name} ---`);
    const env = { ...process.env };
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = `${nodeDir};${env[pathKey]}`;
    env['YTDLP_JS_ENGINE'] = 'node';

    const args = [url, '--dump-json', '--no-playlist', '--no-warnings', ...extraArgs];

    return new Promise((resolve) => {
        const proc = spawn(ytDlpPath, args, { env });
        let out = '';
        let err = '';
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => err += d);
        proc.on('close', code => {
            if (code === 0) {
                console.log(`✅ Success! Formats found: ${JSON.parse(out).formats.length}`);
            } else {
                console.log(`❌ Failed with code ${code}`);
                console.log(`Error: ${err.split('\n')[0]}`);
            }
            resolve();
        });
    });
}

async function run() {
    await test('V11 (Current)', ['--extractor-args', 'youtube:player_client=android,web,ios']);
    await test('Permissive (Web only)', ['--extractor-args', 'youtube:player_client=web']);
    await test('Permissive (Android only)', ['--extractor-args', 'youtube:player_client=android']);
    await test('Ultra Permissive (All)', ['--extractor-args', 'youtube:player_client=all']);
    await test('No restricted client', []);
}

run();
