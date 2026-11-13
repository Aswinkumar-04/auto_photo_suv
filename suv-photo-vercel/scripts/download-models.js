/**
 * download-models.js
 * Run once: node scripts/download-models.js
 * Downloads face-api.js model weights into public/models/
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model';
const OUT_DIR = path.join(__dirname, '..', 'public', 'models');

const FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model-shard1',
  'ssd_mobilenetv1_model-shard2',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
];

fs.mkdirSync(OUT_DIR, { recursive: true });

function download(filename) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/${filename}`;
    const dest = path.join(OUT_DIR, filename);
    if (fs.existsSync(dest)) {
      console.log(`  skip (exists): ${filename}`);
      return resolve();
    }
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        https.get(res.headers.location, (r) => r.pipe(file));
      } else {
        res.pipe(file);
      }
      file.on('finish', () => {
        file.close();
        console.log(`  ✓ ${filename}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

(async () => {
  console.log('Downloading face-api.js models → public/models/');
  for (const f of FILES) {
    await download(f);
  }
  console.log('Done!');
})();

