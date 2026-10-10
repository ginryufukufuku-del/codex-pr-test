// ../video-ai-hub のアプリ本体を desktop/app/ にコピーする(Electronが同梱するため)
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'video-ai-hub'), dst = path.join(__dirname, '..', 'app');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const f of ['server.js', 'studio.js', 'media.js', 'voice.js', 'aozora.js', 'index.html', 'app.js', 'style.css']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('copied app files to', dst);
