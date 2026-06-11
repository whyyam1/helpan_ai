/**
 * End-to-end ingest pipeline against real Postgres.
 *
 * Covers:
 *   - POST /v1/events/ingest happy path (no matching briefing)
 *   - Match against an active briefing → briefing_matches row,
 *     webhook_deliveries row, BRIEFING_MATCHED Kafka publish, audit_log
 *     entry chained from the H-2 genesis row.
 *   - Idempotency replay (within shared-plugin TTL window).
 *   - AJV rejection on a malformed body.
 *   - X-Idempotency-Key required (shared plugin behaviour, sanity check).
 *   - Webhook NOT enqueued when no URL is configured for the publishing app.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  hmacHeaders,
  makeWebhookTargetResolver,
  TEST_APP_ID,
} from '../helpers/testApp.js';
import {
  buildIntegrationApp,
  countAuditEntries,
  drainTestOutbox,
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';
import {
  generateTestKeypair,
  signCustomerToken,
  type TestJwksKeypair,
} from '../helpers/testJwks.js';
import { createInMemoryProducer, type InMemoryProducer } from '../../src/lib/kafka/producer.js';

const ACCOUNT_A = 'acc_00000000-0000-0000-0000-000000000001';
const WEBHOOK_URL = 'https://lunchdrop.example/webhooks/helpan';

function randomUuidV4(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function seedActiveBriefing(
  app: FastifyInstance,
  keypair: TestJwksKeypair,
  intent: Record<string, unknown>
): Promise<string> {
  const token = await signCustomerToken({ keypair, sub: ACCOUNT_A });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/briefings',
    headers: {
      authorization: `Bearer ${token}`,
      'x-app-id': TEST_APP_ID,
      'content-type': 'application/json',
      'x-idempotency-key': randomUuidV4(),
    },
    payload: {
      account_uuid: ACCOUNT_A,
      app_id: TEST_APP_ID,
      briefing_type: 'alert',
      intent,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`seedActiveBriefing: expected 201, got ${res.statusCode}: ${res.body}`);
  }
  return res.json().data.id as string;
}

const hasUrl = !!getTestDatabaseUrl();

describe.skipIf(!hasUrl)('POST /v1/events/ingest (real Postgres)', () => {
  let handle: RealDbHandle;
  let app: FastifyInstance;
  let kafka: InMemoryProducer;
  let keypair: TestJwksKeypair;

  beforeAll(async () => {
    const h = await withRealDb();
    if (!h) throw new Error('TEST_DATABASE_URL set but withRealDb returned null');
    handle = h;
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await resetTestData(handle.sql);
    keypair = generateTestKeypair();
    kafka = createInMemoryProducer();
    ({ app } = await buildIntegrationApp({
      handle,
      keypair,
      kafkaProducer: kafka,
      webhookTargets: makeWebhookTargetResolver({ [TEST_APP_ID]: WEBHOOK_URL }),
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 202 with evt_<ULID> for a no-match ingest', async () => {
    const body = JSON.stringify({
      event_type: 'lunchdrop.zone_feed.broadcast',
      app_id: TEST_APP_ID,
      payload: { merchant_id: 'mer_xyz' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/events/ingest', body }),
        'x-idempotency-key': randomUuidV4(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.data.event_id).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(json.data.match_count).toBe(0);
    await drainTestOutbox(handle, kafka);
    expect(kafka.published).toHaveLength(0);

    // No matches → no webhook row enqueued.
    const rows = (await handle.sql`SELECT count(*)::int AS n FROM webhook_deliveries`) as unknown as {
      n: number;
    }[];
    expect(rows[0]?.n).toBe(0);
  });

  it('on match: writes briefing_match + webhook_delivery + audit + publishes BRIEFING_MATCHED to Kafka', async () => {
    const briefingId = await seedActiveBriefing(app, keypair, {
      match: { merchant_id: 'mer_abc', cuisine: 'mama' },
    });

    const body = JSON.stringify({
      event_type: 'lunchdrop.zone_feed.broadcast',
      app_id: TEST_APP_ID,
      account_uuid: ACCOUNT_A,
      payload: { merchant_id: 'mer_abc', cuisine: 'mama', extra: 'ignored' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/events/ingest', body }),
        'x-idempotency-key': randomUuidV4(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.match_count).toBe(1);

    // briefing_matches row written
    const matches = (await handle.sql`
      SELECT briefing_id, account_uuid, match_confidence, webhook_delivery_id
      FROM briefing_matches
    `) as unknown as {
      briefing_id: string;
      account_uuid: string;
      match_confidence: string;
      webhook_delivery_id: string | null;
    }[];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.briefing_id).toBe(briefingId);
    expect(matches[0]?.match_confidence).toBe('high');
    expect(matches[0]?.webhook_delivery_id).toMatch(/^whd_[0-9A-HJKMNP-TV-Z]{26}$/);

    // webhook_deliveries row pending
    const webhooks = (await handle.sql`
      SELECT id, app_id, event_type, target_url, status, attempt_count
      FROM webhook_deliveries
    `) as unknown as {
      id: string;
      app_id: string;
      event_type: string;
      target_url: string;
      status: string;
      attempt_count: number;
    }[];
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0]?.target_url).toBe(WEBHOOK_URL);
    expect(webhooks[0]?.status).toBe('pending');
    expect(webhooks[0]?.attempt_count).toBe(0);

    // Kafka publish captured (H-17: drained from outbox)
    await drainTestOutbox(handle, kafka);
    expect(kafka.published).toHaveLength(1);
    expect(kafka.published[0]?.topic).toBe('helpan.briefing.events');
    expect(kafka.published[0]?.key).toBe(ACCOUNT_A);
    expect(kafka.published[0]?.value).toMatchObject({
      event_type: 'BRIEFING_MATCHED',
      schema_version: '1.0',
      account_uuid: ACCOUNT_A,
      briefing_id: briefingId,
      match_confidence: 'high',
    });

    // Audit entry appended
    expect(await countAuditEntries(handle)).toBe(2); // briefing.create (seed) + event.ingested
  });

  it('does not enqueue a webhook when no URL is configured for the publishing app', async () => {
    await app.close();
    // Rebuild with no webhook URLs configured at all.
    ({ app } = await buildIntegrationApp({
      handle,
      keypair,
      kafkaProducer: kafka,
      webhookTargets: makeWebhookTargetResolver({}),
    }));

    await seedActiveBriefing(app, keypair, { match: { merchant_id: 'mer_abc' } });

    const body = JSON.stringify({
      event_type: 'lunchdrop.zone_feed.broadcast',
      app_id: TEST_APP_ID,
      account_uuid: ACCOUNT_A,
      payload: { merchant_id: 'mer_abc' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/events/ingest', body }),
        'x-idempotency-key': randomUuidV4(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.match_count).toBe(1);

    // Briefing match is recorded but no webhook row.
    const webhookCount = (await handle.sql`SELECT count(*)::int AS n FROM webhook_deliveries`) as unknown as {
      n: number;
    }[];
    expect(webhookCount[0]?.n).toBe(0);
    // Kafka publish still fires (H-17: drained from outbox).
    await drainTestOutbox(handle, kafka);
    expect(kafka.published).toHaveLength(1);
  });

  it('idempotency replay: same X-Idempotency-Key returns the cached response, no second insert', async () => {
    const idemKey = randomUuidV4();
    const body = JSON.stringify({
      event_type: 'lunchdrop.zone_feed.broadcast',
      app_id: TEST_APP_ID,
      payload: { merchant_id: 'mer_replay' },
    });
    const first = await app.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/events/ingest', body }),
        'x-idempotency-key': idemKey,
      },
      payload: body,
    });
    expect(first.statusCode).toBe(202);
    const firstId = first.json().data.event_id as string;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/events/ingest', body }),
        'x-idempotency-key': idemKey,
      },
      payload: body,
    });
    expect(second.statusCode).toBe(202);
    expect(second.headers['x-idempotency-replayed']).toBe('true');
    expect(second.json().data.event_id).toBe(firstId);

    const rows = (await handle.sql`SELECT count(*)::int AS n FROM events_ingested`) as unknown as {
      n: number;
    }[];
    expect(rows[0]?.n).toBe(1);
  });

  it('rejects POST without X-Idempotency-Key with REQ_IDEMPOTENCY_KEY_MISSING (400)', async () => {
    const body = JSON.stringify({
      event_type: 'lunchdrop.zone_feed.broadcast',
      app_id: TEST_APP_ID,
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      headers: hmacHeaders({ method: 'POST', url: '/v1/events/ingest', body }),
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_IDEMPOTENCY_KEY_MISSING');
  });

  it('AJV rejection: missing required `app_id` returns 400 REQ_INVALID', async () => {
    const body = JSON.stringify({
      event_type: 'lunchdrop.zone_feed.broadcast',
      // app_id omitted
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events/ingest',
      headers: {
        ...hmacHeaders({ method: 'POST', url: '/v1/events/ingest', body }),
        'x-idempotency-key': randomUuidV4(),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REQ_INVALID');
  });
});
