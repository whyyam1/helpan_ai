# Helpan AI Rail — Build Readiness Checklist v1.0

**Document type:** Populated build-readiness checklist against Helpan AI Instruction Pack §13 + DoD/MVP v1.0 §7.
**Date:** 7 May 2026
**Authority:** Instruction Pack v1.0 §13; DoD/MVP v1.0 §7; Confirmation Memo v1.0 §7; Scan Integration Memo v1.0 (BR-AI-1 to BR-AI-5).

---

## Legend

- [x] **Done** — closed at issuance of this checklist
- [~] **In flight** — work has begun
- [ ] **Open** — must close before the named stage advance

---

## Section A — Hard blockers (Stage 0 specification gate)

Per Instruction Pack §13.1.

| ID | Item | Status | Where it landed | Owner |
|---|---|---|---|---|
| H1 | Confirm rail name | [x] | Confirmation Memo §1 (Helpan AI) | Chamia |
| H2 | OpenAPI 3.x spec | [x] | `helpan-ai-openapi-v1.yaml` | Session |
| H3 | Delegated authority token contract | [~] | `helpan-ai-delegated-authority-contract-v1.md` (strawman; pending H4 closure) | Helpan AI + Identiti + Security |
| H4 | Step-up token joint contract | [~] | `helpan-ai-delegated-authority-contract-v1.md` §8 (joint points enumerated) | Helpan AI + Identiti |
| H5 | Schema and ERD | [x] | `helpan-ai-schema-erd-v1.md` | Session |
| H6 | RLS policy specification | [x] | `helpan-ai-schema-erd-v1.md` §3 | Session |
| H7 | Audit log specification with retention rules | [x] | `helpan-ai-schema-erd-v1.md` §1.13 + Reboot Pack §9.5 (7-yr retention) | Session |
| H8 | Kipkiren Pay gap analysis | [x] | `helpan-ai-kipkiren-pay-gap-analysis-v1.md` + Amendment §A | Session (recommendation-class) |
| H9 | OAuth scope catalogue v1 | [x] | `helpan-ai-oauth-scope-catalogue-v1.md` | Session |
| H10 | Threat model | [x] | `helpan-ai-threat-model-v1.md` | Session |
| H11 | Helpan Console design specification | [x] | `helpan-ai-console-specification-v1.md` | Session (design-stage; UX validation at S11) |
| H12 | Per-app safety policy schema | [x] | `helpan-ai-schema-erd-v1.md` §1.9; `helpan-ai-per-app-integration-patterns-v1.md` §6 per app | Session |
| H13 | Event bus contract | [x] | `helpan-ai-event-bus-contract-v1.md` | Session |
| H14 | Legal sign-off on regulatory containment (§9.3) | [ ] | Counsel agenda — out of artefact scope | Legal + Compliance |
| H15 | Behavioural data containment policy per app | [x] | `helpan-ai-per-app-integration-patterns-v1.md` §6 per app + OAuth Scope Catalogue §1.2, §4 | Session |

**Stage 0 gate:** H14 is the only outstanding hard blocker. All other H-items closed at design-stage. Legal sign-off is the gating activity outside this session's scope.

---

## Section B — Scan-integration build-readiness items

Per Scan Integration Memo + Claude Code Instruction Pack Amendment §A.3.

| ID | Item | Status | Stage |
|---|---|---|---|
| BR-AI-1 | KP cross-account behavioural fraud pattern monitoring (Phase 1) | [ ] | Stage 1 build (Kipkiren Pay rail) |
| BR-AI-2 | Todoku envelope velocity-burst component (`ENV_VELOCITY_BURST_DETECTED`) | [ ] | Stage 1 build (Todoku rail) |
| BR-AI-3 | Todoku anomalous recipient pattern alert | [ ] | Stage 1 build (Todoku rail) |
| BR-AI-4 | Todoku API key compromise response playbook | [ ] | Stage 1 build (Todoku ops) |
| BR-AI-5 | Identiti KYC vendor IAD verification | [ ] | Stage 1 procurement (Identiti rail) |

These five are owned by their respective platform rails, surfaced to Helpan AI build readiness because Helpan AI's audit and dispatch correctness depend on them.

---

## Section C — Soft blockers (Stage 1–2 launch gates)

Per Instruction Pack §13.2 and DoD §7.2 / §7.3.

| ID | Item | Stage gate | Status |
|---|---|---|---|
| S1 | React Native client SDK (Helpan Console library) | Stage 1 | [ ] |
| S2 | Family-discovery app integration documented | Stage 1 (doc), Stage 2 (built) | [x] doc; [ ] build |
| S3 | Helpan Chapaa integration documented | Stage 1, Stage 2 | [x] doc; [ ] build |
| S4 | Helpan Lunch Drop integration documented | Stage 1, Stage 2 | [x] doc; [ ] build |
| S4.5 | Helpan Klokd integration documented | Stage 1, Stage 2 | [x] doc; [ ] build |
| S5 | Operator console for Helpan AI ops | Stage 2 | [ ] |
| S6 | Incident management runbooks | Stage 2 | [ ] |
| S7 | Pen-test commissioned; Critical+High resolved | Stage 2 | [ ] |
| S8 | Load test against expected agent volume | Stage 2 | [ ] |
| S9 | DR drill | Stage 2 | [ ] |
| S10 | ODPC registration alignment | Stage 2 | [ ] |
| S11 | Helpan Console UX validated with 10+ users | Stage 2 | [ ] |

---

## Section D — Deferrable (post-v1.0)

Per Instruction Pack §13.3 and DoD §5.

