/**
 * Scope classification for delegated-authority issuance.
 *
 * Pure derive over an `oauth_scopes` row — no DB access here; the repo
 * fetches the rows, the issuance service calls this per scope.
 *
 * Per Delegated Authority Contract §3.5 + H4 joint contract §2 (guard 5):
 *   - TTL ceiling is the row's own `per_scope_max_ttl_seconds`. When a
 *     request carries several scopes, the *tightest* ceiling wins — see
 *     `tightestTtlSeconds`.
 *   - High-stakes scopes require a fresh step-up token at issuance. A scope
 *     is high-stakes when it touches money or identity, or the catalogue
 *     marks it `elevation_friction = 'high'`.
 *   - `amount_limit_minor` / `per_period_limit_minor` on a requested scope
 *     must not exceed the row's ceilings (NULL ceiling = no cap).
 */

import type { OauthScopeRow } from '../oauthScopes/repo.js';

export interface ScopeClassification {
  readonly scopeId: string;
  readonly maxTtlSeconds: number;
  readonly amountCeilingMinor: bigint | null;
  readonly periodCeilingMinor: bigint | null;
  readonly isHighStakes: boolean;
  readonly status: OauthScopeRow['status'];
}

export function classifyScope(row: OauthScopeRow): ScopeClassification {
  const isHighStakes =
    row.elevationFriction === 'high' ||
    row.category === 'write_money' ||
    row.category === 'write_identity' ||
    row.category === 'read_behavioural';
  return {
    scopeId: row.id,
    maxTtlSeconds: row.perScopeMaxTtlSeconds,
    amountCeilingMinor: row.perScopeAmountCeilingMinor,
    periodCeilingMinor: row.perScopePeriodCeilingMinor,
    isHighStakes,
    status: row.status,
  };
}

/**
 * The tightest (smallest) TTL ceiling across a set of classified scopes.
 * Identiti's signer enforces the same bound server-side (H4 §2 guard 5);
 * Helpan AI enforces it request-side so the caller gets a clean
 * `TTL_EXCEEDS_MAX` rather than an opaque signer rejection.
 */
export function tightestTtlSeconds(classifications: readonly ScopeClassification[]): number {
  if (classifications.length === 0) {
    throw new Error('tightestTtlSeconds: empty classification set');
  }
  let min = Number.POSITIVE_INFINITY;
  for (const c of classifications) {
    if (c.maxTtlSeconds < min) min = c.maxTtlSeconds;
  }
  return min;
}

/** True when any scope in the set is high-stakes (→ step-up token required). */
export function requiresStepUp(classifications: readonly ScopeClassification[]): boolean {
  return classifications.some((c) => c.isHighStakes);
}
