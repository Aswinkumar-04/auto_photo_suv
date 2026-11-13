import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

export { sql };

/** Run once at startup to create tables */
export async function initDb() {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS photos (
      id            SERIAL PRIMARY KEY,
      drive_file_id TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      thumbnail_url TEXT NOT NULL,
      view_url      TEXT NOT NULL,
      download_url  TEXT NOT NULL,
      synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS faces (
      id         SERIAL PRIMARY KEY,
      photo_id   INT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      embedding  vector(128) NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS faces_embedding_idx
    ON faces USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  `;
}

/** Wipe all photos + faces (cascade) + reset folder setting */
export async function clearAllPhotos() {
  await sql`DELETE FROM photos`;
  await sql`DELETE FROM settings WHERE key = 'drive_folder_id'`;
  await sql`DELETE FROM settings WHERE key = 'drive_folder_url'`;
}

/** Get a setting value */
export async function getSetting(key: string): Promise<string | null> {
  const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
  return rows.length > 0 ? rows[0].value : null;
}

/** Set a setting value (upsert) */
export async function setSetting(key: string, value: string) {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}
  `;
}

/** Check if a Drive file is already indexed */
export async function photoExists(driveFileId: string): Promise<boolean> {
  const rows = await sql`SELECT id FROM photos WHERE drive_file_id = ${driveFileId}`;
  return rows.length > 0;
}

/** Insert a photo record */
export async function insertPhoto(
  driveFileId: string,
  name: string,
  thumbnailUrl: string,
  viewUrl: string,
  downloadUrl: string,
): Promise<number> {
  const rows = await sql`
    INSERT INTO photos (drive_file_id, name, thumbnail_url, view_url, download_url)
    VALUES (${driveFileId}, ${name}, ${thumbnailUrl}, ${viewUrl}, ${downloadUrl})
    ON CONFLICT (drive_file_id) DO NOTHING
    RETURNING id
  `;
  if (rows.length === 0) {
    // already existed — fetch id
    const existing = await sql`SELECT id FROM photos WHERE drive_file_id = ${driveFileId}`;
    return existing[0].id;
  }
  return rows[0].id;
}

/** Insert a face embedding for a photo */
export async function insertFace(photoId: number, embedding: number[]) {
  const vec = `[${embedding.join(',')}]`;
  await sql`
    INSERT INTO faces (photo_id, embedding)
    VALUES (${photoId}, ${vec}::vector)
  `;
}

/** Find photos whose face embeddings are close to query vector */
export async function searchByFace(
  embedding: number[],
  threshold = 0.4,
  limit = 50,
): Promise<{ drive_file_id: string; name: string; thumbnail_url: string; view_url: string; download_url: string; distance: number }[]> {
  const vec = `[${embedding.join(',')}]`;
  const rows = await sql`
    SELECT DISTINCT ON (p.id)
      p.drive_file_id,
      p.name,
      p.thumbnail_url,
      p.view_url,
      p.download_url,
      (f.embedding <=> ${vec}::vector) AS distance
    FROM faces f
    JOIN photos p ON p.id = f.photo_id
    WHERE (f.embedding <=> ${vec}::vector) < ${threshold}
    ORDER BY p.id, distance
    LIMIT ${limit}
  `;
  return rows as typeof rows extends Promise<infer T> ? T : never;
}

/** Total photo count */
export async function getPhotoCount(): Promise<number> {
  const rows = await sql`SELECT COUNT(*) AS cnt FROM photos`;
  return Number(rows[0].cnt);
}

