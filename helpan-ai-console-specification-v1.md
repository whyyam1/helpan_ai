# Helpan AI Rail — Helpan Console Specification v1.0

**Document type:** UX, behaviour, and scope specification for the Helpan Console — the rail's user-facing consent surface.
**Date:** 7 May 2026
**Authority:** Helpan AI Rail Design Instruction Pack v1.0 §3.7, §13.1 H11; Design Reference v1.0 §6.6 + Amendment §A.3; DoD/MVP v1.0 §4.1.

---

## 1. Mandate

The Helpan Console is **mandatory for v1.0** and **not deferrable** (per Instruction Pack §3.7). It is delivered as a **shared React Native library** invoked from each consuming app, not a standalone app (per Instruction Pack §14 item 9).

The Console is three things in one (per Design Reference §6.6):

1. A user-trust artefact — users see and revoke agent permissions.
2. A regulator-friendly surface — answer to "how does the user know what this agent is doing?"
3. A marketing asset — concrete proof of consent-first claim that competitors lack.

---

## 2. Form factor

### 2.1 Shared React Native library

Package name: `@kmv/helpan-console`. Distributed as a private npm package per the platform-shared package strategy.

Invocation from a consuming app:

```typescript
import { HelpanConsole } from '@kmv/helpan-console';

// Open Console (full-screen modal or screen-stack push)
HelpanConsole.open({
  customerToken: '<from Identiti>',
  appId: 'lunchdrop',
  onClose: () => { /* navigate back */ },
  onAuthorityRevoked: (authorityId) => { /* refresh app state */ }
});
```

The library handles all rendering, API calls, signature verification of webhooks, and state management internally. The consuming app provides only authentication context and lifecycle hooks.

### 2.2 Single source of truth across apps

A user opening the Console from Lunch Drop sees the SAME Console state as opening it from Chapaa or Klokd — every authorisation across every Kirimon app is visible. This is the "single surface" requirement.

The Console queries Helpan AI's `GET /v1/authorities` and `GET /v1/actions` for the authenticated user; no app-specific filtering by default. App-side filtering (e.g. "show me only Lunch Drop authorities") is a UX option but the canonical view is portfolio-wide.

---

## 3. Information architecture

### 3.1 Top-level navigation

Tab navigation:

| Tab | Default | Content |
|---|---|---|
| **Active** | yes | All `status='active'` authorities, grouped by app |
| **Activity** | no | Recent agent actions across all authorities (last 30 per authority, last 90 days) |
| **History** | no | Revoked / expired authorities and the reason each ended |

### 3.2 Active tab — authority card

Each authority renders as a card showing:

| Field | Display |
|---|---|
| Agent name + branded icon | "Helpan Lunch Drop" + Lunch Drop icon |
| Granted on | Relative time + absolute date |
| Expires | Relative ("in 3 days") + absolute |
| Scopes (human-readable) | Bulleted list — each scope shows scope name + amount/period limit |
| Last used | "5 minutes ago" or "never" |
| Quick actions | **Revoke** (one-tap) + "View activity" |

### 3.3 Authority detail screen

Tapped from the card. Shows:

- Full scope detail with concrete language ("Up to KES 2,500 per shift; up to KES 50,000 per month")
- Step-up token JTI consumed at issuance (if any) — informational, audit-friendly
- Recent actions under this authority (last 30)
- **Revoke button** — prominent, single-tap, confirms with a one-screen confirmation modal

### 3.4 Activity tab

Reverse-chronological list of agent actions. Each entry shows:

- Agent + timestamp
- Action ("Sent payment of KES 250 to PowerMama X")
- Authority that authorised it
- Status (completed / failed) with error reason on failure
- Tap → action detail screen

### 3.5 History tab

Authorities that ended. Shows reason: user_initiated, expired, account_suspended, kyc_downgraded, etc. Educational — helps users understand the system's protections.

### 3.6 Empty states

- No active authorities → "You haven't given any agents permission yet. When you do, they'll appear here."
- No activity → "Agents acting on your behalf will show up here."
- No history → "Revoked or expired permissions will be listed here."

---

## 4. Behavioural rules

### 4.1 Revocation is one-tap, immediate

Revoke button → confirmation modal (one screen) → API call → Console state refreshes → authority moves to History tab.

The confirmation modal shows:
- Agent name
- What revocation does ("This agent will no longer be able to take actions on your behalf within these scopes.")
- Whether revocation cascades anywhere ("Active actions in flight will continue; new actions will be blocked.")
- **Confirm Revoke** button + Cancel

No multi-step "are you sure" sequences. Revocation is a positive user act and friction is wrong here.

### 4.2 Consent friction for behavioural-detail scopes

