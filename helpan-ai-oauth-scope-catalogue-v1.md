# Helpan AI Rail — OAuth Scope Catalogue v1.0

**Document type:** Canonical scope list for Helpan AI delegated authorities and third-party agent OAuth.
**Date:** 7 May 2026
**Authority:** Helpan AI Instruction Pack v1.0 §12.1; DoD/MVP v1.0 §4.5; Design Reference v1.0 §6.3, §10; Scan Integration Memo §6.3 (behavioural-data containment).

---

## 1. Scope conventions

### 1.1 Naming

`{rail}.{action}.{resource}` — lowercase, dot-separated.

- `{rail}` is the canonical short-name: `helpan`, `kipkiren`, `identiti`, `todoku`, `lunchdrop`, `chapaa`, `klokd`, `family_discovery`.
- `{action}` is `read`, `write`, or a domain-specific verb (`mmf.rebalance`, `dispatch`).
- `{resource}` names the noun acted on.

### 1.2 Categories

| Category | Default grantable | Elevation friction | Use cases |
|---|---|---|---|
| `read_aggregate` | Yes | Low | Balance, position, goal progress (no time-series detail) |
| `read_behavioural` | **No** | **High** | Savings cadence, spend patterns, agent action history with timestamps |
| `write_money` | No | High | Initiate payments, payouts, MMF rebalance |
| `write_comms` | No | Medium | Send messages on user's behalf |
| `write_identity` | No | High | Submit KYC on user's behalf, change phone |
| `admin` | Never user-grantable | n/a | Operator-only |

### 1.3 Default-most-restrictive posture

A third-party agent registered fresh has **zero scopes**. Every scope is explicitly requested and granted via the Helpan Console. Behavioural-detail scopes (`read_behavioural`) require a friction-laden grant flow per scan §6.3.

### 1.4 Per-scope ceilings

Money-touching scopes have built-in maxima that no delegated authority can exceed regardless of user consent:

| Scope | `per_scope_amount_ceiling_minor` | `per_scope_period_ceiling_minor` | `per_scope_max_ttl_seconds` |
|---|---|---|---|
| `kipkiren.write.payments` | 5,000,000 (KES 50,000) | 50,000,000 (KES 500,000) per week | 3600 (1 hr) |
| `kipkiren.write.payouts` | 7,000,000 (KES 70,000) | 100,000,000 (KES 1,000,000) per month | 3600 |
| `chapaa.write.deposit` | 10,000,000 (KES 100,000) | 100,000,000 per month | 3600 |
| `chapaa.write.withdraw` | 5,000,000 (KES 50,000) | 50,000,000 per month | 3600 |
| `chapaa.mmf.rebalance` | 50,000,000 (KES 500,000) | 200,000,000 per month | 3600 |
| `lunchdrop.write.orders` | 1,000,000 (KES 10,000) per order | 30,000,000 per month | 86400 (24 hr) |
| `klokd.write.shift_pay` | 2,000,000 per shift | 50,000,000 per month | 3600 |
| `family_discovery.write.basket` | 500,000 per basket | 20,000,000 per month | 86400 |

Identity-sensitive scopes max TTL 900s. Read-aggregate scopes max TTL 86400s.

---

## 2. Scope catalogue — by rail

### 2.1 Helpan AI (rail-internal)

| ID | Category | Default grantable | Description |
|---|---|---|---|
| `helpan.read.profile` | read_aggregate | Yes | Basic user profile (display name, account UUID — no phone) |
| `helpan.read.briefings` | read_aggregate | Yes | List user's active briefings |
| `helpan.write.briefings` | write_identity | No (medium friction) | Create/modify briefings on user's behalf |
| `helpan.read.actions` | read_aggregate | Yes | Read user's agent action history (audit log entries; aggregate, no payloads) |
| `helpan.read.actions_detail` | read_behavioural | No (high friction) | Full action detail including target operation parameters |
| `helpan.read.authorities` | read_aggregate | Yes | List user's delegated authorities (Console support) |
| `helpan.write.authorities` | admin | Never user-grantable | Issue authorities (only consuming apps with `helpan:authorities:issue` service scope) |
| `helpan.console.read` | read_aggregate | Yes | Read Helpan Console state (composite of authorities + actions) |
| `helpan.console.write` | write_identity | No (low friction; requires step-up) | Revoke authorities via Console |

