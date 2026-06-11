/**
 * Kafka outbox integration tests (H-17). Closes RECAP §6.7.
 *
 * Real Postgres. Verifies the contract:
 *   - enqueueOutboxEntry inserts a pending row inside the caller's tx
 *   - drainOutboxOnce publishes via the injected producer + marks delivered
 *   - publish failure → markFailed + exponential backoff
 *   - after MAX_OUTBOX_ATTEMPTS the row is marked abandoned
 *   - FOR UPDATE SKIP LOCKED claims a row exactly once across replicas
 *     (single-process proxy: two concurrent drainOutboxOnce calls see
 *     disjoint sets)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  enqueueOutboxEntry,
  drainOutboxOnce,
  countOutboxByStatus,
  MAX_OUTBOX_ATTEMPTS,
} from '../../src/lib/kafka/outbox.js';
import { createInMemoryProducer } from '../../src/lib/kafka/producer.js';
import type { KafkaProducerLike } from '../../src/lib/kafka/producer.js';
import {
  getTestDatabaseUrl,
  resetTestData,
  withRealDb,
  type RealDbHandle,
} from '../helpers/testDb.js';

const hasUrl = !!getTestDatabaseUrl();

describe.skipIf(!hasUrl)('kafka_outbox (real Postgres)', () => {
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

  it('enqueueOutboxEntry persists a pending row with status=pending, attempts=0', async () => {
    await handle.db.transaction(async (tx) => {
      await enqueueOutboxEntry(tx as never, {
        topic: 'helpan.test.events',
        partitionKey: 'acc_test',
        payload: { event_type: 'TEST', n: 1 },
      });
    });
    const counts = await countOutboxByStatus(handle.db);
    expect(counts.pending).toBe(1);
    expect(counts.delivered).toBe(0);
    expect(counts.abandoned).toBe(0);
  });

  it('drainOutboxOnce publishes a pending row and marks it delivered', async () => {
    await handle.db.transaction(async (tx) => {
      await enqueueOutboxEntry(tx as never, {
        topic: 'helpan.test.events',
        partitionKey: 'acc_a',
        payload: { event_type: 'TEST', n: 1 },
      });
    });
    const producer = createInMemoryProducer();
    const result = await drainOutboxOnce(handle.db, producer, { batchSize: 10 });
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.abandoned).toBe(0);
    expect(producer.published).toHaveLength(1);
    expect(producer.published[0]?.topic).toBe('helpan.test.events');
    expect(producer.published[0]?.key).toBe('acc_a');
    expect(producer.published[0]?.value).toMatchObject({ event_type: 'TEST', n: 1 });
    const counts = await countOutboxByStatus(handle.db);
    expect(counts.pending).toBe(0);
    expect(counts.delivered).toBe(1);
  });

  it('failed publish bumps attempts + schedules backoff; does not mark abandoned yet', async () => {
    await handle.db.transaction(async (tx) => {
      await enqueueOutboxEntry(tx as never, {
        topic: 'helpan.test.events',
        partitionKey: 'acc_a',
        payload: { event_type: 'TEST' },
      });
    });
    const failingProducer: KafkaProducerLike = {
      async publish() {
        throw new Error('broker unreachable');
      },
      async connect() {},
      async disconnect() {},
    };
    const result = await drainOutboxOnce(handle.db, failingProducer, { batchSize: 10 });
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.abandoned).toBe(0);
    const counts = await countOutboxByStatus(handle.db);
    expect(counts.pending).toBe(1);
    expect(counts.delivered).toBe(0);
    expect(counts.abandoned).toBe(0);

    // Inspect the row — attempts=1, next_attempt_at in the future, last_error set
    const row = (await handle.sql`
      SELECT attempts, next_attempt_at > NOW() AS retry_scheduled, last_error
      FROM kafka_outbox
    `) as unknown as readonly { attempts: number; retry_scheduled: boolean; last_error: string }[];
    expect(row[0]!.attempts).toBe(1);
    expect(row[0]!.retry_scheduled).toBe(true);
    expect(row[0]!.last_error).toContain('broker unreachable');
  });

  it('after MAX_OUTBOX_ATTEMPTS failures the row is marked abandoned', async () => {
    // Manually seed a row with attempts=MAX_OUTBOX_ATTEMPTS-1 so a single
    // failure tips it to abandoned. Avoids the 7-tick test runtime.
    await handle.sql`
      INSERT INTO kafka_outbox (id, topic, partition_key, payload, status, attempts, next_attempt_at)
      VALUES (
        'kof_pre_abandoned',
        'helpan.test.events',
        'acc_a',
        '{"event_type":"TEST"}'::jsonb,
        'pending',
        ${MAX_OUTBOX_ATTEMPTS - 1},
        NOW() - interval '1 second'
      )
    `;
    const failingProducer: KafkaProducerLike = {
      async publish() {
        throw new Error('still failing');
      },
      async connect() {},
      async disconnect() {},
    };
    const result = await drainOutboxOnce(handle.db, failingProducer, { batchSize: 10 });
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.abandoned).toBe(1);
    const counts = await countOutboxByStatus(handle.db);
    expect(counts.abandoned).toBe(1);
  });

  it('drainOutboxOnce ignores rows whose next_attempt_at is in the future', async () => {
    await handle.sql`
      INSERT INTO kafka_outbox (id, topic, partition_key, payload, status, attempts, next_attempt_at)
      VALUES (
        'kof_not_yet',
        'helpan.test.events',
        'acc_a',
        '{"event_type":"TEST"}'::jsonb,
        'pending',
        2,
        NOW() + interval '5 minutes'
      )
    `;
    const producer = createInMemoryProducer();
    const result = await drainOutboxOnce(handle.db, producer, { batchSize: 10 });
    expect(result.delivered).toBe(0);
    expect(producer.published).toHaveLength(0);
  });

  it('batchSize bounds the per-tick drain', async () => {
    for (let i = 0; i < 5; i++) {
      await handle.db.transaction(async (tx) => {
        await enqueueOutboxEntry(tx as never, {
          topic: 'helpan.test.events',
          partitionKey: `acc_${i}`,
          payload: { event_type: 'TEST', n: i },
        });
      });
    }
    const producer = createInMemoryProducer();
    const result = await drainOutboxOnce(handle.db, producer, { batchSize: 3 });
    expect(result.delivered).toBe(3);
    expect(producer.published).toHaveLength(3);
    const counts = await countOutboxByStatus(handle.db);
    expect(counts.pending).toBe(2);
    expect(counts.delivered).toBe(3);
  });

  it('concurrent drains see disjoint sets (FOR UPDATE SKIP LOCKED proxy)', async () => {
    // Enqueue 6 rows. Two parallel drains with batch=10 each. The combined
    // delivered count is exactly 6 (no double-publish) and no row stays
    // pending. The locks serialise the claim step, so the two drainers see
    // either {6, 0} or {3, 3} depending on timing — both shapes are valid.
    for (let i = 0; i < 6; i++) {
      await handle.db.transaction(async (tx) => {
        await enqueueOutboxEntry(tx as never, {
          topic: 'helpan.test.events',
          partitionKey: `acc_${i}`,
          payload: { event_type: 'TEST', n: i },
        });
      });
    }
    const producerA = createInMemoryProducer();
    const producerB = createInMemoryProducer();
    const [a, b] = await Promise.all([
      drainOutboxOnce(handle.db, producerA, { batchSize: 10 }),
      drainOutboxOnce(handle.db, producerB, { batchSize: 10 }),
    ]);
    expect(a.delivered + b.delivered).toBe(6);
    expect(producerA.published.length + producerB.published.length).toBe(6);
    const counts = await countOutboxByStatus(handle.db);
    expect(counts.pending).toBe(0);
    expect(counts.delivered).toBe(6);
  });
});
