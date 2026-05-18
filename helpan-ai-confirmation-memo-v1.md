# Helpan AI Rail — Confirmation Memo v1.0

**To:** Chamia Mutuku, CEO & CPO, Kirimon Market Ventures
**From:** Helpan AI Rail Design Session (Output Plan item 1)
**Date:** 6 May 2026
**Status:** Gate document. No further Output Plan items proceed until §5 is resolved and §7 is signed off.
**Authority:** Helpan AI Rail Design Instruction Pack v1.0 §15; DoD/MVP v1.0 §7.1; Bootstrap v9.

---

## 0. Purpose

The Bootstrap is explicit: *"DO NOT skip the Confirmation Memo. DO NOT proceed past it without explicit confirmation from Chamia."* This memo discharges that gate — records understanding, surfaces the items that must close before deeper design, and proposes a cadence for Output Plan items 2–16.

---

## 1. Design Law (§3) — confirmed

All ten sub-laws are confirmed understood and treated as non-negotiable unless explicitly reopened.

| § | Confirmed understanding |
|---|---|
| 3.1 | No re-implementation of payment, identity, or comms. Orchestrate only. |
| 3.2 | Apps consume via SDK with thin foreign refs. Rail owns runtime, briefing storage, matching, scope catalogue. |
| 3.3 | Every money/identity/comms agent action carries a scoped, time-bounded, revocable delegated authority token. Distinct from step-up. |
| 3.4 | Default own-app reads only. Cross-app needs explicit consent + scope. Third-party agents start at most-restrictive. Behavioural detail is the credit signal and is the most-protected class. |
| 3.5 | Helpan AI holds no funds, extends no credit, aggregates no yield, runs no float, nets nothing off-ledger. KP is the only CBK-licensed entity in the portfolio. |
| 3.6 | Category whitelists, content moderation hooks, and per-app safety policies are rail primitives — not re-invented per app. |
| 3.7 | Helpan Console is mandatory for v1 and not deferrable. Delivered as a shared React Native library. |
| 3.8 | KP exposes every capability agent-natively. Programmable money / scheduled transfers move from Phase 2 to v1. KP gap analysis (H8) gates the KP backlog. |
| 3.9 | Built for third-party agents under OAuth. Closure at the consent layer, not the API layer. |
| 3.10 | M-Pesa Native firm-wide. No Todoku bypass. Code as files, not chat. Design tokens, no hardcoded values. Confirm before changes. Reboot packs as `.md` + rendered HTML. |

---

## 2. Strategic Context (§4) — confirmed

McKinsey April 2026 names AI agents as the channel of choice for banking within 3–5 years; estimated profit-pool risk is 9% global average, 27% deposits, 34% cards. The mechanism is the removal of consumer inertia. The defensive prescription for wallet providers and superapps is to become the operating system agents prefer — open developer toolkits, transparent consent, secured user intent.

The Kirimon response is not to concede the channel. Each consuming app ships its own agent before third-party agents arrive in Kenya. The defence against the A2A bypass threat (agents calling Daraja directly) is the abstractions Daraja does not expose: verification primitive, escrow, hold/release, dispute orchestration, AI risk scoring, counterfactual explainer, programmable-money primitives. Each app is more useful with its agent than without; each agent is more useful with the rail than without.

Specific implications confirmed: agent-readable KP surface, programmable money elevated to v1, AI risk scoring and AI dispute reframed as defensibility moats; Chapaa's defensibility is the commitment mechanics and the credit-unlock moment, not the rate; behavioural data containment is critical for Chapaa.

---

## 3. Capability boundaries (§5) — confirmed

The split across Helpan AI, consuming apps, Identiti, Kipkiren Pay, and Todoku as set out in §5 is treated as binding. Drift across that boundary in subsequent artefacts is a design error. **Defaults**: rail wins over Helpan AI on rail-vs-rail ambiguity; rail (orchestration) wins over app on rail-vs-app ambiguity.

## 4. Working rules (§16) — confirmed

§16 working rules are accepted in full without modification.

---

## 5. Items requiring sign-off before Output Plan item 2

