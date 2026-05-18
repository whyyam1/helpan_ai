# Helpan AI Rail — Per-App Integration Patterns v1.0

**Document type:** Integration patterns for the four flagship Helpan AI consuming apps (priority order per DoD §3.2).
**Date:** 7 May 2026
**Authority:** Helpan AI Instruction Pack v1.0 §11; DoD/MVP v1.0 §3.2, §4.3; Design Reference v1.0 §8; Output Plan items 9 + 10 + 11 + 11.5 (consolidated).
**Companion docs:** OpenAPI v1.0; Delegated Authority Token Contract v1.0; Schema and ERD v1.0; OAuth Scope Catalogue v1.0; Threat Model v1.0; Event Bus Contract v1.0.

---

## 0. How to read

This document consolidates the four per-app integration patterns into one reference. Each app's section is independently readable. Common skeleton:

1. Strategic posture (cross-reference to Design Reference §8).
2. Capability list at v1.0.
3. Briefings the app supports.
4. Delegated authority shape (scopes, limits, TTLs).
5. Cross-rail dispatch flows.
6. Safety policy (per-app).
7. v1.1+ deferrals.

Order: Klokd (priority 1) → Lunch Drop (2) → Chapaa (3) → Family-discovery (4).

---

## 1. Helpan Klokd (priority 1)

### 1.1 Strategic posture
Casual labour marketplace agent. Beta live; highest integration readiness. The agent replaces a manual-coordination workflow (workers browsing for shifts; employers messaging workers to confirm). Defensibility: verified-worker reputation + same-day pay-on-completion via M-Pesa — neither replicable by general-purpose agents.

### 1.2 Capabilities at v1.0

| Capability | Surface |
|---|---|
| Worker-side: shift availability briefings | `POST /briefings` with `briefing_type: alert`, `intent` includes geo + category |
| Worker-side: shift sign-up | `POST /actions/dispatch` to `klokd.shift_signup` |
| Worker-side: pay-on-completion auto-receipt | Briefing fires on shift sign-off → KP payout via dispatch |
| Employer-side: shift-fill orchestration | Briefing matches verified workers → notifies → confirms via agent |
| Reputation surfacing | `klokd.read.worker_reputation` scope; aggregate only |

### 1.3 Briefings supported

```json
{
  "briefing_type": "alert",
  "intent": {
    "domain": "klokd.shift_search",
    "categories": ["hospitality", "retail"],
    "max_distance_km": 5,
    "time_window": {"start": "18:00", "end": "23:59", "tz": "Africa/Nairobi"},
    "min_pay_minor": 80000,
    "auto_signup": false
  }
}
```

`auto_signup: true` requires a delegated authority with `klokd.write.shift_signup` scope.

### 1.4 Delegated authority shape

Two patterns:

**Worker-side autonomous shift sign-up** (rare; user-elected only):
```json
{
  "scopes": [{
    "scope_id": "klokd.write.shift_signup",
    "per_period_limit_minor": 0,
    "period": "weekly"
  }],
  "ttl_seconds": 86400
}
```
No money in this scope; per-period count limit applied in app logic (max shifts per week).

**Employer-side pay-on-completion** (standard):
```json
{
  "scopes": [{
    "scope_id": "klokd.write.shift_pay",
    "amount_limit_minor": 200000,
    "per_period_limit_minor": 5000000,
    "period": "monthly"
  }],
  "ttl_seconds": 3600,
  "step_up_token": "<step-up JWT>"
}
```

### 1.5 Cross-rail dispatch flows

```
Worker shift sign-off in Klokd app
  → Klokd backend POST /v1/actions/dispatch
     X-Delegated-Authority: <employer authority>
     {
       account_uuid: <worker>,
       target_rail: "kipkiren_pay",
       target_operation: "payout.initiate",
       payload: {amount_minor: <shift pay>, destination_type: "mpesa", destination_ref: <worker phone token>}
     }
  → Helpan AI validates authority (scope kp.write.payouts via klokd.write.shift_pay mapping; amount within limit)
  → Helpan AI dispatches to KP
  → KP executes payout (verifies step-up jti from authority for audit)
  → Helpan AI publishes ACTION_COMPLETED
  → Klokd backend receives webhook; surfaces to worker
```

