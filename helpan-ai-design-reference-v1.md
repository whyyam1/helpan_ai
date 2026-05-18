# Helpan AI Rail — Design Reference v1.0

**Document type:** Strategic design narrative — the "why" document.
**Owner:** Chamia Mutuku, CEO & CPO, Kirimon Market Ventures
**CTO:** Silvia Mumbua
**Date:** 6 May 2026
**Status:** Authoritative. Read alongside the Instruction Pack v1.0 and the DoD/MVP v1.0. This is the document that explains the design choices the contracts and schemas implement.
**Audience:** Helpan AI engineering, Identiti / Kipkiren Pay / Todoku rail engineers, consuming-app teams, legal, compliance, and any future engineer joining the build after the original context has faded.
**Length target:** ~30 pages of strategic narrative. Read in full before producing implementation artefacts.

---

## 0. How to read this document

This is the second artefact in the Helpan AI Rail Output Plan (Instruction Pack §15). The Confirmation Memo gated this document; this document gates the OpenAPI spec (item 3), the delegated authority token contract (item 4), and everything downstream.

The Design Reference is **not the design**. It is the strategic context the design must hold. Where the Instruction Pack states a rule, this document explains why that rule exists and what breaks if it is relaxed. Where the DoD names a gate, this document names the underlying threat the gate defends against.

Read in this order:
- §1 (Executive summary) for orientation.
- §2–§3 (Mission, four-rail architecture) for the placement of Helpan AI in the platform.
- §4–§5 (Disintermediation thesis, the window) for the strategic charter.
- §6 (Design law as design choices) for the deepest reasoning — the longest section.
- §7 (A2A bypass defence) for the threat model in plain English.
- §8 (Per-app strategic posture) for the consuming-app implications.
- §9 (Cross-rail strategic posture) for the inter-rail expectations.
- §10 (Third-party agent posture) for the open-by-design implementation.
- §11–§13 (Stage progression, risks, charter) for sequencing and closure.

Where this document conflicts with the Instruction Pack or the DoD, the Instruction Pack and DoD win — they are authoritative on rules and gates; this document is authoritative on the reasoning.

---

## 1. Executive summary

Helpan AI is the **agent rail** — the fourth platform rail in the Kirimon Market Ventures stack, alongside Identiti, Kipkiren Pay, and Todoku. It provides the orchestration runtime, delegated authority model, consent surface, and audit infrastructure that allow every Kirimon consuming app to ship a branded AI agent without rebuilding the agent layer. It is also the surface through which third-party AI agents — a user's general-purpose assistant, a household management app, an external aggregator — interact with the Kirimon portfolio under OAuth.

The rail is being built in direct response to the **disintermediation thesis**: that AI agents will become the channel of choice for consumer banking and a meaningful share of consumer commerce within three to five years. McKinsey's April 2026 banking report estimates global incumbent profit-pool risk at 9% on average, 27% for deposits, 34% for cards. The mechanism is the removal of consumer inertia — agents move money, build baskets, and arbitrate providers in seconds. The defensive prescription for wallet providers and superapps is unambiguous: become the operating system agents prefer.

The Kirimon response is to ship the rail and the consuming agents **before third-party agents arrive in Kenya**. Each consuming app — Helpan Klokd, Helpan Lunch Drop, Helpan Chapaa, Helpan [App Name] for the new family-discovery app — runs on the same rail with the same security model, the same consent surface, and the same integration patterns. The rail's defensibility against agents bypassing it (calling Daraja directly to skip Kipkiren Pay) lies in the abstractions Daraja does not expose: the verification primitive, escrow, hold/release, dispute orchestration, AI-mediated risk scoring, the counterfactual explainer, programmable money primitives.

The rail is **agent-native, consent-first, regulatory-contained**. Helpan AI does not hold funds, does not extend credit, does not aggregate yield, does not net off-ledger, does not run float — Kipkiren Pay remains the only CBK-licensed entity in the portfolio. Every agent action that touches money, identity, or comms carries a scoped, time-bounded, revocable **delegated authority token**, distinct from a user step-up token. Every active authorisation is visible to the user in the **Helpan Console**, with one-tap revocation. By default, an app's agent reads only its own app's data; cross-app reads require explicit consent and explicit OAuth scope.

The strategic charter is one sentence: **the agent is the new front door; the rail is the foundation the door is hung on**. Build agent-native, consent-first, regulatory-contained — and ship before third-party agents arrive.

---

## 2. The mission

Helpan AI's mission is twofold.

**One — enable every Kirimon consumer app to ship an agent capability without duplicating infrastructure.** Every consuming app has the same needs: an agent runtime, briefing storage, intent management, a matching engine, audit, observability, safety policies, third-party scope catalogues. Without the rail, each app rebuilds these. With the rail, each app ships its agent in weeks instead of months and inherits a consistent security model, a consistent consent surface, and a consistent regulatory posture across the portfolio.

**Two — position the Kirimon platform as the agent operating system for East African consumer finance and commerce.** The McKinsey companion piece on agent-era retail banking is explicit: superapps and wallet providers must publish developer toolkits, bake transparent consent and override controls into the core, and secure the user's intent. Helpan AI is the surface that delivers all three. The rail is **open by design** — third-party agents are first-class consumers — and **closed by consent** — every read or write requires explicit user authorisation.

These two missions are not in tension. Owning the agent rail for the Kirimon portfolio and being the rail third-party agents prefer are the same play. Each strengthens the other. Each consuming app is more useful with its branded agent than without; each branded agent is more useful with the rail than without; the rail is more useful than the agents around it.

---

## 3. The four-rail architecture

The Kirimon platform now consists of four rails:

| Rail | Function | Regulatory class | What every app calls it for |
|---|---|---|---|
| **Kipkiren Pay** | E-money, wallet, payments, payouts, savings goals, M-Pesa, programmable money, escrow | CBK E-Money Issuer (NPS Reg 2014) | All money movement |
| **Identiti** | Account UUID, KYC tier signal, step-up tokens, phone tokens, OAuth issuance | DPA 2019; CA-K | Identity, authentication, consent records |
| **Todoku** | SMS, voice, WhatsApp, in-app inbox, push | DPA 2019; CA-K | All user-facing comms |
| **Helpan AI** | Agent runtime, briefing storage, matching, delegated authority, consent surface, audit | DPA 2019; no CBK exposure (per §6.4) | Agent capability across every consuming app |

Helpan AI sits **on top of** the other three rails. It does not own primitives the other three rails own; it orchestrates them.

The four-rail thesis updates the three-rail thesis stated in Platform Rails Reboot Pack v1.2. Helpan AI was added one day after v1.2 consolidated. A v1.3 Reboot Pack will fold the four-rail thesis into the canonical record; that is out of scope for this document but is on the platform programme backlog.

The runtime dependency graph between the four rails is:

```
                        ┌──────────────────┐
                        │   Helpan AI      │  ← agent rail (this rail)
                        └─────┬─┬──┬───────┘
                              │ │  │
              ┌───────────────┘ │  └────────────────┐
              ▼                 ▼                   ▼
       ┌────────────┐   ┌──────────────┐   ┌──────────────┐
       │  Identiti  │   │ Kipkiren Pay │   │   Todoku     │
       └────────────┘   └──────────────┘   └──────────────┘
              ▲                 ▲                   ▲
              └─────────────────┴───────────────────┘
                            consuming apps
                  (Klokd, Lunch Drop, Chapaa, [App Name], …)
```