### 2.2 Kipkiren Pay

| ID | Category | Default grantable | Description |
|---|---|---|---|
| `kipkiren.read.balance` | read_aggregate | Yes | Wallet spendable + reserved aggregate |
| `kipkiren.read.transactions` | read_behavioural | No (high friction) | Transaction history (time-series spend pattern) |
| `kipkiren.read.statement` | read_aggregate | Yes | Periodic statement (aggregated by category and period) |
| `kipkiren.write.payments` | write_money | No (high friction; requires step-up) | Initiate payments |
| `kipkiren.write.payouts` | write_money | No (high friction; requires step-up) | Initiate payouts |
| `kipkiren.write.topup` | write_money | No (medium friction; user STK approval still required) | Initiate STK push top-up on user's behalf |
| `kipkiren.read.risk_score` | read_behavioural | No (high friction) | AI risk score on user's transactions (v1.1) |

### 2.3 Identiti

| ID | Category | Default grantable | Description |
|---|---|---|---|
| `identiti.read.tier` | read_aggregate | Yes | Current KYC tier (no tier-history detail) |
| `identiti.read.profile_minimal` | read_aggregate | Yes | Display name, account UUID |
| `identiti.read.profile_full` | read_behavioural | No (high friction) | Full profile including tier history, KYC artefact summaries |
| `identiti.write.kyc_submission` | write_identity | No (high friction; requires step-up) | Submit KYC on user's behalf (e.g. agent-assisted onboarding) |
| `identiti.stepup.request` | write_identity | No (medium; user-mediated) | Request a step-up challenge (user must complete) |

### 2.4 Todoku

| ID | Category | Default grantable | Description |
|---|---|---|---|
| `todoku.write.send` | write_comms | No (medium friction) | Send template-based message on user's behalf |
| `todoku.write.send_priority` | write_comms | No (high friction) | Send with elevated class (only with explicit per-scope grant) |
| `todoku.read.delivery_status` | read_aggregate | Yes | Read message delivery status (aggregate counts) |

### 2.5 Lunch Drop

| ID | Category | Default grantable | Description |
|---|---|---|---|
| `lunchdrop.read.orders` | read_aggregate | Yes | Order history (count, totals; no per-merchant detail) |
| `lunchdrop.read.orders_detail` | read_behavioural | No | Per-merchant order patterns (used to suggest weekly plans — high-friction grant) |
| `lunchdrop.write.orders` | write_money | No (high friction; requires step-up + delegated authority with limits) | Place orders on user's behalf |
| `lunchdrop.read.zone_feed` | read_aggregate | Yes | Personalised feed for the user |
| `lunchdrop.write.briefings` | write_identity | No (medium) | Create weekly-plan briefings |

### 2.6 Chapaa

| ID | Category | Default grantable | Description |
|---|---|---|---|
| `chapaa.read.position` | read_aggregate | Yes | Aggregate savings position (current balance, current goal progress — no time-series) |
| `chapaa.read.goals` | read_aggregate | Yes | Goal list and current progress per goal |
| `chapaa.read.behavioural` | read_behavioural | **No (high friction)** | Savings cadence, withdrawal patterns, goal-completion signal — **the credit signal**; per scan §6.3 this is the most-protected behavioural scope |
| `chapaa.write.deposit` | write_money | No (high friction; requires step-up) | Initiate deposits |
| `chapaa.write.withdraw` | write_money | No (high friction; requires step-up) | Initiate withdrawals |
| `chapaa.mmf.rebalance` | write_money | **No (high friction; requires step-up; v1.0 default suggest-only)** | Initiate MMF rebalance — autonomous-with-limits is v1.1 only |
| `chapaa.read.credit_unlock_status` | read_aggregate | Yes | Whether user has hit credit-unlock; not the underlying signal |

### 2.7 Klokd

