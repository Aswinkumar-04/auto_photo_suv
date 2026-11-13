/**
 * download-models.js
 * Copies face-api.js models from node_modules directly to public/models/
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'face-api', 'model');
const destDir = path.join(__dirname, '..', 'public', 'models');

fs.mkdirSync(destDir, { recursive: true });

if (fs.existsSync(srcDir)) {
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    console.log(`  ✓ ${file}`);
  }
  console.log('✅ Models copied successfully!');
} else {
  console.error('❌ node_modules/@vladmandic/face-api/model not found. Run npm install first.');
}
