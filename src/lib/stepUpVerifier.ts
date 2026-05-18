/**
 * Step-up token verifier — issuance-time proof for high-stakes delegated
 * authorities (Delegated Authority Contract §3.5, §1 "the two compose").
 *
 * A step-up token is an RS256 JWT minted by Identiti's
 * `/v1/stepup/verify`. For delegated-authority issuance it must carry the
 * audience `helpan_authority_issuance` (H4 joint contract §3 — a bare,
 * non-URI audience string).
 *
 * Verification:
 *   1. RS256 signature against Identiti's JWKS (the step-up key — same JWKS
 *      doc as the delegated-authority key; `jose` selects by `kid`).
 *   2. `iss` equals the configured Identiti issuer.
 *   3. `aud` includes `helpan_authority_issuance`.
 *   4. `exp` in the future.
 *   5. `sub` matches the issuance request's `account_uuid` (caller's check).
 *
 * Single-use enforcement is NOT done here — Identiti's `POST /v1/internal/sign`
 * consumes the JTI atomically (H4 §2). This verifier only proves the token
 * is authentic and well-scoped before Helpan AI bothers calling the signer.
 */

import { jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';

export const STEP_UP_AUDIENCE = 'helpan_authority_issuance';

export type StepUpVerifyResult =
  | { readonly ok: true; readonly jti: string; readonly sub: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface StepUpVerifierConfig {
  /** `jose.createRemoteJWKSet(...)` in production; a `KeyLike` in tests. */
  readonly keyResolver: JWTVerifyGetKey | KeyLike;
  readonly issuer: string;
}

export interface StepUpVerifier {
  verify(token: string): Promise<StepUpVerifyResult>;
}

export function createStepUpVerifier(config: StepUpVerifierConfig): StepUpVerifier {
  return {
    async verify(token) {
      let payload: Record<string, unknown>;
      try {
        const verified = await jwtVerify(token, config.keyResolver as JWTVerifyGetKey, {
          issuer: config.issuer,
          audience: STEP_UP_AUDIENCE,
          algorithms: ['RS256'],
        });
        payload = verified.payload;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'ERR_JWT_EXPIRED') {
          return { ok: false, code: 'STEP_UP_TOKEN_INVALID', message: 'Step-up token expired' };
        }
        if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
          const claim = (err as { claim?: string }).claim;
          return {
            ok: false,
            code: 'STEP_UP_TOKEN_INVALID',
            message: `Step-up token claim invalid${claim ? ` (${claim})` : ''}`,
          };
        }
        return {
          ok: false,
          code: 'STEP_UP_TOKEN_INVALID',
          message: 'Step-up token signature or structure invalid',
        };
      }

      const jti = payload['jti'];
      const sub = payload['sub'];
      if (typeof jti !== 'string' || typeof sub !== 'string') {
        return {
          ok: false,
          code: 'STEP_UP_TOKEN_INVALID',
          message: 'Step-up token missing jti or sub',
        };
      }
      return { ok: true, jti, sub };
    },
  };
}
