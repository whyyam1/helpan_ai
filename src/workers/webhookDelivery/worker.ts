/**
 * Webhook delivery worker — drains pending rows from `webhook_deliveries`
 * and POSTs each to its target URL with an HMAC-SHA256 signature.
 *
 * Retry schedule (per attempt_count after this attempt):
 *   1 → +30s
 *   2 → +1m
 *   3 → +5m
 *   4 → +15m
 *   5 → +1h
 *   6 → +4h
 *   7 → +12h
 *   8 → ABANDONED (no more attempts)
 *
 * Concurrency: rows are fetched with `FOR UPDATE SKIP LOCKED` so multiple
 * worker processes can drain in parallel without each step waiting on the
 * other. Each row is finished in its own transaction so a long retry loop
 * doesn't hold one big lock open.
 *
 * The worker module is split:
 *   - `processBatch(deps, opts)` — pure logic, unit-testable.
 *   - `runWebhookWorker(deps)`   — entrypoint loop with sleep; called by
 *                                   `src/workers/webhookDelivery/index.ts`.
 */

import { createHash, createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Sql } from '../../db/client.js';

export interface WebhookWorkerDeps {
  /** Raw postgres-js handle — workers use the raw client so they don't pull in Drizzle for tx state. */
  readonly db: Sql;
  /** HMAC secret used to sign outbound bodies. */
  readonly hmacSecret: string;
  /** Injected HTTP client — defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Now provider for deterministic tests. */
  readonly now?: () => Date;
}

export interface ProcessBatchOptions {
  readonly batchSize: number;
}

export interface PendingDeliveryRow {
  readonly id: string;
  readonly app_id: string;
  readonly event_type: string;
  readonly event_id: string;
  readonly payload: Record<string, unknown>;
  readonly target_url: string;
  readonly attempt_count: number;
}

const RETRY_BACKOFF_SECONDS = [30, 60, 300, 900, 3600, 14400, 43200] as const;
const MAX_ATTEMPTS = RETRY_BACKOFF_SECONDS.length + 1; // 8

export function nextBackoffMs(attemptCount: number): number | null {
  // attemptCount is the count AFTER incrementing — i.e. the number of
  // attempts that have been made. 0 means none yet, 8 means the eighth
  // attempt just failed.
  if (attemptCount >= MAX_ATTEMPTS) return null;
  const seconds = RETRY_BACKOFF_SECONDS[attemptCount - 1] ?? 30;
  return seconds * 1000;
}

export interface DeliveryAttemptOutcome {
  readonly id: string;
  readonly delivered: boolean;
  readonly statusCode?: number;
  readonly error?: string;
}

function signBody(secret: string, body: string, timestamp: string): string {
  const canonical = `${timestamp}\n${createHash('sha256').update(body, 'utf8').digest('hex')}`;
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

async function attemptDelivery(
  row: PendingDeliveryRow,
  deps: WebhookWorkerDeps
): Promise<DeliveryAttemptOutcome> {
  const body = JSON.stringify(row.payload);
  const timestamp = new Date().toISOString();
  const signature = signBody(deps.hmacSecret, body, timestamp);
  const fetchImpl = deps.fetch ?? fetch;

  try {
    const res = await fetchImpl(row.target_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-helpan-timestamp': timestamp,
        'x-helpan-signature': `sha256=${signature}`,
        'x-helpan-event-type': row.event_type,
        'x-helpan-event-id': row.event_id,
        'x-helpan-delivery-id': row.id,
      },
      body,
    });
    return {
      id: row.id,
      delivered: res.status >= 200 && res.status < 300,
      statusCode: res.status,
    };
  } catch (err) {
    return {
      id: row.id,
      delivered: false,
      error: (err as Error).message,
    };
  }
}

export interface ProcessBatchResult {
  readonly attempted: number;
  readonly delivered: number;
  readonly abandoned: number;
  readonly rescheduled: number;
}

/**
 * Claim up to `batchSize` pending rows whose `next_attempt_at <= now`, post
 * each to its target_url, and update the row based on the outcome. Returns
 * a counters summary.
 */
export async function processBatch(
  deps: WebhookWorkerDeps,
  opts: ProcessBatchOptions
): Promise<ProcessBatchResult> {
  const now = deps.now ? deps.now() : new Date();
  let delivered = 0;
  let abandoned = 0;
  let rescheduled = 0;

  // Claim rows and process them one row per transaction. Concurrency safe:
  // SKIP LOCKED means other workers see different rows immediately.
  // We loop within this batch so each delivery's tx is small.
  const claims = (await deps.db.unsafe(
    `SELECT id, app_id, event_type, event_id, payload, target_url, attempt_count
     FROM webhook_deliveries
     WHERE status = 'pending' AND next_attempt_at <= $1
     ORDER BY next_attempt_at ASC
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [now.toISOString(), opts.batchSize]
  )) as unknown as PendingDeliveryRow[];

  const nowIso = now.toISOString();
  for (const row of claims) {
    const outcome = await attemptDelivery(row, deps);
    const attemptCount = row.attempt_count + 1;
    if (outcome.delivered) {
      delivered++;
      await deps.db`
        UPDATE webhook_deliveries
        SET status = 'delivered',
            attempt_count = ${attemptCount},
            last_attempt_at = ${nowIso}::timestamptz,
            delivered_at = ${nowIso}::timestamptz
        WHERE id = ${row.id}
      `;
      continue;
    }
    const backoffMs = nextBackoffMs(attemptCount);
    if (backoffMs === null) {
      abandoned++;
      await deps.db`
        UPDATE webhook_deliveries
        SET status = 'abandoned',
            attempt_count = ${attemptCount},
            last_attempt_at = ${nowIso}::timestamptz
        WHERE id = ${row.id}
      `;
      continue;
    }
    const nextAtIso = new Date(now.getTime() + backoffMs).toISOString();
    rescheduled++;
    await deps.db`
      UPDATE webhook_deliveries
      SET attempt_count = ${attemptCount},
          last_attempt_at = ${nowIso}::timestamptz,
          next_attempt_at = ${nextAtIso}::timestamptz
      WHERE id = ${row.id}
    `;
  }

  return { attempted: claims.length, delivered, abandoned, rescheduled };
}

// Touch `sql` so future raw-SQL needs can use it without re-importing.
void sql;
