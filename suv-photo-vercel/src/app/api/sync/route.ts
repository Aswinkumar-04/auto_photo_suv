import { NextRequest, NextResponse } from 'next/server';
import { initDb, getSetting } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Cron route (e.g. called by Vercel Cron or dashboard health check)
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      // Allow if called internally without secret or warn
    }

    await initDb();
    const folderUrl = await getSetting('drive_folder_url');

    return NextResponse.json({
      status: 'healthy',
      activeFolder: folderUrl || null,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
