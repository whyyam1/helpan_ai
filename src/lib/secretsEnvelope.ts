/**
 * Envelope encryption for at-rest secrets.
 * Per ERD §1.10 (`hmac_secret`, `webhook_signing_secret` are "encrypted at rest").
 *
 * Providers:
 *   - `noop`    — plaintext behind a version prefix. Dev/test only.
 *   - `aes-gcm` — AES-256-GCM under a 32-byte key from SECRETS_ENVELOPE_KEY
 *                 (RECAP §6.3(c) blob format):
 *                   secret:aes-gcm:v1:<key_id>:<iv_b64>:<ct_b64>:<tag_b64>
 *                 Decrypt also accepts `noop` blobs, so switching a live
 *                 environment to aes-gcm keeps existing rows readable until
 *                 `npm run secrets:rewrap` converts them. An optional
 *                 previous key keeps rows readable across a key rotation.
 *   - `kms` / `supabase-vault` — reserved, not implemented.
 *
 * Callers never parse blobs; they go through encrypt()/decrypt().
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretsEnvelopeProvider } from '../config/env.js';

export interface SecretsEnvelope {
  /**
   * Wrap a plaintext secret for storage. Returns the ciphertext blob.
   * Format is provider-defined; callers must not parse it.
   */
  encrypt(plaintext: string): Promise<string>;

  /**
   * Unwrap a stored secret. Throws if the blob was not produced by a
   * compatible provider.
   */
  decrypt(blob: string): Promise<string>;

  readonly provider: SecretsEnvelopeProvider;
}

/** One AES-256 key, identified so blobs record which key wrapped them. */
export interface EnvelopeKey {
  readonly id: string;
  /** Base64 of exactly 32 random bytes. */
  readonly keyB64: string;
}

export interface SecretsEnvelopeOptions {
  /** Required for `aes-gcm`: the key new blobs are wrapped under. */
  readonly key?: EnvelopeKey;
  /** Optional: a retired key still accepted on decrypt during rotation. */
  readonly previousKey?: EnvelopeKey;
}

const NOOP_PREFIX = 'envelope:noop:v1:';
const AES_PREFIX = 'secret:aes-gcm:v1:';
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function decryptNoop(blob: string): string {
  if (blob.startsWith(NOOP_PREFIX)) return blob.slice(NOOP_PREFIX.length);
  // Tolerate bare plaintext during initial seeding (e.g. test fixtures
  // inserted via SQL without going through encrypt()).
  return blob;
}

const noopEnvelope: SecretsEnvelope = {
  provider: 'noop',
  encrypt(plaintext) {
    return Promise.resolve(`${NOOP_PREFIX}${plaintext}`);
  },
  decrypt(blob) {
    if (blob.startsWith(AES_PREFIX)) {
      return Promise.reject(
        new Error('Secret is aes-gcm encrypted but the envelope provider is noop')
      );
    }
    return Promise.resolve(decryptNoop(blob));
  },
};

function loadKey(key: EnvelopeKey): Buffer {
  if (!KEY_ID_RE.test(key.id)) {
    throw new Error(`Envelope key id must match ${KEY_ID_RE.source}; got "${key.id}"`);
  }
  const raw = Buffer.from(key.keyB64, 'base64');
  if (raw.length !== 32) {
    throw new Error(`Envelope key "${key.id}" must be 32 bytes (base64); got ${raw.length}`);
  }
  return raw;
}

function createAesGcmEnvelope(opts: SecretsEnvelopeOptions): SecretsEnvelope {
  if (!opts.key) {
    throw new Error('aes-gcm envelope requires a key (SECRETS_ENVELOPE_KEY)');
  }
  const current = { id: opts.key.id, key: loadKey(opts.key) };
  const keys = new Map<string, Buffer>([[current.id, current.key]]);
  if (opts.previousKey) {
    if (opts.previousKey.id === current.id) {
      throw new Error('Previous envelope key must have a different id from the current key');
    }
    keys.set(opts.previousKey.id, loadKey(opts.previousKey));
  }

  return {
    provider: 'aes-gcm',
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', current.key, iv);
      // Bind the key id as AAD so a blob can't be relabelled to another key.
      cipher.setAAD(Buffer.from(current.id, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Promise.resolve(
        `${AES_PREFIX}${current.id}:${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`
      );
    },
    decrypt(blob) {
      if (!blob.startsWith(AES_PREFIX)) {
        return Promise.resolve(decryptNoop(blob));
      }
      const parts = blob.slice(AES_PREFIX.length).split(':');
      if (parts.length !== 4) {
        return Promise.reject(new Error('Malformed aes-gcm secret blob'));
      }
      const [keyId, ivB64, ctB64, tagB64] = parts as [string, string, string, string];
      const key = keys.get(keyId);
      if (!key) {
        return Promise.reject(new Error(`No envelope key loaded for key id "${keyId}"`));
      }
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
        decipher.setAAD(Buffer.from(keyId, 'utf8'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        const pt = Buffer.concat([
          decipher.update(Buffer.from(ctB64, 'base64')),
          decipher.final(),
        ]);
        return Promise.resolve(pt.toString('utf8'));
      } catch {
        return Promise.reject(new Error('aes-gcm secret failed authentication'));
      }
    },
  };
}

/**
 * Read envelope keys from env:
 *   SECRETS_ENVELOPE_KEY / SECRETS_ENVELOPE_KEY_ID                    — current
 *   SECRETS_ENVELOPE_PREVIOUS_KEY / SECRETS_ENVELOPE_PREVIOUS_KEY_ID  — rotation
 * A key without its id (or vice versa) throws, so a half-set pair fails loud.
 */
export function parseEnvelopeOptions(
  env: Readonly<Record<string, string | undefined>>
): SecretsEnvelopeOptions {
  const pair = (keyVar: string, idVar: string): EnvelopeKey | undefined => {
    const keyB64 = env[keyVar] || undefined;
    const id = env[idVar] || undefined;
    if (!keyB64 && !id) return undefined;
    if (!keyB64 || !id) throw new Error(`${keyVar} and ${idVar} must be set together`);
    return { id, keyB64 };
  };
  const key = pair('SECRETS_ENVELOPE_KEY', 'SECRETS_ENVELOPE_KEY_ID');
  const previousKey = pair('SECRETS_ENVELOPE_PREVIOUS_KEY', 'SECRETS_ENVELOPE_PREVIOUS_KEY_ID');
  return { ...(key ? { key } : {}), ...(previousKey ? { previousKey } : {}) };
}

/** True when a stored blob is already wrapped under `keyId` with aes-gcm. */
export function isWrappedUnderKey(blob: string, keyId: string): boolean {
  return blob.startsWith(`${AES_PREFIX}${keyId}:`);
}

export function createSecretsEnvelope(
  provider: SecretsEnvelopeProvider,
  opts: SecretsEnvelopeOptions = {}
): SecretsEnvelope {
  switch (provider) {
    case 'noop':
      return noopEnvelope;
    case 'aes-gcm':
      return createAesGcmEnvelope(opts);
    case 'kms':
    case 'supabase-vault':
      throw new Error(`Secrets envelope provider "${provider}" is not implemented yet.`);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown secrets envelope provider: ${String(exhaustive)}`);
    }
  }
}
