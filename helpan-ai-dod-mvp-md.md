# Helpan AI Rail — Definition of Done & MVP Scope v1.0

**Owner:** Chamia Mutuku, CEO & CPO, Kirimon Market Ventures
**CTO:** Silvia Mumbua
**Date:** 5 May 2026
**Status:** Authoritative. Read alongside Helpan AI Rail Design Instruction Pack v1.0.
**Corpus:** This document is part of the Helpan AI Rail design corpus. Cross-references use §-notation pointing to the Instruction Pack.

---

## 1. Purpose and how to use

This document serves two functions in a single reference:

**MVP Scope** defines exactly what ships in Helpan AI v1.0 — what is in, what is out, and why. It is the binding agreement between product and engineering on the boundary of the first production release.

**Definition of Done** defines the quality bar that must be met at each stage before work can advance. It is the mechanism by which "done" means the same thing to Chamia, Silvia, and every engineer on the rail.

The two functions are deliberately combined. A feature is not "in MVP" unless it is also "done" by the criteria in this document. There is no MVP without DoD. There is no DoD without a clear MVP scope.

**How to use:**
- Read §2 (Strategic Context) once for orientation.
- Use §3–§6 (MVP) as the product boundary reference throughout the build.
- Use §7–§9 (DoD) as the sprint gate and stage-advance checklist.
- Use §10 (Launch Criteria) as the go/no-go checklist for v1.0 production release.
- Use §11–§12 as forward planning inputs, not build commitments.

---

## 2. Strategic context

Helpan AI is being built in direct response to the disintermediation thesis: that AI agents will become the primary interface between consumers and their financial and commercial services within three to five years. Kenya is not immune. M-Pesa agents disintermediated bank branches. Helpan AI is the move that ensures the Kirimon portfolio is on the right side of the next disintermediation wave.

The two McKinsey reports informing this design (April 2026) are cited in full in Instruction Pack §4. The summary relevant to this document:

- Consumers are starting to use agentic tools for basket building, automated replenishment, and routine financial decisions.
- If financial institutions (and by extension, consumer app platforms) fail to ship their own agents, third-party agents absorb the customer relationship.
- The defence is to be the operating system agents prefer — open by design, closed by consent, agent-native from day one.

Helpan AI is that operating system for the Kirimon portfolio. Every week it does not exist is a week a third-party agent could arrive first.

**Silvia is starting the rail build today, 5 May 2026.** This document must govern that build from the first commit.

---

## 3. MVP definition

### 3.1 What MVP means for Helpan AI

Helpan AI v1.0 MVP is defined as:

> The minimum Helpan AI rail that allows at least two consuming apps to ship a production-grade branded Helpan agent — with full delegated authority, consent surface, notification routing, and payment orchestration — without building any agent infrastructure themselves.

"Production-grade" means: secure, auditable, regulator-compliant, observable, and recoverable from failure. An MVP that requires manual intervention to operate is not production-grade. An MVP that cannot be audited is not production-grade.

### 3.2 The four flagship integrations

The MVP is not complete until all four consuming-app integrations are live and passing DoD Stage 3. They are listed in priority order based on current product maturity:

1. **Helpan Klokd** — casual labour marketplace agent. Beta live. Shift matching, M-Pesa-native pay-on-completion orchestration, worker reputation signals. Highest integration readiness.
2. **Helpan Lunch Drop** — food delivery agent. Beta live. ZoneFeed personalisation augmentation, weekly lunch plan briefings, reliability nudges.
3. **Helpan Chapaa** — savings agent. Advanced build. MMF rebalancing at suggest-only default. Credit unlock orchestration. Highest regulatory and financial stakes.
4. **Helpan [Family-Discovery App]** — family-friendly consumer discovery agent. New build. Agent capability is the product's primary differentiator. Lowest current maturity; benefits from lessons of the first three integrations.

### 3.3 What the MVP is not

