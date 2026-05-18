/**
 * In-process delegated-authority signer for H-3 tests.
 *
 * Stands in for Identiti's `POST /v1/internal/sign`: RS256-signs the claim
 * set locally with the test keypair so the issued token verifies against the
 * same keypair's public half (the `daKeyResolver` passed to `buildApp`).
 *
 * `forceError` makes the signer return a chosen error envelope instead of
 * signing — used to exercise the issuance error paths that, in production,
 * originate inside Identiti (e.g. `step_up_token_already_used`).
 */

import { SignJWT, type KeyLike } from 'jose';
import type { DelegatedAuthoritySigner } from '../../src/lib/identitiSigner.js';
import type { TestJwksKeypair } from './testJwks.js';

export interface InProcessSignerOptions {
  readonly forceError?: {
    readonly code: string;
    readonly message: string;
    readonly httpStatus: number;
  };
  /** Override the kid stamped on the token header. */
  readonly kid?: string;
}

export function createInProcessSigner(
  keypair: TestJwksKeypair,
  opts: InProcessSignerOptions = {}
): DelegatedAuthoritySigner {
  return {
    async sign(input) {
      if (opts.forceError) {
        return {
          ok: false,
          code: opts.forceError.code,
          message: opts.forceError.message,
          httpStatus: opts.forceError.httpStatus,
        };
      }
      const token = await new SignJWT(input.claims as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: opts.kid ?? input.kid })
        .sign(keypair.privateKey as unknown as KeyLike);
      return { ok: true, token, signedAt: new Date() };
    },
  };
}
