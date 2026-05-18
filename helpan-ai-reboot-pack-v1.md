# Helpan AI Rail — Reboot Pack v1.0

**Canonical record. Read first at the start of any new session on the Helpan AI rail.**

**Document version:** 1.0
**Programme:** Kirimon Market Ventures (KMV) — Helpan AI Rail (4th platform rail)
**Consolidation date:** 7 May 2026
**Owner:** Chamia Mutuku (CEO & CPO); Silvia Mumbua (CTO leading the build)
**Status:** Authoritative for the Helpan AI rail. Read first at any session entry. Companion to (does not supersede) Platform Rails Reboot Pack v1.2.

**Standing rule:** Sessions resuming Helpan AI work read this Reboot Pack first, plus the Platform Rails Reboot Pack v1.2. Sessions do not invoke `conversation_search` or `recent_chats`; standing knowledge lives here.

---

## How to read this document

This is the canonical record for the Helpan AI rail at v1.0. Every locked decision lives here. It does not restate the entire Helpan AI corpus — for any sub-area, the section pointer leads to the authoritative artefact.

§1–§4 give the architectural and strategic picture. §5 is the Output Plan as executed. §6 is the corpus map. §7 is the locked decisions. §8 is open items. §9 is the Continuity-Critical Context — the single most-read section, summarising what every future session must know without reading anything else first. §10 is closing notes.

---

## Document map

1. Programme summary
2. Cardinal rule
3. The four rails — at a glance
4. The disintermediation thesis
5. Output Plan execution status
6. Corpus map — every Helpan AI document
7. Locked decisions
8. Open items
9. Continuity-Critical Context — read this every session
10. Closing notes

---

## 1. Programme summary

Helpan AI is the **fourth platform rail** in the KMV portfolio, alongside Identiti (identity), Kipkiren Pay (payment), and Todoku (comms). It provides:

- **Agent runtime** for AI agents acting on behalf of users.
- **Briefing storage** — standing user intents the agent acts on.
- **Matching engine** — events → briefings → matches → notifications.
- **Delegated authority issuance, validation, revocation** — the rail's most-consumed primitive.
- **The Helpan Console** — single-surface consent for every active authorisation, one-tap revocation.
- **OAuth scope catalogue** for third-party agents (Identiti issues; Helpan AI defines).
- **Audit log** of every agent action, hash-chained, 7-year retained.
- **Cross-app data access policy enforcement** with default-most-restrictive scope posture.
- **Per-app safety primitives** — category whitelists, content moderation, audience postures (family_friendly, general, adult_confirmed).

Built as the strategic response to McKinsey's April 2026 thesis that AI agents will become the channel of choice for banking and a meaningful share of consumer commerce within 3–5 years. Position: **the agent operating system for East African consumer finance and commerce, before third-party agents arrive in Kenya.**

---

## 2. Cardinal rule

> **Helpan AI does not duplicate platform rail functionality.** Apps don't bypass Identiti for identity, KP for money, Todoku for comms. Helpan AI orchestrates those rails on behalf of agents — it does not reimplement them.

Specifically:
- No payment processing inside Helpan AI. KP holds the funds.
- No identity, KYC, or credential storage inside Helpan AI. Identiti is the source of truth.
- No direct comms delivery inside Helpan AI. Todoku is the comms boundary.
- Helpan AI does not hold funds, extend credit, aggregate yield, run float, or net off-ledger. KP remains the only CBK-licensed entity.

If a design pattern appears to require Helpan AI to violate any of the above, the design is wrong, not the rule.

---

## 3. The four rails — at a glance