### 5.1 Reboot Pack reconciliation
The Platform Rails Reboot Pack v1.2 (4 May 2026) names three rails and does not list Helpan AI in §3 or §15. The Helpan corpus (5 May 2026) introduces a fourth rail. **Proposed:** this session produces a **Helpan AI Reboot Pack v1.0** (Output Plan item 16) as a peer to v1.2. A Platform Rails Reboot Pack v1.3 to fold in the four-rail thesis is **out of scope here**. **Question:** confirm v1.3 is scheduled separately and not blocking.

### 5.2 kaLunch → Lunch Drop rename
Helpan corpus uses **Lunch Drop**; Reboot Pack v1.2 still says **kaLunch** as the brand. **Proposed:** Helpan AI artefacts use Lunch Drop; legal entity remains Lunch Drop Limited; v1.3 folds the rename in. **Question:** confirm Lunch Drop is the canonical v1.0 brand.

### 5.3 Helpan Klokd
DoD §3.2 / §4.3 names Helpan Klokd a **priority-1 v1.0 hard MVP gate** (beta live). Instruction Pack §11 (per-app integrations) does not document it; Output Plan §15 does not list a Klokd integration item. **Proposed:** add Output Plan **item 11.5 — Per-app integration: Helpan Klokd**. **Question:** confirm Helpan Klokd is in v1.0 scope with the new item, OR confirm v1.1 deferral and DoD §4.3 amendment.

### 5.4 KP gap analysis as recommendation, not directive
Programmable money is unmentioned in Reboot Pack v1.2 §6 but elevated to v1 by Helpan corpus §3.8. **Proposed:** Output Plan item 8 produces a **recommendation** to KP engineering and Chamia, not a binding scope change. The actual KP v1 scope change is Chamia's call after KP engineering reviews feasibility. **Question:** confirm recommendation-class output.

### 5.5 Family-discovery app — placeholder name
Name is TBD (Sasa, Hapa, or other). DoD §12 accepts "working name TBD" through Stage 0–1; lock by Stage 2. **Proposed:** all artefacts use placeholder **Helpan [App Name]**; freeze before Stage 2. **Question:** confirm — or provide the name now to remove a small disambiguation cost.

### 5.6 Nightpulse
Instruction Pack §11.6 names Helpan Nightpulse as a v1 consuming app; DoD §5 defers Helpan Nightpulse to v1.2; Reboot Pack v1.2 §1 does not list Nightpulse in the portfolio. **Proposed:** Nightpulse is in the portfolio; Helpan Nightpulse is v1.2; the v1.0 rail must architect for adult-audience safety posture (so Nightpulse can plug in at v1.2 without re-architecture). **Question:** confirm all three.

### 5.7 Identiti spelling
Bootstrap NAMING is explicit: **Identiti, not Identity**. Careful re-read confirms the Instruction Pack is consistent. Reported for awareness only.

### 5.8 Default LLM provider
§14 item 4 leaves it open. **Proposed:** **Anthropic Claude** — Opus 4.x for high-stakes (Helpan Chapaa), Sonnet 4.x for high-volume (Helpan Lunch Drop, Helpan Klokd, family-discovery), Haiku 4.x for routing and lightweight matching. Per-app override supported. Rationale: af-south-1 availability, mature tool-use, well-formed delegated authority patterns in the SDK. **Question:** confirm or specify alternative.

### 5.9 Step-up token joint contract (H4)
The Identiti step-up token format is joint design with Identiti engineering and cannot be resolved unilaterally. **Proposed:** Output Plan item 4 produces a **strawman** delegated authority token contract that consumes the Identiti step-up at named integration points marked "Identiti-joint — pending H4 closure." Item 4 is finalised only after Identiti engineering signs off the joint integration. **Question:** confirm the strawman approach and name the Identiti engineering point of contact.

---

## 6. Proposed Output Plan cadence

§15 order is fixed except where noted. **Proposed parallelism:** items 2 and 8 run in parallel after item 1 closes (item 8 has external KP-engineering bandwidth dependency; serialising wastes their availability). All other items respect §15.

