/**
 * Events ingestion service — orchestrates the H-5 pipeline:
 *
 *   POST /v1/events/ingest
 *      │
 *      ├─ (idempotency replay handled by shared plugin before we reach here)
 *      │
 *      ├─ withCustomerContext-equivalent (system context: no customer GUC)
 *      │     ├─ insertEvent                  → events_ingested row
 *      │     ├─ listActiveBriefingsForEvent  → candidate set
 *      │     ├─ matchEventAgainstBriefings   → BriefingMatch[]
 *      │     ├─ for each match:
 *      │     │     ├─ enqueueWebhookDelivery (if app has a configured URL)
 *      │     │     └─ insertBriefingMatch
 *      │     ├─ markEventMatchStatus
 *      │     └─ appendAuditEntry             → one entry per ingestion
 *      │
 *      └─ after-commit:
 *            └─ kafka.publish(BRIEFING_MATCHED) × match_count
 *
 * Why publish after commit: if the transaction rolls back, we have neither
 * the DB rows nor the Kafka emission. The trade is that a crash *between*
 * commit and publish leaks a match into the DB without Kafka subscribers
 * seeing it. v1.1 will replace this with a transactional outbox; for H-5
 * the webhook_deliveries queue + audit_log are the systems-of-record.
 */

import { generateUlid } from '@kmv/platform-shared/ulid';
import { appendAuditEntry } from '../../lib/auditWriter.js';
import {
  matchEventAgainstBriefings,
  type BriefingMatch,
} from '../../lib/matching/engine.js';
import {
  EVENT_BRIEFING_MATCHED,
  SCHEMA_VERSION,
  TOPIC_BRIEFING_EVENTS,
} from '../../lib/kafka/topics.js';
import { enqueueOutboxEntry } from '../../lib/kafka/outbox.js';
import type { KafkaProducerLike } from '../../lib/kafka/producer.js';
import type { Db } from '../../db/client.js';
import {
  enqueueWebhookDelivery,
  findEventByIdempotencyKey,
  insertBriefingMatch,
  insertEvent,
  listActiveBriefingsForEvent,
  markEventMatchStatus,
} from './repo.js';

export interface WebhookTargetResolver {
  /** Returns the configured webhook URL for `appId`, or null when none. */
  resolve(appId: string): string | null;
}

/**
 * Env-driven resolver: reads `HELPAN_WEBHOOK_URL_<APP_ID_UPPERCASED>` lazily
 * from process.env per call. Lazy reads make tests possible without
 * restarting the process; the env is read at call time, not at construction.
 */
export function createEnvWebhookTargetResolver(env: NodeJS.ProcessEnv): WebhookTargetResolver {
  return {
    resolve(appId) {
      const key = `HELPAN_WEBHOOK_URL_${appId.toUpperCase()}`;
      const url = env[key];
      return url && url.length > 0 ? url : null;
    },
  };
}

export interface IngestEventInput {
  eventType: string;
  appId: string;
  accountUuid?: string | null;
  payload: Record<string, unknown>;
  publishedAt?: Date;
  appCorrelationId?: string;
  idempotencyKey: string;
  requestId: string;
  traceparent?: string;
}

export interface IngestEventResult {
  readonly eventId: string;
  readonly acceptedAt: Date;
  readonly matchCount: number;
  /** True when the call replayed a prior idempotency-keyed insertion. */
  readonly replayed: boolean;
}

export interface IngestEventDeps {
  readonly db: Db;
  readonly kafka?: KafkaProducerLike;
  readonly webhookTargets: WebhookTargetResolver;
}

interface PreparedKafkaMessage {
  readonly key: string;
  readonly value: Record<string, unknown>;
}

const EVENT_ID_PREFIX = 'evt_';
const MATCH_ID_PREFIX = 'bmt_';
const WEBHOOK_DELIVERY_ID_PREFIX = 'whd_';

