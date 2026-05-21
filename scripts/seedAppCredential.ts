/**
 * Seed an `app_credentials` row.
 *
 *   npm run db:seed:app -- <app_id> <app_name> [tenant_class] [scopes_csv]
 *
 * Examples:
 *   npm run db:seed:app -- lunchdrop "Lunch Drop" internal helpan:admin
 *   npm run db:seed:app -- chapaa "Chapaa" internal
 *
 * Generates a fresh 32-byte HMAC secret, wraps it via the noop envelope, and
 * upserts into `app_credentials`. Prints the plaintext secret to stdout
 * exactly once — copy it into the consuming app's secret store. There is no
 * way to recover it after this run (the DB stores the envelope blob, the
 * plaintext is not persisted anywhere else).
 *
 * Idempotent on `app_id` — re-running with the same id rotates the secret.
 * Exits non-zero on SQL error so deploy hooks fail loudly.
 */

import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import { appCredentials } from '../src/db/schema/index.js';
import { createSecretsEnvelope } from '../src/lib/secretsEnvelope.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Source .env or pass it inline.');
  process.exit(1);
}

const args = process.argv.slice(2);
const appId = args[0];
const appName = args[1];
const tenantClass = (args[2] ?? 'internal') as 'internal' | 'external';
const scopesCsv = args[3] ?? '';

if (!appId || !appName) {
  console.error('Usage: npm run db:seed:app -- <app_id> <app_name> [tenant_class] [scopes_csv]');
  process.exit(1);
}
if (tenantClass !== 'internal' && tenantClass !== 'external') {
  console.error(`tenant_class must be 'internal' or 'external'; got "${tenantClass}"`);
  process.exit(1);
}

const scopes = scopesCsv
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// Fresh 32-byte random secret, hex-encoded → 64-char string. Matches the
// shape platform-shared's hmac.ts expects (UTF-8 bytes used directly).
const plaintextSecret = randomBytes(32).toString('hex');

const envelope = createSecretsEnvelope(
  (process.env['SECRETS_ENVELOPE_PROVIDER'] ?? 'noop') as 'noop'
);
const wrappedSecret = await envelope.encrypt(plaintextSecret);

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const db = drizzle(sql);

  await db
    .insert(appCredentials)
    .values({
      appId,
      appName,
      tenantClass,
      hmacSecret: wrappedSecret,
      scopes,
    })
    .onConflictDoUpdate({
      target: appCredentials.appId,
      set: {
        appName,
        tenantClass,
        hmacSecret: wrappedSecret,
        scopes,
        updatedAt: drizzleSql`NOW()`,
      },
    });

  console.warn('[seed:app] upserted app_credentials row');
  console.warn(`  app_id        : ${appId}`);
  console.warn(`  app_name      : ${appName}`);
  console.warn(`  tenant_class  : ${tenantClass}`);
  console.warn(`  scopes        : [${scopes.join(', ')}]`);
  console.warn('');
  console.warn('  HMAC secret (copy now — not recoverable):');
  console.warn(`  ${plaintextSecret}`);
} catch (err) {
  console.error('[seed:app] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