### 1.6 Safety policy

| Setting | Value |
|---|---|
| Audience posture | `general` |
| Category whitelist | (none — open category) |
| Category blacklist | (none) |
| Content moderation | Standard text filter |
| Location precision floor | `merchant_level` |

### 1.7 v1.0 KP gap dependencies

Per KP Gap Analysis:
- B.1 delegated authority validation (required)
- C.2 transactional hold/release for shift escrow (recommended; v1.0 workaround: payout on shift sign-off without hold)
- C.1 verification primitive (recommended; v1.0 workaround: app-side reconciliation against KP webhooks)
- C.6 refund (deferrable; v1.0 workaround: refund-via-payout on dispute)

### 1.8 v1.1 additions

- Bulk shift-fill with multi-worker delegated authority (employer issues one authority, agent signs up multiple verified workers).
- Reputation-based auto-signup (worker grants `klokd.write.shift_signup` with reputation-floor restriction).
- Dispute orchestration (C.7 from KP Gap Analysis).

---

## 2. Helpan Lunch Drop (priority 2)

### 2.1 Strategic posture
Food delivery agent. Augments ZoneFeed (does not replace). Volume-predictable, demonstrates agent rail capability cleanly. Defensibility: vendor-reliability data + local-merchant relationships not available to third-party agents.

### 2.2 Capabilities at v1.0

| Capability | Surface |
|---|---|
| ZoneFeed personalisation augmentation (suggestions only) | `lunchdrop.read.zone_feed` + agent runtime suggestion path |
| Weekly lunch plan briefings | `briefing_type: scheduled_action`, intent specifies recurrence |
| Reliability nudges ("your usual Mama hasn't been active") | Briefing matches `MERCHANT_INACTIVE` events from Lunch Drop |
| Order placement | `lunchdrop.write.orders` scope (with limits) |

### 2.3 Briefings supported

```json
{
  "briefing_type": "scheduled_action",
  "intent": {
    "domain": "lunchdrop.weekly_plan",
    "merchant_id": "mer_...",
    "schedule": "0 12 * * 1-5",   // weekdays at noon
    "menu_preference": ["chapati", "stew"],
    "max_per_order_minor": 80000,
    "fallback_merchant_ids": ["mer_...", "mer_..."]
  }
}
```

### 2.4 Delegated authority shape

```json
{
  "scopes": [{
    "scope_id": "lunchdrop.write.orders",
    "amount_limit_minor": 100000,
    "per_period_limit_minor": 3000000,
    "period": "weekly"
  }],
  "ttl_seconds": 86400,
  "step_up_token": "<step-up>"
}
```

### 2.5 Cross-rail dispatch flows

Weekly-plan execution (when programmable money lands per KP Gap Analysis C.3):
```
Cron-fired event in KP scheduler (programmable money)
  → KP triggers Lunch Drop hook (or Helpan AI cron via /actions/dispatch)
  → POST /actions/dispatch
     {target_rail: "kipkiren_pay", target_operation: "payment.execute",
      payload: {payee: <merchant>, amount, ...}}
  → Helpan AI validates authority
  → KP executes payment with order ref
  → ACTION_COMPLETED → Lunch Drop receives webhook → marks order placed
  → Lunch Drop dispatches order confirmation SMS via Helpan AI → Todoku
```

### 2.6 Safety policy

| Setting | Value |
|---|---|
| Audience posture | `general` |
| Category whitelist | Standard food categories |
| Category blacklist | (none) |
| Content moderation | Standard |
| Location precision floor | `merchant_level` |

