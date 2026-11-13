import { google } from 'googleapis';

/** Build an authenticated Google Drive client using the service account JSON env var */
function getDriveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is missing');

  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

/** Extract folder ID from a Google Drive folder URL or bare ID */
export function extractFolderId(urlOrId: string): string {
  const match = urlOrId.match(/[-\w]{25,}/);
  if (!match) throw new Error('Could not extract folder ID from: ' + urlOrId);
  return match[0];
}

/** List all image files in a Drive folder */
export async function listDriveImages(folderId: string): Promise<
  { id: string; name: string }[]
> {
  const drive = getDriveClient();
  const files: { id: string; name: string }[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 200,
      pageToken,
    });

    for (const f of res.data.files ?? []) {
      if (f.id && f.name) files.push({ id: f.id, name: f.name });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}

/** Download image bytes from Drive into a Buffer (streams fully in memory) */
export async function downloadDriveImage(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Build public URLs for a Drive file */
export function buildDriveUrls(fileId: string) {
  return {
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
    viewUrl:      `https://drive.google.com/file/d/${fileId}/view`,
    downloadUrl:  `https://drive.google.com/uc?export=download&id=${fileId}`,
  };
}