| ID | Category | Default grantable | Description |
|---|---|---|---|
| `klokd.read.shifts` | read_aggregate | Yes | Available shifts matching user's profile |
| `klokd.read.worker_reputation` | read_aggregate | Yes | Aggregate reputation (verified shift count, average rating) |
| `klokd.read.worker_reputation_detail` | read_behavioural | No | Per-shift detail, time-series rating |
| `klokd.write.shift_signup` | write_identity | No (medium) | Sign up for shift on user's behalf |
| `klokd.write.shift_pay` | write_money | No (high friction; requires step-up) | Trigger pay-on-completion (employer-side agent) |

### 2.8 Family-discovery (Helpan [App Name])

| ID | Category | Default grantable | Description |
|---|---|---|---|
| `family_discovery.read.feed` | read_aggregate | Yes | Personalised discovery feed (family-friendly safety-policy-enforced) |
| `family_discovery.read.merchants` | read_aggregate | Yes | Merchant directory (verified merchants only) |
| `family_discovery.write.briefings` | write_identity | No (medium) | Create discovery briefings |
| `family_discovery.write.basket` | write_money | No (high friction; requires step-up + programmable money) | Standing-basket auto-replenishment |
| `family_discovery.read.basket_history` | read_aggregate | Yes | Past basket fulfillments |

---

## 3. Service-side scopes (consuming-app credentials, not user-grantable)

These are minted on `app_credentials` records, not on delegated authorities:

| ID | Category | Description |
|---|---|---|
| `helpan:authorities:issue` | service | App can issue delegated authorities (POST /authorities) for users in-session in its app |
| `helpan:authorities:revoke` | service | App can revoke its own apps' issued authorities (operator-side override is admin-only) |
| `helpan:authority:validate` | service | Relying parties (KP, Todoku) call validate endpoint |
| `helpan:actions:dispatch` | service | App or agent can dispatch actions |
| `helpan:events:ingest` | service | App can publish events for matching |
| `helpan:console:read` | service | App can render the Helpan Console for its users |
| `helpan:admin` | service | Operator-only; broad read/write across rail |
| `helpan:admin:pii` | service | Operator-only; access to PII-bearing fields |

---

## 4. Behavioural-detail scopes — friction design

Per Design Reference §6.3 and scan §6.3 — behavioural detail is the credit signal and must not leak under default consent.

The Helpan Console grant flow for `read_behavioural` scopes:

1. Standard grant flow shows scope name + description.
2. **Behavioural scope inserts a friction step**: a secondary screen explaining what behavioural data this scope unlocks, with concrete examples ("This will let X read when you save, how much, and how often").
3. Step-up confirmation required (5-minute fresh OTP).
4. Granted scope appears in Console with a special badge marking it behavioural.

This is intentional UX friction. Most users will not grant; the few who do are making a deliberate choice.

---

## 5. Scope deprecation

Scopes can be deprecated. Deprecation flow:

1. Operator sets `oauth_scopes.status = 'deprecated'`.
2. New authority issuance requesting deprecated scope returns `SCOPE_DEPRECATED` error.
3. Existing authorities with the scope continue to work until expiry.
4. After 90 days, operator sets `status = 'retired'`. Any remaining authorities with the scope fail validation with `scope_not_covered`.

---

## 6. v1.1 additions (forthcoming)

| Planned ID | Category | Reason |
|---|---|---|
| `helpan.agent.coordinate` | write_identity | Agent-to-agent coordination (v2.0 feature; placeholder reserved) |
| Cross-app aggregate scopes (e.g. `cross.read.balance` joining KP + Chapaa) | read_aggregate | v1.1 cross-app data access flows |
| `chapaa.mmf.rebalance.autonomous` | write_money | v1.1 graduation from suggest-only |
| `*.read.risk_score` (per-rail) | read_behavioural | When AI risk scoring is exposed to consuming apps (v1.1) |

---

## 7. Authoritative source documents

1. Helpan AI Rail Design Instruction Pack v1.0 §12.1
2. Helpan AI DoD/MVP v1.0 §4.5
3. Helpan AI Design Reference v1.0 §6.3 (behavioural data containment), §10 (third-party agent posture)
4. Scan Integration Memo v1.0 §6.3
5. Helpan AI Schema and ERD v1.0 (oauth_scopes table)

---

*Helpan AI Rail · OAuth Scope Catalogue v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential*