### 2.7 v1.0 KP gap dependencies

- B.1 delegated authority validation (required)
- C.2 transactional escrow (recommended; v1.0 workaround: explicit refund via §C.6 if undelivered)
- C.3 programmable money (recommended for weekly plans; v1.0 workaround: app-side cron with user-confirmed payment per cycle)

### 2.8 v1.1 additions

- Cross-merchant standing baskets (multi-merchant single payment flow).
- Group order coordination (multiple users one order).
- Multi-stage escrow per line item (C.4 from Gap Analysis).

---

## 3. Helpan Chapaa (priority 3 — highest stakes)

### 3.1 Strategic posture
Savings agent. **Highest-stakes integration in the portfolio.** McKinsey deposits-at-34%-risk thesis lands here. Defensibility: commitment mechanics (locked savings, goals, streaks), Chama group savings, credit-unlock moment — none replicable by third-party agents.

### 3.2 Capabilities at v1.0

| Capability | Surface |
|---|---|
| Goal acceleration nudges | Briefing-fired suggestions, surfaced in Chapaa app |
| Round-up acceleration prompts | Briefing matches `WALLET_DEBITED` events from KP |
| MMF rebalancing — **suggest-only at v1.0** | Suggestion path; user confirms via standard flow |
| Chama support (top-up prompts, shortfall alerts) | Briefing-fired, app-rendered |
| Credit unlock orchestration | Aggregate read on `chapaa.read.credit_unlock_status` |
| Behavioural insights to user | App-side; agent renders insights without data crossing app boundary |

### 3.3 Briefings supported

```json
{
  "briefing_type": "threshold_watch",
  "intent": {
    "domain": "chapaa.goal_acceleration",
    "goal_id": "goal_...",
    "alert_when": "weekly_pace_below_target",
    "suggest_amount_minor": 20000
  }
}
```

```json
{
  "briefing_type": "alert",
  "intent": {
    "domain": "chapaa.round_up_offer",
    "min_unrounded_minor": 50,
    "max_round_up_minor": 20000
  }
}
```

### 3.4 Delegated authority shape

**v1.0 suggest-only** — no autonomous money movement. Suggestions surface as in-app cards; user confirms by tapping which triggers a normal in-session flow.

**v1.0 round-up auto-acceptance** (user-elected, money-touching):
```json
{
  "scopes": [{
    "scope_id": "chapaa.write.deposit",
    "amount_limit_minor": 30000,
    "per_period_limit_minor": 1000000,
    "period": "monthly"
  }],
  "ttl_seconds": 3600,
  "step_up_token": "<step-up>"
}
```

**v1.0 MMF rebalance — DOES NOT EXIST** as autonomous scope at v1.0. Suggest-only is the canonical v1.0 default. v1.1 adds `chapaa.mmf.rebalance` as autonomous-with-limits.

### 3.5 Cross-rail dispatch flows

Round-up auto-deposit (v1.0):
```
KP emits WALLET_DEBITED on payment of KES 4847
  → Helpan AI matching engine sees user's round-up briefing
  → Computes round_up = 153
  → Helpan AI POST /actions/dispatch
     X-Delegated-Authority: <user's chapaa.write.deposit authority>
     {target_rail: "kipkiren_pay", target_operation: "goals.deposit",
      payload: {goal_id: <user's primary goal>, amount_minor: 15300}}
  → Helpan AI validates authority (within amount and period limit)
  → KP executes goal deposit
  → ACTION_COMPLETED → Chapaa app shows updated goal progress
  → Notification via Todoku: "We added KES 153 to your school fees jar."
```

### 3.6 Safety policy

| Setting | Value |
|---|---|
| Audience posture | `general` |
| Behavioural-data containment | **STRICT** per Design Reference §8.3 — savings cadence, withdrawal patterns, goal completions |
| Cross-app default | Block — no third-party agent can read `chapaa.read.behavioural` under default scope |
| MMF rebalance posture | Suggest-only (v1.0) |

