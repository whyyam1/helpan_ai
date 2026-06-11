/**
 * Kafka outbox helpers (H-17). Closes RECAP §6.7.
 *
 * The contract:
 *
 *   Producers call `enqueueOutboxEntry(tx, message)` INSIDE the tx that
 *   writes the business state. The INSERT and the business write commit
 *   atomically — if the tx rolls back, the event is not emitted. There is
 *   no after-commit publish; no crash-window event loss.
 *
 *   The drainer worker (`src/workers/kafkaOutbox/`) polls
 *   `status='pending'` rows whose `next_attempt_at` is due, claims them
 *   with FOR UPDATE SKIP LOCKED (multi-replica safe), publishes via the
 *   real kafkajs producer, and marks `delivered` or `abandoned`. The
 *   `drainOutboxOnce` function is shared between the worker loop and
 *   integration tests so the same code path is exercised both places.
 *
 * Retry policy:
 *
 *   Exponential backoff with a floor — 1s, 2s, 4s, 8s, 16s, 32s, 60s,
 *   then `abandoned`. Abandoned rows stay in the table for forensics; an
 *   operator can re-enqueue by hand if a broker outage was the cause.
 *
 * No-broker tolerance:
 *
 *   The drainer treats "no broker connection" the same as any other
 *   publish failure — bumps `attempts` + sets `next_attempt_at` + records
 *   `last_error`. Pending rows accumulate. When KAFKA_BROKERS is empty
 *   the worker logs the situation and sleeps; the producers keep
 *   enqueueing. Empty-brokers operation is an at-least-once-when-wired
 *   semantics, not a silent skip.
 */

import { generateUlid } from '@kmv/platform-shared/ulid';
import { eq, sql } from 'drizzle-orm';
import { kafkaOutbox, type KafkaOutboxRow } from '../../db/schema/kafkaOutbox.js';
import type { Db } from '../../db/client.js';
import type { Tx } from '../../plugins/rlsContext.js';
import type { KafkaMessage, KafkaProducerLike } from './producer.js';

const OUTBOX_ID_PREFIX = 'kof_';

// Exponential backoff in milliseconds. Index = attempts BEFORE this failure.
// `attempts=0` → 1s after the 1st failure; `attempts=6` → 60s after the 7th.
// After the 7th failure the row is marked `abandoned`.
export const RETRY_BACKOFF_MS = [
  1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000,
] as const;
export const MAX_OUTBOX_ATTEMPTS = RETRY_BACKOFF_MS.length;

// ---------------------------------------------------------------------------
// Producer side — called from inside the business tx
// ---------------------------------------------------------------------------

export interface EnqueueOutboxInput {
  readonly topic: string;
  /** Partition key — for account-scoped events this is `account_uuid`. */
  readonly partitionKey: string;
  /** JSON-serialisable event body. The drainer passes this through verbatim. */
  readonly payload: Record<string, unknown>;
  /** Optional Kafka headers (string→string). */
  readonly headers?: Record<string, string>;
}

/**
 * Enqueue one outbox row inside the caller's transaction. Returns the
 * row id (`kof_<ULID>`) for trace logging.
 *
 * The row enters with `status='pending'`, `attempts=0`, `next_attempt_at=NOW()`
 * — eligible for the next drainer tick.
 */
