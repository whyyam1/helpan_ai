# Scan Integration Memo v1.0

**Document type:** Master plan for integrating Chamia's Agentic AI Signal Scan (4 May 2026) into every affected artefact across the platform corpus.
**Owner:** Helpan AI Rail Design Session.
**Date:** 7 May 2026
**Authority source:** `agentic_ai_scan.html` (Chamia, 4 May 2026). All 24 scan findings + 6 cross-rail implications + Recommended Design Responses are treated as binding directives unless explicitly out of artefact scope (counsel, regulator, ops engagement).
**Standing rule:** Where this memo and Chamia's scan disagree, the scan wins.

---

## 0. Why this memo exists

The scan is a Chamia directive that pre-dates the Helpan AI corpus by one day. Several scan recommendations (notably "Identiti has no framework for authenticating AI agents — v1.1 roadmap") were superseded the next day by the decision to build Helpan AI as a fourth rail. But the **majority of scan items are independent of that decision** and apply to artefacts already in the platform corpus — rail contracts, schema appendices, the App Integration Guide, the Claude Code Instruction Pack, and downstream design documents.

This memo exists to ensure no scan item is silently dropped. Every action pill in the scan is mapped here to a specific artefact, with a planned amendment, a priority tier, and a status flag.

---

## 1. Scan-item inventory and disposition

The scan contains 24 numbered findings across three rails plus 6 cross-rail implications. Action pills are categorised: 🟢 add now, 🟡 watch, ⏸ defer.

### 1.1 Kipkiren Pay findings

| ID | Scan finding | Action | Disposition | Lands in |
|---|---|---|---|---|
| KP-1 | Payment API designed for humans; agents arriving | Add agent delegation spec to v1.1 roadmap | **Superseded by Helpan AI** — delegation lives in fourth rail (Helpan AI Design Reference §6.2; Gap Analysis B.1) | Helpan AI corpus; KP Rail Contract amendment notes Helpan AI as the answer |
| KP-2 | AI-orchestrated synthetic identity / coordinated drain | Add AI fraud pattern monitoring to Build Readiness | **v1.0** — directly actionable | KP Rail Contract amendment §A1; Build Readiness Checklist; Reboot Pack v1.3 |
| KP-3 | Know Your Agent regulatory expectation | Watch — flag for CBK pre-application | **Watch (regulatory)** — out of artefact scope; surface to Chamia | Scan Integration Memo §3 |
| KP-4 | AI-driven AML pattern obfuscation | Watch — AML vendor evaluation criteria | **Watch (procurement)** — out of artefact scope; surface to Chamia | Scan Integration Memo §3 |
| KP-5 | Step-up token good but needs `initiated_by` claim | Add to v1.0 Schema Appendix — one claim, future-proof | **v1.0 hard** — minimal cost, high audit value | Identiti Schema Appendix amendment; KP Schema Appendix amendment |
| KP-6 | Agentic payments regulation moving — no CBK framework yet | Watch — raise at CBK pre-application | **Watch (regulatory)** | Scan Integration Memo §3 |
| KP-7 | AI voice cloning for OTP authorisation fraud | Add anti-social-engineering copy to step-up templates | **v1.0** — template-approval requirement | KP Rail Contract amendment; Todoku Rail Contract amendment |
| KP-8 | AI-powered fraud detection as differentiator | Watch — Phase 2 product roadmap | **Watch (roadmap)** — Helpan AI Design Reference §7.2 already names this as defensibility moat | No new artefact change beyond existing Design Reference §7.2 |

### 1.2 Identiti findings