### 3.7 Credit-unlock partner-lender architecture (S.1 from Gap Analysis)

Per KP-D-09 in Reboot Pack, **lending is out at KP v1**. Chapaa's "save first, borrow later" credit-unlock requires partner-lender architecture:

```
Helpan Chapaa surfaces "you've unlocked KES 3,000 in micro-credit"
  → User taps to accept
  → Chapaa backend calls partner-lender API (out of Helpan AI scope)
  → Partner-lender disburses KES 3,000 to user's KP wallet via standard KP topup
  → KP emits WALLET_CREDITED
  → Chapaa backend records unlock event
  → Repayment scheduled via partner-lender (which may use KP programmable money for collection)
```

Helpan AI's role: surface the credit-unlock moment via aggregate scope `chapaa.read.credit_unlock_status`. Not the credit relationship itself.

### 3.8 v1.0 KP gap dependencies

- B.1 delegated authority validation (required)
- A.3 goal endpoints (already exist)
- B.2 counterfactual error context (recommended)
- C.3 programmable money (for auto-save scheduling; v1.0 workaround: round-up reactive to WALLET_DEBITED events)
- S.1 credit-unlock partner-lender architecture (counsel-led; **must close before Helpan Chapaa ships**)

### 3.9 v1.1 additions

- Autonomous MMF rebalancing with user-set risk limits (`chapaa.mmf.rebalance` autonomous).
- Cross-app behavioural read (with explicit consent + cross-app data access flow).
- Chama group savings agent (multiple users, one chama briefing).

---

## 4. Helpan [App Name] — family-discovery (priority 4)

### 4.1 Strategic posture
Agent-native from day one. The agent IS the primary interaction model. Defensibility: family-friendly safety policy + standing-basket auto-replenishment via programmable money — neither replicable by general-purpose agents.

### 4.2 Capabilities at v1.0

| Capability | Surface |
|---|---|
| Briefing-based real-time discovery | `briefing_type: alert`, intent specifies category + geo |
| Standing-basket auto-replenishment | `briefing_type: standing_basket`, requires programmable money (KP C.3) |
| Merchant-side AI clienteling (broadcast drafting) | Out of scope at agent rail level — lives in app's own surface |
| Family-friendly safety enforcement | Per-app safety policy (audience_posture: family_friendly) |
| Helpan Console integration | Standard React Native shared library |

### 4.3 Briefings supported

```json
{
  "briefing_type": "alert",
  "intent": {
    "domain": "family_discovery.fresh_arrivals",
    "categories": ["fresh_fish", "vegetables"],
    "max_distance_km": 2,
    "time_window": {"start": "06:00", "end": "18:00"},
    "max_price_minor": 100000
  }
}
```

```json
{
  "briefing_type": "standing_basket",
  "intent": {
    "domain": "family_discovery.basket_auto_refill",
    "schedule": "0 14 * * 0",   // Sundays at 14:00
    "merchant_ids": ["mer_...", "mer_...", "mer_...", "mer_..."],
    "items": [{"sku": "tomatoes_2kg", "max_price_minor": 30000}, ...],
    "max_total_minor": 250000
  }
}
```

### 4.4 Delegated authority shape

```json
{
  "scopes": [{
    "scope_id": "family_discovery.write.basket",
    "amount_limit_minor": 250000,
    "per_period_limit_minor": 2000000,
    "period": "monthly",
    "category_whitelist": ["fresh_fish", "vegetables", "fruit", "grains"]
  }],
  "ttl_seconds": 86400,
  "step_up_token": "<step-up>"
}
```

### 4.5 Cross-rail dispatch flows

Standing-basket execution requires KP programmable money (Gap Analysis C.3):