| Rail | Function | Regulator | Domain |
|---|---|---|---|
| **Kipkiren Pay** | E-money, wallet, payments, payouts, savings goals, M-Pesa | CBK (NPS Reg 2014) | `pay.kipkiren.co.ke` |
| **Identiti** | Account UUID, KYC tier, step-up, phone tokens, OAuth issuance | DPA 2019; CA-K | `identiti.co.ke` |
| **Todoku** | SMS, voice, WhatsApp, in-app inbox | DPA 2019; CA-K | `todoku.co.ke` |
| **Helpan AI** | Agent runtime, delegated authority, consent, audit, OAuth scopes | DPA 2019; **no CBK exposure** (per §6.4 of Design Reference) | `helpan.co.ke` |

Helpan AI sits **on top** of the other three. It does not own primitives the others own; it orchestrates them.

---

## 4. The disintermediation thesis (strategic charter)

McKinsey April 2026 reports name AI agents as the channel of choice within 3–5 years; estimated profit-pool risk is 9% global average, 27% deposits, 34% cards. The defensive prescription for wallet providers and superapps: **become the operating system agents prefer**.

The Kirimon response is to ship the rail and the consuming agents (Helpan Klokd, Helpan Lunch Drop, Helpan Chapaa, Helpan [App Name]) **before third-party agents arrive in Kenya**. The rail's defensibility against the A2A bypass threat (agents calling Daraja directly to skip Kipkiren Pay) lies in the abstractions Daraja does not expose: verification primitive, escrow, hold/release, dispute orchestration, AI risk scoring, counterfactual explainer, programmable money.

The strategic charter in five sentences:

1. The agent is the new front door.
2. The rail is the foundation the door is hung on.
3. Build agent-native, consent-first, regulatory-contained.
4. Ship before third-party agents arrive.
5. Be the operating system agents prefer — open by design, closed by consent.

---

## 5. Output Plan execution status

Per Instruction Pack §15.

| # | Artefact | Status | File |
|---|---|---|---|
| 1 | Confirmation Memo | ✅ Complete (+ Amendment §A) | `helpan-ai-confirmation-memo-v1.md` |
| 2 | Design Reference | ✅ Complete (+ Amendment §A) | `helpan-ai-design-reference-v1.md` |
| 3 | OpenAPI 3.x spec | ✅ Complete | `helpan-ai-openapi-v1.yaml` |
| 4 | Delegated authority token contract | ✅ Strawman complete; pending Identiti H4 closure | `helpan-ai-delegated-authority-contract-v1.md` |
| 5 | Schema and ERD | ✅ Complete | `helpan-ai-schema-erd-v1.md` |
| 6 | Event bus contract | ✅ Complete | `helpan-ai-event-bus-contract-v1.md` |
| 7 | Threat model | ✅ Complete | `helpan-ai-threat-model-v1.md` |
| 8 | KP gap analysis | ✅ Complete (+ Amendment §A) | `helpan-ai-kipkiren-pay-gap-analysis-v1.md` |
| 9 | Per-app: family-discovery | ✅ Complete | `helpan-ai-per-app-integration-patterns-v1.md` §4 |
| 10 | Per-app: Helpan Chapaa | ✅ Complete | same file §3 |
| 11 | Per-app: Helpan Lunch Drop | ✅ Complete | same file §2 |
| 11.5 | Per-app: Helpan Klokd | ✅ Complete | same file §1 |
| 12 | OAuth scope catalogue v1 | ✅ Complete | `helpan-ai-oauth-scope-catalogue-v1.md` |
| 13 | Helpan Console specification | ✅ Complete | `helpan-ai-console-specification-v1.md` |
| 14 | Build Readiness Checklist | ✅ Complete | `helpan-ai-build-readiness-checklist-v1.md` |
| 15 | Reading orders by role | ✅ Complete | `helpan-ai-reading-orders-v1.md` |
| 16 | **Reboot Pack v1.0** | ✅ This document | `helpan-ai-reboot-pack-v1.md` |

Plus scan integration:
- Scan Integration Memo: `helpan-ai-scan-integration-memo-v1.md`
- Six canonical Platform Rails docs amended (Identiti / KP / Todoku Rail Contracts + Schema Appendices, App Integration Guide, Claude Code Instruction Pack — each Amendment §A appended)
- Three rail integration maps updated

