# Helpan AI Rail — Kipkiren Pay Gap Analysis v1.0

**Document type:** Cross-rail gap analysis (recommendation-class).
**Owner:** Helpan AI Rail Design Session (Output Plan item 8).
**Recipient:** Chamia Mutuku, CEO & CPO; Kipkiren Pay engineering (currently Chamia, wearing the KP hat).
**Date:** 7 May 2026
**Status:** Recommendation-class output per Confirmation Memo §5.4. This document does **not** bind Kipkiren Pay scope. It surfaces the delta between today's KP surface and what Helpan AI consuming-app integrations need, classifies each gap, and recommends a disposition. Final scope decisions are Chamia's after KP engineering reviews feasibility.

**Authority sources:**
- Helpan AI Rail Design Instruction Pack v1.0 §9 (Kipkiren Pay integration); §11 (per-app integrations).
- Helpan AI Rail DoD/MVP v1.0 §4.3 (consuming-app v1.0 capabilities).
- Helpan AI Rail Design Reference v1.0 §7 (A2A bypass defence); §8 (per-app strategic posture).
- Platform Rails Reboot Pack v1.2 §6 (Kipkiren Pay locked decisions); §15 (corpus map).
- Claude Code Instruction Pack v1.0 §5 (Kipkiren Pay build brief — current v1 endpoint inventory).
- App Integration Guide v1.0 (Chamia-canonical, 30 April 2026) §6 (cross-rail flows).

---

## 0. How to read this document

This is a gap analysis between two surfaces:

1. **What Helpan AI consuming-app integrations need from Kipkiren Pay** — derived from the Helpan AI Instruction Pack §9 and §11, and from the per-app strategic posture in the Design Reference §8.
2. **What Kipkiren Pay v1 currently exposes** — derived from the Claude Code Instruction Pack v1.0 §5 endpoint inventory and the Reboot Pack v1.2 §6 locked decisions.

Each gap is classified into one of three buckets per Instruction Pack §9.4:

- **Bucket A** — Capability exists, agent-native already; needs only contract documentation.
- **Bucket B** — Capability exists; needs refactoring for clean agent-native consumption.
- **Bucket C** — Capability does not exist; must be added to the Kipkiren Pay backlog.

For each gap, the document names: which Helpan AI consuming app needs it, what severity (v1.0 hard blocker / v1.0 soft / v1.1 / further), what the recommendation is, and the implementation complexity estimate.

§7 maps each Helpan AI consuming-app integration to its specific blockers. §8 is the consolidated punch list — the single document Chamia and KP engineering work through to decide v1.0 KP scope.

---

## 1. Executive summary

Today's Kipkiren Pay v1 surface, as captured in the Claude Code Instruction Pack §5, supports **wallet-bearing customers transacting on M-Pesa via app-mediated flows**. The endpoints assume a human is in the loop on every payment, every payout, and every savings-goal action. Step-up authentication is the security primitive; the human's session is the trust anchor.

Helpan AI introduces a different consumer: **agents acting on the user's behalf, often asynchronously, under delegated authority**. The endpoint shape that works for human-mediated flows is not always the shape that works for agent-mediated flows. Some KP capabilities are already close enough that documentation and minor parameter additions are sufficient. Others require explicit refactoring (notably accepting `X-Delegated-Authority` and emitting agent-friendly error context). Still others — programmable money, transactional escrow, the verification primitive, refund and dispute orchestration, AI risk scoring exposed to consuming apps, the counterfactual explainer — are not in KP v1 today and must be added if Helpan AI is to deliver its v1.0 promise.

**Top-line counts (the detail is in §6):**

| Bucket | Count | What it means |
|---|---|---|
| A — Already agent-native or close | 4 capabilities | Documentation work. Days, not weeks. |
| B — Existing, needs refactor | 4 capabilities | Real engineering. Weeks per capability. |
| C — New capabilities | 11 capabilities | Real engineering plus product/regulatory work. The bulk of the gap. |

**Helpan AI consuming-app blocker map (the detail is in §7):**

| Consuming app | v1.0 hard blockers in KP | v1.0 soft blockers | v1.1+ |
|---|---|---|---|
| Helpan Klokd | Delegated authority on payment + payout; transactional hold/release | Verification primitive; refund | Dispute orchestration |
| Helpan Lunch Drop | Delegated authority on payment | Programmable money (for weekly plans) | AI dispute support |
| Helpan Chapaa | Delegated authority on goal deposit/withdraw; **MMF rebalance is fundamentally new** | Counterfactual explainer | **Credit unlock — needs KP lending or external lender integration** |
| Helpan [App Name] (family-discovery) | Programmable money; multi-stage escrow | Merchant verification primitive | Conditional release patterns |

**The headline coordination ask:** the Helpan AI v1.0 build cannot complete without resolution on **delegated authority validation in KP** (Bucket B refactor, ~3 weeks), **programmable money** (Bucket C new, ~6 weeks), and **transactional escrow / hold-release** (Bucket C new, ~4 weeks). These three are the long-pole items. Everything else can ship in v1.1 with documented stub patterns or app-side workarounds at v1.0.

---

## 2. The recommendation-class disclaimer

Per Confirmation Memo §5.4, this document is recommendation-class. It does not bind KP scope. Specifically:

- **Severity ratings** in §6 and §8 reflect Helpan AI's consuming-app needs. They are not commitments by KP engineering.
- **Complexity estimates** are first-order. KP engineering's review may reveal architectural constraints that change them materially.
- **Recommendations** are this session's best read. Chamia decides scope after KP engineering reviews feasibility.
- **Where this document and Reboot Pack v1.2 §6 (KP locked decisions) conflict, Reboot Pack wins.** This document surfaces conflicts; it does not override KP-D-01 through KP-D-10.

The output of this analysis is a punch list (§8) plus a recommended sequencing (§9). The decisions on the punch list are Chamia's, in consultation with KP engineering, after this analysis lands.

---

## 3. Methodology

For each capability Helpan AI requires (per Instruction Pack §9.1):

1. Locate the corresponding KP v1 endpoint or capability in the Claude Code Instruction Pack §5 inventory.
2. If present and agent-suitable as-is → **Bucket A**.
3. If present but requires changes (parameters, headers, response shape, or error semantics) for agent consumption → **Bucket B**.
4. If absent → **Bucket C**.

For each gap:

