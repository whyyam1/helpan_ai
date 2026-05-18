/**
 * Cascade-revocation worker — Railway entrypoint.
 *
 *   npm run worker:cascade
 *
 * Consumes Identiti's `identiti.account.events` topic and auto-revokes
 * delegated authorities when an account is suspended or KYC-downgraded
 * (see cascade.ts). Publishes `AUTHORITY_REVOKED` per revoked authority so
 * relying parties evict their validate caches.
 *
 * Consumer group: `helpan.identiti.account.events.consumer` (Event Bus
 * Contract §1 naming). Offsets are managed by the Kafka consumer group.
 *
 * SIGTERM-aware: stops the consumer, closes the producer + DB, exits 0.
 *
 * Configuration (env):
 *   DATABASE_URL         — required
 *   KAFKA_BROKERS        — required (comma-separated); without it there is
 *                          nothing to consume and the worker exits 1
 *   KAFKA_CLIENT_ID      — optional, default 'helpan-ai-cascade'
 */

import { Kafka, logLevel } from 'kafkajs';
import { createDbClient } from '../../db/client.js';
import { createKafkajsProducer } from '../../lib/kafka/producer.js';
import { generateUlid } from '@kmv/platform-shared/ulid';
import { handleAccountEvent, type AccountEvent } from './cascade.js';

const TOPIC_IDENTITI_ACCOUNT_EVENTS = 'identiti.account.events';
const CONSUMER_GROUP = 'helpan.identiti.account.events.consumer';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[cascade-worker] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = envRequired('DATABASE_URL');
  const brokers = (process.env['KAFKA_BROKERS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (brokers.length === 0) {
    console.error('[cascade-worker] KAFKA_BROKERS is empty — nothing to consume');
    process.exit(1);
  }
  const clientId = process.env['KAFKA_CLIENT_ID'] ?? 'helpan-ai-cascade';

  const { sql, db } = createDbClient({ connectionString: databaseUrl });
  const producer = createKafkajsProducer({ clientId, brokers });
  await producer.connect();

  const kafka = new Kafka({ clientId, brokers, logLevel: logLevel.WARN });
  const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC_IDENTITI_ACCOUNT_EVENTS, fromBeginning: false });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.warn(`[cascade-worker] ${signal} — draining`);
    try {
      await consumer.disconnect();
      await producer.disconnect();
      await sql.end({ timeout: 5 });
    } finally {
      console.warn('[cascade-worker] shutdown complete');
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.warn(`[cascade-worker] consuming ${TOPIC_IDENTITI_ACCOUNT_EVENTS} as ${CONSUMER_GROUP}`);
  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString('utf8');
      if (!raw) return;
      let event: AccountEvent;
      try {
        event = JSON.parse(raw) as AccountEvent;
      } catch (err) {
        // A malformed event is logged and skipped — the offset still
        // advances so one bad message doesn't wedge the partition.
        console.error('[cascade-worker] unparseable event, skipping', (err as Error).message);
        return;
      }
      try {
        const result = await handleAccountEvent({ db, kafka: producer }, event, generateUlid());
        if (result.revoked > 0) {
          console.warn(
            `[cascade-worker] ${result.trigger}: revoked ${result.revoked} authority(ies) for ${result.accountUuid}`
          );
        }
      } catch (err) {
        // Re-throw so kafkajs does not commit the offset — the message is
        // redelivered. handleAccountEvent is idempotent, so a retry is safe.
        console.error('[cascade-worker] cascade failed, will retry', (err as Error).message);
        throw err;
      }
    },
  });
}

main().catch((err) => {
  console.error('[cascade-worker] fatal', err);
  process.exit(1);
});
