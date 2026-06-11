/**
 * Kafka outbox drainer — Railway entrypoint (H-17).
 *
 *   npm run worker:outbox            # dev: tsx
 *   node dist/workers/kafkaOutbox/index.js  # prod: built
 *
 * Polls `kafka_outbox` for `status='pending'` rows whose
 * `next_attempt_at` is due and publishes them via the kafkajs producer.
 * See `src/lib/kafka/outbox.ts` for the drain contract.
 *
 * Configuration (env):
 *   DATABASE_URL                    — required
 *   KAFKA_BROKERS                   — comma-separated broker list. Empty →
 *                                     the worker logs warning + sleeps;
 *                                     pending rows accumulate until brokers
 *                                     are wired (at-least-once semantics).
 *   KAFKA_CLIENT_ID                 — default 'helpan-ai-outbox'
 *   KAFKA_OUTBOX_POLL_INTERVAL_MS   — default 1_000 (1 s)
 *   KAFKA_OUTBOX_BATCH_SIZE         — default 50
 *
 * SIGTERM-aware: drains the in-flight tick, disconnects the producer,
 * closes the DB, exits 0.
 */

import { createDbClient } from '../../db/client.js';
import { createKafkajsProducer, type KafkaProducerLike } from '../../lib/kafka/producer.js';
import { drainOutboxOnce } from '../../lib/kafka/outbox.js';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[outbox-worker] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function envInt(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.error(`[outbox-worker] ${name} must be an integer in [${min}, ${max}]; got "${raw}"`);
    process.exit(1);
  }
  return n;
}

async function main(): Promise<void> {
  const databaseUrl = envRequired('DATABASE_URL');
  const brokers = (process.env['KAFKA_BROKERS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const clientId = process.env['KAFKA_CLIENT_ID'] ?? 'helpan-ai-outbox';
  const pollIntervalMs = envInt('KAFKA_OUTBOX_POLL_INTERVAL_MS', 1_000, 100, 600_000);
  const batchSize = envInt('KAFKA_OUTBOX_BATCH_SIZE', 50, 1, 500);

  const { sql, db } = createDbClient({ connectionString: databaseUrl, max: 2 });

  let producer: KafkaProducerLike | null = null;
  if (brokers.length > 0) {
    producer = createKafkajsProducer({ clientId, brokers });
    await producer.connect();
    console.warn(`[outbox-worker] connected to brokers: ${brokers.join(',')}`);
  } else {
    console.warn(
      '[outbox-worker] KAFKA_BROKERS is empty — sleeping; pending rows accumulate until brokers are wired'
    );
  }

  let shuttingDown = false;
  let currentTick: Promise<void> | null = null;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.warn(`[outbox-worker] ${signal} — finishing in-flight tick`);
    if (currentTick) {
      try {
        await currentTick;
      } catch {
        /* logged in tick() */
      }
    }
    try {
      if (producer) await producer.disconnect();
      await sql.end({ timeout: 5 });
    } finally {
      console.warn('[outbox-worker] shutdown complete');
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.warn(
    `[outbox-worker] starting · poll=${pollIntervalMs}ms · batch=${batchSize}`
  );

  while (!shuttingDown) {
    const tick = (async () => {
      if (!producer) {
        // No brokers configured — nothing to publish to. Pending rows
        // stay in pending state; the loop just idles. Logging on every
        // tick would be noisy, so we sleep silently and rely on the
        // startup warning + ops dashboards to surface the situation.
        return;
      }
      try {
        const result = await drainOutboxOnce(db, producer, { batchSize });
        if (result.delivered + result.failed + result.abandoned > 0) {
          console.warn(
            `[outbox-worker] tick · delivered=${result.delivered} failed=${result.failed} abandoned=${result.abandoned}`
          );
        }
      } catch (err) {
        console.error(`[outbox-worker] tick failed:`, (err as Error).message);
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
  console.error('[outbox-worker] fatal', err);
  process.exit(1);
});
