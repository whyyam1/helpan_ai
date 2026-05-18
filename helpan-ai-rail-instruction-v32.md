# Helpan AI Rail — Design Instruction Pack v1.0

**For:** Silvia Mumbua, Chief Technology Officer, Kirimon Market Ventures
**Owner:** Chamia Mutuku, CEO and Chief Product Officer
**Date:** 5 May 2026
**Status:** Authoritative design instruction. Read in full before architecture decisions are made.
**Format:** Source of truth for the new session that will produce the Helpan AI rail design corpus.

---

## 0. How to use this document

This is the brief for a new dedicated session that will produce the full Helpan AI rail design corpus — specs, contracts, schemas, integration patterns, and build-readiness checklist. It is not the design itself. It is the instruction that constrains the design.

The new session must:

1. Read this document in full before producing any design artefact.
2. Treat every rule in §3 (Design Law) and §4 (Strategic Context) as non-negotiable unless explicitly reopened by Chamia.
3. Produce design artefacts in the order set out in §15 (Output Plan).
4. Confirm understanding of design law and strategic context before proceeding to design.

The new session should be opened with the instruction: *"Read the Helpan AI Rail Design Instruction Pack v1.0 in full, confirm understanding of design law and strategic context, then proceed with the Output Plan in the order specified."*

---

## 1. Mission

Helpan AI is the **Agent Rail** — the fourth platform rail in the Kirimon Market Ventures stack, alongside Identiti, Kipkiren Pay, and Todoku.

Helpan AI provides the orchestration runtime, delegated authority model, and consent infrastructure that allow consuming apps to ship AI agents without each app rebuilding the agent layer from scratch. Each consuming app ships its own branded agent — *Helpan Lunch Drop*, *Helpan Chapaa*, *Helpan Sasa* (or whatever the new family-discovery app is named), *Helpan Nightpulse*, and so on — but every agent runs on the same rail, with the same security model, the same consent surface, and the same integration patterns into Identiti, Kipkiren Pay, and Todoku.

Helpan AI is also the surface through which **third-party agents** (a user's general-purpose AI assistant, a household management app, an external aggregator) interact with the Kirimon portfolio. Third-party agent access is gated by OAuth scopes that Helpan AI defines and Identiti enforces.

The mission is twofold:

1. Enable every Kirimon consumer app to ship an agent capability without duplicating infrastructure.
2. Position the Kirimon platform as **the agent operating system for East African consumer finance and commerce** before global agents arrive and disintermediate.

---

## 2. Naming convention

The Helpan family of agents is named per consuming app:

| App | Agent name |
|---|---|
| The new family-discovery app | Helpan [App Name] |
| Lunch Drop | Helpan Lunch Drop |
| Chapaa | Helpan Chapaa |
| SabakiFresh | Helpan SabakiFresh |
| Kipkiren Pay (consumer) | Helpan Kipkiren |
| Nightpulse | Helpan Nightpulse |
| Future apps | Helpan [App Name] |

The rail itself is **Helpan AI**. Generic references to "the agent layer" or "the Agent rail" are acceptable in technical documentation but the brand surface is always Helpan.

The new session may propose a Swahili-rooted alternative for the rail name if it makes a strong case, but Helpan is the working name and should be assumed locked unless explicitly reopened.

---

## 3. Design Law

These are non-negotiable unless explicitly reopened.

### 3.1 No duplication of platform rail functionality

Helpan AI never reimplements payment, identity, or comms. Every capability that belongs to Kipkiren Pay, Identiti, or Todoku is invoked via the relevant rail's API. If a capability sounds like it might belong to a rail, it does — Helpan AI's job is to orchestrate, not to reproduce.

Specifically:
- **No payment processing inside Helpan AI.** All money movement goes through Kipkiren Pay.
- **No identity, KYC, or credential storage inside Helpan AI.** All user authentication and authorisation goes through Identiti.
- **No direct comms delivery inside Helpan AI.** All notifications, SMS, email, and in-app inbox messages go through Todoku.

### 3.2 Rail consumer pattern for consuming apps

Consuming apps interact with Helpan AI exactly the way they interact with the other three rails — via SDK, with thin local references to rail-side authoritative records. The consuming app does not build its own agent runtime, briefing storage, matching engine, intent management, or third-party agent OAuth scopes. Those are rail-side.

What the consuming app owns:
- The agent's experience (UX, voice, persona)
- The agent's policies (what it will and won't do, category rules, content moderation)
- The app-specific data the agent operates on (e.g., kaLunch order history, Chapaa savings behaviour)
- The notification routing decisions briefed to Todoku

### 3.3 Delegated authority is a first-class primitive

