/**
 * Webhook delivery worker — drains pending rows + applies retry schedule.
 * Real Postgres; stub fetch to assert signature + handle controlled outcomes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';
import { processBatch, nextBackoffMs } from '../../src/workers/webhookDelivery/worker.js';

const HMAC_SECRET = 'webhook-test-secret-32-bytes-of-entropy_x';
const hasUrl = !!getTestDatabaseUrl();

interface FetchCall {
  readonly url: string;
  readonly body: string;
  readonly timestamp: string;
  readonly signature: string;
}

function makeStubFetch(handler: (call: FetchCall) => { status: number }): typeof fetch {
  return (async (url, init) => {
    const body = init?.body as string;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const timestamp = headers['x-helpan-timestamp'] ?? '';
    const signatureHeader = headers['x-helpan-signature'] ?? '';
    const call: FetchCall = {
      url: String(url),
      body,
      timestamp,
      signature: signatureHeader,
    };
    const { status } = handler(call);
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

async function enqueueWebhook(
  handle: RealDbHandle,
  args: {
    id: string;
    appId: string;
    eventId: string;
    payload: Record<string, unknown>;
    targetUrl: string;
    attemptCount?: number;
    nextAttemptAt?: Date;
  }
): Promise<void> {
  const nextAtIso = (args.nextAttemptAt ?? new Date()).toISOString();
  await handle.sql`
    INSERT INTO webhook_deliveries (
      id, app_id, event_type, event_id, payload, target_url,
      attempt_count, next_attempt_at, status
    ) VALUES (
      ${args.id},
      ${args.appId},
      'BRIEFING_MATCHED',
      ${args.eventId},
      ${JSON.stringify(args.payload)}::jsonb,
      ${args.targetUrl},
      ${args.attemptCount ?? 0},
      ${nextAtIso}::timestamptz,
      'pending'
    )
  `;
}

interface DeliveryStatusRow {
  status: string;
  attempt_count: number;
  delivered_at: Date | null;
  next_attempt_at: Date | null;
}

async function readDelivery(
  handle: RealDbHandle,
  id: string
): Promise<DeliveryStatusRow | undefined> {
  const rows = (await handle.sql`
    SELECT status, attempt_count, delivered_at, next_attempt_at
    FROM webhook_deliveries WHERE id = ${id}
  `) as unknown as DeliveryStatusRow[];
  return rows[0];
}

describe('nextBackoffMs (unit)', () => {
  it('schedules attempt 1 at +30s, attempt 7 at +12h', () => {
    expect(nextBackoffMs(1)).toBe(30_000);
    expect(nextBackoffMs(2)).toBe(60_000);
    expect(nextBackoffMs(3)).toBe(300_000);
    expect(nextBackoffMs(4)).toBe(900_000);
    expect(nextBackoffMs(5)).toBe(3_600_000);
    expect(nextBackoffMs(6)).toBe(14_400_000);
    expect(nextBackoffMs(7)).toBe(43_200_000);
  });

  it('returns null at attempt 8 (abandon)', () => {
    expect(nextBackoffMs(8)).toBeNull();
    expect(nextBackoffMs(99)).toBeNull();
  });
});

describe.skipIf(!hasUrl)('processBatch (real Postgres)', () => {
  let handle: RealDbHandle;

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
  });

  it('delivers a pending row, marks status=delivered, sets delivered_at', async () => {
    const id = `whd_${randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase()}`;
    await enqueueWebhook(handle, {
      id,
      appId: 'lunchdrop',
      eventId: 'evt_TESTEVENT0000000000000000',
      payload: { hello: 'world' },
      targetUrl: 'https://stub.example/webhooks',
    });

    const calls: FetchCall[] = [];
    const stubFetch = makeStubFetch((call) => {
      calls.push(call);
      return { status: 200 };
    });
    const result = await processBatch(
      { db: handle.sql, hmacSecret: HMAC_SECRET, fetch: stubFetch },
      { batchSize: 10 }
    );
    expect(result).toEqual({ attempted: 1, delivered: 1, abandoned: 0, rescheduled: 0 });

    const row = await readDelivery(handle, id);
    expect(row?.status).toBe('delivered');
    expect(row?.attempt_count).toBe(1);
    expect(row?.delivered_at).not.toBeNull();

    // Signature is sha256(secret, `${ts}\n${sha256(body)}`).
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    const expected = createHmac('sha256', HMAC_SECRET)
      .update(`${c.timestamp}\n${createHash('sha256').update(c.body, 'utf8').digest('hex')}`, 'utf8')
      .digest('hex');
    expect(c.signature).toBe(`sha256=${expected}`);
  });

  it('on non-2xx response: reschedules with backoff, increments attempt_count', async () => {
    const id = `whd_${randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase()}`;
    // Enqueue with a firmly-past next_attempt_at so it is claimable regardless
    // of wall-clock; `fixedNow` is a fixed reference strictly after it.
    await enqueueWebhook(handle, {
      id,
      appId: 'lunchdrop',
      eventId: 'evt_TESTEVENT0000000000000000',
      payload: {},
      targetUrl: 'https://stub.example/webhooks',
      nextAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const fixedNow = new Date('2026-06-01T10:00:00.000Z');
    const result = await processBatch(
      {
        db: handle.sql,
        hmacSecret: HMAC_SECRET,
        fetch: makeStubFetch(() => ({ status: 500 })),
        now: () => fixedNow,
      },
      { batchSize: 10 }
    );
    expect(result).toEqual({ attempted: 1, delivered: 0, abandoned: 0, rescheduled: 1 });

    const row = await readDelivery(handle, id);
    expect(row?.status).toBe('pending');
    expect(row?.attempt_count).toBe(1);
    const expectedNextMs = fixedNow.getTime() + 30_000;
    // postgres-js returns timestamptz as either Date or ISO string depending on
    // configuration; normalise here so the assertion doesn't depend on driver
    // tuning.
    const nextAt = row?.next_attempt_at;
    const nextAtMs =
      nextAt instanceof Date ? nextAt.getTime() : new Date(String(nextAt)).getTime();
    expect(nextAtMs).toBe(expectedNextMs);
  });

  it('abandons a row after MAX_ATTEMPTS failures', async () => {
    const id = `whd_${randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase()}`;
    // Seed with attempt_count=7 so the next failure tips to 8 → abandoned.
    await enqueueWebhook(handle, {
      id,
      appId: 'lunchdrop',
      eventId: 'evt_TESTEVENT0000000000000000',
      payload: {},
      targetUrl: 'https://stub.example/webhooks',
      attemptCount: 7,
    });
    const result = await processBatch(
      {
        db: handle.sql,
        hmacSecret: HMAC_SECRET,
        fetch: makeStubFetch(() => ({ status: 500 })),
      },
      { batchSize: 10 }
    );
    expect(result.abandoned).toBe(1);

    const row = await readDelivery(handle, id);
    expect(row?.status).toBe('abandoned');
    expect(row?.attempt_count).toBe(8);
  });

  it('skips rows whose next_attempt_at is in the future', async () => {
    const id = `whd_${randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase()}`;
    const future = new Date(Date.now() + 60_000);
    await enqueueWebhook(handle, {
      id,
      appId: 'lunchdrop',
      eventId: 'evt_TESTEVENT0000000000000000',
      payload: {},
      targetUrl: 'https://stub.example/webhooks',
      nextAttemptAt: future,
    });
    const result = await processBatch(
      {
        db: handle.sql,
        hmacSecret: HMAC_SECRET,
        fetch: makeStubFetch(() => ({ status: 200 })),
      },
      { batchSize: 10 }
    );
    expect(result.attempted).toBe(0);
  });

  it('treats network failures as a delivery miss (reschedules, not abandons)', async () => {
    const id = `whd_${randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase()}`;
    await enqueueWebhook(handle, {
      id,
      appId: 'lunchdrop',
      eventId: 'evt_TESTEVENT0000000000000000',
      payload: {},
      targetUrl: 'https://stub.example/webhooks',
    });
    const throwingFetch = (async () => {
      throw new Error('econnreset');
    }) as unknown as typeof fetch;
    const result = await processBatch(
      { db: handle.sql, hmacSecret: HMAC_SECRET, fetch: throwingFetch },
      { batchSize: 10 }
    );
    expect(result.rescheduled).toBe(1);
    expect(result.delivered).toBe(0);
    const row = await readDelivery(handle, id);
    expect(row?.status).toBe('pending');
    expect(row?.attempt_count).toBe(1);
  });
});