---

## 6. Corpus map

### 6.1 Inputs (Chamia, pre-session)

- `helpan-ai-rail-instruction-v32.md` — authoritative Design Instruction Pack v1.0
- `helpan-ai-dod-mvp-md.md` (+ HTML twin) — Definition of Done & MVP Scope v1.0
- `helpan-ai-rail-one-pager-v11.md` — daily reference companion
- `helpan-ai-bootstrap-v9.md` — new-session bootstrap prompt
- `agentic_ai_scan.html` — Agentic AI Signal Scan (4 May 2026)

### 6.2 Outputs (this session)

All listed in §5 above.

### 6.3 Companion Platform Rails docs (referenced; not authored here)

- Platform Rails Reboot Pack v1.2 (4 May 2026) — three-rail canonical record; Helpan AI is the fourth-rail addition
- Identiti / KP / Todoku Rail Contracts v1.0 + Schema Appendices + Amendment §A (scan integration) (each)
- App Integration Guide v1.0 + Amendment §A
- Claude Code Instruction Pack v1.0 + Amendment §A

---

## 7. Locked decisions

### 7.1 — Rail name
**Helpan AI.** Confirmed per Confirmation Memo §1. Brand "Helpan" used across consuming-app agent names: Helpan Klokd, Helpan Lunch Drop, Helpan Chapaa, Helpan [App Name].

### 7.2 — Domain
`helpan.co.ke`. Sandbox `sandbox.helpan.co.ke`, pre-production `pre.helpan.co.ke`, production `api.helpan.co.ke` — all under the KMV `.co.ke` family for regulated rails.

### 7.3 — Rail consumer pattern
Apps consume via SDK with thin foreign references. Rail owns: runtime, briefing storage, matching, scope catalogue. Apps own: agent persona, agent policies, app-specific data, briefing UX. Per Instruction Pack §3.2 and §5.

### 7.4 — Delegated authority is the security primitive
Every agent action touching money / identity / comms carries a scoped, time-bounded, revocable delegated authority token. Distinct from step-up. Token signed RS256 by Identiti on Helpan AI's behalf. Validated per call against Helpan AI's `POST /authorities/{id}/validate`. 60-second positive cache; no negative cache. Per §1 Delegated Authority Contract.

### 7.5 — Helpan Console is mandatory v1
Shared React Native library `@kmv/helpan-console` invoked from each consuming app. Every active authorisation visible portfolio-wide. One-tap revocation. Activity log of last 30 actions per authority. Per Console Specification.

### 7.6 — OAuth scope catalogue
Helpan AI defines scopes; Identiti issues OAuth tokens. Default-most-restrictive posture for third-party agents. Behavioural-detail scopes are `default_grantable=false` with `elevation_friction=high`. Per OAuth Scope Catalogue.

### 7.7 — Cardinal-rule defaults
- Rail-vs-rail ambiguity → platform rail wins.
- Rail-vs-app ambiguity → rail owns orchestration; app owns experience.
- Money / KYC / comms feature in Helpan AI → wrong; find the platform-rail primitive.

### 7.8 — LLM provider
**Open per Confirmation Memo §5.8.** Architecture is provider-agnostic with configurable provider per app override. Decision deferred; not blocking.

### 7.9 — Family-discovery app name
**Placeholder `[App Name]`** through Stage 0–1 per Confirmation Memo §5.5. Lock required before Stage 2.

### 7.10 — Stage progression
Stage 0 (Specification) → Stage 1 (Internal Alpha, ~8 weeks from build kick-off) → Stage 2 (Closed Beta) → Stage 3 (Production GA). Per DoD §6.

### 7.11 — Sign-off authorities
Stage 0→1: Chamia + Silvia. Stage 1→2: + Security. Stage 2→3: + Legal + Security. Per DoD §14.

