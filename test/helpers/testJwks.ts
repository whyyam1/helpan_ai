/**
 * Ephemeral RS256 signer for tests. Mirrors Identiti's signing path
 * (src/services/jwtSigner.ts) for customer tokens, so we can produce
 * a JWT that the rail's customer-JWT plugin will verify against the
 * paired public key.
 */

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { SignJWT, type KeyLike } from 'jose';

export const TEST_ISSUER = 'https://test.identiti.local';
export const TEST_AUDIENCE = 'https://test.helpan.local';

export interface TestJwksKeypair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

export function generateTestKeypair(): TestJwksKeypair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, publicKey };
}

export interface SignCustomerTokenInput {
  readonly keypair: TestJwksKeypair;
  readonly sub: string;
  readonly issuer?: string;
  readonly audience?: string | string[];
  readonly scope?: readonly string[];
  readonly tier?: 'tier_0' | 'tier_1' | 'tier_2';
  readonly sessionKind?: 'primary' | 'stepup';
  readonly sessionId?: string;
  readonly authFactors?: readonly string[];
  readonly env?: string;
  /** Default 600s (10 min). Pass a negative number for "already expired". */
  readonly expiresInSeconds?: number;
  /** Optional override on iat for "expired token" tests. */
  readonly issuedAtSeconds?: number;
  readonly jti?: string;
}

export async function signCustomerToken(input: SignCustomerTokenInput): Promise<string> {
  const issuedAtSec =
    input.issuedAtSeconds ?? Math.floor(Date.now() / 1000);
  const expSec = issuedAtSec + (input.expiresInSeconds ?? 600);
  const audience = input.audience ?? TEST_AUDIENCE;

  const payload: Record<string, unknown> = {
    scope: [...(input.scope ?? ['customer:profile_read', 'customer:tier_request'])],
    tier: input.tier ?? 'tier_0',
    session_kind: input.sessionKind ?? 'primary',
    session_id: input.sessionId ?? '01TESTSESSIONID0000000000A',
    auth_factors: [...(input.authFactors ?? ['phone_otp'])],
    env: input.env ?? 'test',
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })
    .setIssuer(input.issuer ?? TEST_ISSUER)
    .setAudience(audience)
    .setSubject(input.sub)
    .setIssuedAt(issuedAtSec)
    .setExpirationTime(expSec)
    .setJti(input.jti ?? `01TESTJTI${Math.random().toString(36).slice(2, 18).toUpperCase()}`)
    .sign(input.keypair.privateKey as unknown as KeyLike);
}

/**
 * Returns the public key as the verifier expects — `jose.jwtVerify` accepts
 * a `KeyLike`, which `crypto.KeyObject` satisfies at runtime.
 */
export function publicKeyResolver(keypair: TestJwksKeypair): KeyLike {
  return keypair.publicKey as unknown as KeyLike;
}

export interface SignStepUpTokenInput {
  readonly keypair: TestJwksKeypair;
  readonly sub: string;
  readonly issuer?: string;
  /** Defaults to `helpan_authority_issuance` (H-3 issuance audience). */
  readonly audience?: string;
  readonly expiresInSeconds?: number;
  readonly issuedAtSeconds?: number;
  readonly jti?: string;
}

/**
 * Signs a step-up token shaped for delegated-authority issuance — RS256,
 * audience `helpan_authority_issuance` (H4 joint contract §3). Mirrors
 * Identiti's step-up signer surface closely enough for `stepUpVerifier`.
 */
export async function signStepUpToken(input: SignStepUpTokenInput): Promise<string> {
  const issuedAtSec = input.issuedAtSeconds ?? Math.floor(Date.now() / 1000);
  const expSec = issuedAtSec + (input.expiresInSeconds ?? 300);
  const jti =
    input.jti ?? `stp_01TESTSTEPUP${Math.random().toString(36).slice(2, 14).toUpperCase()}`;
  return new SignJWT({
    token_class: 'step_up',
    operation_kind: 'helpan_ai.authority_issuance',
    factor: 'phone_otp',
    env: 'test',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'test-stepup-key' })
    .setIssuer(input.issuer ?? TEST_ISSUER)
    .setAudience(input.audience ?? 'helpan_authority_issuance')
    .setSubject(input.sub)
    .setIssuedAt(issuedAtSec)
    .setExpirationTime(expSec)
    .setJti(jti)
    .sign(input.keypair.privateKey as unknown as KeyLike);
}
