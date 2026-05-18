# Helpan AI Rail — Reading Orders by Role v1.0

**Document type:** Role-specific reading paths through the Helpan AI design corpus.
**Date:** 7 May 2026
**Authority:** Instruction Pack v1.0 §17; DoD/MVP v1.0; standing platform-corpus convention.

---

## 0. The corpus

Once an artefact is referenced in a reading order, the reader has the full path. The corpus, in version order:

| # | Document | Lines | Primary author |
|---|---|---|---|
| 1 | `helpan-ai-rail-instruction-v32.md` | ~790 | Chamia |
| 2 | `helpan-ai-dod-mvp-md.md` | ~558 | Chamia |
| 3 | `helpan-ai-rail-one-pager-v11.md` | ~147 | Chamia |
| 4 | `helpan-ai-bootstrap-v9.md` | ~83 | Chamia |
| 5 | `agentic_ai_scan.html` | ~797 | Chamia |
| 6 | `helpan-ai-confirmation-memo-v1.md` + Amendment §A | Session |
| 7 | `helpan-ai-design-reference-v1.md` + Amendment §A | Session |
| 8 | `helpan-ai-kipkiren-pay-gap-analysis-v1.md` + Amendment §A | Session |
| 9 | `helpan-ai-scan-integration-memo-v1.md` | Session |
| 10 | `helpan-ai-openapi-v1.yaml` | Session |
| 11 | `helpan-ai-delegated-authority-contract-v1.md` | Session |
| 12 | `helpan-ai-schema-erd-v1.md` | Session |
| 13 | `helpan-ai-event-bus-contract-v1.md` | Session |
| 14 | `helpan-ai-threat-model-v1.md` | Session |
| 15 | `helpan-ai-oauth-scope-catalogue-v1.md` | Session |
| 16 | `helpan-ai-per-app-integration-patterns-v1.md` | Session |
| 17 | `helpan-ai-console-specification-v1.md` | Session |
| 18 | `helpan-ai-build-readiness-checklist-v1.md` | Session |
| 19 | `helpan-ai-reading-orders-v1.md` (this document) | Session |
| 20 | `helpan-ai-reboot-pack-v1.md` | Session (forthcoming) |

Companion Platform Rails docs (consume as needed):
- `Platform_Rails_Reboot_Pack_v1_2.md`
- `Identiti_Rail_Contract_v1.0_*.md` + Amendment §A
- `Kipkiren_Pay_Rail_Contract_v1.0_*.md` + Amendment §A
- `Todoku_Rail_Contract_v1_0_*.md` + Amendment §A
- `App_Integration_Guide_v1_0.md` + Amendment §A
- `Claude_Code_Instruction_Pack_Platform_Rails_v1_0.md` + Amendment §A

---

## 1. Silvia Mumbua (CTO leading the build) — full corpus

Read in this order. Estimated ~6 hours active read.

