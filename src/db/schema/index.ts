/**
 * Re-exports all 14 tables in the Helpan AI rail schema (ERD §1).
 *
 * Order matches helpan-ai-schema-erd-v1.md §5 migration grouping so that
 * a casual reader of this index file sees the same dependency progression
 * as the SQL migrations.
 */

// 0001 — universal tables
export * from './appCredentials.js';
export * from './idempotencyKeys.js';
export * from './auditLog.js';
export * from './kafkaOffsets.js';
export * from './webhookDeliveries.js';

// 0002 — oauth scope catalogue
export * from './oauthScopes.js';

// 0003 — agents + safety
export * from './agents.js';
export * from './safetyPolicies.js';

// 0004 — briefings + events + matches
export * from './briefings.js';
export * from './eventsIngested.js';
export * from './briefingMatches.js';

// 0005 — authorities + usage + actions
export * from './delegatedAuthorities.js';
export * from './authorityUsage.js';
export * from './actions.js';

// 0016 — kafka outbox (H-17, closes RECAP §6.7)
export * from './kafkaOutbox.js';