| ID | Scan finding | Action | Disposition | Lands in |
|---|---|---|---|---|
| ID-1 | Deepfake-as-a-Service ($10–50) bypasses liveness | Add IAD requirement to KYC vendor RFQ | **v1.0 hard** — vendor requirement + Rail Contract amendment | Identiti Rail Contract amendment §A1; Reboot Pack v1.3 vendor list |
| ID-2 | Non-human identity — Identiti has no framework | Add to v1.1 roadmap — agent identity spec + registry | **Superseded by Helpan AI** — Helpan AI is the framework | Helpan AI Design Reference §9.1; Identiti integration map |
| ID-3 | Synthetic identity / dormant 18-month profiles | Watch — continuous monitoring in behavioural biometrics spec | **v1.1** — monitoring is post-onboarding; document in Identiti contract roadmap | Identiti Rail Contract amendment §A2 (roadmap section) |
| ID-4 | OAuth being rebuilt for agents | Add `actor` claim + CAEP revocation endpoint to v1.1 roadmap | **Hybrid: `actor` claim is v1.0; CAEP is v1.1** | Identiti Schema Appendix amendment (`actor` claim); Identiti Rail Contract amendment §A3 (CAEP roadmap) |
| ID-5 | AiTM session-token theft (80% of MFA bypasses) | Add explicit auth JWT TTL policy | **v1.0 hard** | Identiti Rail Contract amendment §A4 |
| ID-6 | DPA 2019 + agentic AI | Watch — counsel engagement | **Watch (counsel)** — out of artefact scope; surface to Chamia | Scan Integration Memo §3 |
| ID-7 | Identiti as agent credential authority | Opportunity — v1.1 roadmap and B2B pitch | **Captured by Helpan AI** — Identiti issues OAuth tokens for third-party agents under scopes Helpan AI defines | Helpan AI Design Reference §9.1; B2B pitch separately (out of artefact scope) |
| ID-8 | JIT identity is the standard | Document JIT posture explicitly | **v1.0** — contract language addition | Identiti Rail Contract amendment §A5 |

### 1.3 Todoku findings

| ID | Scan finding | Action | Disposition | Lands in |
|---|---|---|---|---|
| TD-1 | Meta WhatsApp AI ToS ban + COMESA probe | Add ToS compliance note + monitor probe | **v1.0** — contract amendment | Todoku Rail Contract amendment §A1 |
| TD-2 | AI smishing / sender-ID spoofing | Add sender-ID monitoring + consumer verification | **v1.1 (ops playbook + Stage-2 product)** — out of v1.0 artefact scope; document in Todoku integration map and roadmap | Todoku Rail Contract amendment §A2 (roadmap); Todoku integration map |
| TD-3 | Template abuse via compromised credentials | Add anomaly detection + key compromise playbook | **v1.0 ops + v1.1 detection** | Todoku Rail Contract amendment §A3 (envelope enforcement); Build Readiness Checklist |
| TD-4 | AI voice cloning for OTP vishing | Add anti-vishing copy to voice OTP templates | **v1.0** — template-approval requirement | Todoku Rail Contract amendment §A4 |
| TD-5 | AI agents at inhuman SMS volume | Add time-windowed velocity component to diversity check | **v1.0 hard** — envelope enforcement spec change | Todoku Rail Contract amendment §A5; Claude Code Instruction Pack §7.4 |
| TD-6 | Template-only is competitive differentiator | Strengthen language in investor pack | **Strategic (out of artefact scope)** — surface to BD/investor materials | Scan Integration Memo §3 |
| TD-7 | OTP smishing 19–36% CTR | Mandatory anti-phishing line in class_0 OTP templates | **v1.0** — template-approval requirement | Todoku Rail Contract amendment §A6 |
| TD-8 | Agent-initiated comms via consuming-app AI | Add optional `initiated_by` field to SendMessageRequest | **v1.0** — schema addition | Todoku Schema Appendix amendment |

### 1.4 Cross-rail implications

