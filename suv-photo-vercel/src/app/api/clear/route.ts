import { NextRequest, NextResponse } from 'next/server';
import { initDb, clearAllPhotos } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/clear
 * Body: { password: string }
 * Wipes all photos, faces, and folder setting from Neon.
 */
export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  await initDb();
  await clearAllPhotos();

  return NextResponse.json({ message: 'All photos cleared.' });
}

