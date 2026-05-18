# Helpan AI Rail — Threat Model v1.0

**Document type:** STRIDE-style threat model with adopted scan threat catalogue.
**Date:** 7 May 2026
**Authority:** Helpan AI Instruction Pack v1.0 §13.1 H10; Design Reference v1.0 + Amendment §A.5; Agentic AI Signal Scan (Chamia, 4 May 2026); Scan Integration Memo v1.0.

---

## 0. Scope

Threats to the agent rail's confidentiality, integrity, availability, audit fidelity, and abuse-resistance. Out of scope: threats to KP, Identiti, Todoku that do not transit Helpan AI (those are in the respective rails' threat models).

Method: STRIDE per element; adopt scan named adversary patterns; reconcile.

---

## 1. Trust boundaries

```
[End user device]   ──┐
                      │   TLS 1.3 + customer JWT
[Consuming app] ◄─────┘
        │
        │ HMAC-SHA256 + mTLS
        ▼
[Helpan AI rail] ─── shared Kafka cluster ─── [KP / Identiti / Todoku]
        │
        │ HMAC-SHA256 + mTLS  ◄─── X-Delegated-Authority validation per call
        ▼
[Relying party rails: KP, Todoku]
        │
[Operator console] ─── FIDO2/WebAuthn (no SMS 2FA)
```

