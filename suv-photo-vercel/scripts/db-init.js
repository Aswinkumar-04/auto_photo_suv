/**
 * db-init.js — Run once after setting NEON_DATABASE_URL to create all tables.
 * Usage: NEON_DATABASE_URL=... node scripts/db-init.js
 */
const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.NEON_DATABASE_URL);

  console.log('Creating pgvector extension...');
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  console.log('Creating settings table...');
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `;

  console.log('Creating photos table...');
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

  console.log('Creating faces table...');
  await sql`
    CREATE TABLE IF NOT EXISTS faces (
      id         SERIAL PRIMARY KEY,
      photo_id   INT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      embedding  vector(128) NOT NULL
    )
  `;

  console.log('Creating ivfflat index...');
  await sql`
    CREATE INDEX IF NOT EXISTS faces_embedding_idx
    ON faces USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  `;

  console.log('✅ Database initialized!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

