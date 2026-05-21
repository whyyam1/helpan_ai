/**
 * Topic catalogue and event-type constants for the Helpan AI rail.
 * Source: helpan-ai-event-bus-contract-v1.md §2.
 *
 * Topic naming: `{rail}.{domain}.events`. Partition key: `account_uuid` for
 * account-scoped events.
 */

export const TOPIC_BRIEFING_EVENTS = 'helpan.briefing.events';
export const TOPIC_AUTHORITY_EVENTS = 'helpan.authority.events';
export const TOPIC_ACTION_EVENTS = 'helpan.action.events';
export const TOPIC_AUDIT_EVENTS = 'helpan.audit.events';

export const EVENT_BRIEFING_MATCHED = 'BRIEFING_MATCHED' as const;
export const EVENT_BRIEFING_CREATED = 'BRIEFING_CREATED' as const;
export const EVENT_BRIEFING_UPDATED = 'BRIEFING_UPDATED' as const;
export const EVENT_BRIEFING_REVOKED = 'BRIEFING_REVOKED' as const;
export const EVENT_BRIEFING_EXPIRED = 'BRIEFING_EXPIRED' as const;

/** helpan.authority.events — Event Bus Contract §2.2. */
export const EVENT_AUTHORITY_ISSUED = 'AUTHORITY_ISSUED' as const;
export const EVENT_AUTHORITY_REVOKED = 'AUTHORITY_REVOKED' as const;
export const EVENT_AUTHORITY_EXPIRED = 'AUTHORITY_EXPIRED' as const;

/**
 * helpan.action.events — Event Bus Contract §2.3 (H-4).
 *
 * DISPATCHED is emitted after the action row commits in 'pending' status —
 * before the downstream rail has been called, so subscribers see "an
 * agent intent now exists on the rail" even if the downstream call fails
 * or stalls. COMPLETED / FAILED follow on terminal status, one per action.
 */
export const EVENT_ACTION_DISPATCHED = 'ACTION_DISPATCHED' as const;
export const EVENT_ACTION_COMPLETED = 'ACTION_COMPLETED' as const;
export const EVENT_ACTION_FAILED = 'ACTION_FAILED' as const;

export const SCHEMA_VERSION = '1.0' as const;
