/**
 * Drizzle data-access for events ingestion and matching.
 *
 * Reads / writes used by H-5:
 *   - insertEvent(tx, …) — persist a new `events_ingested` row.
 *   - listActiveBriefingsForEvent(tx, {appId, accountUuid?}) — pre-filter
 *     candidate briefings using the indexes from H-2.
 *   - insertBriefingMatch(tx, …) — persist a (briefing × event) match row.
 *   - enqueueWebhookDelivery(tx, …) — append a row the worker will drain.
 *   - markEventMatchStatus(tx, …) — close out the event after matching.
 *
 * Functions take a `Tx` so the whole ingest path runs in one transaction:
 * either every match + audit + webhook row commits together, or none does.
 */

import { and, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import { briefings } from '../../db/schema/briefings.js';
import { briefingMatches } from '../../db/schema/briefingMatches.js';
import { eventsIngested } from '../../db/schema/eventsIngested.js';
import { webhookDeliveries } from '../../db/schema/webhookDeliveries.js';
import type { Tx } from '../../plugins/rlsContext.js';
import type { MatchableBriefing } from '../../lib/matching/engine.js';

export interface InsertEventInput {
  id: string;
  eventType: string;
  appId: string;
  accountUuid?: string | null;
  payload: Record<string, unknown>;
  publishedAt: Date;
  idempotencyKey: string;
  appCorrelationId?: string | null;
}

export interface InsertedEvent {
  id: string;
  eventType: string;
  appId: string;
  accountUuid: string | null;
  ingestedAt: Date;
}

export async function insertEvent(
  tx: Tx,
  input: InsertEventInput
): Promise<InsertedEvent> {
  const rows = (await tx
    .insert(eventsIngested)
    .values({
      id: input.id,
      eventType: input.eventType,
      appId: input.appId,
      accountUuid: input.accountUuid ?? null,
      payload: input.payload,
      publishedAt: input.publishedAt,
      idempotencyKey: input.idempotencyKey,
      appCorrelationId: input.appCorrelationId ?? null,
    })
    .returning({
      id: eventsIngested.id,
      eventType: eventsIngested.eventType,
      appId: eventsIngested.appId,
      accountUuid: eventsIngested.accountUuid,
      ingestedAt: eventsIngested.ingestedAt,
    })) as unknown as InsertedEvent[];
  if (rows.length !== 1) throw new Error('insertEvent: expected exactly one row');
  return rows[0]!;
}

/**
 * Pre-filter briefings for the matching engine. Per the design notes in
 * `src/lib/matching/engine.ts`, eligibility is enforced here in SQL.
 *
 * `account_uuid` is optional on the event — broadcast-style events fan out
 * against every active briefing for the app. For account-scoped events we
 * restrict to one customer.
 */
export async function listActiveBriefingsForEvent(
  tx: Tx,
  args: { appId: string; accountUuid: string | null; now: Date }
): Promise<readonly MatchableBriefing[]> {
  const expiryGuard = or(isNull(briefings.expiresAt), gt(briefings.expiresAt, args.now)) as SQL;
  const filters: SQL[] = [
    eq(briefings.appId, args.appId),
    eq(briefings.status, 'active'),
    expiryGuard,
  ];
  if (args.accountUuid) {
    filters.push(eq(briefings.accountUuid, args.accountUuid));
  }
  const rows = (await tx
    .select({
      id: briefings.id,
      accountUuid: briefings.accountUuid,
      appId: briefings.appId,
      briefingType: briefings.briefingType,
      intent: briefings.intent,
    })
    .from(briefings)
    .where(and(...filters))) as unknown as MatchableBriefing[];
  return rows;
}

export interface InsertBriefingMatchInput {
  id: string;
  briefingId: string;
  eventId: string;
  accountUuid: string;
  matchConfidence: 'high' | 'medium' | 'low';
  matchDetail: Record<string, unknown>;
  webhookDeliveryId?: string | null;
}

export async function insertBriefingMatch(
  tx: Tx,
  input: InsertBriefingMatchInput
): Promise<void> {
  await tx.insert(briefingMatches).values({
    id: input.id,
    briefingId: input.briefingId,
    eventId: input.eventId,
    accountUuid: input.accountUuid,
    matchConfidence: input.matchConfidence,
    matchDetail: input.matchDetail,
    webhookDeliveryId: input.webhookDeliveryId ?? null,
  });
}

export interface EnqueueWebhookDeliveryInput {
  id: string;
  appId: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
  targetUrl: string;
  /** First attempt fires immediately (next_attempt_at = now). */
  scheduledAt: Date;
}

export async function enqueueWebhookDelivery(
  tx: Tx,
  input: EnqueueWebhookDeliveryInput
): Promise<void> {
  await tx.insert(webhookDeliveries).values({
    id: input.id,
    appId: input.appId,
    eventType: input.eventType,
    eventId: input.eventId,
    payload: input.payload,
    targetUrl: input.targetUrl,
    attemptCount: 0,
    nextAttemptAt: input.scheduledAt,
    status: 'pending',
  });
}

export async function markEventMatchStatus(
  tx: Tx,
  eventId: string,
  matchCount: number
): Promise<void> {
  const status = matchCount > 0 ? 'matched' : 'no_match';
  await tx
    .update(eventsIngested)
    .set({ matchStatus: status, matchCount })
    .where(eq(eventsIngested.id, eventId));
}

/**
 * Look up an event by its (idempotency_key, app_id) — used to replay the
 * 202 response when a consuming app re-sends the same ingestion key.
 * Returns null when there is no prior entry.
 */
export async function findEventByIdempotencyKey(
  tx: Tx,
  appId: string,
  idempotencyKey: string
): Promise<InsertedEvent | null> {
  const rows = (await tx
    .select({
      id: eventsIngested.id,
      eventType: eventsIngested.eventType,
      appId: eventsIngested.appId,
      accountUuid: eventsIngested.accountUuid,
      ingestedAt: eventsIngested.ingestedAt,
    })
    .from(eventsIngested)
    .where(
      and(eq(eventsIngested.appId, appId), eq(eventsIngested.idempotencyKey, idempotencyKey))
    )
    .limit(1)) as unknown as InsertedEvent[];
  return rows[0] ?? null;
}

// Touch `sql` so the linter doesn't drop the import — kept available for
// future raw-SQL escape hatches the repo may need.
void sql;