Helpan AI is **downstream** of the other three rails in the sense that it consumes them. It is **upstream** of the consuming apps in the sense that it orchestrates on their behalf. Consuming apps continue to call Identiti, Kipkiren Pay, and Todoku directly for non-agent flows; Helpan AI is invoked when an agent is involved.

---

## 4. The disintermediation thesis

This section names the strategic intellectual backdrop. It is included so future engineers and future sessions understand *why* the rail is designed this way after the original reasoning has faded.

### 4.1 The McKinsey banking report (April 2026)

McKinsey's April 2026 retail-banking research argues that within three to five years, an AI agent will become the **channel of choice** for all banking interactions — acting as the primary interface between a customer and their financial institution. The headline estimate is a 9% global average decline in incumbent banking profit pools if banks fail to respond, with credit cards (-34%) and consumer deposits (-27%) the most exposed lines. The mechanism is the **removal of consumer inertia**: today, consumers do not move their savings to a higher-yielding account because the friction is not worth a small rate differential. Tomorrow, an agent moves the money in seconds. Today, a consumer carries a card with mediocre rewards because switching is annoying; tomorrow, an agent picks the right card per transaction.

The companion piece adds the explicit instruction for wallet providers and superapps:

1. Publish developer toolkits so agents can integrate.
2. Bake transparent consent and override controls into the core.
3. Secure the user's intent — make sure when an agent acts, it is acting for a real, authorised, current intent of a real user.

These three are the architectural charter for Helpan AI.

### 4.2 The McKinsey shopping report (April 2026)

The companion retail report identifies three structural forces reshaping consumer behaviour: rising use of AI in purchase decisions, growing expectations for transparency and convenience, and shifting spending power toward younger generations. The strongest signal is that consumers are starting to use agentic tools for **basket building, automated replenishment, and post-purchase support**, particularly for routine essentials. The report flags that retailers need clean catalogue feeds, accurate local availability data, and live pricing updates to stay competitive when a shopper's agent is comparing alternatives.

The implication for Helpan AI is direct: the new family-discovery app is being built to be **agent-native from day one** — standing-basket auto-replenishment, real-time discovery briefings, merchant-side AI clienteling. None of this works without a rail.

### 4.3 The Kenya angle

The McKinsey reports are global. The Kenya angle is sharper.

**Kenya is M-Pesa-native.** M-Pesa is the underlying account-to-account rail; Daraja is its API. As agents become more capable, they will eventually try to call Daraja directly and bypass any wallet that sits on top — including Kipkiren Pay. This is the **A2A bypass threat** (§7). Kipkiren Pay's defence is to expose abstractions Daraja does not.

**The disintermediation arrived early in Kenya before.** M-Pesa agents disintermediated bank branches in the 2010s. The next disintermediation wave — agents over wallets — will arrive in Kenya at the same time it arrives globally, possibly faster because the on-rail substrate is already mobile-first.

**Kirimon is being built in the agentic era, ground-up.** Kipkiren Pay and Chapaa are not retrofitting agent-readiness onto a legacy stack; they are designing for it from day one. This is a structural advantage over incumbent Kenyan banks and over wallets built before 2024.

### 4.4 What "agent as channel of choice" actually means

Three things, concretely, that the rail must support to be on the right side of this transition:

1. **Standing intents that survive sessions.** A user briefs their agent once ("alert me when fresh tilapia drops within 2km of home before 6pm") and the briefing fires repeatedly across sessions, devices, and weeks. The briefing storage and matching engine on the rail are what make this possible.
2. **Delegated authority that survives the user's absence.** The user is not online when the agent acts. The agent acts under a delegated authority token that the user issued when they were online, and that they can revoke at any time. The token is the asynchronous trust primitive.
3. **A consent surface that the user can read, audit, and revoke from.** Without this, agents are opaque and consumers learn (correctly) not to trust them. The Helpan Console is what makes the rail trustworthy.

Each of these is on the v1 critical path. None can be deferred without breaking the thesis.

---

## 5. Why now — the window to ship

### 5.1 The window

The window between "agents are technically capable" and "agents are routine for Kenyan consumers" is short. McKinsey says three to five years globally; Kenya may be sooner because M-Pesa already trained the population to do significant financial activity through a non-bank channel.

The window for Kirimon to ship Helpan AI **before third-party agents arrive at scale in Kenya** is shorter still — likely measurable in months for a credible v1, not in years. Every week without Helpan AI is a week a third-party agent could arrive first and start absorbing the customer relationship.

### 5.2 What "first" buys

Shipping first does three things.

**One — defines the consent surface.** When a Kirimon user grants their first agent authorisation, they do it through the Helpan Console. The Console becomes the place users go to manage agents. A user who has used the Helpan Console once is materially less likely to grant authorisation through a third-party agent's own UI, because the Helpan Console is more transparent and revocation is one tap.

**Two — establishes the delegated authority pattern.** The rail's token format becomes the format every Kirimon-portfolio integration uses. When a third-party agent registers and requests a scope, they get a Helpan-AI-shaped token with Helpan-AI semantics. This is the "operating system agents prefer" claim in concrete form.

**Three — captures the behavioural data.** Every agent interaction generates audit data. That data is the substrate for the next generation of features — predictive intent, agent-to-agent coordination, cross-app suggestions — all of which require behavioural maturity that takes time to accumulate. Shipping first means accumulating first.

### 5.3 What "second" costs

Shipping second — letting a third-party agent be the user's first agent in Kenya — means the consent surface is owned by someone else, the delegated authority pattern is whatever the third party imposes, and the behavioural data flows out of the portfolio rather than into it. The defensibility moats Kipkiren Pay and Chapaa are building become commoditised because the agent layer above them is owned by an external player.

This is the disintermediation thesis applied to a specific portfolio. The reason every line of this design favours speed over completeness in v1 is that completeness can be added in v1.1, but the consent-surface and behavioural-data positions, once lost, are hard to recover.

---

## 6. Design law as design choices

The Instruction Pack §3 lists ten sub-laws. Each is a design choice with consequences. This section explains each one's reasoning so engineers can apply judgment in edge cases the law does not literally cover.

### 6.1 No duplication of platform rail functionality

**The rule.** Helpan AI never reimplements payment, identity, or comms. Every such capability is invoked via Kipkiren Pay, Identiti, or Todoku.

**The reasoning.** Three things break if Helpan AI duplicates rail functionality.

First, **regulatory containment** breaks. If Helpan AI implements payment routing or holds intermediate balances, it becomes an entity the CBK has to license. Today, only Kipkiren Pay needs CBK authorisation. Adding Helpan AI to the regulated perimeter is years of work and capital it does not need. The architectural restraint here is a regulatory shield.

Second, **observability** breaks. If two rails can both emit a payment, debugging "why didn't this customer's payment succeed?" requires reconciling two ledgers. Today, Kipkiren Pay is the single source of truth for the answer. Multi-source-of-truth costs more in support and audit than the engineering convenience of "let the agent rail just pay directly" ever returns.

Third, **defensibility** breaks. The rail's value to consuming apps is the integration consistency. A consuming app that today calls one Kipkiren Pay endpoint for payment and tomorrow calls a different Helpan AI endpoint for agent-initiated payment is paying integration cost twice. The whole point of a fourth rail is to *reduce* the integration surface for consuming apps, not increase it.

**Edge case guidance.** If something looks like it might belong to a rail, it does. If the design pattern requires Helpan AI to hold an intermediate balance, the design is wrong — find the Kipkiren Pay primitive that handles it (escrow, hold/release, programmable money), and if no such primitive exists, that is a Kipkiren Pay backlog item, not a Helpan AI feature.

