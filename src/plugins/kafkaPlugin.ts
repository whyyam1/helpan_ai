/**
 * Fastify plugin: decorates `app.kafka` with the rail's producer.
 *
 * The producer is supplied by the caller (either a kafkajs producer in
 * production via `createKafkajsProducer(...)`, or an in-memory stub in
 * tests). The plugin owns its lifecycle — `connect()` at registration,
 * `disconnect()` on `onClose`.
 *
 * Plugin is optional: if no producer is supplied, `app.kafka` is undefined
 * and callers that need it must handle that explicitly. H-5's matching
 * engine throws a clear error if `app.kafka` is missing; this prevents
 * silent loss of BRIEFING_MATCHED publishes.
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { KafkaProducerLike } from '../lib/kafka/producer.js';

declare module 'fastify' {
  interface FastifyInstance {
    kafka?: KafkaProducerLike;
  }
}

export interface KafkaPluginConfig {
  readonly producer: KafkaProducerLike;
}

const kafkaPluginImpl: FastifyPluginAsync<KafkaPluginConfig> = async (fastify, config) => {
  await config.producer.connect();
  fastify.decorate('kafka', config.producer);
  fastify.addHook('onClose', async () => {
    await config.producer.disconnect();
  });
};

export const kafkaPlugin = fp(kafkaPluginImpl, {
  name: 'helpan-ai/kafka',
  fastify: '4.x',
});
