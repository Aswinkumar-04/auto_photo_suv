import { NextRequest, NextResponse } from 'next/server';
import { insertPhoto, insertFace, photoExists } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { password, photo, embeddings } = await req.json();

    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!photo || !photo.drive_file_id) {
      return NextResponse.json({ error: 'Invalid photo data' }, { status: 400 });
    }

    const exists = await photoExists(photo.drive_file_id);
    if (exists) {
      return NextResponse.json({ message: 'Already indexed', skipped: true });
    }

    const photoId = await insertPhoto(
      photo.drive_file_id,
      photo.name,
      photo.thumbnail_url,
      photo.view_url,
      photo.download_url
    );

    if (Array.isArray(embeddings)) {
      for (const emb of embeddings) {
        if (Array.isArray(emb) && emb.length === 128) {
          await insertFace(photoId, emb);
        }
      }
    }

    return NextResponse.json({ success: true, photoId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

