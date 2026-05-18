/**
 * Webhook delivery worker — Railway entrypoint.
 *
 *   npm run worker:webhooks
 *
 * Boots a single connection, drains in batches, sleeps between empty
 * batches. SIGTERM-aware: lets the in-flight batch finish, then closes the
 * connection and exits 0.
 *
 * Configuration (env):
 *   DATABASE_URL                 — required, postgres connection string
 *   WEBHOOK_HMAC_SECRET          — required, 32+ char shared secret
 *   WEBHOOK_DELIVERY_POLL_MS     — optional, sleep when batch is empty (default 1000)
 *   WEBHOOK_DELIVERY_BATCH_SIZE  — optional, rows per batch (default 25)
 */

import postgres from 'postgres';
import { processBatch } from './worker.js';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[webhook-worker] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const databaseUrl = envRequired('DATABASE_URL');
  const hmacSecret = envRequired('WEBHOOK_HMAC_SECRET');
  if (hmacSecret.length < 32) {
    console.error('[webhook-worker] WEBHOOK_HMAC_SECRET must be >=32 chars');
    process.exit(1);
  }
  const pollMs = envInt('WEBHOOK_DELIVERY_POLL_MS', 1000);
  const batchSize = envInt('WEBHOOK_DELIVERY_BATCH_SIZE', 25);

  const sql = postgres(databaseUrl, { max: 4, prepare: false });
  let shutdownRequested = false;
  const onSignal = (signal: string) => {
    console.warn(`[webhook-worker] ${signal} received, draining…`);
    shutdownRequested = true;
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  console.warn(`[webhook-worker] starting (batch=${batchSize}, poll=${pollMs}ms)`);
  while (!shutdownRequested) {
    try {
      const result = await processBatch({ db: sql, hmacSecret }, { batchSize });
      if (result.attempted === 0) {
        await new Promise((r) => setTimeout(r, pollMs));
      } else if (
        result.delivered === 0 &&
        result.rescheduled === 0 &&
        result.abandoned === 0
      ) {
        // Defensive: every claimed row should have produced one outcome.
        await new Promise((r) => setTimeout(r, pollMs));
      }
    } catch (err) {
      console.error('[webhook-worker] batch error', err);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  console.warn('[webhook-worker] draining DB connection');
  await sql.end({ timeout: 5 });
  console.warn('[webhook-worker] shutdown complete');
}

main().catch((err) => {
  console.error('[webhook-worker] fatal', err);
  process.exit(1);
});
