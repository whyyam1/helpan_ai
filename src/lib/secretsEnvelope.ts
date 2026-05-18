/**
 * Placeholder envelope encryption for at-rest secrets.
 * Per ERD §1.10 (`hmac_secret`, `webhook_signing_secret` are "encrypted at rest").
 *
 * H-1 ships only the `noop` provider — values are stored plaintext. This
 * exists so callers (credentialStore, future webhook-signing code) commit
 * to the envelope shape now, and H-6/H-7 swaps in real encryption (KMS or
 * Supabase Vault) without changing call sites.
 *
 * DO NOT use the noop provider in any environment with real secrets in
 * the database. The env validator restricts production use to non-noop
 * providers (todo: enforce when KMS lands).
 */

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

const NOOP_PREFIX = 'envelope:noop:v1:';

const noopEnvelope: SecretsEnvelope = {
  provider: 'noop',
  encrypt(plaintext) {
    return Promise.resolve(`${NOOP_PREFIX}${plaintext}`);
  },
  decrypt(blob) {
    if (blob.startsWith(NOOP_PREFIX)) {
      return Promise.resolve(blob.slice(NOOP_PREFIX.length));
    }
    // Tolerate bare plaintext during initial seeding (e.g. test fixtures
    // inserted via SQL without going through encrypt()). Will be removed
    // when we lock the format at H-6.
    return Promise.resolve(blob);
  },
};

export function createSecretsEnvelope(provider: SecretsEnvelopeProvider): SecretsEnvelope {
  switch (provider) {
    case 'noop':
      return noopEnvelope;
    case 'kms':
    case 'supabase-vault':
      throw new Error(
        `Secrets envelope provider "${provider}" is not implemented yet (H-6/H-7).`
      );
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown secrets envelope provider: ${String(exhaustive)}`);
    }
  }
}
