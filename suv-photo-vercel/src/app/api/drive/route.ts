import { NextRequest, NextResponse } from 'next/server';
import { listDriveImages, buildDriveUrls, extractFolderId } from '@/lib/drive';
import { getSetting, setSetting, clearAllPhotos } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drive/list
 * Lists all image files in the current (or requested) Google Drive folder.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let folderUrl = searchParams.get('folderUrl') || (await getSetting('drive_folder_url'));

    if (!folderUrl) {
      return NextResponse.json({ error: 'No folder URL provided or configured' }, { status: 400 });
    }

    const folderId = extractFolderId(folderUrl);
    const files = await listDriveImages(folderId);

    const formatted = files.map((f) => {
      const urls = buildDriveUrls(f.id);
      return {
        id: f.id,
        name: f.name,
        thumbnailUrl: urls.thumbnailUrl,
        viewUrl: urls.viewUrl,
        downloadUrl: urls.downloadUrl,
      };
    });

    return NextResponse.json({ files: formatted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/drive/list
 * Set new Google Drive folder URL (and clears previous photos if folder changed)
 */
export async function POST(req: NextRequest) {
  try {
    const { folderUrl, password } = await req.json();

    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized: Wrong password' }, { status: 401 });
    }

    if (!folderUrl) {
      return NextResponse.json({ error: 'Missing folder URL' }, { status: 400 });
    }

    const currentUrl = await getSetting('drive_folder_url');
    if (currentUrl !== folderUrl) {
      await clearAllPhotos();
    }

    await setSetting('drive_folder_url', folderUrl);

    return NextResponse.json({ message: 'Folder saved successfully' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

