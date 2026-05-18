import { describe, it, expect } from 'vitest';
import { createSecretsEnvelope } from './secretsEnvelope.js';

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

  it('throws on unimplemented providers', () => {
    expect(() => createSecretsEnvelope('kms')).toThrow(/not implemented yet/);
    expect(() => createSecretsEnvelope('supabase-vault')).toThrow(/not implemented yet/);
  });
});
