const { neon } = require('@neondatabase/serverless');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Read .env.local manually
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

async function testBackend() {
  console.log('--- 1. Testing Neon Database ---');
  if (!process.env.NEON_DATABASE_URL) {
    console.error('❌ NEON_DATABASE_URL is missing in .env.local');
    return;
  }
  const sql = neon(process.env.NEON_DATABASE_URL);
  try {
    const ext = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    console.log('✅ pgvector extension:', ext[0]?.extname || 'NOT FOUND');

    const photos = await sql`SELECT COUNT(*) AS count FROM photos`;
    console.log('✅ Photos table count:', photos[0].count);

    const faces = await sql`SELECT COUNT(*) AS count FROM faces`;
    console.log('✅ Faces table count:', faces[0].count);

    const folder = await sql`SELECT value FROM settings WHERE key = 'drive_folder_url'`;
    console.log('✅ Saved Drive folder:', folder[0]?.value || '(None configured yet)');
  } catch (err) {
    console.error('❌ Neon DB error:', err.message);
  }

  console.log('\n--- 2. Testing Google Drive Service Account ---');
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_JSON is missing in .env.local');
    return;
  }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    console.log('✅ Service account email:', credentials.client_email);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    const about = await drive.about.get({ fields: 'user' });
    console.log('✅ Google Drive API connected successfully as:', about.data.user.emailAddress);
  } catch (err) {
    console.error('❌ Google Drive error:', err.message);
  }
}

testBackend();
