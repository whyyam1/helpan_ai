/**
 * Unit tests for env.ts. Each test mutates and restores process.env around
 * a resetConfigForTests() call so the cached module state does not leak.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resetConfigForTests } from './env.js';

const ORIGINAL_ENV = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL_ENV };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'debug',
  PORT: '3040',
  SERVICE_VERSION: '0.1.0',
  DATABASE_URL: 'postgres://u:p@localhost:5432/helpan',
  AUTH_RAIL_PREFIX: 'Helpan',
  AUTH_TIMESTAMP_HEADER: 'x-helpan-timestamp',
  AUTH_TIMESTAMP_TOLERANCE_SECONDS: '300',
  IDEMPOTENCY_TTL_SECONDS: '86400',
  SECRETS_ENVELOPE_PROVIDER: 'noop',
  IDENTITI_JWKS_URL: 'https://api.identiti.co.ke/.well-known/jwks.json',
  IDENTITI_JWT_ISSUER: 'https://api.identiti.co.ke',
  HELPAN_JWT_AUDIENCE: 'https://api.helpan.co.ke',
};

describe('loadConfig', () => {
  beforeEach(() => {
    resetConfigForTests();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetConfigForTests();
  });

  it('loads a valid config and freezes it', () => {
    withEnv(VALID_ENV);
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe('test');
    expect(cfg.port).toBe(3040);
    expect(cfg.auth.railPrefix).toBe('Helpan');
    expect(cfg.auth.toleranceSeconds).toBe(300);
    expect(cfg.idempotency.ttlSeconds).toBe(86400);
    expect(cfg.secrets.envelopeProvider).toBe('noop');
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('returns the cached object on second call', () => {
    withEnv(VALID_ENV);
    const a = loadConfig();
    const b = loadConfig();
    expect(a).toBe(b);
  });

  it('throws on missing DATABASE_URL', () => {
    withEnv({ ...VALID_ENV, DATABASE_URL: undefined });
    expect(() => loadConfig()).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-helpan rail prefix', () => {
    withEnv({ ...VALID_ENV, AUTH_RAIL_PREFIX: 'kipkiren' });
    expect(() => loadConfig()).toThrow(/AUTH_RAIL_PREFIX must be 'Helpan'/);
  });

  it('rejects PORT out of range', () => {
    withEnv({ ...VALID_ENV, PORT: '99999' });
    expect(() => loadConfig()).toThrow(/PORT/);
  });

  it('rejects non-integer tolerance', () => {
    withEnv({ ...VALID_ENV, AUTH_TIMESTAMP_TOLERANCE_SECONDS: 'soon' });
    expect(() => loadConfig()).toThrow(/AUTH_TIMESTAMP_TOLERANCE_SECONDS/);
  });

  it('rejects unknown envelope provider', () => {
    withEnv({ ...VALID_ENV, SECRETS_ENVELOPE_PROVIDER: 'aes' });
    expect(() => loadConfig()).toThrow(/SECRETS_ENVELOPE_PROVIDER/);
  });

  it('exposes Identiti JWKS + issuer and Helpan audience', () => {
    withEnv(VALID_ENV);
    const cfg = loadConfig();
    expect(cfg.identiti.jwksUrl).toBe('https://api.identiti.co.ke/.well-known/jwks.json');
    expect(cfg.identiti.issuer).toBe('https://api.identiti.co.ke');
    expect(cfg.helpan.jwtAudience).toBe('https://api.helpan.co.ke');
  });

  it('throws on missing IDENTITI_JWKS_URL', () => {
    withEnv({ ...VALID_ENV, IDENTITI_JWKS_URL: undefined });
    expect(() => loadConfig()).toThrow(/IDENTITI_JWKS_URL/);
  });

  it('rejects a non-URL IDENTITI_JWKS_URL', () => {
    withEnv({ ...VALID_ENV, IDENTITI_JWKS_URL: 'not-a-url' });
    expect(() => loadConfig()).toThrow(/IDENTITI_JWKS_URL/);
  });

  it('throws on missing HELPAN_JWT_AUDIENCE', () => {
    withEnv({ ...VALID_ENV, HELPAN_JWT_AUDIENCE: undefined });
    expect(() => loadConfig()).toThrow(/HELPAN_JWT_AUDIENCE/);
  });

  it('parses an empty KAFKA_BROKERS as no brokers (Kafka skipped at boot)', () => {
    withEnv({ ...VALID_ENV, KAFKA_BROKERS: undefined });
    expect(loadConfig().kafka.brokers).toEqual([]);
  });

  it('parses comma-separated KAFKA_BROKERS into an array', () => {
    withEnv({ ...VALID_ENV, KAFKA_BROKERS: 'broker1:9092,broker2:9092 , broker3:9092' });
    expect(loadConfig().kafka.brokers).toEqual([
      'broker1:9092',
      'broker2:9092',
      'broker3:9092',
    ]);
  });

  it('defaults KAFKA_CLIENT_ID to helpan-ai-rail', () => {
    withEnv({ ...VALID_ENV, KAFKA_CLIENT_ID: undefined });
    expect(loadConfig().kafka.clientId).toBe('helpan-ai-rail');
  });
});
