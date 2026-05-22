/**
 * Action reaper — Railway entrypoint (H-16).
 *
 *   npm run worker:reaper            # dev: tsx
 *   node dist/workers/actionReaper/index.js  # prod: built
 *
 * Polls `actions WHERE status='pending'` and settles rows whose
 * `created_at` is older than `REAPER_STALE_AFTER_SECONDS`. See
 * `reaper.ts` for the contract; the entrypoint just provides the loop +
 * lifecycle.
 *
 * Configuration (env, all optional):
 *   DATABASE_URL                  — required
 *   REAPER_POLL_INTERVAL_MS       — default 60_000 (1 minute)
 *   REAPER_STALE_AFTER_SECONDS    — default 600    (10 minutes)
 *   REAPER_BATCH_SIZE             — default 25
 *
 * SIGTERM-aware: aborts the in-flight tick (transaction rolls back),
 * closes the DB, exits 0. Crash on unhandled errors so Railway restarts.
 *
 * Empty grace: a row created exactly N seconds ago is NOT yet eligible —
 * the SQL predicate is strict `<`, so the boundary is exclusive. This
 * matches the H-4 dispatch path's intent — Phase B's default HTTP
 * timeout is 15s, so any in-flight dispatch resolves long before the
 * 10-minute reaper window.
 */

import { createDbClient } from '../../db/client.js';
import { reapStaleActions } from './reaper.js';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[reaper-worker] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function envInt(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.error(`[reaper-worker] ${name} must be an integer in [${min}, ${max}]; got "${raw}"`);
    process.exit(1);
  }
  return n;
}

async function main(): Promise<void> {
  const databaseUrl = envRequired('DATABASE_URL');
  const pollIntervalMs = envInt('REAPER_POLL_INTERVAL_MS', 60_000, 1_000, 600_000);
  const staleAfterSeconds = envInt('REAPER_STALE_AFTER_SECONDS', 600, 30, 24 * 3600);
  const batchSize = envInt('REAPER_BATCH_SIZE', 25, 1, 500);

  const { sql, db } = createDbClient({ connectionString: databaseUrl, max: 2 });

  let shuttingDown = false;
  let currentTick: Promise<void> | null = null;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.warn(`[reaper-worker] ${signal} — finishing in-flight tick`);
    if (currentTick) {
      try {
        await currentTick;
      } catch {
        /* logged in tick() */
      }
    }
    try {
      await sql.end({ timeout: 5 });
    } finally {
      console.warn('[reaper-worker] shutdown complete');
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.warn(
    `[reaper-worker] starting · poll=${pollIntervalMs}ms · stale_after=${staleAfterSeconds}s · batch=${batchSize}`
  );

  while (!shuttingDown) {
    const tick = (async () => {
      try {
        const result = await reapStaleActions({ db }, { staleAfterSeconds, batchSize });
        if (result.reaped > 0) {
          console.warn(
            `[reaper-worker] settled ${result.reaped} stale action(s): ${result.reapedIds.join(', ')}`
          );
        }
      } catch (err) {
        // Whole-batch error: log and continue. Stale rows stay in `pending`
        // and the next tick retries. Persistent failures here are an ops
        // signal (deep-health could read errors-per-minute later).
        console.error(`[reaper-worker] tick failed:`, (err as Error).message);
      }
    })();
    currentTick = tick;
    await tick;
    currentTick = null;
    if (shuttingDown) break;
    await sleep(pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[reaper-worker] fatal', err);
  process.exit(1);
});