Every agent action that touches money, identity, or comms must carry a **delegated authority token** — a scoped, time-bounded, revocable permission the user has granted to a specific agent. This is distinct from a user-initiated step-up token (which is tied to the user's live session).

The delegated authority model is the design's most important security primitive. It is what makes agent actions auditable, regulator-friendly, and revocable. It is also the foundation of the consent surface in §3.7.

### 3.4 Behavioural data containment

By default, an app's agent reads only its own app's data. Helpan kaLunch reads kaLunch order history. Helpan Chapaa reads Chapaa savings behaviour. Cross-app reads require explicit user consent and explicit OAuth scope. Third-party agents get the most restrictive scope by default and must request elevation per data category.

This rule protects three things: user privacy, the behavioural data asset that makes each app defensible, and Kenya's Data Protection Act 2019 compliance posture.

### 3.5 Regulatory containment

Kipkiren Pay is the only entity in the portfolio that requires CBK regulatory approval. Helpan AI must not breach this. The rail does not hold funds, does not extend credit, does not aggregate yield, does not net off-ledger, and does not run any float. Every money movement initiated by an agent is a Kipkiren Pay call. Every yield reallocation initiated by Helpan Chapaa is a Kipkiren Pay call into a CBK-licensed partner MMF.

If the new session finds a design pattern that appears to require Helpan AI to hold funds or extend credit, that is a signal the design is wrong, not a signal that the rule should be relaxed.

### 3.6 Family-friendly safety as a platform-level concern

The new family-discovery app is the first consuming app where family-friendly safety is a hard product requirement. Helpan AI must support category whitelists, content moderation hooks, and per-app safety policies as platform primitives — not as something each app re-invents.

### 3.7 The Helpan Console as the consent surface

Helpan AI ships with a single user-facing surface — the **Helpan Console** — that lets a user see, at any time, what every agent (their own portfolio agents and any connected third-party agents) is currently authorised to do, on what data, until when, with one-tap revocation.

This is a regulator-friendly surface, a user-trust surface, and a marketing asset. It is mandatory for v1 of the rail. It must not be deferred.

### 3.8 Agent-native API surface for Kipkiren Pay

Every Kipkiren Pay capability that today is exposed for human-mediated app interaction must also be exposed as a clean, versioned, machine-readable API suitable for agent consumption. This includes payment, the verification primitive, hold/release, escrow, refund, dispute, statement, and (newly elevated) programmable money / scheduled transfers.

The new session must produce a gap analysis between current Kipkiren Pay surface and what Helpan AI requires.

### 3.9 Open by design, closed by consent

Helpan AI is built to be consumed by third-party agents under OAuth, not just by Kirimon portfolio apps. The rail's long-term defensibility comes from being the operating system agents prefer — not from locking agents out. Closure happens at the consent layer (the user must approve), not at the API layer.

### 3.10 Working rules from existing platform conventions

These are inherited from the platform programme and apply to Helpan AI without modification:

- All Kirimon portfolio apps are M-Pesa Native (firm-wide commitment).
- Apps don't bypass Todoku for user-facing comms.
- All code delivered as downloadable files, never as chat code blocks.
- No hardcoded values in components (all via design system tokens).
- Confirm before proceeding on any significant change.
- Reboot packs delivered as both `.md` and `.pdf`.

---

## 4. Strategic Context

This section names the intellectual backdrop for the design choices in this instruction. It is included so future sessions, future engineers, and Silvia herself understand *why* the rail is designed this way when the original reasoning fades.

### 4.1 The McKinsey "Shopping in the age of AI" report (April 2026)

McKinsey's retail report identifies three structural forces reshaping consumer behaviour: rising use of AI in purchase decisions, growing expectations for transparency and convenience, and shifting spending power toward younger generations. The report's strongest signal is that consumers are starting to use agentic tools for basket building, automated replenishment, and post-purchase support, particularly for routine essentials. The report also flags that retailers need clean catalog feeds, accurate local availability data, and live pricing updates to boost their credibility when a shopper, or their AI agent, compares alternatives.

**Implication for Helpan AI:** The new family-discovery app is being built to be agent-native from day one. Helpan AI is the rail that makes this possible without each app rebuilding the agent layer.

### 4.2 The McKinsey "How gen AI agents threaten retail banks' customer relationships" report (April 2026)

McKinsey's banking report argues that in three to five years, an AI agent could become the channel of choice for all banking interactions, acting as the primary interface between customers and their financial institutions — meaning incumbent retail banks could lose their preeminence in customer relationships. The supporting analysis estimates that if banks fail to respond, their global profit pools could shrink by an average of 9 percent, with credit card lending and consumer deposits the most vulnerable at potential drops of 34 percent and 27 percent respectively. The mechanism is the removal of consumer inertia: agents move money to higher-yield accounts in seconds.

The companion piece adds an explicit instruction for wallet providers and superapps: position themselves as the operating system for agents — publish developer toolkits, bake in transparent consent and override controls, and secure the user's intent.

**Implication for Helpan AI:** This is the strategic charter. Kipkiren Pay and Chapaa are being built in an agentic era, ground-up. The threat to incumbent banks is the opportunity for Kirimon. The rail must be agent-native, the consent surface must be transparent and revocable, and the consuming apps must each ship their own agent before third-party agents arrive and disintermediate.

### 4.3 Specific implications for Kipkiren Pay

- Agent-readable API surface as a first-class requirement (§3.8).
- Consent and override as platform primitives via the delegated authority token (§3.3) and the Helpan Console (§3.7).
- Programmable money and scheduled transfers move from Phase 2 deferrable to v1 priority.
- The rail's defensibility against agents bypassing it to call Daraja directly comes from the abstractions on top of the underlying rail — verification, escrow, hold/release, dispute orchestration, AI-mediated risk scoring, AI-mediated dispute assistance.
- The rail's emerging AI capabilities (real-time risk scoring, reconciliation as classification, counterfactual transaction explainer, AI-mediated dispute resolution) reframe from efficiency plays to defensibility moats.

### 4.4 Specific implications for Chapaa

- Chapaa must ship its own savings agent — Helpan Chapaa — before third-party agents absorb the relationship.
- Chapaa's defensibility is not the interest rate. An agent will always find a higher one. Defensibility is in the commitment mechanics: locked savings, goal-based pots, streaks, Chama group savings, and the behavioural data that builds creditworthiness.
- Helpan Chapaa must support agent-initiated yield rebalancing across CMA-licensed partner MMFs within user-set risk limits.
- Behavioural data containment (§3.4) is critical for Chapaa — the savings behaviour data is the credit signal and must not leak to third-party agents without explicit consent.
- The credit unlock moment (Chapaa's "save first, borrow later" mechanic) is exactly the kind of experiential benefit a third-party agent cannot replicate — it must be celebrated and protected as a Helpan Chapaa-only experience.

### 4.5 The disintermediation threat

In Kenya, M-Pesa via Daraja is the underlying A2A rail. As agents become more capable, they will try to call Daraja directly and bypass Kipkiren Pay. Kipkiren Pay's defence is to be more useful than raw Daraja — to expose abstractions Daraja does not. The same logic applies to Chapaa versus a generic MMF distributor.

The Helpan AI rail is the mechanism by which the entire portfolio defends against bypass. Each consuming app becomes more useful with its agent than without. Each agent becomes more useful with the rail than without. The rail becomes more useful than the agents around it.

---

## 5. Capabilities the rail owns vs. consuming apps own

### 5.1 Owned by Helpan AI (rail-side)

- Agent runtime: the execution environment for agent reasoning, tool calls, and orchestration.
- Briefing storage: the persistent store of user-issued briefings to their agent (e.g., "alert me when fresh fish drops within 2km of my home before 6pm").
- Matching engine: the logic that determines whether an event (a broadcast, a price change, a balance threshold) matches a user briefing.
- Intent management: the structured representation of user goals across sessions and apps.
- Delegated authority token issuance, validation, and revocation.
- The Helpan Console (consent surface).
- Third-party agent OAuth scope definition (Identity enforces; Helpan AI defines).
- Cross-app data access policy enforcement.
- Audit log of every agent action (what was done, by which agent, under which delegated authority, on whose behalf).
- Agent-to-rail call dispatch (the bridge between an agent's intent and the appropriate Kipkiren Pay / Identity / Todoku call).
- Agent observability: usage, success/failure rates, latency, cost per app.
- Safety primitives: category whitelists, content moderation hooks, per-app safety policies.

### 5.2 Owned by the consuming app

- Agent persona: name, voice, tone, brand expression.
- Agent policies: what it will and won't do, what data it operates on, what categories are allowed.
- App-specific data: the substrate the agent reasons over.
- Briefing UX: how the user issues briefings to the agent inside the app.
- The agent's app-specific UI surfaces: cards, prompts, suggestions inline in the app.
- App-specific safety policy: family-friendly content rules for the new family-discovery app, content moderation rules for Nightpulse, etc.
- The decision to act on a Helpan AI suggestion (the consuming app can override or filter rail suggestions before showing them to the user).

### 5.3 Owned by Identiti

User authentication, KYC, profile, consent management, session management, device registration, recovery, account merge, step-up authentication, the privacy centre, OAuth issuance for third-party agents, passkeys when they ship.

### 5.4 Owned by Kipkiren Pay

Payment processing, the verification primitive, hold/release/escrow, settlement, merchant payouts, refunds, disputes, the trust pool, reconciliation, AI risk scoring, AI dispute assistance, programmable money, scheduled transfers.

### 5.5 Owned by Todoku

All user-facing comms — push, SMS, email, in-app inbox, WhatsApp where applicable. Notification preferences, quiet hours, comms preference centre, holdout groups, channel selection, rate limiting.

---

## 6. Contract and API surface

The new session will produce the full OpenAPI 3.x specification. This section sets the shape of what that spec must cover.

### 6.1 Helpan AI rail-side endpoints (consumed by apps and third-party agents)

**Briefing management**
- `POST /briefings` — create a briefing for the authenticated user
- `GET /briefings` — list briefings for the authenticated user (filtered by app)
- `PATCH /briefings/{id}` — update a briefing
- `DELETE /briefings/{id}` — revoke a briefing

**Delegated authority**
- `POST /authorities` — issue a delegated authority token (user-initiated, in-app)
- `GET /authorities` — list active delegated authorities (powers the Helpan Console)
- `POST /authorities/{id}/revoke` — revoke a delegated authority
- `POST /authorities/{id}/validate` — internal endpoint for Kipkiren Pay / Todoku to validate a token presented by an agent

**Agent action dispatch**
- `POST /actions/dispatch` — agent submits a structured intent; rail validates authority, calls the appropriate platform rail, returns result
- `GET /actions/{id}` — retrieve action status and result
- `GET /actions` — list actions for the authenticated user (powers the Helpan Console activity log)

**Matching engine**
- `POST /events/ingest` — consuming apps publish events that may match briefings (e.g., kaLunch publishes "PowerMama X is offering today's special")
- Internal: matching engine evaluates events against briefings and emits `BriefingMatched` events on the platform event bus

**Third-party agent OAuth**
- `POST /oauth/scopes` — define available scopes (admin only)
- `GET /oauth/scopes` — list scopes (used by third-party agent registration flows)
- OAuth issuance itself is Identity's responsibility; Helpan AI defines the scope catalogue.

### 6.2 Consumer-side SDK surface (used by consuming apps)

- `Helpan.briefings.create(...)` — inline briefing creation from app UX
- `Helpan.briefings.list(...)` — for the app to render the user's active briefings
- `Helpan.agent.suggest(...)` — agent produces a suggestion to render in-app
- `Helpan.agent.act(...)` — user confirms an agent suggestion; SDK dispatches the action
- `Helpan.console.open()` — open the Helpan Console (a shared cross-app surface)
- `Helpan.events.publish(...)` — publish an event for the matching engine
- `Helpan.audit.log(...)` — write to the audit trail

The new session must produce the full SDK surface for at least the React Native client. Server-side SDKs (Node, PHP, Python) are Phase 2.

### 6.3 Rail-to-rail contracts

**Helpan AI ↔ Identiti**
- Helpan AI calls Identiti to validate user JWTs presented by clients.
- Helpan AI calls Identiti to issue OAuth tokens to third-party agents (Identiti is the issuer; Helpan AI is the relying party that defines scopes).
- Helpan AI subscribes to Identiti events: `UserDeleted`, `AccountMerged`, `ConsentRevoked`. On any of these, Helpan AI revokes all delegated authorities for the affected user.

**Helpan AI ↔ Kipkiren Pay**
- Helpan AI calls Kipkiren Pay's payment, hold/release, escrow, refund, dispute, statement, and programmable-money endpoints on agent action dispatch.
- Helpan AI presents a delegated authority token in the `X-Delegated-Authority` header on every agent-initiated call.
- Kipkiren Pay calls Helpan AI's `POST /authorities/{id}/validate` to confirm the token is valid, scoped to the requested operation, and not revoked.
- Helpan AI subscribes to Kipkiren Pay events: `PaymentSettled`, `EscrowReleased`, `DisputeOpened`. These feed the matching engine.

**Helpan AI ↔ Todoku**
- Helpan AI calls Todoku to deliver agent-generated notifications.
- Helpan AI emits structured notification requests (message, urgency, channel hint, context); Todoku decides delivery.
- The agent does not bypass Todoku. Quiet hours, frequency caps, and channel selection are Todoku's domain.

### 6.4 The delegated authority token contract

This is the most important contract in the rail. The new session must produce the full specification, but the shape is:

- Token format: signed JWT (RS256), issued by Identiti on behalf of Helpan AI.
- Claims: subject (user ID), agent ID, scope (structured permissions — what the agent can do, on what data, up to what limit), issued-at, expires-at, revocation key.
- Lifetime: explicit per scope. Default short (24 hours for most scopes). Money-touching scopes default shorter (1 hour, or single-use).
- Validation: every relying party (Kipkiren Pay, Todoku) validates the token against Helpan AI's revocation endpoint per call.
- Revocation: immediate. Revocation propagates via the platform event bus. Kipkiren Pay must reject any call with a revoked token even if the token is otherwise valid.

---

## 7. Schema and data model

The new session must produce the full ERD. This section sets the shape.

### 7.1 Core tables (Helpan AI rail-side)

- `agents` — registered agents (one per consuming app, plus any third-party agents)
- `briefings` — user briefings (subject, app, structured intent, status, created, expires)
- `delegated_authorities` — issued delegated authority tokens (subject, agent, scope, issued, expires, revoked)
- `actions` — every agent action attempted (subject, agent, authority, target rail, target operation, status, result, audit data)
- `events_ingested` — events published by consuming apps for matching
- `briefing_matches` — events that matched briefings
- `oauth_scopes` — the catalogue of scopes available for third-party agents
- `safety_policies` — per-app safety policies (category whitelists, content moderation rules)

### 7.2 Foreign references (thin, to authoritative records)

- `user_id` → Identiti (authoritative)
- `payment_intent_id` → Kipkiren Pay (authoritative)
- `notification_id` → Todoku (authoritative)
- `merchant_id` → consuming app's merchant table (authoritative within that app)

The rail does not duplicate user records, payment records, or notification records. It holds references and metadata only.

### 7.3 Audit log

Every agent action writes an immutable audit record. Required fields: timestamp, user, agent, authority, action type, target rail, target operation, request payload (redacted), response (redacted), result status. Retention: minimum 7 years for money-touching actions, minimum 2 years for non-money actions, aligned to Kenya's Data Protection Act 2019 and Kipkiren Pay's regulatory retention.

### 7.4 RLS and access control

Row-level security is mandatory on every table that holds user data. Default: a user can read only their own records; a consuming app's service role can read records for its own app only; the platform service role can read all (with audit). Cross-app reads require an explicit RLS policy that checks for an active cross-app consent record.

---

## 8. Integration with Identiti rail

### 8.1 What Helpan AI relies on Identiti for

- User authentication and JWT issuance.
- OAuth issuance for third-party agents (Identiti is the OAuth server; Helpan AI defines scopes).
- User consent records (Helpan AI checks Identiti's consent table before granting cross-app data access).
- Session management (Helpan AI does not manage sessions; it relies on Identiti-issued JWTs).
- Step-up token validation (when a user issues a high-stakes delegated authority, Helpan AI requires a step-up token from Identiti in the same call).

### 8.2 What Helpan AI does not do

- Does not authenticate users directly.
- Does not issue OAuth tokens.
- Does not store credentials, biometrics, or KYC documents.
- Does not manage devices or sessions.

### 8.3 Subscriptions

Helpan AI subscribes to: `UserDeleted`, `AccountMerged`, `ConsentRevoked`, `KYCDowngraded`. On any of these, Helpan AI takes appropriate action — typically, revoke all delegated authorities for the user.

### 8.4 Open question for the new session

Step-up token contract joint design with Identiti. Helpan AI's delegated authority issuance for high-stakes agent actions must require a step-up token. The exact format and lifecycle is a joint design between Helpan AI and Identiti. The new session must produce the joint contract and confirm with the Identiti rail engineers before build.

---

## 9. Integration with Kipkiren Pay rail

This is the highest-stakes integration. McKinsey's banking thesis lands here.

### 9.1 What Helpan AI requires from Kipkiren Pay

**Existing capabilities to be exposed agent-natively:**
- Payment (STK push, card)
- Verification primitive (`verify_recent_payment`)
- Hold / release / escrow
- Refund
- Dispute initiation
- Statement and balance queries
- Settlement and payout (for merchant-side agents)

**Newly elevated capabilities (move from Phase 2 deferrable to v1):**
- Programmable money / scheduled transfers as a public API.
- Conditional release patterns (release on event X, refund on event Y).
- Multi-stage escrow patterns (relevant for the new family-discovery app's standing-basket auto-replenishment).

**Existing AI capabilities reframed as defensibility moats:**
- Real-time risk scoring on every agent-initiated transaction.
- AI-mediated dispute resolution support exposed to the consuming app.
- Counterfactual transaction explainer ("why was this declined?") exposed to the agent so it can explain to the user.
- Reconciliation classification (rail-internal but visible to ops).

### 9.2 The delegated authority requirement

Every agent-initiated call into Kipkiren Pay must present a delegated authority token. Kipkiren Pay validates the token against Helpan AI's revocation endpoint, checks the scope covers the requested operation, checks the amount is within scope limits, and only then executes. A revoked token is rejected immediately, regardless of other validation.

### 9.3 The regulatory containment principle, restated

Helpan AI does not hold funds. Helpan AI does not extend credit. Helpan AI does not aggregate yield. Helpan AI does not net off-ledger. Every yield rebalancing initiated by Helpan Chapaa is a Kipkiren Pay call into a CBK-licensed partner MMF. Every standing-basket auto-replenishment initiated by Helpan Sasa is a Kipkiren Pay call.

Kipkiren Pay remains the only entity in the portfolio that requires CBK regulatory approval. The new session must confirm this with legal before build.

### 9.4 Gap analysis

The new session must produce a gap analysis between the current Kipkiren Pay platform handoff (v3.0) and the agent-native API surface Helpan AI requires. Specifically:

- Which existing endpoints already work as agent-native and need only contract documentation?
- Which existing endpoints need refactoring to become agent-native?
- Which capabilities are entirely new and need to be added to the Kipkiren Pay backlog?

This gap analysis is a hard blocker for Silvia's build — Helpan AI cannot be built ahead of the Kipkiren Pay capabilities it depends on.

### 9.5 The A2A bypass defence

Agents will eventually try to call Daraja directly and bypass Kipkiren Pay. The defence is to make Kipkiren Pay strictly more useful than raw Daraja for agent consumption. Specifically:
- The verification primitive (Daraja does not expose this).
- Escrow and hold/release (Daraja does not expose this).
- Dispute orchestration (Daraja does not expose this).
- AI-mediated risk scoring (Daraja does not expose this).
- Counterfactual explainer (Daraja does not expose this).
- Programmable money primitives (Daraja does not expose this in a useful form).

The new session must produce a one-pager on the A2A bypass defence as part of the strategic context for the build team.

---

## 10. Integration with Todoku rail

### 10.1 What Helpan AI relies on Todoku for

All notification delivery. The agent layer never delivers a notification directly. When the matching engine fires a `BriefingMatched` event, Helpan AI emits a structured notification request to Todoku — message, urgency, channel hint, context, agent identifier — and Todoku decides delivery based on user preferences, quiet hours, frequency caps, and channel availability.

### 10.2 The agent voice

Each Helpan agent has a brand voice owned by the consuming app. Helpan AI does not own or override that voice. The agent generates the message body; Todoku handles delivery. Tone consistency is the consuming app's responsibility.

### 10.3 Frequency caps and quiet hours

Todoku's frequency caps and quiet hours apply to agent-generated notifications by default. An agent cannot override quiet hours unless the user has explicitly granted an "urgent override" scope in the delegated authority — and even then, Todoku validates the override against its own policy.

### 10.4 The agent inbox

Agents may want a persistent in-app surface for non-urgent messages (suggestions, summaries, weekly digests). This is Todoku's in-app inbox component. Helpan AI does not build an inbox.

---

## 11. Integration with consuming portfolio apps

### 11.1 The new family-discovery app (working name TBD — Sasa, Hapa, or similar)

**Helpan agent name:** Helpan [App Name]

**Primary capabilities:**
- Briefing-based real-time discovery ("alert me when fresh fish drops within 2km of my home before 6pm")
- Standing-basket auto-replenishment (briefings tied to Kipkiren Pay programmable money)
- Merchant-side AI clienteling (small vendors get AI assistance to draft broadcasts, suggest timing, surface regulars)
- Family-friendly safety enforcement at the agent layer

**App-specific safety policy:**
- Category whitelist enforced on briefings (no nightlife, no alcohol-led venues, no adult content)
- Content moderation on agent-generated suggestions
- No location precision below merchant level
- No user-to-user agent communication

**Integration points:**
- Briefings → Helpan AI rail
- Notifications → Todoku
- Standing-basket payments → Kipkiren Pay (programmable money)
- Merchant verification → Kipkiren Pay (verification primitive)
- Merchant identity → Identiti (KYC)

### 11.2 Lunch Drop — Helpan Lunch Drop

**Primary capabilities:**
- ZoneFeed personalisation augmentation (the agent can suggest "your usual Mama is offering your favourite today — order now?")
- Weekly lunch plan briefings ("order from PowerMama X every Tuesday")
- Corporate account orchestration (an HR admin's agent orders for a team)
- Reliability nudges ("your usual Mama hasn't been active for 3 days — try Mama Y?")

**Integration points:**
- ZoneFeed events published to Helpan AI for matching
- Weekly plan payments via Kipkiren Pay escrow
- Notifications via Todoku

**Existing convention:** The ZoneFeed algorithm is locked. Helpan Lunch Drop augments ZoneFeed; it does not replace it.

### 11.3 Chapaa — Helpan Chapaa

**This is the highest-stakes consuming app for Helpan AI.** Refer to §4.4 for strategic context.

**Primary capabilities:**
- Goal acceleration nudges ("you can hit your school fees goal 3 weeks earlier if you redirect KES 200/week from spend to Chapaa")
- Round-up acceleration ("you spent KES 4,847 this week — round up to KES 5,000 and add KES 153 to your jar?")
- MMF rebalancing within user-set limits ("the MMF rate moved up — your locked balance is now earning X")
- Chama support ("your Chama is short KES 5,000 this month — top up?")
- Credit unlock orchestration ("you've saved consistently for 60 days — you've unlocked KES 3,000 in micro-credit")
- Behavioural insights to the user ("you save more on Mondays than Fridays — want to schedule a Monday auto-save?")

**Integration points:**
- Savings ledger reads from Chapaa's own data model
- All money movement (deposit, withdrawal, lock, release, MMF allocation) via Kipkiren Pay
- Credit disbursement via Kipkiren Pay (Chapaa is not a credit-issuing entity; the credit product is structured per Chapaa's MVP design)
- Notifications via Todoku

**Critical containment rule:** Helpan Chapaa's behavioural data — the savings consistency, withdrawal patterns, goal completions — is the credit signal that makes Chapaa defensible. This data must not leak to third-party agents under default scope. A user can grant a third-party agent read access to *aggregate* savings position (current balance, current goal progress) but not to behavioural detail.

**MMF rebalancing — explicit limits:**
- The user must set risk limits before Helpan Chapaa can rebalance autonomously.
- Default behaviour is *suggest, do not act*.
- Autonomous rebalancing requires a delegated authority with a specific `chapaa.mmf.rebalance` scope and a maximum amount per period.
- Every rebalance is logged in the audit trail and visible in the Helpan Console.
- Rebalances only between CMA-licensed partner MMFs explicitly enrolled by Kipkiren Pay.

### 11.4 SabakiFresh — Helpan SabakiFresh

**Primary capabilities:**
- Buyer side: produce availability briefings ("alert me when my preferred farm has tomatoes available")
- Buyer side: standing-basket auto-replenishment for institutional offtakers
- Farmer side: demand signal surfacing ("buyers near you are looking for sukuma — your stock is ready")
- Farmer side: pricing intelligence (anonymised price discovery)

**Integration points:**
- Two-sided agent design — buyer agent and farmer agent are distinct surfaces with different scopes
- Payments via Kipkiren Pay
- Notifications via Todoku

**Convention reminder:** The two-sided nature of SabakiFresh means buyer-facing convenience UX and farmer-facing data density UX must remain separate. Helpan AI must support distinct agent personas per side.

### 11.5 Kipkiren Pay (consumer) — Helpan Kipkiren

**Primary capabilities:**
- Spend insights ("you spent more on transport this month — want to set a transport budget?")
- Loyalty optimisation ("you're 200 points away from Gold tier — here's how to close the gap")
- Round-up suggestions
- Broadcast suggestions (where the original Kipkiren Pay discovery still survives in the consumer app)
- Card and rail rotation (per McKinsey's companion piece — the agent picks the best rail per transaction within user-set rules)

**Integration points:**
- All native to Kipkiren Pay
- Notifications via Todoku

### 11.6 Nightpulse — Helpan Nightpulse

**Primary capabilities:**
- Vibe Score augmentation (the agent surfaces venues matching the user's vibe preferences)
- Real-time crowd alerts ("your favourite venue is buzzing right now")
- Group coordination ("your friends are at venue X — join them?")
- Venue-side: traffic prediction and broadcast timing for venue owners

**App-specific safety policy:**
- Adult-audience confirmed at sign-up
- No family-friendly category enforcement
- Brand voice: edgy, kinetic, Nairobi-coded
- Strictly separated from the family-discovery app at the brand and audience layer; shared only at the rail layer

### 11.7 Future apps

Sherehe and others not yet active will consume Helpan AI on the same pattern. The new session does not need to design for these explicitly but the rail must not preclude them.

---

## 12. Integration with non-portfolio (third-party) apps

### 12.1 The OAuth scope catalogue

Third-party agents (a user's general-purpose AI assistant, a household management app, an external aggregator) access Kirimon platform data via Helpan AI under OAuth. Identiti is the OAuth issuer; Helpan AI defines the scope catalogue.

Default scopes (illustrative — the new session produces the canonical list):

- `helpan.read.profile` — basic user profile
- `helpan.read.briefings` — read user's active briefings
- `helpan.write.briefings` — create briefings on user's behalf
- `helpan.read.actions` — read user's agent action history (audit log)
- `kipkiren.read.balance` — read aggregate balance (no transaction detail)
- `kipkiren.read.transactions` — read transaction history
- `kipkiren.write.payments` — initiate payments (requires delegated authority per call)
- `chapaa.read.position` — read aggregate savings position
- `chapaa.read.goals` — read goal progress (no behavioural detail)
- `chapaa.write.deposit` — initiate deposits (requires delegated authority per call)
- `chapaa.mmf.rebalance` — initiate MMF rebalancing (requires delegated authority with limits)
- `lunchdrop.read.orders` — read order history
- `lunchdrop.write.orders` — place orders on user's behalf
- (and so on per app)

### 12.2 Default scope posture

Most restrictive by default. A third-party agent registered fresh has no scopes — every scope must be explicitly requested and explicitly granted by the user via the Helpan Console.

### 12.3 Scope elevation

A third-party agent can request scope elevation at runtime. The user receives a Helpan Console prompt, sees what is being requested and why, and approves or denies. Approval issues a delegated authority with the granted scope. Denial is logged.

### 12.4 The Kirimon developer portal

The new session must specify a developer portal where third-party agent developers can register, request scopes, see documentation, and obtain test credentials. This is Phase 2 — but the rail's scope and OAuth design must not preclude it.

### 12.5 Anti-abuse posture

Third-party agents are subject to rate limits, behavioural anomaly detection, and per-scope policy controls. A third-party agent that triggers a high rate of failed delegated authority requests is flagged and can be suspended pending review. This is rail-side; the consuming apps do not implement it.

---

## 13. Build readiness checklist for Silvia

This checklist mirrors the platform programme convention. Items are categorised as hard blockers (must close before build), soft blockers (must close before launch), or deferrable.

### 13.1 Hard blockers — must close before build starts

| # | Item | Owner |
|---|---|---|
| H1 | Confirm rail name (Helpan AI working; alternative if proposed) | Chamia |
| H2 | OpenAPI 3.x specification for all rail-side endpoints (§6.1) | Helpan AI Engineering |
| H3 | Delegated authority token contract — full specification (§6.4) | Helpan AI + Identiti Engineering + Security |
| H4 | Step-up token contract joint with Identiti for high-stakes agent actions (§8.4) | Helpan AI + Identiti |
| H5 | Schema and ERD for all rail-side tables (§7.1) | Helpan AI Engineering |
| H6 | RLS policy specification (§7.4) | Helpan AI Engineering + Security |
| H7 | Audit log specification with retention rules (§7.3) | Helpan AI Engineering + Compliance |
| H8 | Kipkiren Pay gap analysis — current vs. agent-native API surface (§9.4) | Helpan AI + Kipkiren Pay Engineering |
| H9 | OAuth scope catalogue v1 (§12.1) | Helpan AI + Identiti + Product |
| H10 | Threat model (STRIDE or equivalent) for agent action dispatch | Helpan AI + Security |
| H11 | Helpan Console design specification (§3.7) | Helpan AI + Design |
| H12 | Per-app safety policy schema (§3.6) | Helpan AI + Product |
| H13 | Event bus contract — events Helpan AI emits and subscribes to | Helpan AI + Platform |
| H14 | Legal confirmation of regulatory containment principle (§9.3) | Legal + Compliance |
| H15 | Behavioural data containment policy (§3.4) — concrete rules per app | Helpan AI + Product + Compliance |

### 13.2 Soft blockers — must close before launch

| # | Item | Owner |
|---|---|---|
| S1 | React Native client SDK | Helpan AI Engineering + DevRel |
| S2 | Per-app integration patterns documented for the new family-discovery app | Helpan AI + App team |
| S3 | Per-app integration patterns documented for Helpan Chapaa | Helpan AI + Chapaa team |
| S4 | Per-app integration patterns documented for Helpan Lunch Drop | Helpan AI + Lunch Drop team |
| S5 | Operator console for Helpan AI ops (audit review, scope catalogue admin, agent registration) | Helpan AI Engineering + Ops |
| S6 | Incident management runbooks | Helpan AI Ops |
| S7 | Penetration test commissioned and Critical+High resolved | Security |
| S8 | Load test against expected agent volume | Helpan AI Engineering |
| S9 | DR drill | Platform |
| S10 | ODPC registration alignment | Compliance |
| S11 | Helpan Console UX validated with 10+ users | Design + Product |

### 13.3 Deferrable

| # | Item | Owner |
|---|---|---|
| D1 | Server-side SDKs (Node, PHP, Python) | DevRel |
| D2 | Developer portal for third-party agents (§12.4) | Helpan AI + DevRel |
| D3 | Per-app integration for Helpan SabakiFresh, Helpan Kipkiren consumer, Helpan Nightpulse | Helpan AI + App teams |
| D4 | Cross-app data access flows (the most complex; can ship after single-app default works) | Helpan AI + Product |
| D5 | Voice and chat agent surfaces (default is text; voice is later) | Helpan AI + Design |

---

## 14. Open decisions that must close before deep build

These are decisions that need Chamia's input or strategic clarification before Silvia can finalise design.

1. **Rail name confirmation.** Helpan AI is working; confirm or propose alternative.
2. **The new family-discovery app's name and brand.** Required to scope Helpan [App Name] and the first consuming app integration.
3. **Whether the rail builds on Supabase (af-south-1) per existing platform convention, or another stack.** Default assumption: Supabase + Railway, consistent with the rest of the portfolio.
4. **Whether the agent runtime uses a specific LLM provider as the default (Anthropic, OpenAI, or local).** This affects cost, latency, regulatory posture, and per-app override.
5. **Pricing model for third-party agent access.** Free during early adoption? Per-call after a threshold? Annual contract? Affects developer portal design.
6. **Helpan Chapaa MMF rebalancing — initial autonomy default.** Suggest-only at launch is the conservative posture. The new session should propose a graduation path to autonomous-with-limits.
7. **Identiti rail step-up token format alignment.** Joint contract — must be agreed with Identiti engineers before the rail-side design is locked.
8. **Whether Kipkiren Pay capability gaps (§9.4) are blockers for Helpan AI MVP or for v1.0.** Pragmatic answer: agent-native API surface is a v1.0 blocker; programmable money is v1.0 blocker for the new family-discovery app's standing-basket feature; AI-mediated dispute exposure is deferrable.
9. **Whether the Helpan Console is delivered as a shared library invoked from each app, or as a standalone Helpan-branded web/mobile surface.** Recommendation: shared library v1, standalone app v2.

---

## 15. Output Plan for the new session

The new session produces these artefacts in this order. Each artefact is delivered as both `.md` and rendered HTML where appropriate. Code artefacts are downloadable files.

1. **Confirmation memo** — confirms understanding of design law and strategic context, lists any disagreements or clarification needed, before proceeding.
2. **Helpan AI Design Reference** — strategic, approximately 30 pages. The "why" document.
3. **OpenAPI 3.x specification** — full machine-readable API surface.
4. **Delegated authority token contract** — joint with Identiti.
5. **Schema and ERD** — full data model.
6. **Event bus contract** — events emitted and subscribed to.
7. **Threat model** — STRIDE or equivalent.
8. **Kipkiren Pay gap analysis** — the most important integration document.
9. **Per-app integration pattern: the new family-discovery app**
10. **Per-app integration pattern: Helpan Chapaa**
11. **Per-app integration pattern: Helpan Lunch Drop**
12. **OAuth scope catalogue v1** — for third-party agent access.
13. **Helpan Console specification** — UX, behaviour, scope.
14. **Build Readiness Checklist** — populated against §13.
15. **Reading orders by role** — same convention as the existing platform programme corpus.
16. **Reboot Pack v1.0** — the document that lets a future Claude session resume this work without losing context.

---

## 16. Working rules for the new session

Inherited from existing platform conventions, applied to this work specifically:

- Confirm before proceeding on any significant change.
- All code delivered as downloadable files, never as chat code blocks.
- No hardcoded values in components (all via design system tokens).
- Reboot packs delivered as both `.md` and rendered HTML where appropriate.
- All Kirimon portfolio apps are M-Pesa Native — Helpan AI's design must not break this.
- Apps don't bypass Todoku for user-facing comms — Helpan AI's design must enforce this.
- Confirm understanding of design law (§3) and strategic context (§4) before producing any design artefact.
- When in doubt about scope between Helpan AI and a platform rail, default to the platform rail. The Agent rail is a thin orchestration layer, not a heavy domain owner.
- When in doubt about scope between Helpan AI and a consuming app, the agent's experience and policies live in the app; the orchestration runtime, briefing storage, matching engine, and consent surface live in the rail.

---

## 17. Reading orders by role

### 17.1 Silvia (CTO leading the build)

Read the entire document. Then proceed in the Output Plan order. Approximately 6 hours of reading.

### 17.2 Helpan AI engineer joining the build

1. §1 Mission
2. §3 Design Law
3. §4 Strategic Context (at least 4.1 and 4.2)
4. §5 Capabilities owned by rail vs apps
5. §6 Contract and API surface
6. §7 Schema and data model
7. §8, §9, §10 Rail integrations
8. §13 Build Readiness Checklist
9. §14 Open Decisions

Approximately 4 hours.

### 17.3 Identiti rail engineer

1. §1, §2, §3
2. §6.4 Delegated authority token contract
3. §8 Identiti integration
4. §9.2 Delegated authority requirement on Kipkiren Pay
5. §12 Third-party agent OAuth

Approximately 90 minutes.

### 17.4 Kipkiren Pay rail engineer

1. §1, §2, §3
2. §4.3 and §4.5 Strategic context for Kipkiren Pay
3. §6.4 Delegated authority token contract
4. §9 Kipkiren Pay integration
5. §11.3 Helpan Chapaa specifically (highest-stakes consumer)

Approximately 2 hours.

### 17.5 Todoku rail engineer

1. §1, §2, §3
2. §10 Todoku integration
3. §11 (per-app integrations — to understand what agent notifications look like)

Approximately 60 minutes.

### 17.6 Consuming app team

1. §1, §2, §3
2. §5 Capabilities owned by rail vs apps
3. §11 (find your app's section)
4. §6.2 Consumer-side SDK surface
5. §13 Build Readiness Checklist

Approximately 90 minutes.

### 17.7 Compliance and legal

1. §3.5 Regulatory containment
2. §4 Strategic context
3. §7.3 Audit log
4. §9.3 Regulatory containment restated
5. §11.3 Helpan Chapaa MMF rebalancing
6. §12 Third-party agent integration
7. §13.1 H14, H15

Approximately 90 minutes.

---

## 18. Session bootstrap instructions

The new dedicated session that will produce the Helpan AI rail design corpus should be opened with this instruction:

> *"You are starting a new session to design the Helpan AI rail — the fourth platform rail in the Kirimon Market Ventures stack, alongside Identity, Kipkiren Pay, and Todoku. Read the Helpan AI Rail Design Instruction Pack v1.0 in full before producing any design artefact. Confirm understanding of design law (§3) and strategic context (§4). Then proceed with the Output Plan (§15) in the order specified, following the working rules (§16). Confirm before proceeding on any significant change. Silvia Mumbua is starting the rail build today; this design must land before her architectural decisions calcify."*

The new session should also call `conversation_search` early for any ambiguous context — specifically on Kipkiren Pay's current platform handoff, Identity rail current state, Todoku current state, Chapaa's current product design, and the new family-discovery app's brand direction.

---

## 19. Closing note from Chamia

Helpan AI is not a feature. It is the rail that decides whether the Kirimon portfolio thrives or is disintermediated when global agents arrive in Kenya. The McKinsey banking thesis — that agents will become the channel of choice within three to five years — is the strategic charter. The rail is the response.

Build it agent-native, build it consent-first, build it without duplicating Identity, Kipkiren Pay, or Todoku, and build it before third-party agents do. Silvia, you have the brief.

— Chamia

---

*Helpan AI Rail Design Instruction Pack v1.0 · 5 May 2026 · Kirimon Market Ventures · Confidential*

*"The agent is the new front door. The rail is the foundation the door is hung on."*