| ID | Item | Target |
|---|---|---|
| D1 | Server-side SDKs (Node, PHP, Python) | v1.1 |
| D2 | Developer portal for third-party agents | v1.1 |
| D3 | Helpan SabakiFresh, Helpan Kipkiren consumer, Helpan Nightpulse | v1.1 / v1.2 |
| D4 | Cross-app data access flows (full) | v1.1 |
| D5 | Voice and chat agent surfaces | v2.0 |

---

## Section E — Stage progression DoD (consolidated from DoD §7)

### Stage 0 — Specification (current)

All H1–H13 + H15 closed at design-stage by this session. **H14 (legal sign-off) is the gate to advance to Stage 1.**

### Stage 1 — Internal Alpha

Stage 0 complete + the following:

- [~] Supabase schema (af-south-1) deployed with full RLS per `helpan-ai-schema-erd-v1.md` — H-1 (8 May 2026) shipped 6 hand-authored migrations + Drizzle schema covering all 14 tables and RLS policies; deployment to Supabase af-south-1 still pending
- [ ] All rail-side endpoints implemented and passing contract tests against `helpan-ai-openapi-v1.yaml` — H-1 ships `/v1/health` + `/v1/health/deep` only
- [ ] Delegated authority issuance / validation / revocation working end-to-end
- [ ] Revocation propagation to KP and Todoku confirmed within 5-second SLA (60s acceptable per §5.3 of authority contract; 5s is target)
- [ ] Audit log writing and reading; hash-chain verified
- [ ] Matching engine processing test events
- [ ] Identiti JWT validation live in staging
- [ ] Identiti step-up flow live in staging
- [ ] KP agent-native endpoints (B.1 + C.2 + C.3 from Gap Analysis) live in staging
- [ ] Todoku notification dispatch live in staging
- [ ] All four flagship integrations wired in staging (Klokd, Lunch Drop, Chapaa, family-discovery)
- [ ] React Native SDK published to internal registry
- [ ] All observability metrics live; alerts configured
- [ ] Scan integration items BR-AI-1 to BR-AI-5 live in staging

### Stage 2 — Closed Beta

Stage 1 complete + the following:

- [ ] Rail in production behind feature flag
- [ ] DR drill complete
- [ ] Incident runbooks live
- [ ] Load test complete
- [ ] Pen-test Critical + High resolved
- [ ] Closed-beta cohorts live for all four flagship integrations (50+ users each per DoD §7.3)
- [ ] Helpan Console UX validated (10+ users)
- [ ] ODPC registration in progress with legal timeline
- [ ] Operator console live for Kirimon ops
- [ ] Audit log production-verified with retention policy active
- [ ] H14 legal sign-off complete

### Stage 3 — Production GA

Stage 2 complete + the following:

- [ ] Zero open Critical + High security findings
- [ ] P99 dispatch latency ≤ 2s under expected load
- [ ] Rail uptime ≥ 99.5% trailing 30 days
- [ ] Revocation propagation ≤ 5 seconds confirmed under load
- [ ] No data leakage incidents in closed beta
- [ ] Family-discovery + Helpan Chapaa GA (DoD §10 hard gates)
- [ ] Helpan Lunch Drop GA OR Chamia-signed v1.1 deferral
- [ ] Helpan Klokd GA OR Chamia-signed v1.1 deferral
- [ ] OAuth scope catalogue published; ≥ 1 third-party agent integration validated
- [ ] All Output Plan artefacts complete and published
- [ ] Reading orders by role published
- [ ] Reboot Pack v1.0 complete and accepted
- [ ] Sign-offs: Chamia (CEO/CPO) + Silvia (CTO) + Legal + Security

---

## Section F — Sign-off authorities (per DoD §14)

| Stage | Required sign-off |
|---|---|
| Stage 0 → Stage 1 | Chamia + Silvia |
| Stage 1 → Stage 2 | Chamia + Silvia + Security |
| Stage 2 → Stage 3 | Chamia + Silvia + Legal + Security |
| Post-launch v1.1 scope | Chamia |

---

## Section G — Items raised to Chamia for non-artefact action

From Scan Integration Memo §3:

- [ ] CBK pre-application meeting agenda — agent-initiated payment authorisation (KP-3, KP-6, XR-4)
- [ ] AML vendor evaluation — behavioural pattern detection criterion (KP-4)
- [ ] KYC vendor RFQ — IAD requirement (ID-1)
- [ ] DPA §31 counsel engagement (ID-6, XR-5)
- [ ] Sender-ID spoofing monitoring — ops capability build + Stage-2 product UX (TD-2)
- [ ] API key compromise playbook — ops documentation (TD-3)
- [ ] COMESA probe quarterly monitoring (TD-6)
- [ ] Cross-rail fraud aggregator — Reboot Pack v1.3 architecture candidate (XR-3)
- [ ] Investor / B2B materials — agentic AI posture, template-only as moat, Identiti as agent credential authority (TD-6, ID-7, XR-6)

These are tracked here but discharged outside this session.

---

## Section H — Items requiring Reboot Pack v1.3

Per Confirmation Memo §5.1 and Scan Integration Memo §2.7. Out of scope for this session; surfaced to Chamia for v1.3 production:

- Four-rail thesis (Helpan AI added to §3 of Reboot Pack)
- Brand renames (kaLunch → Lunch Drop, family-discovery app naming when locked)
- Helpan Klokd priority-1 status across the corpus
- Programmable money elevated in KP scope
- Cross-rail `initiated_by` claim
- IAD on KYC vendor list
- Velocity-burst component on Todoku envelope
- Cross-rail fraud aggregator architecture
- AI fraud pattern monitoring on Build Readiness
- AML behavioural detection on vendor criteria
- CBK / DPA / DPIA agenda items

---

*Helpan AI Rail · Build Readiness Checklist v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential*