When a third-party agent requests scope elevation that includes a `read_behavioural` scope, the Console shows a **dedicated friction screen** before the standard grant flow:

- Title: "This is a behavioural data permission"
- Body: explains what behavioural detail this scope unlocks (concrete examples: "When you save, how often, how much")
- Continue → standard grant flow (which still requires step-up + explicit confirm)

This friction is intentional per scan §6.3 and Design Reference §6.3.

### 4.3 Step-up requirement for grants and revocations

- Granting any new authority: requires fresh step-up (5-minute window).
- Revoking: does NOT require step-up — friction-free revocation is the design intent.
- Modifying an existing authority (raising limits): requires step-up.

### 4.4 Real-time sync via Kafka events

The Console subscribes to `helpan.authority.events` via the consuming-app backend (which proxies Kafka events to the Console via app-defined push). When a user has the Console open and an authority is revoked from another device or by the operator, the Console refreshes within ~1 second.

### 4.5 Offline mode

If the device is offline, the Console shows a banner: "Showing your last-cached state. Some actions are unavailable offline." Reads succeed from cache; revocation requires network.

---

## 5. Audit and observability inside the Console

The Console is itself audited:

- Every Console open writes an audit entry: `action='helpan_console.open'`, `actor_type='user'`, `actor_id=account_uuid`.
- Every revocation writes: `action='helpan_console.revoke'`, target the authority ID.
- Every grant writes: `action='helpan_console.grant'`.

This audit allows post-incident investigation of "did the user actually open the Console and revoke?" — important for fraud disputes.

---

## 6. Cross-rail integration

### 6.1 With Identiti

- Customer JWT used for authentication into Console API calls.
- Step-up tokens for grants / modifications (issued via Identiti `POST /step-up/initiate` from the Console flow).

### 6.2 With Kipkiren Pay

- Aggregate spend-under-authority view: Console calls `GET /v1/authorities/{id}` which Helpan AI augments with KP-side aggregate spend (cached 60s).
- Tap-through to KP transaction detail (out of Console scope; opens KP's own transaction surface in the consuming app).

### 6.3 With Todoku

- Console renders any "verification" SMS prompt: when a user grants a scope to an agent, they receive a Todoku-delivered confirmation SMS ("You granted Helpan Chapaa permission to deposit up to KES 30 per day until 14 May. Open the Console to revoke.").

---

## 7. Accessibility and localisation

- WCAG 2.1 AA conformance.
- Language: English + Swahili at v1.0. Per-app additional languages possible.
- Font scaling: respects OS-level scaling.
- Screen reader: every action card and revoke button properly labelled.

---

## 8. Visual design tokens

Per Reboot Pack §16.10 standing rule "no hardcoded values — design tokens only," the library accepts a theme prop allowing consuming apps to inject brand colours and typography while preserving Console's information architecture and consent friction patterns.

```typescript
HelpanConsole.open({
  ...
  theme: {
    primary: '#0D5C4E',     // Lunch Drop teal
    accent: '#C47A1A',      // amber
    danger: '#8B1A1A',      // revoke colour
    fontFamily: 'Inter'
  }
});
```

Brand colours can vary; the Console's semantic UI (revoke is always danger-coloured, behavioural-detail scopes always have a special badge) is preserved.

---

## 9. v1.0 build deliverables

| Deliverable | Owner |
|---|---|
| `@kmv/helpan-console` React Native library (private npm) | Helpan AI Engineering + Design |
| Integration guide for consuming apps | Helpan AI + DevRel |
| Reference integration in Lunch Drop | Lunch Drop team |
| Reference integration in Helpan Chapaa | Chapaa team |
| Storybook of all states | Design |
| Accessibility audit | Design + QA |
| UX validation with 10+ users (DoD §13.2 S11) | Design + Product |

---

## 10. v1.1+ roadmap

| Item | Target |
|---|---|
| Standalone Helpan-branded app (deeper brand play) | v2.0 |
| Voice surface for revocation ("revoke Helpan Chapaa") | v2.0 |
| Cross-app aggregated agent activity view | v1.1 |
| Notification preferences per agent | v1.1 |
| Agent reputation surfacing in grant flow ("This agent has been used 1,200 times across the platform with no incidents") | v1.2 |

---

## 11. Authoritative source documents

1. Helpan AI Rail Design Instruction Pack v1.0 §3.7, §13.1 H11
2. Design Reference v1.0 §6.6 + Amendment §A.3
3. DoD/MVP v1.0 §4.1, §13.2 S11
4. OAuth Scope Catalogue v1.0 §4 (behavioural-detail friction)
5. Threat Model v1.0
6. Per-App Integration Patterns v1.0 (each per-app section names Console integration)

---

*Helpan AI Rail · Helpan Console Specification v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential*