| ID | Scan finding | Action | Disposition | Lands in |
|---|---|---|---|---|
| XR-1 | `initiated_by` claim across all three rails | Add to KP step-up JWT, Identiti JWT, Todoku send schema | **v1.0 hard — cross-rail addition** | All three Schema Appendix amendments; App Integration Guide amendment §A1; Helpan AI Design Reference §9 |
| XR-2 | Deepfake social engineering full payment loop | Mandatory anti-social-eng copy at template approval | **v1.0** — three-rail template policy | All three Rail Contract amendments; App Integration Guide amendment §A2 |
| XR-3 | Cross-rail AI fraud signal aggregator | Architecture-now, build-later | **v1.1 architecture, v1.2 build** — Kafka topology must support; document in Reboot Pack v1.3 | Reboot Pack v1.3 candidate; Helpan AI Design Reference §9 |
| XR-4 | Trust-by-design as 2026 regulator frame | Document in CBK pre-application materials | **Watch (regulatory)** — out of artefact scope | Scan Integration Memo §3 |
| XR-5 | DPA 2019 + agentic AI = new DPIA trigger | Counsel engagement | **Watch (counsel)** — out of artefact scope | Scan Integration Memo §3 |
| XR-6 | African fintech VC is back — KMV is timed well | Investor positioning | **Strategic (out of artefact scope)** | Scan Integration Memo §3 |

---

## 2. Amendment plan — by artefact

This is the execution checklist. Each row is a planned amendment.

### 2.1 Schema Appendices (Chamia's canonical docs — additive amendment block)

| File | Amendment | Scan items |
|---|---|---|
| `Identiti_Rail_Contract_v1.0_Schema_Appendix.md` | Add `actor` claim and `initiated_by` claim to step-up JWT schema | XR-1, ID-4, KP-5 |
| `Kipkiren_Pay_Rail_Contract_v1.0_Schema_Appendix.md` | Add `initiated_by` field to PaymentRequest, PayoutRequest schemas | XR-1, KP-5 |
| `Todoku_Rail_Contract_v1.0_Schema_Appendix.md` | Add `initiated_by` field to SendMessageRequest schema | XR-1, TD-8 |

### 2.2 Rail Contract Scaffolds (Chamia's canonical docs — additive amendment block)

| File | Amendment | Scan items |
|---|---|---|
| `Identiti_Rail_Contract_v1.0_Scaffold.md` | Amendment §A — Agentic AI Signal Scan integration: explicit auth JWT TTL ≤1 hour; JIT identity posture documented; IAD vendor requirement; CAEP roadmap; continuous-monitoring roadmap | ID-1, ID-3, ID-4 (CAEP), ID-5, ID-8 |
| `Kipkiren_Pay_Rail_Contract_v1_0_Scaffold.md` | Amendment §A — AI fraud pattern monitoring on Build Readiness; anti-social-engineering copy required on step-up templates; `initiated_by` claim documented; agent delegation handled by Helpan AI cross-reference | KP-2, KP-7, XR-1, XR-2 (and KP-1 cross-reference) |
| `Todoku_Rail_Contract_v1_0_Scaffold.md` | Amendment §A — WhatsApp AI ToS compliance note; mandatory anti-phishing line on class_0 OTP templates; anti-vishing copy on voice OTP templates; time-windowed velocity component to diversity check; sender-ID spoofing monitoring (ops); anomalous recipient pattern alert (ops); key compromise playbook (ops) | TD-1, TD-2, TD-3, TD-4, TD-5, TD-7, XR-2 |

### 2.3 App Integration Guide (Chamia's canonical doc — additive amendment block)

| File | Amendment | Scan items |
|---|---|---|
| `App_Integration_Guide_v1_0.md` | Amendment §A — cross-rail `initiated_by` propagation pattern; mandatory anti-social-engineering copy; deepfake-resistant payment loop response | XR-1, XR-2, KP-7, TD-7 |

### 2.4 Claude Code Instruction Pack (Chamia's build brief — amendment block)

| File | Amendment | Scan items |
|---|---|---|
| `Claude_Code_Instruction_Pack_Platform_Rails_v1_0.md` | Amendment §A — DB schema: add `initiated_by` columns to `payments`, `payouts`, `step_up_tokens`, `messages` tables; Build Readiness: AI fraud pattern monitoring (KP), velocity-burst component (Todoku); IAD as KYC vendor requirement (Identiti) | KP-2, KP-5, ID-1, TD-5, XR-1 |

