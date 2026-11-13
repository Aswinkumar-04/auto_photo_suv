import { NextRequest, NextResponse } from 'next/server';
import { initDb, searchByFace } from '@/lib/db';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * POST /api/match
 * Body: { embedding: number[] }  — 128-element float array from face-api.js in browser
 * Returns: list of matching photos with their Google Drive URLs
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const embedding: number[] = body.embedding;

  if (!Array.isArray(embedding) || embedding.length !== 128) {
    return NextResponse.json(
      { error: 'embedding must be a 128-element number array' },
      { status: 400 },
    );
  }

  await initDb();

  const threshold = parseFloat(process.env.FACE_MATCH_THRESHOLD ?? '0.4');
  const results = await searchByFace(embedding, threshold);

  return NextResponse.json({ matches: results });
}

