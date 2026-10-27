# Helpan AI → Platform Operator — Kafka Provisioning Request v1

**From:** Helpan AI rail — build session
**To:** KMV platform operator (owner of shared infra), copy Identiti rail
**Date:** 2026-10-27
**Re:** One shared Kafka cluster for the platform. Helpan's `cascade` and `outbox` workers can't run without it.
**Status:** 🟡 OPEN — the single highest-leverage infra item. The same gap is Identiti's GAP-3.

---

## Why this is needed

There is **no Kafka broker anywhere on the platform** today. Kipkiren Pay's `KAFKA_BROKERS` is `localhost`, Todoku's is a placeholder, and Identiti's and Helpan's are empty. Every rail falls back to an in-memory or no-op producer, so **no cross-rail event is ever delivered**.

What that breaks on Helpan:

| Helpan piece | Without Kafka | Consequence |
|---|---|---|
| `cascade` worker (consumes `identiti.account.events`) | **exits at boot**, so not deployed | A suspended account, or a tier downgrade, does **not** auto-revoke that user's agent authorities. That's a safety gap: an agent keeps acting for a suspended account until its token expires. |
| `outbox` worker (publishes `helpan.*.events`) | sleeps; rows pile up in `kafka_outbox` | Kipkiren Pay, Todoku and the apps never hear `AUTHORITY_REVOKED`. The DoD's 5-second revocation-propagation SLA is unmeetable. |
| Deep health `kafka` component | `unavailable` | Monitoring can't tell real failure from "not wired". |

Elsewhere, from Identiti's RECAP GAP-3: OTP→SMS stays dead (Todoku never receives `STEP_UP_REQUIRED`), and Klokd can't consume tier or phone events.

No rail code is owed. **Helpan added SASL/TLS support on 27 Oct (commit `2416fe8`)**, Identiti already had it, and both read the **same variable names**.

---

## The ask

### 1. Provision one Kafka cluster reachable from all Railway projects

The rails live in **separate Railway projects**, so `*.railway.internal` private networking won't span them. The cluster needs a public endpoint with **SASL over TLS**.

**Recommendation: a managed serverless Kafka with SASL/SCRAM and TLS** (Redpanda Cloud Serverless or Confluent Cloud Basic). It's the least ops and it's Kafka-wire-compatible. Self-hosted Redpanda on Railway works too, but needs a TCP proxy plus SASL you configure yourself. Cloudflare Queues is **not** Kafka-compatible (confirmed in Identiti's RECAP), and Upstash discontinued its Kafka product.

### 2. Pre-create the topics

Every producer runs `allowAutoTopicCreation: false`.

| Topic | Producer | Consumers |
|---|---|---|
| `helpan.authority.events` | Helpan | KP, Todoku, apps |
| `helpan.action.events` | Helpan | apps, audit |
| `helpan.briefing.events` | Helpan | apps |
| `helpan.audit.events` | Helpan | audit / compliance |
| `identiti.account.events` | Identiti | **Helpan cascade**, KP, Klokd |
| `identiti.phone.events`, `identiti.kyc.events`, `identiti.kyb.events`, `identiti.consent.events`, `identiti.step_up.events` | Identiti | Todoku, KP, apps |

Partitions: 3 per topic is plenty for sandbox. Partition key is the account UUID; all rails use kafkajs `LegacyPartitioner`.

### 3. Create credentials and set the variables

Use one SASL user per rail so revocation stays per rail. Set these on each service:

```
KAFKA_BROKERS=<host:port[,host:port]>
KAFKA_SASL_MECHANISM=scram-sha-256        # or plain / scram-sha-512, per provider
KAFKA_SASL_USERNAME=<per-rail user>
KAFKA_SASL_PASSWORD=<per-rail password>
# KAFKA_SSL defaults to true when SASL is set — only set KAFKA_SSL=false for a plaintext broker
```

**Helpan, Railway project `incredible-communication`.** Set the variables on:
- `helpan_ai` (web): publishes inline when brokers are set.
- **New service `cascade`**, from repo `whyyam1/helpan_ai`, with `RAILPACK_START_CMD=node dist/workers/cascadeRevocation/index.js` and `DATABASE_URL=${{helpan_ai.DATABASE_URL}}`.
- **New service `outbox`**, from repo `whyyam1/helpan_ai`, with `RAILPACK_START_CMD=node dist/workers/kafkaOutbox/index.js` and `DATABASE_URL=${{helpan_ai.DATABASE_URL}}`.

Set `KAFKA_*` on the `cascade` and `outbox` services as references to `helpan_ai`'s, for example `${{helpan_ai.KAFKA_BROKERS}}`, so rotation stays a single edit.

**Identiti** service: the same five variables; see Identiti RECAP GAP-3.

---

## Done when

- `cascade` logs show it subscribed to `identiti.account.events`, and `outbox` logs `connected to brokers`.
- Suspending a sandbox account at Identiti revokes that account's Helpan authorities within seconds. The `authority.revoke` audit entry has `reason=account_suspended`.
- `kafka_outbox` drains to zero pending rows.

Helpan's session will run these checks once the variables are set.
