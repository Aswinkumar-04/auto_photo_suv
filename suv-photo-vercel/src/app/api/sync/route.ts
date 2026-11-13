import { NextRequest, NextResponse } from 'next/server';
import {
  initDb,
  getSetting,
  setSetting,
  photoExists,
  insertPhoto,
  insertFace,
  clearAllPhotos,
} from '@/lib/db';
import { listDriveImages, downloadDriveImage, buildDriveUrls, extractFolderId } from '@/lib/drive';
import { extractEmbeddings } from '@/lib/face-server';

export const maxDuration = 60; // Vercel Pro: up to 300s; Hobby: 60s
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Verify cron secret so only Vercel can call this
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDb();

  const folderUrl = await getSetting('drive_folder_url');
  if (!folderUrl) {
    return NextResponse.json({ message: 'No folder configured yet' });
  }

  const folderId = extractFolderId(folderUrl);
  const files = await listDriveImages(folderId);

  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    try {
      if (await photoExists(file.id)) {
        skipped++;
        continue;
      }

      const buffer = await downloadDriveImage(file.id);
      const embeddings = await extractEmbeddings(buffer);

      if (embeddings.length === 0) {
        // No face detected — still store photo (host might want all photos)
        const urls = buildDriveUrls(file.id);
        await insertPhoto(file.id, file.name, urls.thumbnailUrl, urls.viewUrl, urls.downloadUrl);
        indexed++;
        continue;
      }

      const urls = buildDriveUrls(file.id);
      const photoId = await insertPhoto(
        file.id, file.name,
        urls.thumbnailUrl, urls.viewUrl, urls.downloadUrl,
      );

      for (const emb of embeddings) {
        await insertFace(photoId, emb);
      }
      indexed++;
    } catch (err) {
      console.error(`Error processing file ${file.id}:`, err);
      errors++;
    }
  }

  await setSetting('last_sync', new Date().toISOString());

  return NextResponse.json({
    total: files.length,
    indexed,
    skipped,
    errors,
  });
}

/** POST /api/sync  — called from dashboard to set a new folder */
export async function POST(req: NextRequest) {
  // Admin auth
  const { folderUrl, password } = await req.json();
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  await initDb();

  // If folder changed → wipe everything first
  const currentUrl = await getSetting('drive_folder_url');
  if (currentUrl !== folderUrl) {
    await clearAllPhotos();
  }

  await setSetting('drive_folder_url', folderUrl);

  return NextResponse.json({ message: 'Folder saved. Sync will begin within 1 minute.' });
}