5. Identify which Helpan AI consuming-app integration(s) need it (per Instruction Pack §11 and DoD §4.3).
6. Classify severity: **v1.0 hard blocker** (Helpan AI v1.0 cannot launch without it), **v1.0 soft** (workaround possible at v1.0; ideal to ship in v1.0), **v1.1 deferral** (acceptable to defer with documented stub/workaround), or **further** (post-v1.1).
7. Estimate complexity: **S** (≤1 week), **M** (1–4 weeks), **L** (4–12 weeks), **XL** (>12 weeks or substantial regulatory work).
8. Recommend disposition.

---

## 4. Inventory of Helpan AI's requirements from Kipkiren Pay

Drawn verbatim from Instruction Pack §9.1 plus the per-app capability lists in §11 and DoD §4.3.

### 4.1 Existing capabilities to be exposed agent-natively

1. Payment (STK push, card)
2. Verification primitive (`verify_recent_payment`)
3. Hold / release / escrow (transactional)
4. Refund
5. Dispute initiation
6. Statement and balance queries
7. Settlement and payout (for merchant-side agents)

### 4.2 Newly elevated capabilities (Phase 2 → v1)

8. Programmable money / scheduled transfers as a public API
9. Conditional release patterns (release on event X, refund on event Y)
10. Multi-stage escrow patterns (relevant for the family-discovery app's standing-basket auto-replenishment)

### 4.3 Existing AI capabilities reframed as defensibility moats

11. Real-time AI risk scoring on every agent-initiated transaction
12. AI-mediated dispute resolution support exposed to the consuming app
13. Counterfactual transaction explainer ("why was this declined?") exposed to the agent
14. Reconciliation classification (rail-internal but visible to ops)

### 4.4 Cross-cutting requirements (every endpoint)

15. **Delegated authority token validation.** Every agent-initiated KP call presents an `X-Delegated-Authority` header. KP must validate the token against Helpan AI's `POST /authorities/{id}/validate` endpoint per call, check the scope covers the operation, check amount/limit constraints, and reject revoked tokens immediately regardless of other validation.
16. **Cross-rail idempotency.** App Integration Guide §7.6 mandates the UUIDv5 derivation pattern for cross-rail business operations. KP idempotency must support this without re-architecture.
17. **Counterfactual error responses.** When an agent action is rejected, the response must contain enough context for the agent to explain to the user (e.g., "tier limit exceeded — current tier is tier_1 with KES 20,000 single-tx limit; this transaction was KES 25,000").

### 4.5 Specific consumer-app capabilities

Per DoD §4.3 and Design Reference §8:

18. **Helpan Klokd:** M-Pesa-native pay-on-completion; worker reputation signal (KP not the source — included for completeness; lives in Klokd's data model, not KP).
19. **Helpan Lunch Drop:** weekly lunch plan via programmable money; escrow on order pending delivery.
20. **Helpan Chapaa:** goal deposit/withdraw under delegated authority; MMF rebalancing within user-set limits between CMA-licensed partner MMFs; credit-unlock orchestration (Chapaa's "save first, borrow later" mechanic).
21. **Helpan [App Name]:** standing-basket auto-replenishment; multi-stage escrow on basket delivery; merchant verification primitive.

---

## 5. Inventory of Kipkiren Pay's current v1 surface

Drawn from the Claude Code Instruction Pack v1.0 §5 endpoint inventory and Reboot Pack v1.2 §6 locked decisions.

### 5.1 Endpoints in KP v1 (per Claude Code Instruction Pack §5.3)

| Phase | Endpoint | Purpose |
|---|---|---|
| 1 | `GET /v1/health` | Liveness |
| 1 | (auth middleware) | HMAC-SHA-256 verification |
| 1 | (idempotency middleware) | `X-Idempotency-Key` enforcement, 24-hour replay window |
| 2 | `POST /v1/accounts` | Create wallet for an Account UUID |
| 2 | `GET /v1/accounts/{account_uuid}/wallet` | Read wallet balance (spendable + reserved) |
| 2 | (Kafka consumer) | `accounts/{uuid}/tier` updates from Identiti |
| 3 | `POST /v1/topups/mpesa/stk-push` | Initiate Daraja STK push |
| 3 | `POST /v1/topups/mpesa/callback` | Daraja callback receiver |
| 4 | `POST /v1/payments/execute` | Execute payment; enforces tier limits in serialisable transaction |
| 4 | `GET /v1/payments/{payment_id}` | Retrieve payment status |
| 4 | `GET /v1/payments/{payment_id}/events` | Payment event history |
| 5 | `POST /v1/payouts/initiate` | Initiate payout to M-Pesa or bank |
| 5 | `GET /v1/payouts/{payout_id}` | Retrieve payout status |
| 6 | `POST /v1/goals` | Create savings goal ringfence |
| 6 | `GET /v1/goals/{goal_id}` | Retrieve goal status |
| 6 | `POST /v1/goals/{goal_id}/deposit` | Deposit from spendable wallet to goal |
| 6 | `POST /v1/goals/{goal_id}/withdraw` | Withdraw from goal to spendable wallet |
| 7 | `POST /v1/operator/accounts/{uuid}/tier` | Operator tier override |
| 7 | `GET /v1/operator/wallets/{wallet_id}/ledger` | Operator ledger view |
| 7 | `POST /v1/operator/payments/{payment_id}/reverse` | Operator-initiated reversal (compensating entry) |

### 5.2 Locked exclusions (per Reboot Pack v1.2 §6)

The following are explicitly out of scope for KP v1 per KP-D-09:
- Cards (KP-D-03)
- Multi-currency / cross-border
- **Lending**
- Settlement utility to other PSPs
- Designated payment instruments
- Own agent network
- Tier 2 self-elected promotion
- **Bulk payouts above 100 per request**

KP-D-07 leaves the Reg 25(5) Chapaa yield model as an **open determination** — pending counsel and CBK pre-application meeting.

### 5.3 Authentication and authorisation today

Per Claude Code Instruction Pack §4 and App Integration Guide §6.2 step 5:
- HMAC-SHA-256 + mTLS for app-to-rail authentication.
- **Step-up tokens** (RS256 JWT issued by Identiti) for sensitive operations, validated locally by KP against Identiti's JWKS (5-minute cache).
- Step-up token format and lifecycle defined in Identiti Rail Contract §14.
- KP validates `step_up_token` against `step_up_tokens` table for single-use enforcement.

There is **no concept of delegated authority** in KP v1 today. The trust anchor is the user's live session (encoded in the step-up token's freshness window).

---

## 6. The gap analysis — three buckets

### 6.1 Bucket A — Capability exists; agent-native or close; documentation only

These capabilities work as-is for agent consumption, modulo the cross-cutting `X-Delegated-Authority` header (covered in §6.2 as a Bucket B refactor that affects every endpoint).

#### A.1 — Wallet balance read

| | |
|---|---|
| KP today | `GET /v1/accounts/{account_uuid}/wallet` — returns `{spendable, reserved}` |
| Helpan AI need | Agents read aggregate balance (Helpan Chapaa "your current balance," third-party agent under `kipkiren.read.balance` scope) |
| Gap | None on the endpoint itself. Documentation work only. |
| Severity | n/a |
| Complexity | S |
| Recommendation | Document for agent consumption. Confirm response shape is agent-parseable (it is per §5). |

#### A.2 — Payout to M-Pesa

| | |
|---|---|
| KP today | `POST /v1/payouts/initiate` — initiates payout; supports M-Pesa and bank destinations; Daraja B2C wrapper |
| Helpan AI need | Helpan Klokd pay-on-completion; Helpan Chapaa withdrawal to M-Pesa |
| Gap | Endpoint shape works. Needs delegated authority support (Bucket B). |
| Severity | n/a (the endpoint itself); v1.0 hard blocker (the delegated authority extension — see B.1) |
| Complexity | S (just the documentation) |
| Recommendation | Document. The auth extension is in B.1. |

#### A.3 — Goal create / deposit / withdraw

| | |
|---|---|
| KP today | `POST /v1/goals`, `GET /v1/goals/{id}`, `POST /v1/goals/{id}/deposit`, `POST /v1/goals/{id}/withdraw` |
| Helpan AI need | Helpan Chapaa goal acceleration; round-up; goal completion. |
| Gap | Endpoints exist. Need delegated authority support (B.1). Need yield disposition stable (KP-D-07 open). |
| Severity | n/a (endpoint); v1.0 hard blocker (delegated authority); KP-D-07 is independent of Helpan AI |
| Complexity | S (documentation) |
| Recommendation | Document. Note the yield disposition is on a separate clock (counsel + CBK). |

#### A.4 — M-Pesa STK push (top-up)

| | |
|---|---|
| KP today | `POST /v1/topups/mpesa/stk-push` |
| Helpan AI need | Agents trigger top-up on user's behalf — but per design law §6.4 (regulatory containment) the **user must approve the STK on their handset**, so this is fundamentally human-in-the-loop. |
| Gap | None. Agents can trigger; user always approves. |
| Severity | n/a |
| Complexity | S |
| Recommendation | Document the agent-initiated trigger pattern explicitly in Helpan AI's per-app integration patterns. |

### 6.2 Bucket B — Capability exists; needs refactor for agent-native consumption

#### B.1 — Delegated authority token validation across every existing endpoint

| | |
|---|---|
| KP today | Validates step-up tokens (RS256 JWT) on payment/payout where required, against Identiti JWKS. No concept of delegated authority. |
| Helpan AI need | Every agent-initiated KP call carries `X-Delegated-Authority: <token>`. KP must: (1) parse the header; (2) call `POST /authorities/{id}/validate` on Helpan AI; (3) check scope covers the operation; (4) check amount within scope limits; (5) reject revoked tokens immediately, regardless of other validation. |
| Gap | Cross-cutting addition: every existing endpoint that today accepts step-up tokens must additionally accept and validate delegated authority. The two are not interchangeable — step-up is for human-in-the-loop, delegated authority is for agent-on-behalf. They should compose: an endpoint that requires step-up under human flow may instead accept delegated authority under agent flow. |
| Severity | **v1.0 hard blocker — every Helpan AI integration depends on this.** |
| Complexity | M (middleware + per-endpoint integration + cache + revocation propagation handler) |
| Recommendation | Implement as a Fastify plugin (`@kmv/platform-shared/fastify-delegated-authority`) parallel to the existing auth plugin. Plugin: (a) reads `X-Delegated-Authority`; (b) calls Helpan AI validation endpoint with 60-second positive cache, no negative cache; (c) attaches `request.delegatedAuthority` to the Fastify request context; (d) exposes a `requireDelegatedAuthority({scope, amountFn})` helper for route handlers. **This is the single largest unblocker for Helpan AI v1.0.** |

#### B.2 — Payment execute — counterfactual error context

| | |
|---|---|
| KP today | `POST /v1/payments/execute` returns generic error envelope on rejection (e.g., `TIER_LIMIT_EXCEEDED`, `INSUFFICIENT_FUNDS`). |
| Helpan AI need | Counterfactual explainer (§4.3 #13) — the agent must be able to explain to the user *why* the action failed in concrete terms. "Tier limit exceeded" is not enough; "current tier is tier_1 with a per-transaction limit of KES 20,000; this transaction was KES 25,000" is. |
| Gap | Error envelope must include `detail` fields with the comparison values. |
| Severity | v1.0 soft (workaround: app-side error decoration with cached tier signal — possible but error-prone). |
| Complexity | S–M (data is already in scope of the rejecting code path; just needs structured emission). |
| Recommendation | Add `detail` to all rejection error envelopes per the App Integration Guide §7 error shape. Specifically: `TIER_LIMIT_EXCEEDED.detail = {tier, per_tx_limit_minor, rolling_30d_limit_minor, requested_minor, period_used_minor}`. Same pattern for `INSUFFICIENT_FUNDS`, `STEP_UP_TOKEN_INVALID`, etc. |

#### B.3 — Operator ledger and reversal — app-callable equivalents

| | |
|---|---|
| KP today | `GET /v1/operator/wallets/{wallet_id}/ledger` and `POST /v1/operator/payments/{payment_id}/reverse` are **operator-only**. |
| Helpan AI need | Apps need (a) a customer-scoped statement endpoint (the "transaction history" scope `kipkiren.read.transactions`); (b) a customer-scoped refund endpoint that does not require operator intervention. |
| Gap | Two new app-tier endpoints; the operator endpoints stay as-is for ops. |
| Severity | v1.0 soft for statement (most consuming apps already maintain transaction history app-side); v1.0 hard for refund (Helpan Klokd disputes, Helpan Lunch Drop order cancellations) — though "hard" can be downgraded if app-initiated refund is restricted to specific, low-risk patterns at v1.0. |
| Complexity | M (statement: light; refund: real, because of compensating-entry pattern + dispute interaction) |
| Recommendation | Statement first (M-S, ~1 week). Refund deferred to v1.1 if dispute-orchestration framework not ready; v1.0 ships with app-mediated refund-via-payout pattern (app initiates a payout to the customer for the refund amount, with a clear `refund_for=<payment_id>` correlation). Document the workaround. |

#### B.4 — Cross-rail idempotency UUIDv5 derivation pattern

| | |
|---|---|
| KP today | `X-Idempotency-Key` UUIDv4, 24-hour window, scoped per (key, app_id) per the Claude Code Instruction Pack §3.3. |
| Helpan AI need | App Integration Guide §7.6 mandates UUIDv5 deterministic derivation per rail per business_op_id. KP today accepts any UUID — UUIDv5 vs v4 is structurally identical at the wire level. |
| Gap | None at the wire level. The pattern is app-side derivation; KP doesn't care about the version. |
| Severity | n/a |
| Complexity | S (documentation only — confirm that any UUID format is acceptable, not just v4) |
| Recommendation | Document explicitly in the agent-native KP integration guide that UUIDv5 derivation is the recommended pattern for cross-rail business operations. No KP code change. |

### 6.3 Bucket C — New capabilities (not in KP v1; must be added)

#### C.1 — Verification primitive (`verify_recent_payment`)

| | |
|---|---|
| Helpan AI need | A way for an agent (or any consuming app) to ask "did account X make a payment of Y to merchant Z within window W?" without giving the agent full transaction-read access. Example: Helpan Klokd verifying a worker has been paid for a recent shift before allowing next sign-up. |
| Gap | Entirely new endpoint. |
| Severity | v1.0 soft for Helpan Klokd (workaround: app-side reconciliation against KP webhooks); v1.0 hard for the family-discovery app's merchant verification (merchants prove they've delivered before basket releases). |
| Complexity | M (~2 weeks). New endpoint, indexed query against ledger, scope `kipkiren.payments.verify`, audit-friendly response. |
| Recommendation | Build for v1.0. The endpoint is simple to specify; the value across multiple consuming apps is high. Spec: `POST /v1/payments/verify` with `{payer_account_uuid, payee_account_uuid, amount_minor, window_start, window_end, reference}` returning `{verified: bool, payment_ids?: [...], confidence: high|medium|low}`. Daraja does not expose this; this is one of the strongest A2A bypass defences (Design Reference §7.2). |

#### C.2 — Transactional hold / release

| | |
|---|---|
| Helpan AI need | An agent can hold an amount in the user's wallet pending an event, then release or refund based on outcome. Example: Helpan Klokd holds shift pay at acceptance, releases on completion. Different from goals (which are user-savings ringfences); this is transactional escrow on a per-payment basis. |
| Gap | Entirely new capability. KP today has `wallets.reserved_bal` in the schema (per Claude Code Instruction Pack §5.2) but no app-callable hold/release endpoints. |
| Severity | **v1.0 hard for Helpan Klokd; v1.0 hard for Helpan Lunch Drop (escrow on order pending delivery).** |
| Complexity | L (~4 weeks). New endpoint family: `POST /v1/holds` (create), `POST /v1/holds/{id}/release` (commit to payee), `POST /v1/holds/{id}/refund` (return to payer). Ledger postings per `entry_type=reserve|release` already exist in the schema; the user-facing endpoints don't. |
| Recommendation | Build for v1.0. Two of four consuming apps depend on this. Long-pole item — start as soon as B.1 (delegated authority) is in flight. |

#### C.3 — Programmable money / scheduled transfers

| | |
|---|---|
| Helpan AI need | Standing-basket auto-replenishment for the family-discovery app; weekly lunch plan for Helpan Lunch Drop; scheduled transfers for Helpan Chapaa (auto-save). The user briefs the agent once; the agent uses programmable money to schedule the transfer. |
| Gap | Entirely new capability. Reboot Pack §6 does not mention programmable money in the v1 locked decisions. Helpan corpus elevated this from Phase 2 to v1 (Instruction Pack §3.8). |
| Severity | **v1.0 hard for the family-discovery app (the entire standing-basket feature depends on it)**; v1.0 soft for Helpan Lunch Drop (workaround: app-side cron + user-confirmed payment per cycle); v1.0 soft for Helpan Chapaa auto-save (same workaround). |
| Complexity | L (~6 weeks). New endpoint family: `POST /v1/schedules` (create scheduled action — payment, payout, goal-deposit, hold-create), `GET /v1/schedules/{id}`, `DELETE /v1/schedules/{id}`. Internal: scheduler worker, idempotent execution per scheduled occurrence, failure handling (retries, user notification, schedule pause). Compliance: every scheduled execution requires a delegated authority that is still valid at execution time. |
| Recommendation | Build for v1.0. The family-discovery app's launch thesis depends on it. Start in parallel with B.1 (the two are the longest-pole items together). |

#### C.4 — Multi-stage escrow patterns

| | |
|---|---|
| Helpan AI need | Family-discovery app standing-basket: basket has multiple line items from different farms; each line item has its own delivery confirmation; the basket is paid for upfront, and each line releases to its respective farmer on delivery. Multi-stage escrow with per-stage release. |
| Gap | New capability built on C.2 (single-stage hold/release). |
| Severity | v1.0 soft (single-stage hold per C.2 covers most patterns; multi-stage is the family-discovery app's distinctive feature but can ship with a v1.0 single-stage workaround per line item). |
| Complexity | M (~2–3 weeks once C.2 is in place). Addition: `POST /v1/holds/{id}/stages` to attach release conditions per stage; release/refund operate per stage. |
| Recommendation | Build in v1.1 unless the family-discovery app launch sequencing requires it earlier. Single-stage hold-per-line-item is the v1.0 workaround. |

#### C.5 — Conditional release patterns (release on event X)

| | |
|---|---|
| Helpan AI need | Release a hold when an event fires (delivery confirmed, shift completed, milestone reached). |
| Gap | Adjacent to C.2 but driven by event matching. |
| Severity | v1.0 soft (workaround: app subscribes to its own event stream, calls C.2 release endpoint when the matching event fires). |
| Complexity | M (~2 weeks). Addition: `POST /v1/holds/{id}/conditions` to register a condition; KP subscribes to the consuming-app event topic; release auto-fires on match. |
| Recommendation | v1.1. The app-side workaround is mechanical and the v1.0 architecture supports it. |

#### C.6 — Refund (app-initiated, not operator-only)

| | |
|---|---|
| Helpan AI need | Helpan Klokd dispute-driven refund; Helpan Lunch Drop order-cancellation refund. App-initiated, not operator-mediated. |
| Gap | KP today has `POST /v1/operator/payments/{payment_id}/reverse` (operator-only). No app-tier refund endpoint. |
| Severity | v1.0 soft (workaround: app-mediated refund-via-payout, with `refund_for=<payment_id>` correlation). v1.1 hard (every consuming app eventually needs this). |
| Complexity | M (~2–3 weeks). New endpoint: `POST /v1/payments/{id}/refund`; same compensating-entry pattern as operator reversal but with delegated-authority gating and per-tenant scope. |
| Recommendation | v1.1. v1.0 ships with the documented refund-via-payout workaround. |

#### C.7 — Dispute initiation and orchestration

| | |
|---|---|
| Helpan AI need | Disputes between counterparties (worker vs employer, customer vs merchant). Agent can initiate on user's behalf. |
| Gap | Entirely new capability domain. |
| Severity | v1.1. No consuming app has dispute as a v1.0 hard requirement; the family-discovery app and Helpan Klokd may surface dispute needs in production but the rail can ship without it at v1.0. |
| Complexity | L (~6–8 weeks). New endpoint family: `POST /v1/disputes`, `GET /v1/disputes/{id}`, `POST /v1/disputes/{id}/respond`, plus operator-side resolution flows. |
| Recommendation | v1.1. Document the gap; stage cleanly so v1.0 KP architecture does not preclude it. |

#### C.8 — AI risk scoring exposed to consuming apps

| | |
|---|---|
| Helpan AI need | Real-time risk score on every agent-initiated transaction, exposed to the consuming app for display ("this looks unusual — confirm?") or as input to the agent's reasoning. |
| Gap | KP today has internal risk scoring (mentioned in Instruction Pack §9.1 reframing); not exposed externally. |
| Severity | v1.1 (the rail can ship without; reframe value comes from exposing it, but it isn't blocker-class). |
| Complexity | M (~3 weeks). Addition: `risk_score` field on payment/payout responses; scope `kipkiren.read.risk_score`; latency budget protection (the risk model must be fast enough not to add user-visible latency). |
| Recommendation | v1.1. Strong defensibility moat per Design Reference §7.2 — surface the score early in v1.1 to start accumulating user comparison data. |

#### C.9 — AI-mediated dispute resolution support

| | |
|---|---|
| Helpan AI need | When a dispute is initiated, KP's AI offers structured suggestions ("evidence X supports the disputer; evidence Y supports the disputed") to the consuming app. |
| Gap | Builds on C.7 (disputes). |
| Severity | v1.1+ (depends on C.7). |
| Complexity | L (~4 weeks once C.7 ships). |
| Recommendation | v1.2. Defer past initial dispute orchestration. |

#### C.10 — Counterfactual transaction explainer

| | |
|---|---|
| Helpan AI need | Per §4.3 #13 — for any KP rejection or surprising outcome, the agent gets a structured explanation it can render to the user. Adjacent to B.2 (counterfactual error context) but goes further: explains *unrejected* outcomes too ("payment succeeded; here is why this routing was chosen"). |
| Gap | New endpoint or response decoration. |
| Severity | v1.0 soft (B.2 covers the rejection case; the unrejected case is a v1.1 enhancement). |
| Complexity | M (~3 weeks). Addition: `explanation` field on responses (structured), or new `POST /v1/payments/{id}/explain` endpoint for retrospective queries. |
| Recommendation | v1.1. Ship B.2 (rejection counterfactual) at v1.0; full explainer at v1.1. |

#### C.11 — MMF rebalancing endpoint

| | |
|---|---|
| Helpan AI need | Helpan Chapaa MMF rebalancing — agent moves user's locked savings between CMA-licensed partner MMFs within user-set risk limits. |
| Gap | Entirely new capability. **Crosses regulatory boundaries that need legal review** — KP integrating with CMA-licensed MMFs as a distributor/aggregator may attract CMA scrutiny. |
| Severity | v1.0 soft (Helpan Chapaa's MMF rebalancing default is **suggest-only** per DoD §4.3; autonomous rebalancing is v1.1). |
| Complexity | XL (~12+ weeks plus regulatory review). MMF partner enrolment is a precondition (per DoD §12 risk register). The endpoint itself is a payment-into-MMF + payment-out-of-previous-MMF compound. |
| Recommendation | v1.1. Suggest-only MMF in v1.0 means Helpan Chapaa surfaces the suggestion to the user; the user confirms via standard flow; no agent-autonomous rebalancing in v1.0. v1.1 graduates to autonomous-with-limits per DoD §4.3 / Design Reference §8.3. **Legal sign-off (Instruction Pack §13.1 H14) covers this.** |

### 6.4 Special cases and exclusions

#### S.1 — Credit unlock / lending (Helpan Chapaa)

| | |
|---|---|
| Helpan AI need | Chapaa's "save first, borrow later" mechanic — at credit-unlock moment, the user receives KES X in micro-credit. |
| Gap | **Reboot Pack v1.2 §KP-D-09 lists lending as out-of-scope at v1.** This is a locked decision. |
| Recommendation | Helpan Chapaa's credit-unlock cannot be implemented as a KP capability under current locked decisions. Three options: (a) external lender integration (Chapaa partners with a licensed micro-lender; KP holds and releases credit balance only; lender owns the credit relationship); (b) reopen KP-D-09 to permit limited lending (substantial regulatory work); (c) defer credit-unlock entirely past v1.0. **Recommendation: option (a) for v1.0** — Chapaa-partnered lender, KP as the disbursement and repayment rail. Document the partner-integration pattern as part of Helpan Chapaa's per-app integration (Output Plan item 10). |

#### S.2 — Cards

KP-D-03 locks cards out at v1. Helpan AI does not need cards at v1.0 either (DoD §4.3 lists payment as STK push first; cards are a Helpan AI Phase 2 channel). No conflict.

#### S.3 — Bulk payouts

KP-D-09 locks bulk payouts > 100/request out. Helpan AI's Klokd integration does not need bulk-100+; per-worker payout per shift completion is the v1.0 model. No conflict at v1.0; may surface as a Klokd corporate-account request post-v1.0.

---

## 7. Per-Helpan-app blocker map

For each Helpan AI v1.0 consuming-app integration, the specific KP-side blockers.

### 7.1 Helpan Klokd — priority 1

**Required from KP:**
- B.1 — delegated authority on payment + payout (**v1.0 hard**)
- C.2 — transactional hold/release for shift escrow (**v1.0 hard**)
- A.2 — payout to M-Pesa (already exists)
- A.4 — STK push for top-up (already exists)
- B.2 — counterfactual error context (**v1.0 soft**)
- C.1 — verification primitive (**v1.0 soft**) — for "did this worker get paid for the previous shift before signing up for a new one"
- C.6 — refund (**v1.0 soft**) — disputed-shift refunds; v1.0 workaround: refund-via-payout
- C.7 — dispute orchestration (**v1.1**)

**v1.0 launch viability without all gaps closed:** Yes, with B.1 and C.2 closed at minimum, plus B.2 strongly preferred. Soft items have documented workarounds.

### 7.2 Helpan Lunch Drop — priority 2

**Required from KP:**
- B.1 — delegated authority on payment (**v1.0 hard**)
- A.4 — STK push (already exists)
- C.2 — transactional escrow (order-pending-delivery) (**v1.0 hard**)
- C.3 — programmable money (weekly lunch plans) (**v1.0 soft** — workaround: app-side cron with user-confirmed payment per cycle)
- B.2 — counterfactual (**v1.0 soft**)
- C.6 — refund (order cancellation) (**v1.0 soft** — refund-via-payout workaround)

**v1.0 launch viability:** Yes, with B.1 and C.2 closed. Programmable money is the highest-value soft item — its absence reduces Lunch Drop's distinctive "weekly plan" feature to a manually-confirmed pattern.

### 7.3 Helpan Chapaa — priority 3

**Required from KP:**
- B.1 — delegated authority on goal deposit/withdraw (**v1.0 hard**)
- A.3 — goal create/deposit/withdraw (already exists)
- B.2 — counterfactual (**v1.0 soft**)
- C.3 — programmable money (auto-save scheduling) (**v1.0 soft** — workaround as above)
- C.11 — MMF rebalancing (**v1.0 soft** — Chapaa MMF default is suggest-only at v1.0; user confirms; no agent-autonomous rebalance until v1.1)
- S.1 — credit unlock — **needs partner-lender architecture decision** (cannot ship without resolution; the path is partnered-lender per S.1 recommendation)

**v1.0 launch viability:** Yes, with B.1 closed and the credit-unlock partner architecture confirmed. MMF rebalancing as suggest-only is the v1.0 design and not a KP gap (it's a Chapaa UX choice that calls existing endpoints).

### 7.4 Helpan [App Name] — priority 4 (family-discovery)

**Required from KP:**
- B.1 — delegated authority on payment (**v1.0 hard**)
- C.3 — programmable money (standing-basket) (**v1.0 hard — the entire feature depends on it**)
- C.2 — transactional escrow (basket pending delivery) (**v1.0 hard**)
- C.4 — multi-stage escrow (basket with multiple line items) (**v1.0 soft** — workaround: single-stage hold per line item)
- C.1 — merchant verification primitive (**v1.0 soft** — workaround: app-side merchant payment history)

**v1.0 launch viability:** Yes, with B.1, C.2, and **C.3** closed. The family-discovery app is the **most KP-dependent** of the four — its standing-basket feature has no graceful workaround if programmable money is absent.

---

## 8. Severity ranking — the punch list

Consolidated. The single document Chamia and KP engineering work through to decide v1.0 KP scope.

### 8.1 v1.0 hard blockers (Helpan AI v1.0 cannot launch without these)

| ID | Capability | Apps blocked | Complexity | Recommended sequencing |
|---|---|---|---|---|
| B.1 | Delegated authority validation cross-cutting | All four | M (~3 weeks) | Start immediately. Most-leveraged unblocker. |
| C.2 | Transactional hold/release | Klokd, Lunch Drop, family-discovery | L (~4 weeks) | Start in parallel with B.1. |
| C.3 | Programmable money / scheduled transfers | Family-discovery (hard); Lunch Drop, Chapaa (soft) | L (~6 weeks) | Start in parallel with B.1 and C.2. Long-pole item. |
| S.1 | Credit-unlock partner-lender architecture | Chapaa | XL (decision + integration; counsel-led) | Start the architecture decision immediately; build follows after counsel sign-off. |

### 8.2 v1.0 strongly recommended (workarounds exist but reduce product quality)

| ID | Capability | Apps affected | Complexity | Recommended sequencing |
|---|---|---|---|---|
| B.2 | Counterfactual error context on rejections | All four | S–M | After B.1; same code paths. |
| C.1 | Verification primitive | Family-discovery (merchants), Klokd (workers) | M (~2 weeks) | After C.2; reuses ledger-query patterns. |

### 8.3 v1.0 acceptable to defer with documented workaround

| ID | Capability | Workaround | Recommended sequencing |
|---|---|---|---|
| B.3 | App-callable statement | App-side history (already maintained) | v1.0 if cheap; v1.1 acceptable |
| C.4 | Multi-stage escrow | Single-stage per line item | v1.1 |
| C.6 | App-initiated refund | Refund-via-payout pattern | v1.1 |

### 8.4 v1.1+ (post-Helpan-AI-v1.0)

| ID | Capability | Recommended timing |
|---|---|---|
| C.5 | Conditional release on event match | v1.1 |
| C.7 | Dispute initiation and orchestration | v1.1 |
| C.8 | AI risk scoring exposed to apps | v1.1 |
| C.9 | AI-mediated dispute resolution | v1.2 |
| C.10 | Full counterfactual explainer (beyond rejections) | v1.1 |
| C.11 | MMF rebalancing endpoint (autonomous) | v1.1 (suggest-only at v1.0 needs no new endpoint) |

### 8.5 Rolled summary

**v1.0 KP delta to ship Helpan AI v1.0:**

- **3 capabilities are hard blockers** (B.1, C.2, C.3) — total estimated complexity ~13 weeks if sequential, ~6–8 weeks with parallelism.
- **1 architecture decision is hard blocker** (S.1) — counsel-led; can run concurrent with engineering.
- **2 capabilities are strongly recommended** (B.2, C.1) — total estimated complexity ~3–4 weeks; can absorb into the same window.
- **Everything else** is v1.1+ with documented workarounds.

The minimal v1.0 KP delta is therefore **~6–10 calendar weeks of engineering** assuming the parallelism in §9 holds, plus the partner-lender architecture decision for Chapaa (counsel-led, can run concurrent).

---

## 9. Coordination and sequencing

### 9.1 The three-track parallel build

To deliver the v1.0 hard blockers in the shortest calendar window, three tracks run in parallel after the first two weeks:

**Track 1 — Delegated authority (B.1).** Build the cross-cutting Fastify plugin, integrate per existing endpoint, build the Helpan AI revocation-validation client, deploy. ~3 weeks. **Unblocks every other Helpan AI dispatch path the moment it ships.**

**Track 2 — Transactional hold/release (C.2).** Specify endpoint family, extend ledger postings to expose `entry_type=reserve|release` at app-tier, implement `POST /v1/holds`, `POST /v1/holds/{id}/release`, `POST /v1/holds/{id}/refund`. ~4 weeks. Depends on B.1's delegated-authority plugin in the last week of Track 1 to validate that the new endpoints accept agent dispatch.

**Track 3 — Programmable money (C.3).** Specify scheduled-transfer model, build scheduler worker, implement `POST /v1/schedules`, retry-and-failure-and-pause semantics, delegated-authority-still-valid-at-execution check (depends on B.1). ~6 weeks. Longest pole; start at week 1 in parallel with B.1.

### 9.2 Coordination dependencies

- **B.1 depends on** the Helpan AI rail's `POST /authorities/{id}/validate` endpoint being defined (Helpan AI Output Plan item 4 — delegated authority token contract). If item 4 lands before B.1 starts, no friction. If item 4 is still in flight when B.1 starts, build B.1 against the strawman with named integration points marked "pending H4 closure" (per Confirmation Memo §5.9).
- **C.3 depends on B.1** for runtime validation that the delegated authority is still valid at scheduled execution time. This is a per-execution call to Helpan AI's validation endpoint with cached/refreshed authority.
- **B.2 depends on** consensus on error-envelope `detail` field shapes per error code. App Integration Guide §7 already specifies the shape; KP just needs to populate `detail` consistently.
- **S.1 (Chapaa partner-lender)** is independent of the engineering tracks but must close before Helpan Chapaa ships v1.0. Can run end-to-end on counsel + product time.

### 9.3 Risk-and-mitigation

**Risk: B.1 is the cross-cutting refactor and could regress existing step-up flows.** Mitigation: deploy in dual-mode — endpoints accept *either* step-up token *or* delegated authority *or* both — and add integration tests for existing human-flow paths to confirm no regression. KP today has step-up enforcement on `POST /v1/payments/execute` and `POST /v1/payouts/initiate`; B.1 must extend, not replace.

**Risk: C.3 (programmable money) has compliance complexity (CBK posture on automated transfers without per-call user approval).** Mitigation: every scheduled execution carries a delegated authority that the user issued in advance with explicit limits (per-period maximum, total maximum, expiry). The audit trail names the authority that authorised each execution. Legal review (Instruction Pack §13.1 H14) signs off on the delegated authority pattern as the regulatory shield.

**Risk: S.1 (partner-lender architecture) has unknown complexity until counsel weighs in.** Mitigation: start counsel engagement immediately. Helpan Chapaa's credit-unlock spec (Output Plan item 10) waits on this resolution; in the interim, item 10 documents the credit-unlock requirements and flags S.1 as the gating architecture decision.

---

## 10. Open questions for Chamia

This document is recommendation-class; final scope is yours. Specific decisions awaiting:

1. **B.1 (delegated authority validation) — confirm v1.0 hard blocker status?** Recommendation: yes, ship in v1.0. This is the single largest unblocker and Helpan AI cannot dispatch any KP call without it.
2. **C.2 (transactional hold/release) — confirm v1.0 hard blocker status?** Recommendation: yes. Two of four flagship apps depend on it.
3. **C.3 (programmable money) — confirm v1.0 hard blocker status?** Recommendation: yes — the family-discovery app standing-basket feature has no workaround. But it is the longest-pole item; if v1.0 ships without it, the family-discovery launch sequence shifts to v1.1 and Helpan Klokd / Lunch Drop / Chapaa become the v1.0 launch portfolio.
4. **S.1 (Chapaa credit-unlock partner-lender architecture) — confirm option (a) partnered-lender or alternative?** Recommendation: option (a). Engage external counsel on the partnership structure and CBK / CMA implications.
5. **B.2 (counterfactual error context) — accept as v1.0 strongly-recommended, or downgrade to v1.1?** Recommendation: ship in v1.0; complexity is low and it materially improves the agent UX.
6. **C.1 (verification primitive) — accept as v1.0 strongly-recommended?** Recommendation: ship in v1.0; high cross-app value, moderate complexity, strong A2A bypass-defence value.
7. **B.3 (app-callable statement) — v1.0 or v1.1?** Recommendation: v1.0 if KP-engineering bandwidth permits (it is light); v1.1 acceptable.
8. **MMF rebalancing v1.0 default — confirm suggest-only?** Recommendation: yes, per DoD §4.3 and Design Reference §8.3. No KP endpoint addition needed for suggest-only; autonomous rebalancing endpoint deferred to v1.1.
9. **Bulk payouts — does Helpan Klokd have any v1.0 use case > 100/request?** Recommendation: assume no for v1.0; confirm with the Klokd product team. KP-D-09 stays locked.

---

## 11. Recommendation summary

The shortest path to Helpan AI v1.0 launch crosses three KP capability additions:

1. **Delegated authority validation** as a cross-cutting Fastify plugin (3 weeks).
2. **Transactional hold/release** as a new endpoint family (4 weeks).
3. **Programmable money / scheduled transfers** as a new endpoint family with scheduler worker (6 weeks).

Plus one architecture decision:

4. **Chapaa credit-unlock partner-lender architecture** — counsel-led; runs concurrent with engineering.

Plus two strongly-recommended absorbents:

5. **Counterfactual error context** on rejection envelopes (~1 week, fits inside the same windows).
6. **Verification primitive** as a new endpoint (~2 weeks).

Everything else fits cleanly in v1.1+ with documented workarounds.

The total engineering window with parallelism is **6–10 calendar weeks** for KP, sequenced to land before Helpan AI's Stage 1 sandbox (Helpan AI DoD §6 Stage 1 is ~8 weeks from build kick-off, so the timing is tight but feasible).

The single biggest leverage point is item 1 (delegated authority validation). Until that ships, no Helpan AI dispatch path through KP works at all. Recommend starting that track first.

— Helpan AI Rail Design Session

---

## Amendment §A — Agentic AI Signal Scan integrated (7 May 2026)

The **Agentic AI Signal Scan** (`agentic_ai_scan.html`, Chamia, 4 May 2026) adds three KP-side gap items not in the original §6 inventory. They are documented here as additions to the Bucket A / Bucket B / Bucket C taxonomy. The Scan Integration Memo v1.0 maps the full scan; this amendment lists only the items that affect the KP gap analysis specifically.

### A.1 — Bucket B addition: B.5 — `initiated_by` claim cross-cutting

| | |
|---|---|
| KP today | No `initiated_by` field on PaymentRequest, PayoutRequest. No `actor` claim consumption from step-up JWT. |
| Helpan AI need | Distinguish agent-initiated vs human-initiated transactions in audit log (cross-rail audit reconstruction). |
| Gap | Add optional `initiated_by` field to request schemas; consume `actor` and `initiated_by` claims from step-up JWT when present; persist to `payments`, `payouts`, `audit_log` rows. |
| Severity | **v1.0 hard for Helpan AI integrations** (every agent dispatch through KP needs this); **v1.0 soft for human-only flows** (backward-compatible default). |
| Complexity | S (~1 week). Schema fields, migration, JWT claim parsing in step-up verifier, persistence in transaction handler. |
| Recommendation | Build for v1.0. Cost is low; cross-rail audit value is high. Specified in KP Schema Appendix Amendment §A.1, §A.2; KP Rail Contract Amendment §A.1, §A.2; Claude Code Instruction Pack Amendment §A.1, §A.2. |

### A.2 — Bucket B addition: B.6 — Anti-social-engineering copy on step-up notification templates

| | |
|---|---|
| KP today | Step-up notification templates have no mandatory anti-social-engineering copy clause. |
| Helpan AI need | Defend against deepfake-orchestrated payment loop (vishing-collected OTP → step-up bypass → payout to attacker). The scan identifies this as the highest-risk attack scenario in the agentic landscape. |
| Gap | Mandatory copy clause on every template touching step-up authentication: *"KMV / [App Brand] will never call you to ask for this code. Do not share it with anyone."* Enforced at template approval; rejected with `TEMPLATE_MISSING_ANTI_SOCIAL_ENGINEERING_COPY`. |
| Severity | **v1.0 hard cross-rail** (Helpan AI agent flows that include step-up are particularly exposed because the user may not have initiated the step-up themselves and is more vulnerable to a "confirm this code" social-engineering call). |
| Complexity | S (~1 week). Template-approval regex check; documentation of clause patterns per App Brand. |
| Recommendation | Build for v1.0. Specified in KP Rail Contract Amendment §A.3 (cross-coordinated with Todoku Rail Contract Amendment §A.2 / §A.3 and App Integration Guide Amendment §A.2). |

### A.3 — Bucket C addition: C.12 — Cross-account behavioural fraud pattern monitoring

| | |
|---|---|
| Helpan AI need (and platform need beyond Helpan AI) | The scan identifies AI-orchestrated synthetic-identity fraud (21% of first-party frauds 2025; 1,210% rise in AI-enabled fraud Jan–Dec 2025) as a primary threat. The mechanism — dormant profiles building 18-month transaction histories, then simultaneous coordinated drains — bypasses single-account rules-based controls. |
| Gap | KP today enforces tier limits and rolling-30-day caps per account. Cross-account behavioural pattern detection (velocity correlation, payee-graph clustering, dormant-then-active patterns) is **not in v1.0**. |
| Severity | **v1.0 hard per scan** (KP-2: "AI fraud pattern monitoring as Phase 1 Build Readiness, not deferred to Phase 2"). The platform is not Helpan-AI-specific here — this defends every KP user. |
| Complexity | M (~3 weeks). Continuous job, ledger pattern detection rules, operator console alerts, audit log enrichment. Distinct from C.8 (per-transaction AI risk scoring) — C.12 is cross-account; C.8 is per-transaction. |
| Recommendation | Build for v1.0. The scan elevates this from "nice-to-have Phase 2 differentiator" to "Phase 1 Build Readiness item." Specified in KP Rail Contract Amendment §A.4; Claude Code Instruction Pack Amendment §A.3 (BR-AI-1). |

### A.4 — Severity ranking — punch list update

The §8.1 v1.0 hard blockers are augmented with the scan-driven items:

| ID | Capability | Apps blocked | Complexity | Recommended sequencing |
|---|---|---|---|---|
| B.1 | Delegated authority validation (existing) | All four Helpan apps | M (~3 wks) | Track 1 |
| C.2 | Transactional hold/release (existing) | Klokd, Lunch Drop, family-discovery | L (~4 wks) | Track 2 |
| C.3 | Programmable money (existing) | Family-discovery (hard) | L (~6 wks) | Track 3 |
| **B.5** | **`initiated_by` + `actor` propagation (scan)** | Cross-rail audit | S (~1 wk) | Fits inside Track 1 (delegated authority work touches the same code paths) |
| **B.6** | **Anti-social-engineering copy mandatory (scan)** | Cross-rail trust | S (~1 wk) | Independent; can land in any week |
| **C.12** | **Cross-account behavioural fraud monitoring (scan)** | Platform-wide defence (not specifically Helpan AI) | M (~3 wks) | Track 4 — independent; can run in parallel with Tracks 1–3 |
| S.1 | Chapaa credit-unlock partner-lender architecture (existing) | Chapaa | XL (counsel-led) | Counsel-led; concurrent |

**Engineering window updated: ~6–10 weeks** (unchanged, because B.5 and B.6 fit inside Track 1 and Track 4 (C.12) runs in parallel).

### A.5 — §10 Open questions — additions

Three additional questions for Chamia's confirmation:

10. **B.5 (`initiated_by` + `actor` propagation) — confirm v1.0 hard?** Recommendation: yes. Cost is low; cross-rail audit value is high. Specified in KP Schema Appendix Amendment §A.1, §A.2.
11. **B.6 (anti-social-engineering copy) — confirm cross-rail mandatory?** Recommendation: yes. Specified in KP Rail Contract Amendment §A.3 with template-approval enforcement.
12. **C.12 (cross-account behavioural fraud monitoring) — confirm v1.0 Phase 1 per scan?** Recommendation: yes. Scan elevates from Phase 2 to Phase 1; this defends every KP user, not just Helpan AI flows.

---

*Helpan AI Rail · Kipkiren Pay Gap Analysis v1.0 + Amendment §A · 7 May 2026 · Kirimon Market Ventures · Confidential · Recommendation-class output per Confirmation Memo §5.4 + scan-driven items per Scan Integration Memo §2.6.*
