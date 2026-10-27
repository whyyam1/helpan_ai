/**
 * Kafka connection security — SASL + TLS for managed brokers.
 *
 * Managed Kafka (Upstash, Confluent Cloud, Aiven, Redpanda Cloud) requires
 * SASL over TLS; a bare `brokers` list only reaches a local/unauthenticated
 * broker. One env-driven parser shared by the web process (via loadConfig)
 * and the cascade / outbox workers (which read process.env directly):
 *
 *   KAFKA_SASL_MECHANISM  plain | scram-sha-256 | scram-sha-512 (unset → no SASL)
 *   KAFKA_SASL_USERNAME   required when a mechanism is set
 *   KAFKA_SASL_PASSWORD   required when a mechanism is set
 *   KAFKA_SSL             true | false — defaults to true when SASL is set,
 *                         false otherwise (SASL credentials never go in clear)
 *
 * Partial config throws, so a half-pasted Railway variable set fails loud at
 * boot instead of silently connecting unauthenticated.
 */

import type { KafkaConfig, SASLOptions } from 'kafkajs';

export type KafkaSaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';

export interface KafkaAuth {
  readonly ssl: boolean;
  readonly sasl?: {
    readonly mechanism: KafkaSaslMechanism;
    readonly username: string;
    readonly password: string;
  };
}

const MECHANISMS: readonly KafkaSaslMechanism[] = ['plain', 'scram-sha-256', 'scram-sha-512'];

export function parseKafkaAuth(env: Readonly<Record<string, string | undefined>>): KafkaAuth {
  const mechanismRaw = env['KAFKA_SASL_MECHANISM']?.trim().toLowerCase() || undefined;
  const username = env['KAFKA_SASL_USERNAME'] || undefined;
  const password = env['KAFKA_SASL_PASSWORD'] || undefined;
  const sslRaw = env['KAFKA_SSL']?.trim().toLowerCase() || undefined;

  if (sslRaw !== undefined && sslRaw !== 'true' && sslRaw !== 'false') {
    throw new Error(`KAFKA_SSL must be "true" or "false"; got "${sslRaw}"`);
  }

  if (mechanismRaw === undefined) {
    if (username || password) {
      throw new Error(
        'KAFKA_SASL_USERNAME / KAFKA_SASL_PASSWORD are set but KAFKA_SASL_MECHANISM is not'
      );
    }
    return { ssl: sslRaw === 'true' };
  }

  if (!MECHANISMS.includes(mechanismRaw as KafkaSaslMechanism)) {
    throw new Error(
      `KAFKA_SASL_MECHANISM must be one of ${MECHANISMS.join(' | ')}; got "${mechanismRaw}"`
    );
  }
  if (!username || !password) {
    throw new Error(
      'KAFKA_SASL_MECHANISM is set — KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are both required'
    );
  }
  return {
    ssl: sslRaw === undefined ? true : sslRaw === 'true',
    sasl: { mechanism: mechanismRaw as KafkaSaslMechanism, username, password },
  };
}

/** The `ssl` / `sasl` slice of a kafkajs `KafkaConfig`. */
export function toKafkajsAuth(auth: KafkaAuth | undefined): Pick<KafkaConfig, 'ssl' | 'sasl'> {
  if (!auth) return {};
  return {
    ...(auth.ssl ? { ssl: true } : {}),
    ...(auth.sasl ? { sasl: { ...auth.sasl } as SASLOptions } : {}),
  };
}