Boundaries:
- B1: End user → consuming app (app's responsibility; boundary inherited)
- B2: Consuming app → Helpan AI (HMAC + mTLS)
- B3: Helpan AI ↔ Identiti (HMAC + mTLS for service-to-service; JWT verification via JWKS for token validation)
- B4: Helpan AI ↔ KP, Helpan AI ↔ Todoku (HMAC + mTLS; X-Delegated-Authority on dispatch)
- B5: Helpan AI ↔ third-party agents (OAuth via Identiti; Helpan AI defines scopes)
- B6: Operator → Helpan AI operator console (FIDO2 + admin scope)

---

## 2. STRIDE per asset

### 2.1 Delegated authority token

| Threat | Vector | Mitigation |
|---|---|---|
| **S — Spoofing** | Forged JWT not signed by Identiti | RS256 verification against JWKS; relying parties verify per call |
| **T — Tampering** | Modified claims after issuance | RS256 signature breaks on any claim change |
| **R — Repudiation** | User denies issuing the authority | Audit log entry at issuance (hash-chained); step-up token jti recorded for high-stakes; user-initiated revocation visible in Console |
| **I — Information disclosure** | Token leaks reveal authorisation scope | Tokens are bearer; relying parties redact on logs (jti only); 60-second positive cache only |
| **D — Denial of service** | Mass-issuance request to exhaust Identiti signer | Per-app issuance rate limit; Identiti signer has its own envelope |
| **E — Elevation of privilege** | Agent escalates beyond granted scope | Validate endpoint per call; scope check + amount check + period limit check; rejection codes per §4.5 of authority contract |

### 2.2 Briefings

| Threat | Vector | Mitigation |
|---|---|---|
| S | Briefing created in another user's name | Customer JWT `sub` is authoritative for `account_uuid` on POST /briefings |
| T | Briefing content modified by other user | RLS policy: account-scoped writes only |
| R | User denies issuing briefing | Audit log entry at create + customer-token authentication |
| I | Cross-app briefing read | RLS: app-scoped service reads; cross-app requires explicit consent (out of v1.0) |
| D | Briefing flood from compromised app | Per-app rate limit; envelope check |
| E | App escalates briefing beyond its app scope | Scope check on request — `app_id` in token must match request's `app_id` |

### 2.3 Audit log

| Threat | Vector | Mitigation |
|---|---|---|
| T | Audit entries modified after write | Hash-chained (per Reboot Pack §9.5); insert-only; replay detection on chain mismatch |
| R | Operator denies an action | Operator FIDO2 auth + audit entry on every operator action |
| I | Audit reveals PII to non-operator | RLS operator-only; redact at write time (no phone numbers, no full PANs, no biometric vectors) |
| D | Audit log exhausted | Cold-tier mirror (Kafka `helpan.audit.events`); 7-year retention |

### 2.4 Validate endpoint

| Threat | Vector | Mitigation |
|---|---|---|
| S | Caller spoofing relying party | HMAC + mTLS; scope `helpan:authority:validate` restricted per relying-party app credential |
| T | Modified validation request | HMAC body signing |
| I | Validation responses leak authority detail | Only the relying party's app credential can call; response is scoped to the JTI under check |
| D | Validation flood (each agent call hits it) | 60-second positive cache permitted; no negative cache; per-relying-party rate limit |
| E | Relying party validating tokens not for its rail | `aud` claim check on token before validation succeeds |

### 2.5 Operator console

| Threat | Vector | Mitigation |
|---|---|---|
| S | Stolen operator credential | FIDO2/WebAuthn (no SMS 2FA per Reboot Pack §10); hardware-bound |
| T | Malicious tampering of safety policy | Audit entry on every change; PR-style review for high-impact changes (out-of-band) |
| R | Operator denies action | Audit log + FIDO2 attestation |
| I | PII visible to operators | Tier separation: most operator views are aggregate; full PII access is a separate scope `helpan:admin:pii` |
| D | Operator console DoS | Standard rate limit; alerting on auth failures |
| E | Operator scope creep | Scopes minted per-role; rotation 90 days |

---

## 3. Scan threat catalogue (adopted)

Per Design Reference Amendment §A.5 — the scan's named adversary patterns are first-class threats in this model.

### 3.1 Deepfake-orchestrated full payment loop (XR-2)

**Pattern.** Vishing call collects OTP → step-up bypassed → agent dispatch initiates payout to attacker.

**Touchpoints in Helpan AI:**
- Step-up token consumed at delegated authority issuance — if compromised step-up is presented, authority is issued.
- Agent dispatch path — if compromised authority is presented, action proceeds.

**Mitigations (v1.0):**
- Mandatory anti-social-engineering copy on step-up notification templates (KP Rail Contract Amendment §A.3, Todoku §A.2).
- Anti-vishing copy on voice OTP (Todoku §A.3).
- Helpan Console surfaces every active authority — user can revoke if they later realise.
- Validate endpoint per call — revocation propagates within 60s.
- Audit log captures full chain — recoverable if detected.

**Residual risk:** During the step-up validity window (5 minutes) and the cache window (60 seconds), a successful deepfake can complete a payment. Mitigation depth is in operator detection (fraud pattern monitoring) and rapid revocation.

### 3.2 AiTM session-token theft (ID-5)

**Pattern.** Adversary-in-the-Middle proxy intercepts customer JWT after auth; replays.

**Touchpoints:**
- Helpan AI accepts customer JWTs from consuming apps (where the app delegates auth to Identiti).

**Mitigations:**
- Short auth JWT TTL on elevated scopes (5 min per Identiti Schema Appendix Amendment §A.4).
- JIT identity posture across all token classes.
- mTLS between consuming app and Helpan AI prevents simple-MitM at network layer.

**Residual:** Replay during 5-minute window. v1.1 CAEP push-revocation reduces this further.

### 3.3 Synthetic-identity coordinated drain (KP-2)

**Pattern.** Multiple synthetic accounts build 18-month dormant histories; coordinated drain in single activation.

**Touchpoints:**
- Multi-account briefings hitting same payee
- Multi-account authority issuance with similar scope shape
- Coordinated agent dispatch from same agent across accounts

**Mitigations (v1.0):**
- KP Rail Contract Amendment §A.4 BR-AI-1 cross-account behavioural pattern monitoring (Phase 1)
- Helpan AI emits agent-action correlation events (`helpan.action.events`) consumed by future cross-rail aggregator (XR-3 v1.1)

**Residual:** Cross-rail aggregator is post-v1.0. v1.0 detection lives in KP's behavioural monitor; Helpan AI surfaces the agent-correlation signal.

### 3.4 Sender-ID spoofing (TD-2)

**Pattern.** Third-party aggregator impersonates Todoku-managed sender IDs (e.g. `Helpan`, `Klokd`); customers trust messages.

**Touchpoints:** Outside Helpan AI's direct control (Todoku-level concern). But Helpan AI's anti-social-engineering copy in templates ensures even spoofed messages feel inconsistent with legitimate ones.

**Mitigation:** Anti-phishing line on every OTP template (Todoku §A.2). Sender-ID monitoring at Todoku (v1.1).

### 3.5 AI agents at inhuman SMS volume (TD-5)

**Pattern.** Compromised agent or app credential blasts approved templates at API speed within rate windows.

**Touchpoints:**
- Agent dispatch path that targets Todoku.

**Mitigations (v1.0):**
- Todoku envelope velocity-burst component (`ENV_VELOCITY_BURST_DETECTED` per Todoku §A.4).
- Helpan AI per-app envelope on dispatch path with same velocity component.
- Anomaly detection on `actions` table — sudden spike in dispatch rate per agent.

### 3.6 Template abuse via compromised credentials (TD-3)

**Pattern.** API key compromise → approved templates sent to enriched contact lists.

**Touchpoints:** Compromised app credential could call `POST /actions/dispatch` with crafted payloads.

**Mitigations:**
- Per-call delegated authority validation — even with compromised app credential, the attacker needs a valid authority for the user.
- Helpan AI never issues delegated authorities without a step-up token for high-stakes scopes.
- Audit-log alert on unusual dispatch patterns per agent / per app.
- Key compromise playbook (Todoku §A.5; mirrored on Helpan AI ops).

### 3.7 Agent privilege escalation via overscoped authority

**Pattern.** Agent receives broader scope than user intended; uses outside intent.

**Touchpoints:** Authority issuance flow — user grants scope via consuming-app UX.

**Mitigations:**
- Helpan Console surfaces every authority's full scope detail; user can review and revoke.
- Scope per-call ceilings prevent issuance with limits exceeding policy.
- Behavioural-detail scopes are non-default-grantable per scan §6.3 — require additional Console friction.
- Cascade revocation on KYC downgrade ensures privileges shrink with trust.

### 3.8 Cross-app data leakage via behavioural scope

**Pattern.** Third-party agent obtains behavioural-detail scope on Chapaa; reconstructs credit signal.

**Touchpoints:** OAuth scope catalogue.

**Mitigations:**
- Behavioural-detail scopes are `default_grantable=false` and `elevation_friction=high`.
- Helpan Console flow for granting these scopes is materially harder than aggregate scopes.
- Audit log on every behavioural read; suspicious pattern triggers operator alert.
- v1.1: cross-app data access requires explicit consent UX (DoD §5).

---

## 4. Top residual risks (after v1.0 mitigations)

Ranked by likelihood × impact, post-mitigation:

| Rank | Residual risk | Why it persists |
|---|---|---|
| 1 | Deepfake payment loop within step-up validity window | Social engineering depth-of-attack; mitigation is operator detection + audit |
| 2 | Cross-rail synthetic-identity coordinated drain | XR-3 cross-rail aggregator is v1.1; v1.0 detection is per-rail |
| 3 | Cascade-revocation latency up to 60s | CAEP push-revocation is v1.1; v1.0 relies on Kafka + cache TTL |
| 4 | Operator credential theft despite FIDO2 | Hardware-key loss + social engineering of recovery flow |
| 5 | Audit log integrity post-disaster | 7-year cold-tier mirror exists but cold-tier itself can fail; multi-region replication is roadmap |

---

## 5. Mitigations not yet built (roadmap)

| Mitigation | Target version | Owner |
|---|---|---|
| CAEP real-time revocation | v1.1 | Helpan AI + Identiti |
| Cross-rail fraud signal aggregator | v1.1 | Platform |
| Continuous behavioural monitoring (Identiti) | v1.1 | Identiti |
| AML behavioural pattern detection (KP, vendor) | v1.1 (vendor TBD) | KP + procurement |
| Sender-ID spoofing monitoring | v1.1 | Todoku + ops |
| Cross-app data access consent UX | v1.1 | Helpan AI + product |

---

## 6. Test plan

Per Helpan AI DoD §7.4 Stage 3: Zero open Critical or High pen-test findings.

**Pre-Stage 1:** internal red-team review of authority issuance + validation flows, focused on §3.1 deepfake loop and §3.2 AiTM.

**Pre-Stage 2:** external pen-test commissioned. Scope: full rail surface + cross-rail dispatch.

**Pre-Stage 3:** all Critical and High findings closed. Threat model reviewed against findings; this document re-issued as v1.1 if findings surface new threats.

---

## 7. Authoritative source documents

1. Helpan AI Rail Design Instruction Pack v1.0 §13.1 H10
2. Helpan AI Design Reference v1.0 + Amendment §A.5 (scan threat catalogue)
3. Agentic AI Signal Scan (Chamia, 4 May 2026)
4. Scan Integration Memo v1.0
5. Helpan AI Delegated Authority Token Contract v1.0 (validation flow, error codes)
6. Reboot Pack v1.2 §9 (platform-wide standards), §10 (operator authentication)

---

*Helpan AI Rail · Threat Model v1.0 · 7 May 2026 · Kirimon Market Ventures · Confidential*
