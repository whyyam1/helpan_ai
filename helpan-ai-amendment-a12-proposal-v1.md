# Proposed Amendment §A.12 — Helpan AI v1.0 contract reconciliation

**From:** Helpan AI rail — build session
**To:** Platform Rails Reboot Pack v1.2 owner (Amendment §A register)
**Date:** 2026-10-27
**Status:** 🟡 PROPOSED. Helpan's own docs (`helpan-ai-openapi-v1.yaml` v1.0.1, `helpan-ai-delegated-authority-contract-v1.md`) are already updated to match. This entry records the changes in the platform register.

Each item records a place where the v1.0 spec and the live rail disagreed. In every case the rail's behaviour is the deliberate, tested one, and the spec is brought into line. **No rail code changes.**

| # | Topic | Spec said | v1.0 behaviour (now in spec) | Source |
|---|---|---|---|---|
| 1 | Agent id shape | `^agt_<ULID>$` only | `^[a-zA-Z0-9_-]{1,128}$`. Stable cross-rail names (`helpan-klokd-v1`, `helpan-kws-v1`, …) are valid alongside minted `agt_<ULID>` ids. | RECAP §6.20; rail `1da0aca` |
| 2 | Validate `intended_operation` | Example used an operation name (`kipkiren_pay.payment.execute`) | Must be the **exact scope ID** (e.g. `kipkiren.write.payments`). No operation→scope resolver in v1.0. | RECAP §6.15; KP `f37a18c` |
| 3 | `amount_minor` on the wire | Integer in the schema, but some callers sent strings | JSON **integer** only. The rail runs without type coercion, so a string gets 400. | Contract §4.4; KP `f37a18c` |
| 4 | Revoke an expired authority | Contract §7.3: "410 … but still 200" (self-contradictory) | **409 `AUTHORITY_EXPIRED`**, grouped with already-revoked (409). | RECAP §6.16 |
| 5 | Usage accounting | Unspecified | Dispatch consumes per-period budget **before** the outbound call. A target-rail rejection still counts; validate never counts. | RECAP §6.22; §A.1 |
| 6 | `/briefings/*` auth | HMAC, customer JWT or service JWT | Identiti **customer JWT only**. | RECAP §6.2 |
| 7 | `GET /oauth/scopes` | Public (`security: []`) | **HMAC**. The shared auth plugin exempts by path, not method, and `POST` on that path is admin-only. Anonymous discovery is a v1.1 candidate. | RECAP §6.11 |
| 8 | Dispatch targets | `kipkiren_pay`, `identiti`, `todoku` | Adds **`klokd`**, which executes Klokd-native scopes at `POST /api/v1/agents/dispatch/{operation}` and is signed `Helpan-HMAC-SHA256`. | rail `3e20fee`, migration 0017 |
| 9 | Outbound dispatch auth | One shared timestamp header | Per-target-rail scheme and header: `KipkirenPay` / `x-kipkirenpay-timestamp`, `Todoku` / `x-todoku-timestamp`, `Identiti` / `x-identiti-timestamp`, `Helpan` / `x-helpan-timestamp` (Klokd). | rail `3e445f9` |
| 10 | Safety policy create | `PUT /operator/safety-policies/{id}` only | Adds `POST /operator/safety-policies`. The rail mints the `sfp_` id; one policy per app. | RECAP §6.12; rail `c19ac19` |

**Ask:** add these to the Amendment §A register as §A.12, and propagate items 2, 3, 8 and 9 to the KP, Todoku and App Integration Guide references the next time they're revised.