| # | Artefact | Gating |
|---|---|---|
| 1 | **Confirmation Memo** | This document → §7 sign-off unlocks 2 + 8 |
| 2 | Helpan AI Design Reference (~30pp) | Item 1 |
| 3 | OpenAPI 3.x spec | Item 2 |
| 4 | **Delegated authority token contract** (H3, H4) | Item 3 + Identiti joint review |
| 5 | Schema and ERD | Item 4 |
| 6 | Event bus contract | Item 5 |
| 7 | Threat model | Items 4–6 |
| 8 | **Kipkiren Pay gap analysis** (H8) — parallel | Item 1; KP engineering review |
| 9 | Per-app: family-discovery app | Items 4–8 |
| 10 | Per-app: Helpan Chapaa | Items 4–8 |
| 11 | Per-app: Helpan Lunch Drop | Items 4–8 |
| 11.5 | **Per-app: Helpan Klokd** *(proposed; §5.3)* | Items 4–8 |
| 12 | OAuth scope catalogue v1 | Items 9–11.5 in flight |
| 13 | Helpan Console specification | Item 4 |
| 14 | Build Readiness Checklist | All above |
| 15 | Reading orders by role | All above |
| 16 | **Helpan AI Reboot Pack v1.0** | All above |

---

## 7. Sign-off block

The following confirmations unlock Output Plan items 2 and 8.

- [ ] Design Law (§3), Strategic Context (§4), capability boundaries (§5), working rules (§16) — confirmed (this memo §1–§4).
- [ ] §5.1 — v1.3 reconciliation scheduled separately, not blocking.
- [ ] §5.2 — Lunch Drop is the canonical v1.0 brand.
- [ ] §5.3 — Helpan Klokd disposition (in v1.0 with new item 11.5, OR v1.1 deferral with DoD §4.3 amended).
- [ ] §5.4 — KP gap analysis is recommendation-class.
- [ ] §5.5 — Stage 0 proceeds with placeholder for family-discovery app name.
- [ ] §5.6 — Nightpulse confirmed in portfolio; Helpan Nightpulse v1.2; rail architects for adult-audience in v1.0.
- [ ] §5.7 — Identiti spelling. (Reported only.)
- [ ] §5.8 — LLM default (Anthropic proposed) confirmed or specified otherwise.
- [ ] §5.9 — Strawman-then-joint-finalisation approach confirmed; Identiti engineering point of contact named.

When returned, the session moves to Output Plan items 2 and 8.

---

## 8. Close

Two coordination risks deserve flagging now: the KP gap (H8) and the Identiti step-up alignment (H4) need bandwidth from teams outside this session. If those slip, the rail design is paper. The §6 parallelism is the only structural mitigation this session can offer; the rest is on Chamia and Silvia.

— Helpan AI Rail Design Session

---

## Amendment §A — Agentic AI Signal Scan landed (7 May 2026)

The Agentic AI Signal Scan (`agentic_ai_scan.html`, Chamia, 4 May 2026) was added to the corpus folder after this memo was signed off. The scan is treated as a binding Chamia directive per standing rules.

The scan's content is processed through the **Scan Integration Memo v1.0** (`helpan-ai-scan-integration-memo-v1.md`, 7 May 2026), which maps every scan finding to the artefact that absorbs it. Several scan recommendations independently arrive at conclusions already locked in this memo (delegated authority distinct from step-up; default-most-restrictive scopes; trust-by-design; template-only comms posture). Several others are operational, regulatory, or counsel items captured in the Scan Integration Memo §3 for non-artefact action.

**§6 cadence update.** Output Plan items 1, 2, and 8 have been delivered in the order specified in §6 of this memo. The scan integration is inserted between item 8 and item 3 as a discrete batch of canonical-document amendments. The Scan Integration Memo §4 names the execution sequence; subsequent Output Plan items (3, 4, 5, …) inherit the scan-driven additions.

**§5 sign-offs unaffected.** None of the nine sign-off items in §5 of this memo are reopened by the scan. Where the scan reinforces a sign-off (§5.4 KP gap analysis as recommendation-class; §5.9 strawman-then-joint for delegated authority), the reinforcement is consistent. Where the scan adds new items (cross-rail `initiated_by`, IAD on KYC vendor RFQ), those items are tracked in the Scan Integration Memo, not retro-fitted into §5 here.

---

*Helpan AI Rail · Confirmation Memo v1.0 + Amendment §A · 6 May 2026; amendment 7 May 2026 · Kirimon Market Ventures · Confidential*