1. Bootstrap (#4) — orient
2. Instruction Pack (#1) — full
3. DoD/MVP (#2) — full
4. One-pager (#3) — daily reference
5. Agentic AI Scan (#5) — strategic intelligence
6. Confirmation Memo (#6) — what was confirmed and what is open
7. Design Reference (#7) — the "why" document
8. Scan Integration Memo (#9) — what changed and where
9. OpenAPI spec (#10) — wire-level surface
10. Delegated authority contract (#11) — most security-critical
11. Schema and ERD (#12) — DB design
12. Event bus contract (#13) — Kafka topology
13. Threat model (#14) — STRIDE + scan threats
14. OAuth scope catalogue (#15) — scopes
15. Per-app integration patterns (#16) — Klokd, Lunch Drop, Chapaa, family-discovery
16. Console specification (#17) — UX
17. KP gap analysis (#8) — KP-side coordination
18. Build Readiness Checklist (#18) — execution roadmap
19. Reboot Pack (#20) — canonical record (when produced)

After this read: Silvia is ready to lead the build. The Output Plan is exhausted; subsequent work is implementation.

---

## 2. Helpan AI rail engineer joining the build — ~4 hours

1. Confirmation Memo §1 + §2 (Design Law and Strategic Context confirmation) (#6)
2. Design Reference (#7) — full
3. OpenAPI spec (#10) — full
4. Delegated authority contract (#11) — full, this is the most-touched code path
5. Schema and ERD (#12) — full
6. Event bus contract (#13) — full
7. OAuth scope catalogue (#15) — full
8. Per-app integration patterns (#16) — at least one app fully, others scan
9. Threat model (#14) — full
10. Build Readiness Checklist (#18) — what's gating Stage 1

Skip on first read: Console spec (#17), one-pager (#3), bootstrap (#4), Instruction Pack (#1) (Design Reference covers the substance).

---

## 3. Identiti rail engineer — ~90 minutes

The Helpan AI rail consumes Identiti most intensively. Focus:

1. Instruction Pack §1, §2, §3 (#1)
2. Design Reference §6.2, §9.1 (#7) — delegated authority + cross-rail with Identiti
3. Delegated authority contract §6 (cryptographic key custody) and §8 (Identiti-joint integration points pending H4) (#11)
4. Schema and ERD §1.4 (delegated_authorities) and §1.13 (audit_log) (#12)
5. Event bus contract §3.1, §3.2 (Identiti events Helpan AI consumes) (#13)
6. OAuth scope catalogue (#15) — to understand the scopes Identiti issues OAuth tokens against
7. Identiti Rail Contract Amendment §A (session) — the scan-driven additions to your own rail

Read your own rail's amendment first if you haven't already.

---

## 4. Kipkiren Pay rail engineer — ~2 hours

1. Instruction Pack §1, §2, §3, §9 (#1)
2. Design Reference §4.3, §4.5, §7, §8.3 (#7) — A2A bypass + Chapaa highest-stakes context
3. Delegated authority contract — full (#11)
4. **KP Gap Analysis — full + Amendment §A (#8)** — this is your direct input
5. OpenAPI spec endpoints `/authorities/{id}/validate` (most-called endpoint by KP) (#10)
6. Threat model §3.1, §3.3 (#14)
7. Per-app integration patterns §3 (Helpan Chapaa) (#16)
8. KP Rail Contract Amendment §A (session)

After this: KP engineering knows what KP needs to build to support Helpan AI v1.0.

---

## 5. Todoku rail engineer — ~60 minutes

1. Instruction Pack §1, §2, §3, §10 (#1)
2. Design Reference §9.3 (#7)
3. Schema and ERD §1.6 (actions table — Todoku updates this on `MESSAGE_DELIVERED`) (#12)
4. Event bus contract §3.5 (#13)
5. Per-app integration patterns §1, §2, §4 (Klokd, Lunch Drop, family-discovery — all use Todoku via Helpan AI) (#16)
6. Threat model §3.4, §3.5 (#14)
7. Todoku Rail Contract Amendment §A (session)

---

## 6. Consuming app team — ~90 minutes per team

Read your own app first. Then the cross-rail patterns.

1. Instruction Pack §1, §2, §3 (#1)
2. Design Reference §8.x for your app (#7)
3. Per-app integration patterns — your app's section in full + §5 cross-app patterns (#16)
4. Console specification (#17) — what your app embeds
5. OpenAPI consumer-side surface (briefings, actions) (#10)
6. Build Readiness Checklist S2/S3/S4/S4.5 — your app's specific items (#18)

---

## 7. Compliance and Legal — ~90 minutes

1. Design Reference §6.4 (regulatory containment), §6.3 (behavioural data containment) (#7)
2. Instruction Pack §3.5 (regulatory containment), §3.4 (behavioural data containment), §13.1 H14 (#1)
3. Schema and ERD §1.13 (audit_log), §3 (RLS) (#12)
4. Threat model §3.6 (DPA + agentic AI) — counsel agenda items (#14)
5. KP Gap Analysis §S.1 (Chapaa credit-unlock partner-lender) (#8)
6. Build Readiness Checklist §G (items raised to Chamia) — counsel items list (#18)

---

## 8. Security review (independent) — ~3 hours

1. Threat model — full (#14)
2. Delegated authority contract — full (#11)
3. OAuth scope catalogue — full (#15)
4. OpenAPI spec — full (#10) with focus on auth flows
5. Schema and ERD §3 (RLS), §1.13 (audit_log) (#12)
6. Event bus contract §6 (at-least-once + idempotency) (#13)
7. Reboot Pack §10 (operator authentication) — confirms FIDO2 posture
8. Identiti / KP / Todoku Rail Contract Amendments §A (session) — defence-in-depth coordinations

---

## 9. Investor / BD audience — ~30 minutes

1. Design Reference §1 (Executive summary), §13 (Strategic charter) (#7)
2. One-pager (#3)
3. Agentic AI Scan §VC / Market Signal section (#5)
4. Per-app integration patterns §1.1, §2.1, §3.1, §4.1 (strategic posture per app) (#16)

---

## 10. Operator (ops team) — ~2 hours

1. Console specification (#17) — what users see and how revocation works
2. Schema and ERD §3 (RLS — operator role), §1.13 (audit_log) (#12)
3. Event bus contract — full (operations consume Kafka) (#13)
4. Threat model §3 (scan threats — operator detects them) (#14)
5. Build Readiness Checklist §G (ops playbook items) (#18)
6. KP, Identiti, Todoku Rail Contract Amendments §A — ops items (BR-AI-1 through BR-AI-5)

---

## 11. Quick references

- "What is the rail?" → One-pager (#3)
- "Why does it exist?" → Design Reference §1, §13 (#7)
- "What does it not do?" → Instruction Pack §3 (Design Law) (#1)
- "How does an app integrate?" → Per-app integration patterns (#16) + OpenAPI (#10)
- "What's still open?" → Build Readiness Checklist (#18)
- "What changed because of the scan?" → Scan Integration Memo (#9)

---

*Helpan AI Rail · Reading Orders by Role v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential*
