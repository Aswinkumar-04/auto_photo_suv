import { NextResponse } from 'next/server';
import { initDb, getSetting, getPhotoCount } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/status
 * Returns current sync status (photo count, folder url, last sync time).
 */
export async function GET() {
  await initDb();
  const [folderUrl, lastSync, count] = await Promise.all([
    getSetting('drive_folder_url'),
    getSetting('last_sync'),
    getPhotoCount(),
  ]);

  return NextResponse.json({ folderUrl, lastSync, photoCount: count });
}

