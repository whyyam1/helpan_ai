/**
 * Re-wrap `app_credentials` secrets under the current aes-gcm envelope key.
 *
 *   npm run secrets:rewrap            # dry run — reports what would change
 *   npm run secrets:rewrap -- --apply # writes
 *
 * Requires SECRETS_ENVELOPE_KEY + SECRETS_ENVELOPE_KEY_ID (the target key).
 * Reads noop blobs, bare plaintext, and blobs under
 * SECRETS_ENVELOPE_PREVIOUS_KEY[_ID] (rotation), and rewrites each
 * `hmac_secret` / `webhook_signing_secret` not already under the current key.
 * Every rewritten value is decrypted again and compared before the
 * transaction commits, so a bad key can't corrupt a row. Idempotent.
 *
 * Order for switching an environment to aes-gcm:
 *   1. Set SECRETS_ENVELOPE_PROVIDER=aes-gcm + key vars on the web service
 *      (it still reads the existing noop rows) and deploy.
 *   2. Run this with --apply.
 * Never print plaintext — this script only logs app_ids and counts.
 */

import postgres from 'postgres';
import {
  createSecretsEnvelope,
  isWrappedUnderKey,
  parseEnvelopeOptions,
} from '../src/lib/secretsEnvelope.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Source .env or pass it inline.');
  process.exit(1);
}

const apply = process.argv.slice(2).includes('--apply');
const options = parseEnvelopeOptions(process.env);
if (!options.key) {
  console.error('SECRETS_ENVELOPE_KEY and SECRETS_ENVELOPE_KEY_ID are required.');
  process.exit(1);
}
const keyId = options.key.id;
const envelope = createSecretsEnvelope('aes-gcm', options);

interface Row {
  app_id: string;
  hmac_secret: string;
  webhook_signing_secret: string | null;
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  await sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT app_id, hmac_secret, webhook_signing_secret
      FROM app_credentials ORDER BY app_id FOR UPDATE
    `) as unknown as Row[];

    let changed = 0;
    for (const row of rows) {
      const updates: { hmac_secret?: string; webhook_signing_secret?: string } = {};
      for (const col of ['hmac_secret', 'webhook_signing_secret'] as const) {
        const blob = row[col];
        if (blob === null || isWrappedUnderKey(blob, keyId)) continue;
        const plaintext = await envelope.decrypt(blob);
        const wrapped = await envelope.encrypt(plaintext);
        if ((await envelope.decrypt(wrapped)) !== plaintext) {
          throw new Error(`round-trip mismatch for ${row.app_id}.${col}`);
        }
        updates[col] = wrapped;
      }
      const cols = Object.keys(updates);
      if (cols.length === 0) {
        console.warn(`[rewrap] ${row.app_id}: already under key "${keyId}"`);
        continue;
      }
      changed += 1;
      console.warn(`[rewrap] ${row.app_id}: ${apply ? 'rewrapped' : 'would rewrap'} ${cols.join(', ')}`);
      if (apply) {
        await tx`
          UPDATE app_credentials
          SET ${tx(updates)}, updated_at = NOW()
          WHERE app_id = ${row.app_id}
        `;
      }
    }
    console.warn(
      `[rewrap] ${rows.length} row(s) scanned · ${changed} ${apply ? 'rewrapped' : 'pending'}` +
        (apply ? '' : ' — re-run with --apply to write')
    );
  });
} catch (err) {
  console.error('[rewrap] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
