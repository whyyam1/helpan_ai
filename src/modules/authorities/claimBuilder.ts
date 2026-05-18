/**
 * Delegated-authority claim assembly — Delegated Authority Contract §2.3.
 *
 * Pure: takes a fully-validated issuance input and produces the claim set
 * Helpan AI submits to Identiti's `POST /v1/internal/sign`. The shape must
 * satisfy Identiti's `internalSignClaimsSchema` (additionalProperties:false),
 * so every optional scope field is included only when defined.
 *
 * `aud` always carries Helpan AI's own audience plus the platform-rail
 * audience for every distinct rail referenced by the requested scopes —
 * relying parties MAY check `aud` locally as a pre-validation convenience
 * (contract §4.7). App-level scopes (lunchdrop/chapaa/…) add no audience:
 * those tokens are consumed through Helpan AI's dispatch path.
 */

import { generateUlid } from '@kmv/platform-shared/ulid';

/** Platform-rail API audiences. Stable infrastructure URLs; sandbox/prod
 *  variance is a v1.1 env-driven concern (RECAP §6). */
const RAIL_AUDIENCE: Readonly<Record<string, string>> = {
  kipkiren_pay: 'https://api.pay.kipkiren.co.ke',
  identiti: 'https://api.identiti.co.ke',
  todoku: 'https://api.todoku.co.ke',
};

export type AuthorityPeriod = 'single_use' | 'daily' | 'weekly' | 'monthly';

export interface ClaimScope {
  scope_id: string;
  amount_limit_minor?: number;
  per_period_limit_minor?: number;
  period?: AuthorityPeriod;
  category_whitelist?: string[];
  recipient_whitelist?: string[];
}

export interface DelegatedAuthorityClaims {
  iss: string;
  aud: string[];
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  token_class: 'delegated_authority';
  actor: { type: 'agent'; agent_id: string };
  initiated_by: 'agent';
  scopes: ClaimScope[];
  step_up_jti?: string;
  revocation_endpoint: string;
}

export interface BuildClaimsInput {
  readonly issuer: string;
  readonly helpanAudience: string;
  readonly accountUuid: string;
  readonly agentId: string;
  readonly ttlSeconds: number;
  readonly scopes: readonly ClaimScope[];
  /** Rail of each scope, keyed by scope_id — used to assemble `aud`. */
  readonly scopeRails: Readonly<Record<string, string>>;
  readonly stepUpJti?: string | undefined;
  /** Defaults to `new Date()`; injectable for deterministic tests. */
  readonly now?: Date;
}

export interface BuiltClaims {
  readonly jti: string;
  readonly claims: DelegatedAuthorityClaims;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

function buildAudience(
  helpanAudience: string,
  scopes: readonly ClaimScope[],
  scopeRails: Readonly<Record<string, string>>
): string[] {
  const aud = new Set<string>([helpanAudience]);
  for (const s of scopes) {
    const rail = scopeRails[s.scope_id];
    if (rail && RAIL_AUDIENCE[rail]) {
      aud.add(RAIL_AUDIENCE[rail]!);
    }
  }
  return [...aud];
}

function normaliseScope(s: ClaimScope): ClaimScope {
  // Re-emit only the fields the wire schema allows, dropping `undefined`s so
  // Identiti's `additionalProperties:false` validation doesn't trip.
  const out: ClaimScope = { scope_id: s.scope_id };
  if (s.amount_limit_minor !== undefined) out.amount_limit_minor = s.amount_limit_minor;
  if (s.per_period_limit_minor !== undefined) {
    out.per_period_limit_minor = s.per_period_limit_minor;
  }
  if (s.period !== undefined) out.period = s.period;
  if (s.category_whitelist !== undefined && s.category_whitelist.length > 0) {
    out.category_whitelist = [...s.category_whitelist];
  }
  if (s.recipient_whitelist !== undefined && s.recipient_whitelist.length > 0) {
    out.recipient_whitelist = [...s.recipient_whitelist];
  }
  return out;
}

export function buildDelegatedAuthorityClaims(input: BuildClaimsInput): BuiltClaims {
  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + input.ttlSeconds;
  const jti = `daa_${generateUlid()}`;

  const claims: DelegatedAuthorityClaims = {
    iss: input.issuer,
    aud: buildAudience(input.helpanAudience, input.scopes, input.scopeRails),
    sub: input.accountUuid,
    iat,
    exp,
    jti,
    token_class: 'delegated_authority',
    actor: { type: 'agent', agent_id: input.agentId },
    initiated_by: 'agent',
    scopes: input.scopes.map(normaliseScope),
    revocation_endpoint: `${input.helpanAudience}/v1/authorities/${jti}/validate`,
  };
  if (input.stepUpJti) {
    claims.step_up_jti = input.stepUpJti;
  }

  return {
    jti,
    claims,
    issuedAt: new Date(iat * 1000),
    expiresAt: new Date(exp * 1000),
  };
}
