const { neon } = require('@neondatabase/serverless');
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

async function indexDriveFolder() {
  const sql = neon(process.env.NEON_DATABASE_URL);
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const folderId = '1dij7EHIUBImFlWyOrlg772IORp6LTRou';
  console.log(`Fetching photos from Drive folder: ${folderId}`);

  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 100,
  });

  const files = res.data.files || [];
  console.log(`Found ${files.length} photos. Saving to Neon database...`);

  let count = 0;
  for (const f of files) {
    const thumb = `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`;
    const view = `https://drive.google.com/file/d/${f.id}/view`;
    const download = `https://drive.google.com/uc?export=download&id=${f.id}`;

    await sql`
      INSERT INTO photos (drive_file_id, name, thumbnail_url, view_url, download_url)
      VALUES (${f.id}, ${f.name}, ${thumb}, ${view}, ${download})
      ON CONFLICT (drive_file_id) DO UPDATE 
      SET name = ${f.name}, thumbnail_url = ${thumb}, view_url = ${view}, download_url = ${download}
    `;
    count++;
    console.log(`  ✓ Synced: ${f.name}`);
  }

  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  await sql`
    INSERT INTO settings (key, value) VALUES ('drive_folder_url', ${folderUrl})
    ON CONFLICT (key) DO UPDATE SET value = ${folderUrl}
  `;

  const total = await sql`SELECT COUNT(*) AS count FROM photos`;
  console.log(`\n🎉 Total photos now active in Neon: ${total[0].count}`);
}

indexDriveFolder().catch(console.error);