```
KP scheduler fires (Sunday 14:00, scheduled per programmable money)
  → KP calls Helpan AI dispatch (or app-mediated dispatch on user's behalf)
  → Helpan AI runs:
     - Validate basket-authority still valid + within limits
     - Run safety policy check on each line item (categories must be in whitelist)
     - Run merchant verification primitive (KP C.1) per line item
     - Dispatch to KP for transactional escrow on each line (C.2)
       OR multi-stage escrow if available (C.4)
  → For each delivered line: KP releases hold to merchant
  → For undelivered lines: KP refunds hold to user
  → Notification via Todoku
```

### 4.6 Safety policy

| Setting | Value |
|---|---|
| Audience posture | **`family_friendly`** |
| Category whitelist | Family-safe food, household, baby goods, school supplies, basic clothing |
| Category blacklist | Nightlife, alcohol-led venues, adult content (anywhere) |
| Content moderation | Strict text + image moderation |
| Location precision floor | `merchant_level` (no neighborhood-level tracking) |
| User-to-user agent communication | Disabled |

### 4.7 v1.0 KP gap dependencies

- B.1 delegated authority validation (required)
- **C.3 programmable money (REQUIRED — standing-basket has no graceful workaround)**
- **C.2 transactional escrow (REQUIRED — basket pending delivery)**
- C.4 multi-stage escrow (recommended; v1.0 workaround: single-stage hold per line item)
- C.1 merchant verification primitive (recommended; v1.0 workaround: app-side merchant-payment-history check)

### 4.8 Brand-name placeholder

Per Confirmation Memo §5.5, the app's name is TBD. All references in this section use `[App Name]` literal placeholder; search-and-replace at name-lock time. Stage 0–1 acceptable; freeze before Stage 2.

### 4.9 v1.1 additions

- Cross-merchant baskets (single basket spans multiple merchants — single user authority).
- Predictive intent (agent suggests baskets without explicit briefing — requires behavioural maturity not available at launch).
- Multi-household coordination (basket shared across household members).

---

## 5. Cross-app patterns

### 5.1 Common briefing schema atoms

Apps SHOULD use these intent atoms when applicable for consistency:
- `geo`: `{lat, lng, max_distance_km}`
- `time_window`: `{start, end, tz, dows}`
- `monetary`: `{currency: "KES", amount_minor}`
- `categories`: `[string]`
- `recurrence`: cron string + tz

### 5.2 Cross-app event correlation

When a Helpan-mediated business operation chains across apps (rare but possible — e.g. Klokd shift completion triggers Chapaa round-up), traceparent propagates per Reboot Pack §5; correlation ID via app_correlation_id on dispatch.

### 5.3 Cross-app data access (deferred to v1.1)

Per DoD §5, full cross-app data access flows are v1.1. v1.0: each app's agent reads own-app data only.

---

## 6. v1.0 launch criteria summary per app

| App | Hard gates | Soft gates | Deferrals |
|---|---|---|---|
| Helpan Klokd | B.1, A.2 (existing) | B.2, C.1 | C.2, C.6, C.7 → v1.1 |
| Helpan Lunch Drop | B.1 | B.2, C.3 | C.2, C.4 → v1.1 |
| Helpan Chapaa | B.1, A.3 (existing), S.1 | B.2 | C.3, C.11 → v1.1 |
| Helpan [App Name] | B.1, **C.3, C.2** | C.1 | C.4 → v1.1 |

(IDs reference KP Gap Analysis §6 buckets.)

---

## 7. Authoritative source documents

1. Helpan AI Rail Design Instruction Pack v1.0 §11
2. DoD/MVP v1.0 §3.2, §4.3
3. Design Reference v1.0 §8 + Amendment §A
4. KP Gap Analysis v1.0 + Amendment §A
5. OAuth Scope Catalogue v1.0
6. Delegated Authority Token Contract v1.0
7. Threat Model v1.0

---

*Helpan AI Rail · Per-App Integration Patterns v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential · Consolidates Output Plan items 9, 10, 11, 11.5*