### 7.12 — Stack
Provider-agnostic at the LLM layer. Otherwise inherited from platform programme: Node.js 22 LTS · TypeScript 5.x strict · Fastify 4.x · AJV (JSON Schema 2020-12) · PostgreSQL 16 via Supabase (af-south-1) · Drizzle ORM · Kafka (kafkajs) · Vitest · Railway. Per Confirmation Memo §5.8 implicit + Reboot Pack v1.2 §5.

### 7.13 — Helpan Klokd is priority 1
Per DoD §3.2 and Confirmation Memo §5.3. Output Plan extended with item 11.5 covering Helpan Klokd integration. Klokd in v1.0 launch scope.

### 7.14 — Programmable money elevated to KP v1
Per Helpan AI Instruction Pack §3.8. Family-discovery app standing-basket auto-replenishment depends on it. KP Gap Analysis B.1 / C.2 / C.3 are v1.0 hard blockers.

### 7.15 — KP gap analysis is recommendation-class
Per Confirmation Memo §5.4. Helpan AI session does not bind KP scope; Chamia decides after KP engineering reviews feasibility.

### 7.16 — Identiti step-up joint contract proceeds via strawman
Per Confirmation Memo §5.9. Delegated authority token contract is strawman; Identiti engineering joint review on §8 of the contract before final.

### 7.17 — Scan integration is binding
Per the user's directive (7 May 2026): every scan recommendation requiring artefact action has been integrated. Scan Integration Memo §2 enumerates all amendments.

---

## 8. Open items

### 8.1 — Hard blockers awaiting closure

| ID | Item | Owner |
|---|---|---|
| H4 | Step-up joint contract — Identiti engineering review of Delegated Authority Contract §8 | Helpan AI + Identiti |
| H14 | Legal sign-off on regulatory containment principle | Legal + Compliance |

### 8.2 — Operational / regulatory / counsel items raised

Per Scan Integration Memo §3 + Build Readiness Checklist §G:

- CBK pre-application meeting agenda items
- AML vendor evaluation (behavioural pattern detection criterion)
- KYC vendor RFQ (IAD requirement)
- DPA §31 counsel engagement
- ODPC DPIA agentic-AI scope
- COMESA WhatsApp probe quarterly monitoring
- Cross-rail fraud aggregator architecture (v1.1)
- Investor / B2B materials updates

### 8.3 — Reboot Pack v1.3 candidate items

To be folded into Platform Rails Reboot Pack v1.3 by Chamia:

- Four-rail thesis (add Helpan AI to §3 of Reboot Pack)
- Brand renames (kaLunch → Lunch Drop; family-discovery name when locked)
- Helpan Klokd priority-1 status
- Programmable money elevation in KP §6 locked decisions
- Scan integration items from Scan Integration Memo §2.7

### 8.4 — Decisions deferred to v1.1+

- Autonomous MMF rebalancing (Helpan Chapaa)
- CAEP real-time revocation
- Continuous behavioural monitoring (Identiti)
- Cross-app data access flows
- Server-side SDKs (Node, PHP, Python)
- Developer portal for third-party agents
- Helpan SabakiFresh, Helpan Kipkiren consumer, Helpan Nightpulse
- Voice and chat agent surfaces (v2.0)
- Helpan Console standalone app (v2.0)
- Predictive intent (v2.0)

---

## 9. Continuity-Critical Context — read this every session

### 9.1 The four rails
- **Kipkiren Pay** — payment, CBK-licensed (the only one), Kipkiren Pay Ltd, KES 20M capital, M-Pesa native, no cards v1, programmable money elevated to v1.
- **Identiti** — identity, OAuth issuance, step-up + phone tokens, IAD on KYC vendor RFQ (scan-driven), JIT identity posture, auth JWT TTL ≤1h elevated.
- **Todoku** — comms, template-only, anti-phishing/anti-vishing copy mandatory, velocity-burst envelope component, sender-ID monitoring v1.1.
- **Helpan AI** — agent rail, delegated authority + consent + audit + scope catalogue, no CBK exposure, four flagship integrations: Klokd, Lunch Drop, Chapaa, [App Name].

