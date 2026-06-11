/**
 * Cascade-revocation core — Delegated Authority Contract §5.1 + H4 joint
 * contract §5.
 *
 * Helpan AI consumes Identiti's `identiti.account.events` and auto-revokes
 * delegated authorities when the delegating account's standing changes:
 *
 *   ACCOUNT_SUSPENDED   → revoke ALL active authorities for the account
 *                         (reason = account_suspended).
 *   TIER_CHANGED (down) → revoke the account's HIGH-STAKES active authorities
 *                         only (reason = kyc_downgraded). A KYC downgrade
 *                         pulls money / identity-sensitive power; read-only
 *                         authorities survive.
 *
 * `ACCOUNT_DELETED` / `CONSENT_REVOKED` have no v1.0 Identiti source (H4 §5)
 * — not handled here.
 *
 * `handleAccountEvent` is the pure-ish testable core: given a parsed event +
 * a DB handle it performs the cascade and returns a count. The kafkajs
 * consumer wiring lives in `index.ts`.
 *
 * Idempotent under Kafka at-least-once delivery: a redelivered event finds
 * no active authorities left to revoke and is a no-op.
 */

import { appendAuditEntry } from '../../lib/auditWriter.js';
import {
  EVENT_AUTHORITY_REVOKED,
  SCHEMA_VERSION,
  TOPIC_AUTHORITY_EVENTS,
} from '../../lib/kafka/topics.js';
import { enqueueOutboxEntry } from '../../lib/kafka/outbox.js';
import type { KafkaProducerLike } from '../../lib/kafka/producer.js';
import type { Db } from '../../db/client.js';
import {
  listActiveAuthoritiesForAccount,
  revokeActiveAuthority,
  type DelegatedAuthorityRow,
} from '../../modules/authorities/repo.js';
import { getScopeById } from '../../modules/oauthScopes/repo.js';
import { classifyScope } from '../../modules/authorities/scopeClassifier.js';
import type { RevocationReason } from '../../modules/authorities/schemas.js';

const TIER_RANK: Readonly<Record<string, number>> = {
  tier_0: 0,
  tier_1: 1,
  tier_2: 2,
};

export interface AccountEvent {
  readonly event_type?: string;
  readonly account_uuid?: string;
  readonly from_tier?: string;
  readonly to_tier?: string;
  readonly traceparent?: string;
}

export type CascadeTrigger =
  | 'account_suspended'
  | 'kyc_downgraded'
  | 'ignored';

export interface CascadeResult {
  readonly trigger: CascadeTrigger;
  readonly accountUuid: string | null;
  readonly revoked: number;
}

export interface CascadeDeps {
  readonly db: Db;
  readonly kafka?: KafkaProducerLike;
}

/** True when `to_tier` ranks strictly below `from_tier`. */
export function isTierDowngrade(fromTier?: string, toTier?: string): boolean {
  if (!fromTier || !toTier) return false;
  const from = TIER_RANK[fromTier];
  const to = TIER_RANK[toTier];
  if (from === undefined || to === undefined) return false;
  return to < from;
}

/** True when any of the authority's scopes is high-stakes (money / identity). */
async function isHighStakesAuthority(
  db: Db,
  row: DelegatedAuthorityRow
): Promise<boolean> {
  for (const scope of row.scopes) {
    const scopeRow = await getScopeById(db, scope.scope_id);
    if (scopeRow && classifyScope(scopeRow).isHighStakes) return true;
  }
  return false;
}

interface PreparedRevocation {
  readonly id: string;
  readonly accountUuid: string;
  readonly agentId: string;
}

export async function handleAccountEvent(
  deps: CascadeDeps,
  event: AccountEvent,
  requestId: string
): Promise<CascadeResult> {
  const accountUuid = event.account_uuid ?? null;

  let trigger: CascadeTrigger = 'ignored';
  let reason: RevocationReason = 'account_suspended';
  if (event.event_type === 'ACCOUNT_SUSPENDED' && accountUuid) {
    trigger = 'account_suspended';
    reason = 'account_suspended';
  } else if (
    event.event_type === 'TIER_CHANGED' &&
    accountUuid &&
    isTierDowngrade(event.from_tier, event.to_tier)
  ) {
    trigger = 'kyc_downgraded';
    reason = 'kyc_downgraded';
  }

  if (trigger === 'ignored' || !accountUuid) {
    return { trigger: 'ignored', accountUuid, revoked: 0 };
  }

  // Select the authorities this trigger revokes.
  const active = await listActiveAuthoritiesForAccount(deps.db, accountUuid);
  let targets: readonly DelegatedAuthorityRow[];
  if (trigger === 'kyc_downgraded') {
    const filtered: DelegatedAuthorityRow[] = [];
    for (const row of active) {
      if (await isHighStakesAuthority(deps.db, row)) filtered.push(row);
    }
    targets = filtered;
  } else {
    targets = active;
  }

  if (targets.length === 0) {
    return { trigger, accountUuid, revoked: 0 };
  }

  // Revoke + audit the whole batch in one transaction.
  const now = new Date();
  const detail = event.traceparent ? { traceparent: event.traceparent } : undefined;
  const revoked: PreparedRevocation[] = await deps.db.transaction(async (tx) => {
    const done: PreparedRevocation[] = [];
    for (const row of targets) {
      const updated = await revokeActiveAuthority(tx, row.id, {
        reason,
        detail: `cascade:${event.event_type}`,
        revokedAt: now,
      });
      if (!updated) continue; // lost a race with another revoke — skip
      await appendAuditEntry(tx, {
        actorType: 'system',
        actorId: 'system:cascade-revocation',
        accountUuid,
        action: 'authority.revoke',
        resourceType: 'delegated_authority',
        resourceId: updated.id,
        agentId: updated.agentId,
        delegatedAuthorityJti: updated.id,
        requestId,
        ...(event.traceparent ? { traceparent: event.traceparent } : {}),
        outcome: 'success',
        initiatedBy: 'system',
        detail: {
          reason,
          trigger_event: event.event_type,
          ...(detail ?? {}),
        },
      });
      done.push({ id: updated.id, accountUuid, agentId: updated.agentId });
      // H-17: enqueue AUTHORITY_REVOKED inside the same tx as the revoke
      // + audit so cascade-revoked events are durably emitted. Relying
      // parties evict their validate caches when they consume this.
      await enqueueOutboxEntry(tx, {
        topic: TOPIC_AUTHORITY_EVENTS,
        partitionKey: updated.accountUuid,
        payload: {
          event_id: updated.id,
          event_type: EVENT_AUTHORITY_REVOKED,
          schema_version: SCHEMA_VERSION,
          occurred_at: now.toISOString(),
          authority_id: updated.id,
          account_uuid: updated.accountUuid,
          agent_id: updated.agentId,
          reason,
          revoked_at: now.toISOString(),
          ...(event.traceparent ? { traceparent: event.traceparent } : {}),
        },
      });
    }
    return done;
  });

  return { trigger, accountUuid, revoked: revoked.length };
}