The MVP is not a prototype, a sandbox, or an internal tool. It is a production rail consumed by production apps used by real Kenyan consumers. The bar is correspondingly high.

---

## 4. MVP scope — what is IN for v1.0

### 4.1 Rail capabilities

**Agent runtime**
- Execution environment for agent reasoning, tool calls, and orchestration.
- Default LLM provider configured (per open decision #4 in Instruction Pack §14).
- Per-app LLM override supported.

**Briefing management**
- Full CRUD on user briefings.
- Briefing types: alert, standing basket, scheduled action, threshold watch.
- Briefing expiry and auto-cleanup.
- Maximum briefings per user per app enforced.

**Matching engine**
- Real-time event ingestion from consuming apps.
- Briefing-to-event matching logic.
- Match confidence scoring.
- Dead-letter queue for unmatched events.

**Delegated authority**
- Issuance, validation, and revocation of delegated authority tokens.
- Scoped per operation, per amount limit, per time window.
- Step-up token requirement for high-stakes authorities (joint contract with Identiti).
- Revocation propagates to all relying parties within 5 seconds.

**Helpan Console**
- User-facing surface showing all active delegated authorities.
- Per-authority detail: agent name, scope, limits, expiry.
- One-tap revocation.
- Activity log (last 30 agent actions per authority).
- Delivered as a shared React Native library invoked from each consuming app.

**Audit log**
- Immutable record of every agent action.
- Retention: 7 years for money-touching actions, 2 years for all others.
- Accessible to platform ops via operator console.

**Agent-to-rail dispatch**
- Validated dispatch to Kipkiren Pay (payment, verification, hold/release, escrow, refund, dispute, programmable money).
- Validated dispatch to Identiti (step-up token request, consent check).
- Validated dispatch to Todoku (notification request with message body, urgency, channel hint).

**Per-app safety policies**
- Category whitelist enforcement at briefing creation and event ingestion.
- Content moderation hooks (text filtering; image moderation hook for apps that allow images).
- Family-friendly policy enforced for the family-discovery app from day one.

**Observability**
- Agent action success/failure rates per app.
- Briefing match rates per app.
- Delegated authority issuance and revocation rates.
- Latency per dispatch target.
- Cost per agent action per app.
- Alerting on anomaly thresholds.

**Operator console**
- Audit log review.
- Safety policy management (category whitelist admin).
- Agent registration and deregistration.
- Delegated authority revocation (operator-side, for abuse cases).
- OAuth scope catalogue management.

### 4.2 Rail integrations in v1.0

**Identiti**
- JWT validation on all inbound requests.
- Step-up token request and validation.
- Consent record reads for cross-app data access decisions.
- Subscription to: `UserDeleted`, `AccountMerged`, `ConsentRevoked`, `KYCDowngraded`.

**Kipkiren Pay**
- Payment initiation (M-Pesa STK push, card).
- Verification primitive (`verify_recent_payment`).
- Hold / release / escrow.
- Refund.
- Dispute initiation.
- Statement and balance queries.
- Programmable money / scheduled transfers (elevated from Phase 2 — required for the family-discovery app's standing-basket feature).
- Delegated authority token validation endpoint consumed by Kipkiren Pay per call.

**Todoku**
- Notification dispatch (push, SMS, in-app inbox).
- Structured notification request format: message body, urgency, channel hint, agent identifier, context.
- Quiet hours and frequency cap compliance delegated to Todoku.

### 4.3 Consuming-app integrations in v1.0

**Helpan [Family-Discovery App] — hard MVP gate (priority 4)**
- Briefing-based real-time discovery alerts.
- Standing-basket auto-replenishment (via Kipkiren Pay programmable money).
- Merchant-side AI clienteling (broadcast drafting, timing suggestions).
- Family-friendly safety policy enforced.
- Full Helpan Console integration.
- Note: this integration benefits from lessons learned in priorities 1–3 and should be sequenced last.

**Helpan Chapaa — hard MVP gate**
- Goal acceleration nudges.
- Round-up acceleration prompts.
- MMF rebalancing — suggest-only default in v1.0.
- Chama support (top-up prompts, shortfall alerts).
- Credit unlock orchestration.
- Behavioural data containment enforced (no cross-app leakage).
- Full Helpan Console integration.

**Helpan Klokd — hard MVP gate (priority 1)**
- Shift availability briefings ("alert me when a hospitality shift opens within 5km tonight").
- Employer-side shift-fill orchestration ("post shift, match verified workers, confirm via agent").
- M-Pesa-native pay-on-completion — agent triggers Kipkiren Pay settlement on shift sign-off.
- Worker reputation signal surfacing (verified shift count, ratings).
- Full Helpan Console integration.

**Helpan Lunch Drop — hard MVP gate (priority 2)**
- ZoneFeed personalisation augmentation (the agent can suggest "your usual Mama is offering your favourite today — order now?").
- Weekly lunch plan briefings ("order from PowerMama X every Tuesday").
- Reliability nudges ("your usual Mama hasn't been active for 3 days — try Mama Y?").
- Full Helpan Console integration.

**Helpan Chapaa — hard MVP gate (priority 3)**
- ZoneFeed personalisation augmentation.
- Weekly lunch plan briefings.
- Reliability nudges.
- Full Helpan Console integration.

### 4.4 SDK in v1.0

- React Native client SDK covering full consumer-side surface (Instruction Pack §6.2).
- SDK documentation with integration guide.
- Reference integration for the family-discovery app and Helpan Chapaa.

### 4.5 OAuth scope catalogue v1.0

- Scope catalogue defined and documented for all v1.0 consuming apps.
- Default scope posture (most restrictive) enforced for all newly registered third-party agents.
- Third-party agent registration flow live (manual approval by platform ops in v1.0; automated in v1.1).
- At least one third-party agent integration validated end-to-end in staging before production launch.

### 4.6 Data and compliance

- Supabase schema (af-south-1) with full RLS policies.
- Kenya Data Protection Act 2019 alignment confirmed by legal.
- Behavioural data containment enforced per §3.4 of the Instruction Pack.
- Regulatory containment confirmed: Helpan AI holds no funds, extends no credit.
- ODPC registration alignment confirmed.

---

## 5. MVP scope — what is OUT for v1.0

These items are explicitly deferred. They are not descoped permanently — they are sequenced after v1.0 is stable in production.

| Item | Deferred to | Rationale |
|---|---|---|
| Server-side SDKs (Node, PHP, Python) | v1.1 | React Native covers all v1.0 consuming apps |
| Developer portal for third-party agents | v1.1 | Manual ops approval sufficient for v1.0 |
| Helpan Lunch Drop (if bandwidth constrained) | v1.1 | Soft commitment; family-discovery app and Chapaa are the gates |
| Helpan SabakiFresh | v1.1 | Sabaki schema (§13.3 D3) not yet unblocked |
| Helpan Kipkiren consumer | v1.1 | Kipkiren Pay consumer app not yet in active sprint |
| Helpan Nightpulse | v1.2 | Nightpulse is a separate audience and safety posture; right to add categories must be earned |
| Autonomous MMF rebalancing (Helpan Chapaa) | v1.1 | Suggest-only is the safe default; autonomy graduation path to be agreed |
| Cross-app data access flows (full) | v1.1 | Single-app default works; cross-app requires additional consent UX and legal review |
| Voice and chat agent surfaces | v2.0 | Text-first; voice adds significant UX and infra complexity |
| Helpan Console standalone app | v2.0 | Shared library sufficient for v1.0; standalone app is a later brand play |
| Agent-to-agent communication | v2.0 | Not required for v1.0 use cases |
| Predictive intent (agent acts before user asks) | v2.0 | Requires behavioural data maturity not available at launch |

---

## 6. Stage model

Helpan AI advances through four stages. Stage advance requires all DoD criteria for that stage to be met and signed off.

| Stage | Name | Description |
|---|---|---|
| **Stage 0** | Specification | Design corpus complete. All hard blockers from Instruction Pack §13.1 resolved. No code in production. |
| **Stage 1** | Internal Alpha | Rail running in staging. Internal team (Kirimon engineers) using it. Both flagship consuming-app integrations wired in staging. |
| **Stage 2** | Closed Beta | Rail running in production behind a feature flag. Controlled set of real users on the family-discovery app and Chapaa. No general availability. |
| **Stage 3** | Production | General availability. All DoD criteria met. All consuming-app integrations in scope live. |

---

## 7. Definition of Done

### 7.1 Stage 0 — Specification complete

**Contracts and specifications**
- [ ] OpenAPI 3.x specification complete for all rail-side endpoints (Instruction Pack §6.1).
- [ ] Delegated authority token contract complete and signed off by Identiti and Security (§6.4).
- [ ] Step-up token contract joint with Identiti complete (§8.4).
- [ ] OAuth scope catalogue v1 complete (§12.1).
- [ ] Rail-to-rail contracts complete: Helpan AI ↔ Identiti, ↔ Kipkiren Pay, ↔ Todoku (§6.3).
- [ ] Event bus contract complete — events emitted and subscribed to (Instruction Pack Output Plan item 6).
- [ ] Kipkiren Pay gap analysis complete — current surface vs agent-native requirement (§9.4).

**Schema and data model**
- [ ] Full ERD complete for all rail-side tables (§7.1).
- [ ] RLS policy specification complete for all tables (§7.4).
- [ ] Audit log specification complete with retention rules (§7.3).

**Security**
- [ ] Threat model (STRIDE or equivalent) complete and reviewed (§13.1 H10).
- [ ] Per-app safety policy schema defined (§13.1 H12).

**Legal and compliance**
- [ ] Regulatory containment principle confirmed by legal (§9.3, §13.1 H14).
- [ ] Behavioural data containment policy confirmed per app (§13.1 H15).
- [ ] ODPC registration alignment confirmed.

**Design**
- [ ] Helpan Console design specification complete (§3.7, §13.1 H11).
- [ ] Confirmation Memo produced and accepted by Chamia.

**Evidence required:** All Output Plan items 1–8 delivered as downloadable files and accepted by Chamia.

---

### 7.2 Stage 1 — Internal Alpha

All Stage 0 criteria met, plus:

**Infrastructure**
- [ ] Supabase schema (af-south-1) deployed with full RLS.
- [ ] All rail-side endpoints implemented and passing contract tests.
- [ ] Delegated authority token issuance, validation, and revocation working end-to-end.
- [ ] Revocation propagation to Kipkiren Pay and Todoku confirmed within 5-second SLA.
- [ ] Audit log writing and reading confirmed.
- [ ] Matching engine processing test events and firing matches.

**Integrations**
- [ ] Identiti JWT validation live in staging.
- [ ] Identiti step-up token flow live in staging.
- [ ] Kipkiren Pay agent-native endpoints live in staging (covering all v1.0 capabilities).
- [ ] Todoku notification dispatch live in staging.

**Consuming apps**
- [ ] Helpan Klokd wired in staging — shift briefings, employer shift-fill, pay-on-completion via Kipkiren Pay.
- [ ] Helpan Lunch Drop wired in staging — ZoneFeed augmentation, weekly plan briefings, reliability nudges.
- [ ] Helpan Chapaa wired in staging — goal nudges, round-up prompts, MMF suggest flow, credit unlock.
- [ ] Helpan [Family-Discovery App] wired in staging — briefings, matching, dispatch, family-safe policy, Helpan Console.

**SDK**
- [ ] React Native SDK published to internal registry.
- [ ] Integration guide complete.

**Observability**
- [ ] All observability metrics instrumented and visible in ops dashboard.
- [ ] Alerting configured on critical thresholds.

**Evidence required:** Internal demo to Chamia covering all flagship consuming-app flows end-to-end in staging.

---

### 7.3 Stage 2 — Closed Beta

All Stage 1 criteria met, plus:

**Production readiness**
- [ ] Rail deployed to production (feature-flagged).
- [ ] DR drill completed and documented.
- [ ] Incident management runbooks complete (§13.2 S6).
- [ ] Load test completed against expected v1.0 agent volume (§13.2 S8).
- [ ] All Critical and High findings from penetration test resolved (§13.2 S7).

**Consuming apps**
- [ ] Helpan Klokd live in production for closed beta cohort (minimum 50 workers and 20 employers).
- [ ] Helpan Lunch Drop live in production for closed beta cohort (minimum 50 users).
- [ ] Helpan Chapaa live in production for closed beta cohort (minimum 50 users).
- [ ] Helpan [Family-Discovery App] live in production for closed beta cohort (minimum 50 users).
- [ ] Helpan Console UX validated with minimum 10 real users (§13.2 S11).

**Compliance**
- [ ] ODPC registration complete or confirmed in progress with legal timeline.
- [ ] Kenya Data Protection Act 2019 alignment confirmed by legal counsel.
- [ ] Audit log verified in production with retention policy active.

**Operator console**
- [ ] Operator console live for Kirimon ops team (§13.2 S5).

**Evidence required:** Closed beta report covering: user activation, briefing creation rate, agent action success rate, Helpan Console engagement, any safety policy flags, and any incidents. Report accepted by Chamia before Stage 3 advance.

---

### 7.4 Stage 3 — Production (General Availability)

All Stage 2 criteria met, plus:

**Scale and stability**
- [ ] Zero Critical or High open security findings.
- [ ] P99 agent action dispatch latency ≤ 2 seconds under expected load.
- [ ] Rail uptime ≥ 99.5% over trailing 30 days.
- [ ] Revocation propagation ≤ 5 seconds confirmed under load.
- [ ] No data leakage incidents in closed beta.

**Consuming apps**
- [ ] Both flagship integrations (family-discovery app and Chapaa) live with general availability.
- [ ] Helpan Lunch Drop live (or formally deferred to v1.1 with Chamia sign-off).
- [ ] Helpan Console available to all users of all live integrations.

**OAuth and third-party**
- [ ] OAuth scope catalogue published and documented.
- [ ] At least one third-party agent integration validated and live.

**Documentation**
- [ ] All Output Plan items 1–16 complete and published to the platform documentation corpus.
- [ ] Reading orders by role published (Instruction Pack §17).
- [ ] Reboot Pack v1.0 complete and accepted.

**Sign-off**
- [ ] Chamia (CEO & CPO) sign-off on product readiness.
- [ ] Silvia (CTO) sign-off on technical readiness.
- [ ] Legal sign-off on compliance posture.

**Evidence required:** Stage 3 sign-off memo countersigned by Chamia and Silvia.

---

## 8. DoD category reference

Each DoD criterion belongs to a category. Use this to track DoD progress by category across stages.

| Category | Stage 0 | Stage 1 | Stage 2 | Stage 3 |
|---|---|---|---|---|
| Contracts & specifications | ✦ | — | — | — |
| Schema & data model | ✦ | ✦ | — | — |
| Security & threat model | ✦ | ✦ | ✦ | ✦ |
| Rail integrations | — | ✦ | ✦ | ✦ |
| Consuming-app integrations | — | ✦ | ✦ | ✦ |
| Helpan Console | ✦ | ✦ | ✦ | ✦ |
| Observability & ops | — | ✦ | ✦ | ✦ |
| Compliance & legal | ✦ | — | ✦ | ✦ |
| Documentation | ✦ | ✦ | ✦ | ✦ |
| Scale & stability | — | — | ✦ | ✦ |
| Sign-off | ✦ | ✦ | ✦ | ✦ |

✦ = criteria active in this stage

---

## 9. DoD working rules

1. **Binary criteria only.** Every criterion is pass/fail. "Mostly done" is not done.
2. **Evidence, not assertion.** Every criterion requires evidence — a deliverable, a test result, a sign-off. "I believe it works" is not evidence.
3. **No stage advance without full stage completion.** Partial stage 1 + partial stage 2 is not equivalent to full stage 1. Stages are gates, not guidelines.
4. **Regressions reset the stage.** If a Stage 2 criterion fails in Stage 3 testing, the rail reverts to Stage 2 until it is remediated.
5. **Deferred items are formally deferred.** An item listed as OUT in §5 is not "forgotten" — it is formally recorded as deferred to a named stage. It re-enters the DoD when its target stage begins.
6. **Security findings block stage advance.** Any open Critical or High security finding blocks Stage 3. Any open Critical finding blocks Stage 2.

---

## 10. MVP launch criteria (Stage 3 go/no-go)

This is the definitive go/no-go checklist for the v1.0 production launch. All criteria must be met. No exceptions.

**Product**
- [ ] Both flagship consuming-app integrations (family-discovery app, Helpan Chapaa) live and passing DoD Stage 3.
- [ ] Helpan Console available to all users of both integrations.
- [ ] Family-friendly safety policy enforced and validated in production.
- [ ] Chapaa MMF rebalancing defaulting to suggest-only, confirmed in production.

**Security**
- [ ] Zero open Critical or High security findings.
- [ ] Penetration test complete; all Critical and High resolved.
- [ ] Delegated authority revocation confirmed ≤ 5 seconds under load.
- [ ] No cross-app data leakage confirmed in closed beta.

**Performance**
- [ ] P99 dispatch latency ≤ 2 seconds under expected load.
- [ ] Rail uptime ≥ 99.5% over trailing 30 days.
- [ ] Load test passed.

**Compliance**
- [ ] Legal sign-off: regulatory containment, DPA 2019 alignment, ODPC.
- [ ] Audit log live and verified in production with active retention policy.

**Operations**
- [ ] DR drill complete.
- [ ] Incident runbooks live and tested.
- [ ] Operator console live for Kirimon ops team.

**Documentation**
- [ ] Reboot Pack v1.0 complete.
- [ ] Integration guides live for all v1.0 consuming apps.

**Sign-off**
- [ ] Chamia (CEO & CPO) product sign-off.
- [ ] Silvia (CTO) technical sign-off.
- [ ] Legal compliance sign-off.

---

## 11. Success metrics for v1.0

These are the metrics by which the MVP will be judged at 30, 60, and 90 days post-launch.

**Rail health**
- Agent action success rate ≥ 95% (Klokd, Lunch Drop, Chapaa, and family-discovery app combined).
- P99 dispatch latency ≤ 2 seconds sustained.
- Delegated authority revocation rate (as a % of issued) — baseline to be established in closed beta.
- Zero data leakage incidents.

**Helpan [Family-Discovery App]**
- % of active users with at least one live briefing within 30 days of onboarding.
- Briefing-to-notification conversion rate (briefings that fire at least one match per week).
- Standing-basket activation rate (% of users who set up at least one auto-replenishment).
- Helpan Console open rate (% of users who have opened the Console at least once).

**Helpan Chapaa**
- % of active Chapaa users who have interacted with a Helpan Chapaa suggestion.
- Goal acceleration rate (days-to-goal for users with active Helpan briefings vs without).
- Round-up prompt acceptance rate.
- MMF rebalancing suggestion acceptance rate.
- Credit unlock orchestration completion rate.

**Cross-rail health**
- Kipkiren Pay agent-initiated transaction success rate ≥ 99%.
- Todoku notification delivery rate ≥ 98%.
- Identiti step-up token success rate ≥ 99%.

---

## 12. Known risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Kipkiren Pay agent-native API surface not ready when Helpan AI is ready | High | Blocks flagship integrations | Kipkiren Pay gap analysis (Instruction Pack §9.4) must close at Stage 0. Parallel build tracks. |
| Identiti step-up token contract takes longer than expected to agree | Medium | Blocks high-stakes delegated authority flows | Begin joint contract design immediately. Agree interim mock for staging. |
| Regulatory uncertainty on agent-initiated financial actions | Medium | Could require redesign of delegated authority model | Legal sign-off on regulatory containment at Stage 0, not Stage 2. |
| Third-party agent abuse (scope over-reach, data harvesting) | Medium | User trust and DPA 2019 exposure | Conservative default scope posture. Manual approval in v1.0. Behavioural anomaly detection. |
| Chapaa MMF partner availability for rebalancing | Low | Helpan Chapaa MMF feature delayed | MMF partner enrolment via Kipkiren Pay is a pre-condition for the rebalancing feature (suggest-only in v1.0 means this is low risk for MVP). |
| Family-discovery app brand not locked before rail design advances | Low | Integration guide cannot be finalised | Working name TBD is acceptable for Stage 0–1. Must be locked by Stage 2. |
| Consumer inertia on Helpan Console adoption | Low | Consent surface underused; reduces audit value | UX validation with 10+ users required at Stage 2. Console must be surfaced prominently in onboarding. |

---

## 13. Post-MVP roadmap horizons

These are directional, not committed. Sequencing is subject to product priorities at the time.

**v1.1 (first increment post-launch)**
- Helpan Lunch Drop (if deferred from v1.0).
- Helpan SabakiFresh (pending Sabaki schema unblocking).
- Server-side SDKs (Node, PHP, Python).
- Developer portal for third-party agents (automated approval flow).
- Autonomous MMF rebalancing for Helpan Chapaa (with user-set limits and graduation path agreed).
- Full cross-app data access flows.

**v1.2**
- Helpan Kipkiren consumer.
- Helpan Nightpulse.
- Enhanced third-party agent tooling (developer portal improvements, partner programme).
- Briefing templates and sharing (users share briefing patterns with household members).

**v2.0**
- Voice and chat agent surfaces.
- Helpan Console as a standalone branded app.
- Agent-to-agent communication (agents on behalf of different users coordinating — e.g., Chama group savings orchestration).
- Predictive intent (agent surfaces actions before the user has issued a briefing, based on behavioural pattern inference).
- The Agent Rail as an external product — made available to non-Kirimon apps in Kenya and East Africa.

---

## 14. Sign-off authority

| Stage | Sign-off required |
|---|---|
| Stage 0 → Stage 1 | Chamia (product) + Silvia (technical) |
| Stage 1 → Stage 2 | Chamia (product) + Silvia (technical) + Security |
| Stage 2 → Stage 3 | Chamia (product) + Silvia (technical) + Legal + Security |
| Post-launch v1.1 scope | Chamia |

---

## 15. Document provenance and cross-references

This document is part of the Helpan AI Rail design corpus. Read alongside:

- **Helpan AI Rail Design Instruction Pack v1.0** — authoritative design constraints, design law, and strategic context.
- **Helpan AI Rail Daily Reference (One-Pager)** — Silvia's daily build companion.
- **Helpan AI Rail New Session Bootstrap** — for resuming this work in a new session.

Cross-references in this document use the form §X.Y referring to the Instruction Pack unless otherwise noted.

---

*Helpan AI Rail — Definition of Done & MVP Scope v1.0 · 5 May 2026 · Kirimon Market Ventures · Confidential*

*"Done means secure, auditable, and in the hands of real users. Everything else is progress."*
