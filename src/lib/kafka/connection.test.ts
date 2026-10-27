/**
 * Unit tests for the Kafka SASL / TLS env parser.
 */

import { describe, expect, it } from 'vitest';
import { parseKafkaAuth, toKafkajsAuth } from './connection.js';

describe('parseKafkaAuth', () => {
  it('no vars → plaintext, no SASL (local broker)', () => {
    expect(parseKafkaAuth({})).toEqual({ ssl: false });
  });

  it('KAFKA_SSL=true alone → TLS without SASL', () => {
    expect(parseKafkaAuth({ KAFKA_SSL: 'true' })).toEqual({ ssl: true });
  });

  it('SASL set → TLS defaults on', () => {
    expect(
      parseKafkaAuth({
        KAFKA_SASL_MECHANISM: 'SCRAM-SHA-256',
        KAFKA_SASL_USERNAME: 'u',
        KAFKA_SASL_PASSWORD: 'p',
      })
    ).toEqual({ ssl: true, sasl: { mechanism: 'scram-sha-256', username: 'u', password: 'p' } });
  });

  it('SASL with explicit KAFKA_SSL=false is honoured', () => {
    expect(
      parseKafkaAuth({
        KAFKA_SASL_MECHANISM: 'plain',
        KAFKA_SASL_USERNAME: 'u',
        KAFKA_SASL_PASSWORD: 'p',
        KAFKA_SSL: 'false',
      }).ssl
    ).toBe(false);
  });

  it('rejects an unknown mechanism', () => {
    expect(() =>
      parseKafkaAuth({
        KAFKA_SASL_MECHANISM: 'oauthbearer',
        KAFKA_SASL_USERNAME: 'u',
        KAFKA_SASL_PASSWORD: 'p',
      })
    ).toThrow(/KAFKA_SASL_MECHANISM/);
  });

  it('rejects a mechanism without credentials', () => {
    expect(() =>
      parseKafkaAuth({ KAFKA_SASL_MECHANISM: 'plain', KAFKA_SASL_USERNAME: 'u' })
    ).toThrow(/both required/);
  });

  it('rejects credentials without a mechanism', () => {
    expect(() => parseKafkaAuth({ KAFKA_SASL_PASSWORD: 'p' })).toThrow(/MECHANISM is not/);
  });

  it('rejects a non-boolean KAFKA_SSL', () => {
    expect(() => parseKafkaAuth({ KAFKA_SSL: 'yes' })).toThrow(/KAFKA_SSL/);
  });
});

describe('toKafkajsAuth', () => {
  it('maps to the kafkajs ssl / sasl slice', () => {
    expect(
      toKafkajsAuth({ ssl: true, sasl: { mechanism: 'plain', username: 'u', password: 'p' } })
    ).toEqual({ ssl: true, sasl: { mechanism: 'plain', username: 'u', password: 'p' } });
    expect(toKafkajsAuth({ ssl: false })).toEqual({});
    expect(toKafkajsAuth(undefined)).toEqual({});
  });
});