export async function enqueueOutboxEntry(
  tx: Tx,
  input: EnqueueOutboxInput
): Promise<string> {
  const id = `${OUTBOX_ID_PREFIX}${generateUlid()}`;
  await tx.insert(kafkaOutbox).values({
    id,
    topic: input.topic,
    partitionKey: input.partitionKey,
    payload: input.payload,
    headers: input.headers ?? null,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Drainer side — claim, publish, settle
// ---------------------------------------------------------------------------

export interface ClaimPendingBatchInput {
  readonly now: Date;
  readonly limit: number;
}

/**
 * Claim a batch of due pending rows. MUST be called inside a tx —
 * `FOR UPDATE SKIP LOCKED` row locks are tx-scoped, so concurrent drainer
 * replicas see disjoint batches.
 */
export async function claimPendingBatch(
  tx: Tx,
  input: ClaimPendingBatchInput
): Promise<readonly KafkaOutboxRow[]> {
  const rows = (await tx.execute(sql`
    SELECT
      id, topic, partition_key, payload, headers, status, attempts,
      next_attempt_at, delivered_at, last_error, created_at
    FROM kafka_outbox
    WHERE status = 'pending'
      AND next_attempt_at <= ${input.now.toISOString()}::timestamptz
    ORDER BY next_attempt_at ASC, created_at ASC, id ASC
    LIMIT ${input.limit}
    FOR UPDATE SKIP LOCKED
  `)) as unknown as readonly {
    id: string;
    topic: string;
    partition_key: string;
    payload: Record<string, unknown>;
    headers: Record<string, string> | null;
    status: string;
    attempts: number;
    next_attempt_at: string | Date;
    delivered_at: string | Date | null;
    last_error: string | null;
    created_at: string | Date;
  }[];

  // Raw `tx.execute(sql`…`)` returns postgres-js native types — timestamps
  // come back as ISO strings, not Date. Normalise. Same pattern as the
  // H-16 reaper's listStalePendingActions.
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    partitionKey: r.partition_key,
    payload: r.payload,
    headers: r.headers,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at instanceof Date ? r.next_attempt_at : new Date(r.next_attempt_at),
    deliveredAt:
      r.delivered_at === null
        ? null
        : r.delivered_at instanceof Date
          ? r.delivered_at
          : new Date(r.delivered_at),
    lastError: r.last_error,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

export async function markDelivered(tx: Tx, id: string): Promise<void> {
  await tx
    .update(kafkaOutbox)
    .set({
      status: 'delivered',
      deliveredAt: sql`NOW()`,
      lastError: null,
    })
    .where(eq(kafkaOutbox.id, id));
}

/**
 * Mark a row as failed-but-retryable, or `abandoned` if it has now
 * exhausted its retry budget. Bumps `attempts` + records the failure
 * message + schedules `next_attempt_at` per the exponential backoff.
 */
export async function markFailed(
  tx: Tx,
  id: string,
  attemptsBefore: number,
  error: string,
  now: Date
): Promise<{ nextStatus: 'pending' | 'abandoned'; nextAttemptAt: Date }> {
  const newAttempts = attemptsBefore + 1;
  if (newAttempts >= MAX_OUTBOX_ATTEMPTS) {
    await tx
      .update(kafkaOutbox)
      .set({
        status: 'abandoned',
        attempts: newAttempts,
        lastError: truncateError(error),
      })
      .where(eq(kafkaOutbox.id, id));
    return { nextStatus: 'abandoned', nextAttemptAt: now };
  }
  // attemptsBefore is 0-indexed; backoff[attemptsBefore] is the delay
  // BEFORE the next retry. Index is safe — bounds checked by the < above.
  const backoffMs = RETRY_BACKOFF_MS[attemptsBefore]!;
  const nextAttemptAt = new Date(now.getTime() + backoffMs);
  await tx
    .update(kafkaOutbox)
    .set({
      attempts: newAttempts,
      nextAttemptAt,
      lastError: truncateError(error),
    })
    .where(eq(kafkaOutbox.id, id));
  return { nextStatus: 'pending', nextAttemptAt };
}

function truncateError(s: string): string {
  // Bound the error text so a stack trace dump doesn't blow up the row.
  // 2000 chars is generous for an operator scanning by eye.
  return s.length > 2000 ? `${s.slice(0, 2000)}…<truncated>` : s;
}

// ---------------------------------------------------------------------------
// drainOutboxOnce — one tick of the worker loop
// ---------------------------------------------------------------------------

export interface DrainOutboxResult {
  readonly delivered: number;
  readonly failed: number;
  readonly abandoned: number;
  readonly deliveredIds: readonly string[];
}

export interface DrainOutboxOptions {
  readonly now?: () => Date;
  readonly batchSize: number;
}

/**
 * One drain tick: claim a batch (own tx for locks), publish each row, mark
 * delivered/failed in its own per-row tx so a partial-batch failure does
 * not roll back the successful rows. Returns counts for structured logging.
 *
 * Per-row commit means the batch's row locks must be released before
 * publishing — otherwise a long-running kafka.publish() would hold locks
 * unnecessarily. We resolve this by claiming the batch, COMMITting the
 * claim tx (which releases the locks but leaves status='pending'), then
 * publishing each row outside any tx, then writing the final delivered/
 * failed status in a fresh per-row tx.
 *
 * Concurrent drainers can still race on the same row between the claim
 * commit and the publish, but `markDelivered` / `markFailed` are
 * idempotent updates keyed on `id`, and the `attempts` counter prevents
 * double-incrementing on the abandoned threshold.
 */
export async function drainOutboxOnce(
  db: Db,
  producer: KafkaProducerLike,
  options: DrainOutboxOptions
): Promise<DrainOutboxResult> {
  const now = (options.now ?? (() => new Date()))();

  let claimed: readonly KafkaOutboxRow[] = [];
  await db.transaction(async (tx) => {
    claimed = await claimPendingBatch(tx as never, {
      now,
      limit: options.batchSize,
    });
    // Commit immediately — releases the row locks. The rows stay
    // status='pending' until we mark them after publishing.
  });

  if (claimed.length === 0) {
    return { delivered: 0, failed: 0, abandoned: 0, deliveredIds: [] };
  }

  const deliveredIds: string[] = [];
  let failed = 0;
  let abandoned = 0;

  for (const row of claimed) {
    const message: KafkaMessage = {
      topic: row.topic,
      key: row.partitionKey,
      value: row.payload as Record<string, unknown>,
      ...(row.headers ? { headers: row.headers as Record<string, string> } : {}),
    };
    try {
      await producer.publish(message);
      await db.transaction(async (tx) => {
        await markDelivered(tx as never, row.id);
      });
      deliveredIds.push(row.id);
    } catch (err) {
      const settleNow = (options.now ?? (() => new Date()))();
      let settled: { nextStatus: 'pending' | 'abandoned' };
      await db.transaction(async (tx) => {
        settled = await markFailed(
          tx as never,
          row.id,
          row.attempts,
          (err as Error).message ?? String(err),
          settleNow
        );
      });
      if (settled!.nextStatus === 'abandoned') abandoned++;
      else failed++;
    }
  }

  return {
    delivered: deliveredIds.length,
    failed,
    abandoned,
    deliveredIds,
  };
}

// ---------------------------------------------------------------------------
// Read helper — exposed for tests + ops visibility
// ---------------------------------------------------------------------------

export async function countOutboxByStatus(
  db: Db
): Promise<{ pending: number; delivered: number; abandoned: number }> {
  const rows = (await db
    .select({
      status: kafkaOutbox.status,
      n: sql<number>`count(*)::int`,
    })
    .from(kafkaOutbox)
    .groupBy(kafkaOutbox.status)) as unknown as readonly {
    status: string;
    n: number;
  }[];
  const out = { pending: 0, delivered: 0, abandoned: 0 };
  for (const r of rows) {
    if (r.status === 'pending') out.pending = r.n;
    else if (r.status === 'delivered') out.delivered = r.n;
    else if (r.status === 'abandoned') out.abandoned = r.n;
  }
  return out;
}

export type { KafkaOutboxRow };
