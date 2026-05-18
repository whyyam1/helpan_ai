# Helpan AI Rail — Daily Reference

**For Silvia (CTO) · Build start: 5 May 2026 · Companion to Instruction Pack v1.0**

---

## What you're building

The fourth platform rail. Alongside Identity, Kipkiren Pay, Todoku. Provides the orchestration runtime, delegated authority model, and consent infrastructure that lets every Kirimon app ship an AI agent — *Helpan Lunch Drop*, *Helpan Chapaa*, *Helpan Sasa*, *Helpan Nightpulse* — without rebuilding the agent layer each time. Also the OAuth surface for third-party agents.

---

## Design law (non-negotiable)

1. **No duplication of rail functionality.** Helpan AI never reimplements payment (Kipkiren Pay), identity (Identity), or comms (Todoku). Orchestrate, don't reproduce.
2. **Delegated authority is the security primitive.** Every agent action touching money, identity, or comms carries a scoped, time-bounded, revocable token. Distinct from user step-up tokens.
3. **Behavioural data containment.** App's agent reads its own app's data by default. Cross-app needs explicit consent. Third-party agents get most restrictive scope by default.
4. **Regulatory containment.** Helpan AI does not hold funds, extend credit, aggregate yield, or net off-ledger. Kipkiren Pay remains the only CBK-licensed entity. If a design pattern seems to require breaking this, the design is wrong.
5. **The Helpan Console is mandatory for v1.** Single user-facing surface showing every active authorisation with one-tap revocation. Do not defer.
6. **Open by design, closed by consent.** Built to be consumed by third-party agents under OAuth. Closure happens at the consent layer, not the API layer.

---

## Strategic context in two sentences

McKinsey's April 2026 banking thesis: in 3–5 years, AI agents become the channel of choice for banking, with global profit pools at risk of 9% decline (27% in deposits, 34% in cards). Kirimon's response: build the agent rail and the consuming agents *before* third-party agents arrive in Kenya — be the operating system agents prefer, not the back-office they bypass.

---

## Top three integration risks

| Risk | Why it matters | Where to look |
|---|---|---|
| **Kipkiren Pay gap** | Helpan AI cannot ship ahead of Kipkiren Pay's agent-native API surface. Programmable money has been elevated from Phase 2 to v1. | Instruction §9, hard blocker H8 |
| **Delegated authority token joint with Identiti** | Single most important contract in the rail. Cannot be designed alone. | Instruction §6.4 and §8.4, hard blockers H3 and H4 |
| **A2A bypass (agents calling Daraja directly)** | Long-term existential threat to Kipkiren Pay. The defence is the abstractions on top — verification, escrow, dispute orchestration, AI scoring. | Instruction §9.5 |

---

## Hard blockers — close before deep build

H1 Rail name · H2 OpenAPI spec · H3 Delegated authority contract · H4 Step-up token joint with Identity · H5 Schema/ERD · H6 RLS · H7 Audit log · **H8 Kipkiren Pay gap analysis** · H9 OAuth scope catalogue · H10 Threat model · H11 Helpan Console design · H12 Per-app safety policy schema · H13 Event bus contract · H14 Legal sign-off on regulatory containment · H15 Behavioural data containment per-app rules.

Full detail in Instruction §13.1.

---

## Output Plan order (do not deviate)

1. Confirmation memo (design law + strategic context understood)
2. Helpan AI Design Reference (~30 pages, the "why")
3. OpenAPI 3.x spec
4. **Delegated authority token contract** ← gate for almost everything else
5. Schema and ERD
6. Event bus contract
7. Threat model
8. **Kipkiren Pay gap analysis** ← gates Kipkiren Pay backlog conversation
9. Per-app integration: new family-discovery app
10. Per-app integration: Helpan Chapaa
11. Per-app integration: Helpan Lunch Drop
12. OAuth scope catalogue v1
13. Helpan Console specification
14. Build Readiness Checklist (populated)
15. Reading orders by role
16. Reboot Pack v1.0

---

## What each platform rail does for you

| Rail | What Helpan AI calls it for |
|---|---|
| **Identiti** | User auth, JWT validation, OAuth issuance for third-party agents (you define scopes, Identiti issues), step-up tokens, consent records, KYC posture |
| **Kipkiren Pay** | All money movement. Payment, verification primitive, hold/release, escrow, refund, dispute, statements, programmable money. Every agent-initiated call presents a delegated authority token. |
| **Todoku** | All notification delivery. Agent generates message body; Todoku decides delivery, channel, timing, frequency caps, quiet hours. |

What you do *not* build: payment processing, KYC, credential storage, OTP delivery, push integration, SMS aggregator, email infrastructure, in-app inbox.

---

## What you do build

Agent runtime · Briefing storage · Matching engine · Intent management · Delegated authority issuance/validation/revocation · The Helpan Console · Third-party OAuth scope catalogue · Cross-app data access policy enforcement · Audit log · Agent-to-rail call dispatch · Agent observability · Per-app safety primitives.

---

## Per-app priority order for v1

1. **The new family-discovery app** (working name TBD) — first consumer, agent-native by design
2. **Helpan Chapaa** — highest-stakes savings agent; MMF rebalancing default = suggest-only at launch
3. **Helpan Lunch Drop** — augments ZoneFeed, does not replace it
4. Helpan SabakiFresh, Helpan Kipkiren consumer, Helpan Nightpulse — deferrable to post-v1

---

## Open decisions awaiting Chamia

1. Rail name confirmation (Helpan AI working)
2. Family-discovery app name (Sasa, Hapa, or other)
3. Stack confirmation (default: Supabase af-south-1 + Railway)
4. Default LLM provider for agent runtime
5. Third-party agent pricing model
6. Helpan Chapaa MMF rebalancing autonomy graduation path
7. Identiti step-up token format alignment
8. Which Kipkiren Pay gaps are MVP blockers vs v1.0 blockers
9. Helpan Console: shared library v1 or standalone surface

---

## Working rules

- Confirm before proceeding on any significant change.
- Code as downloadable files, never chat blocks.
- No hardcoded values — design tokens only.
- Reboot packs as `.md` and `.pdf`.
- M-Pesa Native firm-wide.
- Apps don't bypass Todoku.
- When in doubt about scope between Helpan AI and a platform rail → default to the platform rail.
- When in doubt about scope between Helpan AI and a consuming app → orchestration in rail, experience in app.

---

## Where to ask for help

- **Design law / strategic direction** → Chamia
- **Identiti contract** → joint design with Identiti engineering lead
- **Kipkiren Pay gap** → joint design with Kipkiren Pay engineering lead
- **Todoku integration** → Todoku engineering lead
- **Compliance and regulatory containment** → Legal + Compliance
- **Per-app integration patterns** → respective app product owners
- **The new family-discovery app brand** → Chamia (pending naming decision)

---

## Bootstrap line for the new design session

> *"You are starting a new session to design the Helpan AI rail — the fourth platform rail in the Kirimon Market Ventures stack. Read the Helpan AI Rail Design Instruction Pack v1.0 in full. Confirm understanding of design law (§3) and strategic context (§4). Then proceed with the Output Plan (§15) in the order specified. Confirm before proceeding on any significant change. Silvia Mumbua is starting the rail build today."*

---

## The single most important sentence

The agent is the new front door. The rail is the foundation the door is hung on. Build agent-native, consent-first, regulatory-contained — and ship before third-party agents arrive.

---

*Helpan AI Rail · Daily Reference · 5 May 2026 · Kirimon Market Ventures · Confidential · Companion to Instruction Pack v1.0*
