# Helpan AI Rail — Event Bus Contract v1.0

**Document type:** Kafka topology, topic catalogue, event schemas, consumer-group conventions for the Helpan AI rail's cross-rail and intra-rail eventing.
**Date:** 7 May 2026
**Authority:** Helpan AI Rail Design Instruction Pack v1.0 §6.3, §13.1 H13; Reboot Pack v1.2 §9.6, §16.8.

---

## 1. Topology

Single Kafka cluster shared across all four rails (Reboot Pack §9.6). Topic naming: `{rail}.{domain}.events`. Consumer-group naming: `{consuming_rail}.{topic_name}.consumer`.

### 1.1 Configuration

| Setting | Value | Rationale |
|---|---|---|
| Replication factor | 3 | Survives single-broker loss |
| min.insync.replicas | 2 | Acks=all writes survive single-broker loss |
| Compression | zstd | Best ratio at acceptable CPU |
| Retention | 30 days for non-audit events; 7 years (separate cold-tier) for audit-mirrored events | Reboot Pack §9.5 + audit retention |
| Partition count | 12 per topic (default); 24 for high-volume audit | Account-UUID-keyed partitioning |
| Cleanup policy | `delete` for events; `compact` for state-mirrors (e.g. authority status) | Per topic-class |

### 1.2 Partition key

Account UUID is the canonical partition key for account-scoped events. This ensures all events for one account land on one partition, preserving per-account ordering.

For non-account-scoped events (operator actions, system events), `app_id` or a fixed `system` key is used.

---

## 2. Topics published by Helpan AI

### 2.1 `helpan.briefing.events`

Cleanup policy: `delete`. Retention: 30 days. Partition key: `account_uuid`.

| Event type | Trigger |
|---|---|
| `BRIEFING_CREATED` | New briefing via `POST /briefings` |
| `BRIEFING_UPDATED` | Briefing mutated via `PATCH /briefings/{id}` |
| `BRIEFING_REVOKED` | Briefing deleted/revoked |
| `BRIEFING_EXPIRED` | Briefing reached `expires_at` |
| `BRIEFING_MATCHED` | Matching engine emitted a match (also fanned out as webhook to consuming app) |

#### `BRIEFING_MATCHED` payload

```json
{
  "event_id": "01J...",
  "event_type": "BRIEFING_MATCHED",
  "schema_version": "1.0",
  "occurred_at": "2026-05-07T10:23:14.123Z",
  "account_uuid": "acc_...",
  "app_id": "lunchdrop",
  "briefing_id": "brf_...",
  "source_event_id": "evt_...",
  "match_confidence": "high",
  "match_detail": {"merchant_id": "mer_...", "score": 0.92},
  "traceparent": "00-..."
}
```

### 2.2 `helpan.authority.events`

Cleanup policy: `delete`. Retention: 30 days. Partition key: `account_uuid`.

| Event type | Trigger |
|---|---|
| `AUTHORITY_ISSUED` | New delegated authority via `POST /authorities` |
| `AUTHORITY_REVOKED` | Authority revoked (any cause) |
| `AUTHORITY_EXPIRED` | Authority reached `expires_at` |

#### `AUTHORITY_REVOKED` payload

```json
{
  "event_id": "01J...",
  "event_type": "AUTHORITY_REVOKED",
  "schema_version": "1.0",
  "occurred_at": "2026-05-07T10:23:14.123Z",
  "authority_id": "daa_...",
  "account_uuid": "acc_...",
  "agent_id": "agt_...",
  "reason": "user_initiated",
  "scopes": [{"scope_id": "kipkiren.write.payments", ...}],
  "revoked_at": "2026-05-07T10:23:14.123Z",
  "traceparent": "00-..."
}
```

**Critical consumers:** Kipkiren Pay, Todoku, all consuming-app servers — for cache eviction of the authority's validate result.

### 2.3 `helpan.action.events`

Cleanup policy: `delete`. Retention: 30 days. Partition key: `account_uuid`.

| Event type | Trigger |
|---|---|
| `ACTION_DISPATCHED` | Helpan AI accepted action and dispatched to target rail |
| `ACTION_COMPLETED` | Target rail returned success |
| `ACTION_FAILED` | Target rail returned failure or dispatch path errored |

### 2.4 `helpan.audit.events`

Cleanup policy: `delete`. Retention: 7 years (cold-tier mirror). Partition key: `account_uuid` for account-scoped, `app_id` for app-scoped, `system` for platform.

Mirrors every `audit_log` row insert. Used for: cross-rail audit aggregator (post-v1.0); cold-tier compliance archival.

---

## 3. Topics consumed by Helpan AI

### 3.1 From Identiti — `identiti.account.events`

| Event | Helpan AI action |
|---|---|
| `ACCOUNT_SUSPENDED` | Cascade-revoke ALL active delegated authorities for the account; reason='account_suspended' |
| `ACCOUNT_REACTIVATED` | No automatic action (revoked authorities stay revoked; user re-issues if needed) |
| `ACCOUNT_DELETED` | Cascade-revoke ALL authorities; mark briefings revoked; mark agent registry agents owned by this account suspended |
| `KYC_DOWNGRADED` | Cascade-revoke high-stakes authorities only (money-touching, identity-sensitive); reason='kyc_downgraded' |
| `TIER_CHANGED` | Re-check active authority limits against new tier ceilings; if any exceed new tier max, revoke with reason='kyc_downgraded' |

