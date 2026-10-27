import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  createSecretsEnvelope,
  isWrappedUnderKey,
  parseEnvelopeOptions,
} from './secretsEnvelope.js';

const keyA = { id: 'k2026a', keyB64: randomBytes(32).toString('base64') };
const keyB = { id: 'k2026b', keyB64: randomBytes(32).toString('base64') };

describe('secretsEnvelope (noop)', () => {
  const env = createSecretsEnvelope('noop');

  it('round-trips plaintext through encrypt/decrypt', async () => {
    const wrapped = await env.encrypt('hunter2');
    expect(wrapped.startsWith('envelope:noop:v1:')).toBe(true);
    const unwrapped = await env.decrypt(wrapped);
    expect(unwrapped).toBe('hunter2');
  });

  it('tolerates bare plaintext (seed-fixture compatibility)', async () => {
    const unwrapped = await env.decrypt('seeded-secret');
    expect(unwrapped).toBe('seeded-secret');
  });

  it('refuses an aes-gcm blob instead of returning ciphertext as the secret', async () => {
    const blob = await createSecretsEnvelope('aes-gcm', { key: keyA }).encrypt('s');
    await expect(env.decrypt(blob)).rejects.toThrow(/aes-gcm/);
  });

  it('throws on unimplemented providers', () => {
    expect(() => createSecretsEnvelope('kms')).toThrow(/not implemented yet/);
    expect(() => createSecretsEnvelope('supabase-vault')).toThrow(/not implemented yet/);
  });
});

describe('secretsEnvelope (aes-gcm)', () => {
  const env = createSecretsEnvelope('aes-gcm', { key: keyA });

  it('round-trips, never stores plaintext, and uses a fresh IV per call', async () => {
    const secret = 'f'.repeat(64);
    const a = await env.encrypt(secret);
    const b = await env.encrypt(secret);
    expect(a.startsWith('secret:aes-gcm:v1:k2026a:')).toBe(true);
    expect(a).not.toContain(secret);
    expect(a).not.toBe(b);
    expect(await env.decrypt(a)).toBe(secret);
    expect(isWrappedUnderKey(a, 'k2026a')).toBe(true);
    expect(isWrappedUnderKey(a, 'k2026b')).toBe(false);
  });

  it('reads existing noop blobs (in-place migration path)', async () => {
    expect(await env.decrypt('envelope:noop:v1:legacy')).toBe('legacy');
  });

  it('rejects a tampered ciphertext', async () => {
    const blob = await env.encrypt('secret');
    const parts = blob.split(':');
    const ct = Buffer.from(parts[5]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[5] = ct.toString('base64');
    await expect(env.decrypt(parts.join(':'))).rejects.toThrow(/authentication/);
  });

  it('rejects a blob relabelled to another key id (key id is AAD)', async () => {
    const both = createSecretsEnvelope('aes-gcm', { key: keyA, previousKey: keyB });
    const blob = await both.encrypt('secret');
    const relabelled = blob.replace(':k2026a:', ':k2026b:');
    await expect(both.decrypt(relabelled)).rejects.toThrow(/authentication/);
  });

  it('decrypts under the previous key during rotation', async () => {
    const old = await createSecretsEnvelope('aes-gcm', { key: keyB }).encrypt('rotated');
    const rotating = createSecretsEnvelope('aes-gcm', { key: keyA, previousKey: keyB });
    expect(await rotating.decrypt(old)).toBe('rotated');
  });

  it('fails clearly when the blob key is not loaded', async () => {
    const old = await createSecretsEnvelope('aes-gcm', { key: keyB }).encrypt('x');
    await expect(env.decrypt(old)).rejects.toThrow(/No envelope key loaded/);
  });

  it('validates key material', () => {
    expect(() => createSecretsEnvelope('aes-gcm')).toThrow(/requires a key/);
    expect(() =>
      createSecretsEnvelope('aes-gcm', { key: { id: 'k', keyB64: 'c2hvcnQ=' } })
    ).toThrow(/32 bytes/);
    expect(() =>
      createSecretsEnvelope('aes-gcm', { key: { id: 'bad id!', keyB64: keyA.keyB64 } })
    ).toThrow(/key id/);
    expect(() =>
      createSecretsEnvelope('aes-gcm', { key: keyA, previousKey: { ...keyB, id: keyA.id } })
    ).toThrow(/different id/);
  });
});

describe('parseEnvelopeOptions', () => {
  it('reads current + previous pairs', () => {
    expect(
      parseEnvelopeOptions({
        SECRETS_ENVELOPE_KEY: keyA.keyB64,
        SECRETS_ENVELOPE_KEY_ID: keyA.id,
        SECRETS_ENVELOPE_PREVIOUS_KEY: keyB.keyB64,
        SECRETS_ENVELOPE_PREVIOUS_KEY_ID: keyB.id,
      })
    ).toEqual({ key: keyA, previousKey: keyB });
    expect(parseEnvelopeOptions({})).toEqual({});
  });

  it('rejects a half-set pair', () => {
    expect(() => parseEnvelopeOptions({ SECRETS_ENVELOPE_KEY: keyA.keyB64 })).toThrow(
      /must be set together/
    );
  });
});
