const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx !== -1) {
      const key = line.substring(0, idx).trim();
      const val = line.substring(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

async function testFolder() {
  const folderId = '1dij7EHIUBImFlWyOrlg772IORp6LTRou';
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  console.log(`Checking Drive folder: ${folderId}`);
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 20,
    });
    const files = res.data.files || [];
    console.log(`✅ Found ${files.length} images in folder:`);
    files.forEach(f => console.log(`   - ${f.name} (id: ${f.id})`));
  } catch (err) {
    console.error('❌ Folder access error:', err.message);
  }
}

testFolder();