### 9.2 The cardinal rule
Helpan AI orchestrates; never duplicates rail functionality. No funds, no credit, no yield, no float, no off-ledger netting.

### 9.3 The four flagship integrations (priority order)
1. Helpan Klokd — beta live; pay-on-completion; reputation surfacing.
2. Helpan Lunch Drop — augmentation, not replacement; weekly plans; reliability nudges.
3. Helpan Chapaa — highest stakes; suggest-only MMF v1.0; credit-unlock via partner-lender.
4. Helpan [App Name] (family-discovery) — agent-native first; standing-basket; family-friendly safety.

### 9.4 The most security-critical primitive
Delegated authority token. RS256 signed. Carries `actor`, `initiated_by`, scope-list with limits. Validated per call against revocation endpoint. 60-second positive cache; no negative cache. CAEP real-time revocation v1.1.

### 9.5 The mandatory user surface
Helpan Console. Shared React Native library. Every active authorisation visible portfolio-wide. One-tap revocation. Mandatory v1.0; not deferrable.

### 9.6 The KP gap (v1.0 hard blockers)
- B.1 — Delegated authority validation in KP (cross-cutting Fastify plugin)
- C.2 — Transactional hold/release endpoints (Klokd shift escrow; Lunch Drop order escrow)
- C.3 — Programmable money / scheduled transfers (family-discovery standing-basket)
- S.1 — Chapaa credit-unlock partner-lender architecture (counsel-led)

### 9.7 The Identiti H4 joint
Step-up token format alignment + actor/initiated_by claim + signing API + cascade-revocation Kafka events. Strawman in Delegated Authority Contract §8; Identiti engineering review pending.

### 9.8 Scan integration is binding
Every scan recommendation requiring artefact action has been integrated. Cross-rail `initiated_by` claim, IAD on KYC, anti-social-engineering / anti-phishing / anti-vishing copy, velocity-burst envelope, JIT identity, auth JWT TTLs, behavioural-detail scope friction.

### 9.9 Stage 0 → Stage 1 gate
H14 (legal sign-off on regulatory containment) is the only open hard blocker. All other H-items closed at design-stage by this session.

### 9.10 Standing rules
Sessions read this Reboot Pack first + Platform Rails Reboot Pack v1.2. No `conversation_search`. Code as files only. KES minor units only — no floating point. Confirm before significant changes. M-Pesa Native firm-wide. No Todoku bypass. Default-to-rail on rail-vs-Helpan-AI ambiguity. Default-to-rail-orchestration on rail-vs-app ambiguity.

---

## 10. Closing notes

This Reboot Pack closes the Helpan AI design corpus at v1.0. Output Plan items 1–16 are all delivered. The build can begin. Stage 1 sandbox target is ~8 weeks from build kick-off; Stage 2 closed beta ~14 weeks; Stage 3 production GA ~20–24 weeks.

The next consolidation cycle (Helpan AI Reboot Pack v1.1) is targeted for after:
- Stage 1 sandbox operational with all four flagship integrations wired
- Identiti H4 joint contract finalised
- Legal H14 sign-off complete
- KP Gap Analysis items B.1, C.2, C.3 shipped to KP staging
- First closed-beta cohort (50+ users) live for at least one consuming app
- Scan-driven items BR-AI-1 through BR-AI-5 live in staging

Until then, this Reboot Pack v1.0 is the working canonical record.

The disintermediation thesis remains the strategic charter. The window to ship is short. **Build agent-native, consent-first, regulatory-contained — and ship before third-party agents arrive.**

— Helpan AI Rail Design Session, 7 May 2026

---

*Helpan AI Rail · Reboot Pack v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential · Companion to Platform Rails Reboot Pack v1.2*

*"The agent is the new front door. The rail is the foundation the door is hung on."*