### 6.2 Delegated authority as a first-class primitive

**The rule.** Every agent action that touches money, identity, or comms carries a scoped, time-bounded, revocable delegated authority token. This token is distinct from a user-initiated step-up token (which is tied to the user's live session).

**The reasoning.** The asynchronous problem. The user is not online when the agent acts. The agent might act minutes, hours, or days after the user issued the briefing. The user's session token expired long ago. So the agent needs a different kind of credential — one issued by the user when they were online, scoped to a specific class of action, time-bounded, and revocable.

If this primitive does not exist, the rail has three bad options.

Option one: the agent acts under the user's session token, which is short-lived and gets refreshed somehow. This requires a "background refresh" mechanism that is hard to secure (anything that can refresh a session token can act as the user). Bad.

Option two: the agent acts under a long-lived API key issued to the consuming app, which the app uses to act on the user's behalf. This shifts the trust burden to the consuming app and breaks regulator-friendly auditability ("did the user authorise this specific action?" becomes "the app says they did"). Bad.

Option three: the agent acts under a delegated authority token. The user issued it. The token names the scope. The token has an expiry. The token can be revoked. Every relying party (Kipkiren Pay, Todoku) validates the token per call against the rail's revocation endpoint. Auditability is precise: this exact action, by this exact agent, under this exact authority, at this exact time, on behalf of this exact user. **This is the choice.**

The token is **distinct from the user step-up token** because step-up is the user authorising *themselves* for a sensitive action they are about to take, in real time. Delegated authority is the user authorising *the agent* for a sensitive action the agent will take later. Same cryptographic primitives, different lifetimes, different audit semantics. Conflating the two is a security bug.

**Edge case guidance.** If a flow seems to "skip" the delegated authority (e.g. an agent that "just reads"), check if the read crosses an app boundary or touches identity material. If yes, a delegated authority is required. Reads that stay inside the app's own behavioural data are not "agent actions" in the sense this rule covers — they are normal app behaviour. The rule applies to *cross-rail* and *cross-app* actions.

### 6.3 Behavioural data containment

**The rule.** By default, an app's agent reads only its own app's data. Cross-app reads require explicit user consent and explicit OAuth scope. Third-party agents start at the most restrictive scope and elevate per data category.

**The reasoning.** Three protections in one rule.

First, **user privacy.** A user signing up for Helpan Lunch Drop did not sign up for that agent to read their Chapaa savings behaviour. Default cross-app read is a privacy violation no consent dialog can fully repair.

Second, **the behavioural data asset.** Each consuming app's defensibility lives in the patterns of how its users behave inside that app. Chapaa's defensibility is the savings-consistency signal. Lunch Drop's is the ordering-pattern signal. Klokd's is the worker-reliability signal. If these signals leak across apps without consent, the apps individually become commoditised — any third-party agent with cross-app read access has the same data as the app and can build the same product.

Third, **DPA 2019 compliance.** Kenya's Data Protection Act 2019 requires explicit purpose limitation. Reading a user's savings data to make food suggestions is not the purpose for which the savings data was collected. The default-own-app-only rule is the architectural expression of purpose limitation.

**The hierarchy of reads, by sensitivity:**

| Read class | Default | Elevation path |
|---|---|---|
| Own-app aggregate (e.g. Chapaa's "your current balance") | Permitted | n/a |
| Own-app behavioural (e.g. Chapaa's "you save more on Mondays") | Permitted | n/a |
| Cross-app aggregate (e.g. another agent reading your Chapaa balance) | Denied | User grants `chapaa.read.position` |
| Cross-app behavioural (e.g. another agent reading your saving cadence) | Denied | User grants explicit behavioural-detail scope; rare |
| Third-party agent reading any KMV data | Denied | User grants per-scope via Helpan Console |

The design must make the *behavioural-detail* class a deliberate, hard-to-grant scope. The credit signal in Chapaa is one of the portfolio's strongest defensibility moats; granting third-party agents read access to it should be a friction-laden, well-explained user choice — not a default or a check-the-box.

**Edge case guidance.** "Aggregate" means a single number or a small derived summary. "Behavioural" means a time-series, a pattern, a sequence. If a third-party agent can reconstruct the user's savings behaviour from N aggregate reads, the read is behavioural and the scope is wrong.

### 6.4 Regulatory containment

**The rule.** Helpan AI does not hold funds, extend credit, aggregate yield, run float, or net off-ledger. Every money movement initiated by an agent is a Kipkiren Pay call. Kipkiren Pay remains the only entity in the portfolio that requires CBK regulatory approval.

**The reasoning.** Crossing the regulatory perimeter is a one-way door. Once the CBK considers Helpan AI a payment institution, the rail is subject to NPS Reg 2014, capital floors, fit-and-proper checks, audit cycles, and regulatory reporting in perpetuity. The cost is years of compliance work and capital that is doing nothing for the rail's actual value proposition (orchestration).

The architectural rule that prevents this is **stateless intermediation**. Helpan AI receives an agent's intent ("transfer KES 500 from goal A to goal B"), validates the delegated authority, dispatches the corresponding Kipkiren Pay call, and waits for the result. At no point does any value sit on Helpan AI's side of the wire. The audit log records what happened; the ledger is Kipkiren Pay's.

This rule has a corollary: **AI risk scoring lives in Kipkiren Pay, not in Helpan AI**. If the rail were to build its own risk scoring on top of intent dispatch, that scoring would have to be regulator-friendly, which collapses back into the perimeter problem. The rail can call Kipkiren Pay's risk-scoring endpoint and act on the result; it cannot run its own.

**Edge case guidance.** Any feature that generates a balance, a credit, a position, a settlement, or a yield is wrong on its face for Helpan AI. Find the Kipkiren Pay primitive. If no primitive exists, escalate to the gap analysis (Output Plan item 8) and let Kipkiren Pay decide whether to add it.

### 6.5 Family-friendly safety as a platform-level concern

**The rule.** Category whitelists, content moderation hooks, and per-app safety policies are platform primitives. Each consuming app declares its safety posture; the rail enforces.

**The reasoning.** The new family-discovery app makes safety a hard product requirement. Nightpulse (when Helpan Nightpulse ships at v1.2) makes the inverse — adult-audience-confirmed — a hard product requirement. If each app were to implement these primitives independently, the rail would have inconsistent safety enforcement across the portfolio, and a single bug in one app's safety filter could leak inappropriate content to a different app's audience through an agent-to-agent path.

Architecting for this in v1, even though Nightpulse is v1.2, means the rail's safety primitives must support both directions: enforce-family-friendly, and confirm-adult-audience. The shape of the per-app safety policy schema (Instruction Pack §13.1 H12) is the artefact that locks this in.

**Edge case guidance.** Where an app's experience-level safety rule is the same as a rail-level enforcement rule, prefer the rail. Apps can layer additional rules on top of rail enforcement; rails cannot relax app rules. Defence in depth runs from app inward to rail outward.

### 6.6 The Helpan Console as the consent surface

**The rule.** Helpan AI ships a single user-facing surface — the Helpan Console — that lets a user see, at any time, every agent authorised to act on their behalf, on what data, until when, with one-tap revocation. The Console is mandatory for v1 and not deferrable.

**The reasoning.** Consent is the one thing third-party agents cannot replicate. A general-purpose AI assistant can offer better intelligence, better integrations, broader scope. It cannot offer a regulator-friendly, user-trustable, portfolio-wide consent surface — because it does not own the rail.

The Console is therefore three things in one:

1. **A user-trust artefact.** Users who can see and revoke agent permissions trust agents more. This is the difference between an agent feeling like a feature and an agent feeling like a delegation of authority.
2. **A regulator-friendly surface.** When the ODPC, the CBK, or the Communications Authority asks "how does the user know what this agent is doing?", the answer is "they open the Helpan Console." Architecting the answer into the rail saves audit cycles later.
3. **A marketing asset.** The Console is something Kirimon can show — to investors, to partners, to journalists writing about agent safety — that competitors do not have. It is concrete proof that the consent-first claim is real.

The Console is delivered as a **shared React Native library** invoked from each consuming app in v1. A standalone Helpan-branded app is a v2 ambition. The library form factor in v1 means a user opens the Console from inside Lunch Drop, sees every authorisation across every Kirimon app, and revokes the Chapaa one without leaving Lunch Drop. This is the "single surface" requirement made concrete.

**Edge case guidance.** Anything that is not visible in the Console is not authorised. If a flow seems to bypass the Console (e.g. a "background" agent action with no audit entry), the flow is wrong.

### 6.7 Agent-native API surface for Kipkiren Pay

**The rule.** Every Kipkiren Pay capability today exposed for human-mediated app interaction must also be exposed as a clean, versioned, machine-readable API suitable for agent consumption. Programmable money / scheduled transfers move from Phase 2 deferrable to v1 priority.

**The reasoning.** Two things drive this.

First, the consuming-app pattern. Helpan Klokd's pay-on-completion, the family-discovery app's standing-basket auto-replenishment, Helpan Chapaa's MMF rebalancing — all of these require Kipkiren Pay to support patterns that, today, are not formally part of the v1 surface. The gap between today's KP and what Helpan AI consuming apps need is the gap analysis (Output Plan item 8).

Second, the bypass defence. If KP's surface is awkward for agents, agents will route around it. Agent-friendliness is not a nice-to-have; it is the structural defence against agents calling Daraja directly. Every capability KP exposes that Daraja does not is one more reason for agents to stay on KP.

**Programmable money** specifically is elevated because the family-discovery app's standing-basket feature is the most agent-native v1 use case in the portfolio. A user briefs the agent ("every Sunday afternoon, top up the kitchen basket from these 4 farms within KES 2,500"), and the agent uses Kipkiren Pay's programmable money primitive to schedule the transfer. Without programmable money on KP, the rail has to either implement scheduling itself (breaking §6.4 regulatory containment) or punt the feature to v1.1 (breaking the family-discovery launch thesis).

**Edge case guidance.** When the gap analysis surfaces a capability, the question is not "should KP add it?" — that is Chamia's call after KP engineering reviews feasibility. The question is "what is the consequence to Helpan AI v1 of KP not adding it?" — which the gap analysis answers per gap.

### 6.8 Open by design, closed by consent

**The rule.** Helpan AI is built to be consumed by third-party agents under OAuth, not just by Kirimon portfolio apps. Closure happens at the consent layer, not the API layer.

**The reasoning.** The McKinsey banking thesis names the defence: be the operating system agents prefer. An operating system agents prefer is one that lets them in, not one that locks them out. Locking third-party agents out at the API layer is a short-term defence that does not scale: agents will scrape the consuming-app UIs, reverse-engineer the mobile apps, or aggregate via screen-reading — all of which are worse for the user (no consent surface, no audit, no revocation) than letting them in via OAuth.

Letting them in via OAuth, on the other hand, gives Kirimon four levers:

1. **Scope catalogue control.** Kirimon defines what scopes exist. A third-party agent cannot ask for a scope the rail does not offer.
2. **Default-most-restrictive posture.** A newly registered third-party agent has zero scopes. Every scope must be explicitly requested and explicitly granted by the user.
3. **Per-call authority validation.** Even with a granted scope, every agent call presents a delegated authority. The rail validates per call. Revocation is immediate and per-user.
4. **Behavioural anomaly detection.** Third-party agents are subject to rate limits, anomaly detection, and per-scope policy controls. An agent that triggers a high rate of failed delegated authority requests is flagged and can be suspended pending review.

These four together mean Kirimon controls the closure dial precisely without the all-or-nothing trade-off of API-layer lock-out.

**Edge case guidance.** When designing a new scope, ask: would a user reasonably expect this agent to do this thing? If the answer requires explanation, the scope is too coarse. Split it.

### 6.9 The remaining sub-laws

The remaining design-law sub-laws (§3.2 rail consumer pattern, §3.10 inherited working rules) are operational rather than strategic. They are not expanded here because the reasoning is the platform programme's general convention, documented elsewhere. Engineers should treat §3.2 and §3.10 as binding operational rules without further reasoning.

---

## 7. The A2A bypass defence

### 7.1 The Daraja attack vector

In Kenya, **M-Pesa via Daraja is the underlying account-to-account rail**. Anyone with Daraja access can move money between M-Pesa accounts. As agents become more capable, they will try to call Daraja directly and skip Kipkiren Pay. If they succeed, Kipkiren Pay becomes a redundant abstraction layer — a wallet that nobody is using because the agent is going around it.

This is not a theoretical risk. It is the natural endpoint of the disintermediation thesis applied to a specific market. Every day Kipkiren Pay does not expose more than Daraja does, the bypass becomes more rational.

### 7.2 What Kipkiren Pay exposes that Daraja does not

The defence is **strictly more useful than raw Daraja**, agent-natively. Specifically:

| Capability | Available on Daraja? | Available on KP for agents? | Defensibility |
|---|---|---|---|
| Payment (STK push) | Yes | Yes | Parity — necessary, not sufficient |
| Verification primitive (`verify_recent_payment`) | No | Yes (v1) | KP-only |
| Hold / release / escrow | No | Yes (v1) | KP-only |
| Refund | Limited | Yes (v1) | KP advantage |
| Dispute initiation and orchestration | No | Yes (v1) | KP-only |
| AI-mediated risk scoring per transaction | No | Yes (v1) | KP-only |
| Counterfactual transaction explainer | No | Yes (v1) | KP-only |
| Programmable money / scheduled transfers | No (in useful form) | Yes (v1, elevated) | KP-only |
| Multi-stage escrow patterns | No | Yes (v1) | KP-only |
| AI-mediated dispute resolution support | No | Yes (v1.1) | KP-only |

The eight KP-only capabilities are the **moat**. Each one is something an agent can do via Kipkiren Pay that it cannot do via Daraja. The more such capabilities exist and the smoother they are to use agent-natively, the less rational the bypass.

### 7.3 The Chapaa parallel — MMFs

The same logic applies to Chapaa versus a generic MMF distributor. A third-party agent that wants to move a user's savings to a higher-yielding account can, in principle, integrate directly with whichever MMF the user might prefer. Chapaa's defence is to be more useful than direct MMF distribution:

- The commitment mechanics (locked savings, goal-based pots, streaks).
- The Chama group savings primitive (no MMF distributor exposes this).
- The behavioural-data-driven credit unlock (the "save first, borrow later" mechanic is unique to Chapaa's design).
- The aggregation across multiple CMA-licensed MMFs without the user having to manage multiple distributor relationships.

Helpan Chapaa exposes these to the user's agent through Helpan AI. A third-party agent with the appropriate scopes can read the position, suggest a rebalance, and (with explicit user consent and a delegated authority within MMF rebalancing limits) act. But the unique value — the commitment mechanics, the credit unlock — only exists in Chapaa.

### 7.4 The strategic conclusion

The bypass defence is structural, not legal. There is no rule that prevents an agent from calling Daraja. The rail's job is to make Daraja the wrong choice for any agent acting in the user's interest. **Every architectural decision in Kipkiren Pay's agent-native surface, and every decision in Helpan AI's orchestration of it, should be evaluated against the question: does this make KP more or less useful than raw Daraja for an agent right now?**

---

## 8. Per-app strategic posture

The DoD names four flagship integrations as v1.0 hard MVP gates (DoD §3.2, §4.3). The Stage 3 launch criteria gate strictly on two — the family-discovery app and Helpan Chapaa — with Helpan Lunch Drop deferrable with sign-off. Helpan Klokd is in v1 scope per the DoD §4.3 commitment, though §10 launch criteria do not explicitly name it; this document treats Klokd as a strong v1 commitment per the priority-1 ranking in DoD §3.2 and the new Output Plan item 11.5 added per Confirmation Memo §5.3.

Order of presentation is by priority per DoD §3.2.

### 8.1 Helpan Klokd — priority 1

**Strategic posture.** Klokd is the casual-labour marketplace agent. The integration readiness is the highest of the four because Klokd is in beta with real workers and employers. The Helpan integration adds: shift-availability briefings on the worker side; shift-fill orchestration on the employer side; M-Pesa-native pay-on-completion via Kipkiren Pay; worker reputation surfacing. The strategic value is that Klokd is the first integration where the agent is replacing a manual-coordination workflow that real users feel as friction today — workers manually browsing for shifts, employers manually messaging workers to confirm.

**Defensibility.** Klokd's defensibility is the **verified-worker reputation signal** combined with **same-day pay-on-completion via M-Pesa**. Both are KP-only features that no third-party labour aggregator can replicate. A general-purpose agent can match a worker to a shift; only Helpan Klokd can verify the worker, confirm the shift completion, and trigger pay-on-completion in a single agent flow.

**Risks specific to Klokd.** Two-sided market dynamics — workers and employers both need to be on the rail for the agent to be useful. The integration has to ship to both sides simultaneously. The mitigation is to start with employers who already have a verified-worker pool and let the worker-side agent enter through the existing roster, rather than cold-starting workers.

**Behavioural-data containment.** Worker-reliability signals (verified shift count, ratings, completion rate) are the credit signal for any future Klokd-flavoured worker financing product. This data is contained per §6.3 — it does not leak to third-party agents under default scope.

### 8.2 Helpan Lunch Drop — priority 2

**Strategic posture.** Lunch Drop is the food-delivery agent. The integration is **augmentation, not replacement**: ZoneFeed personalisation augmentation, weekly-lunch-plan briefings, reliability nudges. The ZoneFeed algorithm is locked and Helpan Lunch Drop adds an orchestration layer on top, not a substitute. The strategic value is that Lunch Drop is the most volume-predictable consumer flow in the portfolio — most users order lunch most weekdays — and turning that into a standing briefing is a textbook v1 demonstration of the agent rail.

**Defensibility.** Lunch Drop's defensibility is the **vendor-reliability data and the local-merchant relationships**. A third-party food-discovery agent does not have the merchant relationships or the live availability signal Lunch Drop has. The Helpan Lunch Drop agent compounds this with reliability nudges — "your usual Mama hasn't been active for 3 days; try Mama Y?" — that only work because Lunch Drop has the longitudinal merchant-activity data.

**Risks specific to Lunch Drop.** Soft-deferral risk per DoD §5: if bandwidth is constrained, Lunch Drop is the most likely v1.0 → v1.1 deferral. The DoD §10 launch criteria explicitly allow "Helpan Lunch Drop live (or formally deferred to v1.1 with Chamia sign-off)." This document recommends shipping Lunch Drop in v1.0 if at all possible — it is the lowest-risk integration with the highest user-volume payoff.

### 8.3 Helpan Chapaa — priority 3 (highest stakes)

**Strategic posture.** Chapaa is the savings agent and is the **highest-stakes integration in the portfolio**. McKinsey's deposits-at-34%-risk number lands here. If consumers' first agent-grade savings experience in Kenya is third-party, Chapaa is disintermediated. If it is Helpan Chapaa, Chapaa is reinforced.

The Helpan Chapaa capabilities at v1: goal-acceleration nudges, round-up acceleration, MMF-rebalancing-suggest-only (autonomous-with-limits is v1.1), Chama support (top-up prompts, shortfall alerts), credit-unlock orchestration, behavioural-insight surfacing.

**Defensibility.** Chapaa's defensibility is **not the rate**. An agent will always find a higher one. Defensibility is in the commitment mechanics (locked savings, goal-based pots, streaks), the Chama group-savings primitive (no MMF distributor offers this), and the credit-unlock moment (Chapaa's "save first, borrow later" mechanic is the experiential payoff a third-party agent cannot replicate). Helpan Chapaa surfaces these mechanics in the agent flow; it does not commoditise them.

**The MMF rebalancing question.** v1.0 default is **suggest-only**. A user receives a suggestion ("the MMF rate moved up; consider rebalancing KES 5,000 from MMF A to MMF B") and confirms in-app. Autonomous rebalancing is v1.1, gated on:

- A user-set risk-limit framework (per-period maximum, per-rebalance maximum, allowed MMF set).
- A delegated authority with the `chapaa.mmf.rebalance` scope and explicit limits.
- Audit-trail visibility for every rebalance in the Helpan Console.
- Rebalances only between CMA-licensed partner MMFs explicitly enrolled by Kipkiren Pay.

The graduation from suggest-only to autonomous-with-limits is itself a strategic moment: it is the first time the rail does anything material with autonomous money movement. The Confirmation Memo flagged the graduation path as a separate decision; this document treats it as a v1.1 gate that requires explicit Chamia sign-off based on observed v1.0 user behaviour.

**Behavioural-data containment.** Chapaa's behavioural data — savings consistency, withdrawal patterns, goal completions — is the **credit signal that makes Chapaa defensible**. This data must not leak to third-party agents under default scope. A user can grant a third-party agent read access to *aggregate* savings position (current balance, current goal progress) but not to behavioural detail. The scope split between `chapaa.read.position` (aggregate, grantable) and any behavioural-detail scope (rare, friction-laden) is the architectural expression of this rule.

**Risks specific to Chapaa.** Regulatory exposure — MMF rebalancing involves CMA-licensed partners and could attract CMA scrutiny if mishandled. The mitigation is the suggest-only v1.0 default and the explicit-limits-only autonomous-rebalancing v1.1 model. Legal sign-off (Instruction Pack §13.1 H14) covers this.

### 8.4 Helpan [App Name] — priority 4 (family-discovery app)

**Strategic posture.** The new family-discovery app is being designed agent-native from day one. Briefing-based real-time discovery, standing-basket auto-replenishment, merchant-side AI clienteling. This is the consuming app where the agent **is the primary interaction model** rather than an augmentation.

**Defensibility.** Two layers. The **family-friendly safety policy** — category whitelists, content moderation, no nightlife / alcohol-led / adult content, no location precision below merchant level, no user-to-user agent communication — is the brand-defining differentiator. Any general-purpose agent that could match the discovery feature does not have the family-friendly safety stack. The second layer is **standing-basket auto-replenishment via programmable money** — a flow only Kipkiren Pay can support agent-natively.

**Risks specific to the family-discovery app.** Brand name not yet locked (working candidates: Sasa, Hapa, other). Per Confirmation Memo §5.5, Stage 0 proceeds with placeholder; name lock required by Stage 2. Risk that the placeholder propagates into artefacts that are expensive to retro-fit; mitigation is to use the literal placeholder string `[App Name]` in all references, making search-and-replace at lock time mechanical.

**The lessons-from-priorities-1-3 dependency.** The DoD positions this app fourth in priority *because* it benefits from lessons learned in the first three integrations. The structural sequencing is: ship Klokd first (operational learning on agent dispatch and pay-on-completion), Lunch Drop second (learning on briefing storage and matching at volume), Chapaa third (learning on behavioural-data containment and high-stakes consent), family-discovery fourth (applying all of the above to an agent-native-first product).

### 8.5 The deferred apps

**Helpan SabakiFresh, Helpan Kipkiren consumer, Helpan Nightpulse, Sherehe, others.** These are v1.1 / v1.2 / further. The rail must architect for them in v1.0 — supporting two-sided markets (SabakiFresh), spend-insight agent flows (Kipkiren consumer), adult-audience safety posture (Nightpulse) — without breaking when they plug in. The architectural rule for v1.0 is **make these possible, not actual**.

---

## 9. Cross-rail strategic posture

This section sets the relationship Helpan AI expects to have with each of the other three rails. It is not the contract (that lives in the Instruction Pack §6.3); it is the strategic frame for how each rail thinks about the agent rail.

### 9.1 With Identiti

Identiti is the **root of the trust graph**. Helpan AI consumes Identiti for user authentication, OAuth issuance for third-party agents, consent records, session management, and step-up-token issuance.

The strategically interesting bit is the **OAuth issuance / scope catalogue split**. Helpan AI defines what scopes exist; Identiti issues the OAuth tokens. This split exists because identity issuance is identity's job (regulator-friendly, audit-friendly, KYC-aware) while scope definition is a product / domain question that lives where the product / domain lives — which for agent-mediated portfolio access is Helpan AI.

The **step-up token contract** is the other strategically interesting bit. High-stakes delegated authorities — large-amount payments, autonomous MMF rebalancing, account-merge authorisation — require a step-up token issued in the same flow as the delegated authority itself. The joint contract (Instruction Pack §8.4, hard blocker H4) is the most security-critical interface in the rail.

The expectation Helpan AI sets for Identiti: **fast, available, and consent-aware**. JWT validation per call must be sub-100ms p99. Step-up token issuance must complete inside the user's attention window (typically <30 seconds end-to-end including OTP delivery via Todoku). Consent records must be queryable per (user, scope, app) tuple.

### 9.2 With Kipkiren Pay

Kipkiren Pay is the **highest-stakes integration**. Every agent action that touches money is a Kipkiren Pay call. The defensibility of the whole portfolio against the A2A bypass threat depends on KP's agent-native surface.

The expectation Helpan AI sets for Kipkiren Pay: **agent-native, abstraction-rich, and per-call delegated-authority-validating**. Every endpoint Kipkiren Pay exposes must be cleanly callable by an agent without a human-in-the-loop fallback. Every endpoint must accept a delegated authority token in the `X-Delegated-Authority` header and validate the token against Helpan AI's revocation endpoint per call. Every capability that today is human-mediated (and there are several) must have an agent-native equivalent or a documented v1.1 path to one.

The gap analysis (Output Plan item 8) is the artefact that makes this concrete. It enumerates today's KP surface, names the delta to agent-native, and estimates the work per gap. The gap analysis is recommendation-class per Confirmation Memo §5.4 — it does not bind KP scope; it informs Chamia's scope decisions.

The KP capability that has been **explicitly elevated** is programmable money. The KP capability that has been **explicitly deferred** is AI-mediated dispute resolution support to the consuming app (v1.1). Other elevations / deferrals will surface in the gap analysis.

### 9.3 With Todoku

Todoku is the **comms boundary**. The agent never delivers a notification. The matching engine fires; Helpan AI emits a structured notification request (message body, urgency, channel hint, agent identifier, context); Todoku decides delivery based on user preferences, quiet hours, frequency caps, and channel availability.

The strategically interesting bit is **agent voice ownership**. Each Helpan agent has a brand voice owned by the consuming app. Helpan AI does not own the voice. The agent generates the message body; Todoku handles delivery; tone consistency is the consuming app's responsibility. The rail does not normalise voice across agents because the brand-voice is part of each app's defensibility.

The expectation Helpan AI sets for Todoku: **fast delivery decisions, faithful execution, no voice drift**. Quiet-hour enforcement and frequency-cap enforcement are absolute — agents cannot override them except via an explicit `urgent_override` scope in the delegated authority, and even then Todoku validates against its own policy.

The agent inbox (non-urgent persistent surface) is **Todoku's**, not Helpan AI's. The rail does not build an inbox. This avoids two surfaces competing for the same user attention.

---

## 10. Third-party agent posture

### 10.1 The OAuth scope catalogue

Third-party agents access the Kirimon platform through OAuth. Identiti is the OAuth issuer; Helpan AI defines the scope catalogue. Output Plan item 12 produces the v1 catalogue.

Indicative shape (the canonical list lives in item 12):

| Scope | What it permits |
|---|---|
| `helpan.read.profile` | Basic user profile |
| `helpan.read.briefings` | Read user's active briefings |
| `helpan.write.briefings` | Create briefings on user's behalf |
| `helpan.read.actions` | Read user's agent action history (audit log) |
| `kipkiren.read.balance` | Aggregate balance only |
| `kipkiren.read.transactions` | Transaction history |
| `kipkiren.write.payments` | Initiate payments (requires delegated authority per call) |
| `chapaa.read.position` | Aggregate savings position (no behavioural detail) |
| `chapaa.read.goals` | Goal progress (no behavioural detail) |
| `chapaa.write.deposit` | Initiate deposits (requires delegated authority) |
| `chapaa.mmf.rebalance` | Initiate MMF rebalancing (requires delegated authority with limits) |
| `lunchdrop.read.orders` | Order history |
| `lunchdrop.write.orders` | Place orders on user's behalf |

Per-app scopes are added as each consuming app onboards.

### 10.2 Default scope is most-restrictive

A third-party agent registered fresh has **zero scopes**. Every scope is explicitly requested (during agent registration or at runtime via scope-elevation), and explicitly granted by the user via the Helpan Console. Granting a scope does not also grant the right to act under that scope — every specific action also presents a delegated authority, and the rail validates per call.

### 10.3 Scope elevation flow

Runtime scope elevation: the third-party agent issues a scope-elevation request; the user receives a Helpan Console prompt naming what is being requested and why; the user approves or denies; approval issues a delegated authority with the granted scope; denial is logged.

The strategic property of this flow is that **the user is making a deliberate choice in a regulator-friendly UI**. Not a buried checkbox in a third-party app's settings.

### 10.4 Anti-abuse posture

Third-party agents are subject to:

- Rate limits per scope.
- Behavioural anomaly detection (unusual call patterns flagged).
- Per-scope policy controls (some scopes have lower thresholds for review).
- Suspension pending review on high failure rates of delegated-authority requests.

These are rail-side; consuming apps do not implement them. The rail's anti-abuse infrastructure is the same one consuming-app engineering teams would otherwise have to build independently.

### 10.5 The developer portal

A developer portal where third-party agent developers register, request scopes, see documentation, and obtain test credentials is **Phase 2**. v1.0 ships without it; manual ops approval handles registration. The rail's scope and OAuth design must not preclude the portal — it must be addable in v1.1 without rail re-architecture.

---

## 11. Stage progression

Helpan AI advances through four stages per DoD §6. Stage advance requires all DoD criteria for that stage to be met and signed off.

| Stage | Name | What it means strategically |
|---|---|---|
| **Stage 0** | Specification | Design corpus complete. All hard blockers resolved. Engineering not yet writing rail code. Consuming-app teams can begin reading the API contracts. |
| **Stage 1** | Internal Alpha | Rail running in staging. All four flagship consuming-app integrations wired in staging. Internal team using it. The rail's correctness becomes empirically demonstrable. |
| **Stage 2** | Closed Beta | Rail in production behind a feature flag. Real Kenyan users on the family-discovery app and Chapaa. No general availability. The rail's safety, latency, and consent-surface engagement become measurable. |
| **Stage 3** | Production | General availability. All v1.0 launch criteria met (DoD §10). The rail is the operating system for agents in the Kirimon portfolio. |

The strategic timing is **Stage 2 within the window** the disintermediation thesis allows. Stage 0 → Stage 1 should be measured in weeks; Stage 1 → Stage 2 in weeks; Stage 2 → Stage 3 in weeks. Slippage at any stage is real strategic cost.

---

## 12. Strategic risks and mitigations

### 12.1 Coordination risks (highest-likelihood)

**Risk.** The Kipkiren Pay gap (H8) and the Identiti step-up token alignment (H4) require engineering bandwidth from teams outside Helpan AI. If those reviews slip, the rail's design is paper.

**Mitigation.** Output Plan items 2 and 8 run in parallel (Confirmation Memo §6) — item 8 starts the cross-team conversation as early as possible. Item 4 produces a strawman first (Confirmation Memo §5.9), unblocking downstream items while the joint review converges on the final shape.

### 12.2 Scope creep on the rail (medium-likelihood)

**Risk.** A consuming-app team finds a feature easier to build at the rail level than at the app level and asks for it. Each "small" rail-level feature is a step toward the rail owning experience as well as orchestration — which breaks §3.2 and § 6.1.

**Mitigation.** The rail-vs-app default in §16 working rules: orchestration in rail, experience in app. Every requested rail feature is reviewed against this rule. The default answer is no.

### 12.3 Behavioural-data leakage (medium-likelihood, high-impact)

**Risk.** A third-party agent obtains a scope that should have been behavioural-detail-restricted but was provisioned as aggregate. Chapaa's credit signal leaks. Kirimon's defensibility erodes.

**Mitigation.** Scope catalogue review (Output Plan item 12) explicitly distinguishes aggregate vs. behavioural reads. Behavioural-detail scopes are rare, friction-laden, and require a Helpan Console flow that is materially harder than aggregate-scope grants.

### 12.4 Regulatory drift (low-likelihood, very-high-impact)

**Risk.** A feature gets added that puts Helpan AI inside the CBK regulatory perimeter. The rail becomes a regulated entity overnight.

**Mitigation.** Legal sign-off on regulatory containment at Stage 0 (Instruction Pack §13.1 H14), not at Stage 2. Every feature with money or yield exposure is reviewed against §3.5 / §6.4 by legal before it ships.

### 12.5 The bypass actually happening (lower-likelihood with v1; rises with time if rail is slow)

**Risk.** A third-party agent ships in Kenya and demonstrates that calling Daraja directly is simpler than calling Kipkiren Pay. Users start preferring the third-party agent.

**Mitigation.** Ship v1 fast (the entire reason for the §6 cadence parallelism); make KP's agent-native surface visibly more useful than Daraja per §7.2; ensure the Helpan Console is a tangible user benefit early.

### 12.6 Helpan Console adoption

**Risk.** Consumers do not open the Console. The consent surface is real but underused, and the audit value is reduced.

**Mitigation.** UX validation with 10+ real users at Stage 2 (DoD §13.2 S11). Console surfaced prominently in onboarding. Deliberate UX choices that make the Console the natural destination for "where did this agent come from?" questions.

### 12.7 Family-discovery app brand not locked

**Risk.** The brand name does not lock by Stage 2; integration guides require retro-fitting.

**Mitigation.** Placeholder `[App Name]` used literally in artefacts (Confirmation Memo §5.5) so search-and-replace at lock time is mechanical.

---

## 13. The strategic charter

Five sentences.

1. **The agent is the new front door.** McKinsey's banking and shopping reports name agents as the channel of choice within three to five years; Kenya is not exempt.
2. **The rail is the foundation the door is hung on.** Without Helpan AI, every Kirimon consuming app rebuilds the agent layer; with it, every app inherits a consistent security model, consent surface, and integration pattern.
3. **Build agent-native, consent-first, regulatory-contained.** Programmable money in v1; the Helpan Console mandatory in v1; Kipkiren Pay remains the only CBK-licensed entity.
4. **Ship before third-party agents arrive.** The window between "agents are technically capable" and "agents are routine for Kenyan consumers" is short; every week without the rail is a week a third-party agent could arrive first.
5. **Be the operating system agents prefer.** Open by design, closed by consent. The defence is structural — every architectural decision should make Kirimon the rail an agent acting in the user's interest will choose.

— end —

---

## 14. Reading map for downstream artefacts

This Design Reference is the "why." The next artefacts make it concrete.

| Output Plan item | What it produces | What it inherits from this document |
|---|---|---|
| 3 — OpenAPI 3.x spec | Wire-level contract for every rail-side endpoint | §6 design law (especially §6.1, §6.2); §9 cross-rail expectations |
| 4 — Delegated authority token contract | Cryptographic shape, claims, lifecycle, revocation | §6.2 reasoning; §9.1 step-up joint contract; §10 third-party scope semantics |
| 5 — Schema and ERD | Postgres schema for all rail-side tables | §6 (especially §6.3 behavioural containment for RLS rules); §6.6 Console requires actions and authorities surfaced |
| 6 — Event bus contract | Cross-rail event topic catalogue | §9 cross-rail expectations |
| 7 — Threat model | STRIDE-style coverage of agent dispatch | §7 A2A bypass; §6.3 behavioural leakage; §6.4 regulatory drift |
| 8 — KP gap analysis | Per-capability gap between today's KP and agent-native v1 | §6.7 reasoning; §7.2 capability table |
| 9, 10, 11, 11.5 — Per-app integrations | Concrete integration patterns for the four flagship apps | §8 per-app strategic posture |
| 12 — OAuth scope catalogue v1 | The canonical scope list | §10.1 illustrative scopes; §6.3 aggregate-vs-behavioural split |
| 13 — Helpan Console specification | UX, behaviour, scope of the Console | §6.6 reasoning |
| 14 — Build Readiness Checklist | Populated against §13 of Instruction Pack | All of this |
| 15 — Reading orders by role | Who reads what to onboard | §0 of this document |
| 16 — Helpan AI Reboot Pack v1.0 | Canonical record for future sessions | All of this |

---

## Amendment §A — Agentic AI Signal Scan integrated (7 May 2026)

The **Agentic AI Signal Scan** (`agentic_ai_scan.html`, Chamia, 4 May 2026) is an adjacent intelligence corpus that was produced one day before the Helpan AI Instruction Pack and was integrated into the Helpan AI corpus on 7 May 2026 via the **Scan Integration Memo v1.0**. The scan's threat catalogue, design responses, and v1.1-roadmap items are now reflected in the Rail Contract amendments (Identiti, Kipkiren Pay, Todoku Amendment §A each), the App Integration Guide Amendment §A, and the Claude Code Instruction Pack Amendment §A.

This Design Reference is updated as follows.

### A.1 — §4 Strategic Context — adjacent intelligence corpus

The McKinsey banking and shopping reports cited in §4.1 / §4.2 are reinforced by the scan, which adds named external evidence:

- **IMF April 2026 note** on agentic AI's effect on payment authorisation, liquidity, settlement, compliance, resilience.
- **Ant International AMP** open-sourced 28 April 2026 — first agentic mobile payment framework, built explicitly because existing rails were designed for human-initiated transactions.
- **CSA Agentic AI Addendum (Oct 2025)** and **IMDA Model Governance Framework for Agentic AI (Jan 2026)** — establishing agent identity, delegation, and consent as primary governance dimensions.
- **FINRA 2026 Regulatory Oversight Report** — agentic AI governance as a new exam area for financial firms.
- **Sumsub 2025** — synthetic-identity fraud and AI-orchestrated drain; AI-enabled fraud +1,210% Jan–Dec 2025 vs +195% traditional.
- **WEF Cybercrime Atlas (Jan 2026)** — Deepfake-as-a-Service costs $10–50; most face-swap and camera-injection tools bypass standard biometric onboarding.
- **Microsoft 2025 Digital Defense Report** — 80% of recent MFA bypasses use AiTM session-token theft.
- **CrowdStrike 2024** — 442% rise in vishing H2; AI voice cloning mainstream.

These sources sharpen the strategic charter without changing it. The window-to-ship argument in §5 is reinforced; the disintermediation thesis in §4 is corroborated.

### A.2 — §6.2 (Delegated authority as primitive) — alignment with emerging standards

The reasoning in §6.2 is reinforced by the scan's identification of the subject-vs-actor distinction emerging across CSA, IMDA, OAuth 2.1, and major vendor implementations (Strata, Microsoft). Helpan AI's delegated authority token is the canonical implementation of this distinction for the KMV portfolio. The Identiti step-up JWT now carries an `actor` claim (per Identiti Schema Appendix Amendment §A.1) that pairs with the Helpan AI delegated authority — together they cover both human-in-the-loop and agent-on-behalf-of flows.

### A.3 — §6.6 (Helpan Console as consent surface) — JIT identity posture

The scan recommends explicit documentation of Just-In-Time (JIT) identity provisioning per emerging standards. Helpan AI's design already implements JIT (delegated authorities expire fast, no static service accounts, no long-lived bearer tokens). The Identiti Rail Contract Amendment §A.3 documents the JIT posture explicitly across the platform — Helpan AI inherits and extends it.

The Console UX must surface JIT posture to users — every active authorisation visible, every revocation immediate, every TTL displayed. The scan's "consumer inertia removal" thesis (§5.1 here) and the JIT identity standard converge: the Console's role is to make JIT credentials feel as durable to users as long-lived tokens did, while preserving the security advantage.

### A.4 — §7 (A2A bypass defence) — adopt the scan's named threat catalogue

The §7.2 capability table is augmented with the scan's named threats. Each KP-only capability is now tagged with the threats it specifically defends against:

| Capability | Defends against |
|---|---|
| Verification primitive (`verify_recent_payment`) | Synthetic-identity drain (validates real activity); A2A bypass (Daraja doesn't expose) |
| Hold/release/escrow | Delivery-fraud patterns; conditional release on event |
| Dispute orchestration | Coordinated-drain claw-back; agent-mediated dispute |
| AI-mediated risk scoring | Synthetic-identity behaviour; AML pattern obfuscation; deepfake-orchestrated payment loop |
| Counterfactual explainer | User trust under agent-mediated decisions; CSA-aligned transparency |
| Programmable money | Standing-basket and recurring-payment patterns that agents need; A2A bypass via deterministic execution |

The scan reinforces that the bypass defence is **structural, not legal** — every architectural decision in KP's agent-native surface is evaluated against "does this make KP more or less useful than raw Daraja for an agent acting in the user's interest right now?"

### A.5 — §12 (Strategic risks) — incorporate scan threat landscape

The §12 risk register is extended with the scan-derived threats:

| Risk added | Likelihood | Impact | Primary mitigation |
|---|---|---|---|
| **Deepfake-orchestrated full payment loop** (vishing → step-up bypass → payout) | High (KE-CIRT/CC: +201.85% Q1 2025) | Direct customer fund loss | Cross-rail anti-social-engineering copy enforced at template approval (per all three Rail Contract Amendments §A); call-back number registration; explicit "KMV will never call you" pattern |
| **AiTM session-token theft** | High (80% of MFA bypasses) | Auth JWT replay; agent dispatch under stolen credential | Short auth JWT TTL on elevated scopes (5 min); JIT identity posture; CAEP roadmap (v1.1) for active revocation |
| **Synthetic-identity coordinated drain** | Medium-rising (21% of first-party frauds 2025) | Multi-account fraud not caught by single-account rules | KP cross-account behavioural fraud monitoring as Phase 1 Build Readiness item (BR-AI-1); rules-based AML supplemented by behavioural |
| **Sender-ID spoofing** (third-party impersonating KMV brands) | Medium (KE-CIRT/CC growth signal) | Customer trust erosion; OTP collection by attackers | Anti-phishing copy on every class_0 OTP template; sender-ID spoofing detection on v1.1 roadmap |
| **AI agents at inhuman SMS volume** | Low-rising (limited at v1.0; rises with agent density) | Envelope drain, abuse | Time-windowed velocity component on Todoku envelope (`ENV_VELOCITY_BURST_DETECTED`) |
| **WhatsApp ToS / COMESA platform risk** | Medium (live probe) | WhatsApp channel disruption | Template-only posture is compliant; quarterly probe monitoring |

### A.6 — §13 (Strategic charter) — unchanged

The five-sentence charter in §13 is unchanged. The scan's recommendations all serve it; none redirect it.

### A.7 — §14 (Reading map) — additions for downstream artefacts

The reading-map table now includes the scan-driven inheritances:

| Output Plan item | Additional scan-driven content |
|---|---|
| 3 — OpenAPI spec | `initiated_by` field across agent dispatch + delegated-authority validation request shapes; `actor` claim consumption in JWKS-validated tokens |
| 4 — Delegated authority token contract | Subject/actor distinction (CSA-aligned); CAEP-ready revocation semantics; per-call validation against revocation endpoint |
| 7 — Threat model | Adopt the scan's full threat catalogue as named adversary patterns: Deepfake-as-a-Service, AiTM session-token theft, synthetic-identity coordinated drain, AI smishing, AI voice-cloning vishing, sender-ID spoofing, AI-orchestrated AML structuring, AI volume abuse, template evasion via compromised credentials |
| 9–11.5 — Per-app integration patterns | Mandatory anti-social-engineering / anti-phishing / anti-vishing copy patterns; agent-initiated comms via `initiated_by=agent` |
| 12 — OAuth scope catalogue | Tight default scopes; behavioural-detail scopes friction-laden per the scan's data-leakage threat |
| 13 — Helpan Console specification | Deepfake-resistant consent UX; JIT posture surfaced to users; the Console as the "verify this came from KMV" anchor for users facing impersonation attempts |

---

*Helpan AI Rail · Design Reference v1.0 + Amendment §A · 6 May 2026; amendment 7 May 2026 · Kirimon Market Ventures · Confidential · Companion to Instruction Pack v1.0 and DoD/MVP v1.0; integrates Agentic AI Signal Scan (Chamia, 4 May 2026)*

*"The agent is the new front door. The rail is the foundation the door is hung on."*