### 2.5 Rail integration maps (mine — direct rewrite)

| File | Update | Scan items |
|---|---|---|
| `C:\Projects\identiti\docs\INTEGRATION_MAP.md` | New §11 — Agentic AI threat landscape and integration responses; updates to §2 (cardinal rule) and §7 (token surfaces) for `actor`/`initiated_by` and JIT documentation; reference to IAD and CAEP roadmap | ID-1, ID-3, ID-4, ID-5, ID-8, XR-1 |
| `C:\Projects\kipkiren-pay\docs\INTEGRATION_MAP.md` | New §10 — Agentic AI threat landscape and integration responses; update to §6 (step-up handshake) for `initiated_by` claim; cross-reference to Helpan AI for agent delegation | KP-1, KP-2, KP-5, KP-7, XR-1, XR-2 |
| `C:\Projects\todoku-prod\docs\INTEGRATION_MAP.md` | New §13 — Agentic AI threat landscape and integration responses; updates to template-approval rules (anti-phishing/anti-vishing); update envelope enforcement (velocity burst); WhatsApp ToS compliance note | TD-1, TD-2, TD-4, TD-5, TD-7, TD-8, XR-1, XR-2 |

### 2.6 Helpan AI artefacts (mine — direct rewrite)

| File | Update | Scan items |
|---|---|---|
| `helpan-ai-confirmation-memo-v1.md` | Note scan as a strategic input that landed during memo cycle; reference scan integration in §6 cadence | All |
| `helpan-ai-design-reference-v1.md` | Reference scan in §4 (strategic context — adjacent intelligence corpus); §6.2 (delegated authority — note scan's `actor`/`subject` distinction); §7 (A2A bypass — adopt scan threat language); §12 (risks — incorporate scan threats); §13 (charter unchanged) | XR-1, XR-3, KP-1 (Helpan AI as the answer), ID-2, ID-7 |
| `helpan-ai-kipkiren-pay-gap-analysis-v1.md` | Add scan-driven items: B.5 `initiated_by` claim addition (cross-cutting, v1.0 lightweight); B.6 anti-social-engineering copy; C.12 cross-account behavioural fraud detection (the scan's "AI fraud pattern monitoring" — distinct from C.8 per-transaction risk scoring) | KP-2, KP-5, KP-7, XR-1, XR-2 |

### 2.7 Reboot Pack v1.2 → v1.3 (Chamia's authority, not mine)

| File | Action | Scan items |
|---|---|---|
| `Platform_Rails_Reboot_Pack_v1_2.md` | **DO NOT EDIT.** Surface a Reboot Pack v1.3 candidate-items list to Chamia. v1.3 should fold in: four-rail thesis (Helpan AI); brand renames; Klokd priority-1 status; programmable money elevation; cross-rail `initiated_by` claim; IAD on KYC vendor list; velocity-burst component; cross-rail fraud aggregator architecture; AI fraud pattern monitoring on Build Readiness; AML behavioural detection on vendor criteria; CBK pre-application agenda items (KP-3, KP-6, XR-4); DPA §31 counsel agenda. | All v1.0 hard items above plus all watch items |

---

## 3. Items outside artefact scope — flagged to Chamia for ops/regulatory/counsel/BD action

These scan items cannot be discharged by editing artefacts. They require human engagement outside this session's scope.

| Scan item | Stream | Specific ask |
|---|---|---|
| KP-3 — KYA regulatory expectation | Regulatory | Add agent-initiated payment authorisation as a CBK pre-application meeting agenda item |
| KP-4 — AI AML pattern obfuscation | Procurement | Add behavioural pattern detection to AML vendor evaluation criteria |
| KP-6 — Agentic payments regulation | Regulatory | Raise at CBK pre-application meeting alongside KP-3 |
| KP-8 — AI fraud detection as differentiator | Roadmap | Already named in Helpan AI Design Reference §7.2; ensure Phase 2 product roadmap captures it |
| ID-1 — IAD on KYC vendor RFQ | Procurement | Add IAD (ISO 25456 / CEN/TS 18099) to KYC vendor RFQ as a mandatory requirement |
| ID-6 — DPA + agentic AI | Counsel | Engage data protection counsel on agentic AI dimension under DPA §31 |
| TD-2 — Sender-ID spoofing monitoring | Ops | Build sender-ID spoofing detection capability (ops capability, not v1 artefact) |
| TD-3 — Anomaly detection + compromise playbook | Ops | Build anomalous recipient pattern alert; document API key compromise response playbook beyond "Platform Ops suspends tenant" |
| TD-6 — Template-only competitive differentiator | BD/Investor | Update investor one-pager and B2B materials to reference template-only posture as competitive moat |
| XR-3 — Cross-rail AI fraud aggregator | Architecture | Design Kafka topology to support post-v1 cross-rail fraud signal aggregator (Reboot Pack v1.3 candidate) |
| XR-4 — Trust-by-design CBK | Regulatory | Document trust-by-design controls explicitly in CBK pre-application materials |
| XR-5 — DPIA agentic AI dimension | Counsel/Compliance | Update ODPC DPIA scope to address agentic AI under DPA §31 (automated decision-making with significant effects) |
| XR-6 — African fintech VC | BD/Investor | Update investor materials to position KMV in QED's "auditable, controllable, regulated-environment AI" frame |

---

## 4. Execution sequencing

The amendments in §2 are executed in this order to maximise safety and traceability. Each tier is a discrete batch.

| Tier | Files | Status |
|---|---|---|
| 1 | This memo (master plan) | ✅ Done |
| 2 | Three Schema Appendix amendments (cross-cutting `initiated_by` + Identiti `actor`) | Next |
| 3 | Three Rail Contract Scaffold amendments | Following |
| 4 | App Integration Guide amendment | Following |
| 5 | Claude Code Instruction Pack amendment | Following |
| 6 | Three rail integration map updates (mine; direct rewrite) | Following |
| 7 | Three Helpan AI artefact updates (mine; direct rewrite) | Following |
| 8 | Reboot Pack v1.3 candidate items list (this memo §2.7 + handoff to Chamia) | Already documented |

---

## 5. Standing rules for the amendments

1. **Chamia's canonical docs (rail contracts, schema appendices, App Integration Guide, Claude Code Instruction Pack, Reboot Pack):** additive amendment block at the end of the file, dated, attributed to the scan, marked "Amendment §A — Agentic AI Signal Scan integration." Do not rewrite original content. Do not bump version number (Chamia's authority).
2. **Mine (rail integration maps, Helpan AI artefacts):** direct rewrite — these are session-owned. Update in place; new sections added where appropriate.
3. **Reboot Pack v1.2:** do not edit. Surface candidate items to Chamia for v1.3.
4. **Out-of-scope items (ops/regulatory/counsel/BD):** documented in §3 above; surfaced to Chamia for action through the appropriate stream.
5. **Naming:** scan amendments use the convention "Amendment §A" so a future scan would be "Amendment §B" without renumbering.

---

## 6. Closing note

The scan was Chamia's pre-Helpan-AI thinking. Several of its recommendations (agent delegation, agent identity framework, the "subject vs actor" distinction) have been promoted from "v1.1 roadmap" to "build the rail now" by the Helpan AI corpus. Other recommendations (`initiated_by` claim, IAD on KYC vendor RFQ, anti-phishing/anti-vishing copy, velocity-burst envelope) are independent of that decision and apply directly to the existing three-rail corpus.

This memo treats the scan as binding. The amendments in §2 are the operational expression of that binding.

— Helpan AI Rail Design Session

---

*Helpan AI Rail · Scan Integration Memo v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential · Authority: Agentic AI Signal Scan (Chamia, 4 May 2026)*