Consumer group: `helpan.identiti.account.events.consumer`.

### 3.2 From Identiti — `identiti.consent.events`

| Event | Helpan AI action |
|---|---|
| `CONSENT_REVOKED` | Cascade-revoke authorities whose scopes depend on the revoked consent; reason='cascade_consent_revoked' |
| `CONSENT_GRANTED` | No automatic action (informational) |

Consumer group: `helpan.identiti.consent.events.consumer`.

### 3.3 From Kipkiren Pay — `kp.payment.events`

| Event | Helpan AI action |
|---|---|
| `PAYMENT_COMPLETED` | If `actor.type='agent'`, update corresponding `actions` row to `status='completed'`; emit `helpan.action.events.ACTION_COMPLETED` |
| `PAYMENT_FAILED` | If `actor.type='agent'`, update `actions` row to `failed`; emit `ACTION_FAILED` |

Consumer group: `helpan.kp.payment.events.consumer`.

### 3.4 From Kipkiren Pay — `kp.payout.events`, `kp.goal.events`

Same pattern as 3.3. Consumer groups: `helpan.kp.payout.events.consumer`, `helpan.kp.goal.events.consumer`.

### 3.5 From Todoku — `todoku.delivery.events`

| Event | Helpan AI action |
|---|---|
| `MESSAGE_DELIVERED` | If `actor.type='agent'`, update corresponding `actions` row to `completed`; emit `ACTION_COMPLETED` |
| `MESSAGE_FAILED` | If `actor.type='agent'`, update `actions` to `failed`; emit `ACTION_FAILED` |

Consumer group: `helpan.todoku.delivery.events.consumer`.

### 3.6 From consuming apps (event ingestion bridge)

Consuming apps publish to `helpan.app-events.{app_id}` (via the `POST /v1/events/ingest` API, which proxies to Kafka). Helpan AI's matching engine consumes these.

Topic per app for partitioning isolation. Examples:
- `helpan.app-events.lunchdrop`
- `helpan.app-events.chapaa`
- `helpan.app-events.klokd`
- `helpan.app-events.family_discovery`

---

## 4. Cross-rail consumer-group registry

Consolidated list of consumer groups Helpan AI maintains:

| Group name | Source topic | Purpose |
|---|---|---|
| `helpan.identiti.account.events.consumer` | `identiti.account.events` | Cascade revocation on user lifecycle |
| `helpan.identiti.consent.events.consumer` | `identiti.consent.events` | Cascade revocation on consent change |
| `helpan.kp.payment.events.consumer` | `kp.payment.events` | Update agent action status |
| `helpan.kp.payout.events.consumer` | `kp.payout.events` | Update agent action status |
| `helpan.kp.goal.events.consumer` | `kp.goal.events` | Update agent action status |
| `helpan.todoku.delivery.events.consumer` | `todoku.delivery.events` | Update agent action status |
| `helpan.matching.consumer` | `helpan.app-events.*` (regex sub) | Run matching engine over ingested events |

---

## 5. Standard event envelope

All events Helpan AI publishes follow this envelope:

```json
{
  "event_id": "01J... (ULID)",
  "event_type": "STRING",
  "schema_version": "1.0",
  "occurred_at": "RFC 3339 UTC",
  "rail": "helpan",
  "...event-specific fields...",
  "traceparent": "00-... (W3C Trace Context, when known)"
}
```

`event_id` is the partition-internal unique ID. Idempotent processing by consumers MUST key on `event_id`.

---

## 6. At-least-once semantics

All events are delivered at-least-once. Consumers MUST handle duplicates by `event_id`. The Helpan AI database has a `processed_events` table (operator-installed, not in main schema) for consumers that need exactly-once semantics at the application layer:

```sql
CREATE TABLE processed_events (
  consumer_group  TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_group, event_id)
);
CREATE INDEX ON processed_events (processed_at);   -- for cleanup (90-day retention)
```

---

## 7. Schema registry

A platform-wide schema registry (e.g. Confluent Schema Registry) holds all event payload schemas in JSON Schema 2020-12. Producers register schemas before emit. Consumers validate on consume in non-production; production consumers may rely on producer compliance for performance.

Schema topic naming: `_schemas.helpan.{event_type}`.

---

## 8. Cross-rail correlation

Every event MUST carry `traceparent` when the originating call had one. Consumers MUST propagate the same `traceparent` to any downstream operations they trigger. This is what makes cross-rail correlation possible (per Reboot Pack §5; App Integration Guide §9.1).

---

## 9. Authoritative source documents

1. Helpan AI Rail Design Instruction Pack v1.0 §6.3, §13.1 H13
2. Reboot Pack v1.2 §9.6 (cross-rail event bus) + §16.8 (cross-rail wiring)
3. Helpan AI Schema and ERD v1.0 (partition keys aligned with table account_uuid)
4. Identiti / KP / Todoku Rail Contracts v1.0 + Amendment §A (event types these rails publish)

---

*Helpan AI Rail · Event Bus Contract v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential*