export async function ingestEvent(
  deps: IngestEventDeps,
  input: IngestEventInput
): Promise<IngestEventResult> {
  const publishedAt = input.publishedAt ?? new Date();
  let outboundMessages: PreparedKafkaMessage[] = [];

  // Single transaction: every match / audit / webhook row commits together.
  const result: IngestEventResult = await deps.db.transaction(async (tx) => {
    // Idempotency: if the same (app_id, key) already produced an event,
    // return that event's id with no further work. This is belt-and-braces
    // — the shared idempotency plugin replays the HTTP response — but it
    // also protects against TTL-window misses.
    const prior = await findEventByIdempotencyKey(tx, input.appId, input.idempotencyKey);
    if (prior) {
      return {
        eventId: prior.id,
        acceptedAt: prior.ingestedAt,
        matchCount: 0,
        replayed: true,
      };
    }

    const eventId = `${EVENT_ID_PREFIX}${generateUlid()}`;
    const inserted = await insertEvent(tx, {
      id: eventId,
      eventType: input.eventType,
      appId: input.appId,
      ...(input.accountUuid !== undefined ? { accountUuid: input.accountUuid } : {}),
      payload: input.payload,
      publishedAt,
      idempotencyKey: input.idempotencyKey,
      ...(input.appCorrelationId !== undefined
        ? { appCorrelationId: input.appCorrelationId }
        : {}),
    });

    const candidates = await listActiveBriefingsForEvent(tx, {
      appId: input.appId,
      accountUuid: input.accountUuid ?? null,
      now: new Date(),
    });
    const matches = matchEventAgainstBriefings(
      {
        id: eventId,
        eventType: input.eventType,
        appId: input.appId,
        accountUuid: input.accountUuid ?? null,
        payload: input.payload,
      },
      candidates
    );

    const targetUrl = deps.webhookTargets.resolve(input.appId);
    const traceparent = input.traceparent;
    const preparedKafka: PreparedKafkaMessage[] = [];

    for (const match of matches) {
      const occurredAt = new Date();
      const webhookDeliveryId = targetUrl
        ? `${WEBHOOK_DELIVERY_ID_PREFIX}${generateUlid()}`
        : null;
      // Payload shape per Event Bus Contract §2.1 BRIEFING_MATCHED.
      const briefingMatchedPayload: Record<string, unknown> = {
        event_id: eventId,
        event_type: EVENT_BRIEFING_MATCHED,
        schema_version: SCHEMA_VERSION,
        occurred_at: occurredAt.toISOString(),
        account_uuid: match.accountUuid,
        app_id: input.appId,
        briefing_id: match.briefingId,
        source_event_id: eventId,
        match_confidence: match.confidence,
        match_detail: match.detail,
        ...(traceparent ? { traceparent } : {}),
      };

      if (webhookDeliveryId && targetUrl) {
        await enqueueWebhookDelivery(tx, {
          id: webhookDeliveryId,
          appId: input.appId,
          eventType: EVENT_BRIEFING_MATCHED,
          eventId,
          payload: briefingMatchedPayload,
          targetUrl,
          scheduledAt: occurredAt,
        });
      }

      await insertBriefingMatch(tx, {
        id: `${MATCH_ID_PREFIX}${generateUlid()}`,
        briefingId: match.briefingId,
        eventId,
        accountUuid: match.accountUuid,
        matchConfidence: match.confidence,
        matchDetail: match.detail,
        webhookDeliveryId,
      });

      // H-17: enqueue BRIEFING_MATCHED inside the ingest tx — atomic with
      // the briefing_match row + audit entry. The H-5 `preparedKafka`
      // post-commit list still exists for backward compat with the test
      // harness but is now always empty (handed off to outbox here).
      await enqueueOutboxEntry(tx, {
        topic: TOPIC_BRIEFING_EVENTS,
        partitionKey: match.accountUuid,
        payload: briefingMatchedPayload,
      });
    }

    await markEventMatchStatus(tx, eventId, matches.length);

    await appendAuditEntry(tx, {
      actorType: 'system',
      actorId: `app:${input.appId}`,
      ...(input.accountUuid ? { accountUuid: input.accountUuid } : {}),
      action: 'event.ingested',
      resourceType: 'event',
      resourceId: eventId,
      appId: input.appId,
      requestId: input.requestId,
      ...(traceparent ? { traceparent } : {}),
      outcome: 'success',
      initiatedBy: 'system',
      detail: {
        event_type: input.eventType,
        match_count: matches.length,
        matched_briefings: matches.map((m: BriefingMatch) => m.briefingId),
        webhook_enqueued: targetUrl !== null,
      },
    });

    outboundMessages = preparedKafka;
    return {
      eventId,
      acceptedAt: inserted.ingestedAt,
      matchCount: matches.length,
      replayed: false,
    };
  });

  // H-17: post-commit publish removed. BRIEFING_MATCHED now enqueues to the
  // outbox inside the tx above; the drainer worker
  // (`src/workers/kafkaOutbox/`) publishes it. `outboundMessages` /
  // `preparedKafka` are vestigial; keeping the binding so the surrounding
  // return shape and ordering are visibly unchanged.

  return result;
}
