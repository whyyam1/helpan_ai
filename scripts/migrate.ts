/**
 * Migration runner.
 *
 *   npm run db:migrate
 *
 * Reads src/db/migrations/{0001..0006}_*.sql per the manifest in
 * src/db/migrations/meta/_journal.json and applies any not yet recorded in
 * the `_drizzle_migrations` table. Safe to re-run.
 *
 * Exits non-zero on any SQL error so CI / Railway deploy hooks fail loudly.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Source .env or pass it inline.');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '..', 'src', 'db', 'migrations');

// Migrations always use a single dedicated connection that does NOT go through
// PgBouncer (pgcrypto's CREATE EXTENSION and ALTER TABLE ... ENABLE RLS are
// session-state operations that don't survive transaction pooling). Direct
// connection string + max:1 keeps that contract simple.
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const db = drizzle(sql);
  console.warn(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, {
    migrationsFolder,
    migrationsTable: '_drizzle_migrations',
    migrationsSchema: 'public',
  });
  console.warn('[migrate] complete');
} catch (err) {
  console.error('[migrate] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
