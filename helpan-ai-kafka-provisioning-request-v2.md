# KMV Platform Kafka — Provisioning Guide v2

**From:** Helpan AI rail — build session
**To:** KMV platform operator. Copies to Identiti, Kipkiren Pay, Todoku and Klokd for their own steps (§7).
**Date:** 2026-10-28
**Supersedes:** v1 (27 Oct). v2 adds Klokd's review: one login per service with least-privilege access, EU region, a Klokd bridge, the move off kafkajs, and the topic plan written down first.
**Status:** 🟡 OPEN — critical infrastructure blocker.

---

## 0. Why

There is no Kafka broker on the platform. Every event a rail publishes is discarded. Consequences:

- **Helpan:** a suspended account keeps its agent authorities until the tokens expire, because the `cascade` worker can't run. Revocation events sit in `kafka_outbox`, so the 5-second propagation SLA is unmeetable.
- **Identiti → Todoku:** `STEP_UP_REQUIRED` never arrives, so OTP-by-SMS can't work.
- **Klokd:** tier, suspension and phone changes never arrive. On 8 Oct this silently broke Klokd's Hakken registration.

No rail needs code changes to *connect*. Identiti, Kipkiren Pay, Todoku and Helpan all read the same `KAFKA_*` variables and support SASL over TLS.

---

## 1. Decisions (already made — follow these)

| Item | Decision | Why |
|---|---|---|
| Provider | **Confluent Cloud, Basic cluster** | Managed, Kafka-wire-compatible, per-service accounts with ACLs on Basic, and it maintains the client library the rails are moving to (§6). |
| Region | **AWS `eu-west-1` (Ireland)**, single zone | Same region as every rail's Supabase database. Data stays in-region. |
| Auth | **SASL/PLAIN over TLS** with one API key per service account | Confluent's standard. `KAFKA_SSL` defaults on when SASL is set. |
| Accounts | **One service account per rail, least privilege** (§4) | After the Railway breach, a leaked Kafka secret must expose only one rail's streams, not all of them. |
| Topic creation | **Pre-create every topic; no auto-create** | All producers run `allowAutoTopicCreation: false`. |
| Partitions | **3 per topic** | Ample for sandbox and closed beta. The key is the account UUID, so one account's events stay ordered. |

---

## 2. Create the cluster

1. Go to confluent.cloud and create the organisation, or use the existing one. Create an **Environment** named `kmv-platform`.
2. **Add cluster** → **Basic** → **AWS** → **`eu-west-1`** → single zone. Name it `kmv-events`.
3. Open the cluster, go to **Cluster settings**, and copy the **Bootstrap server**, e.g. `pkc-xxxxx.eu-west-1.aws.confluent.cloud:9092`. That's `KAFKA_BROKERS` for every service.
4. Don't create a "Global access" API key. Every key in this guide belongs to a service account (§4).

---

## 3. Topic plan

Create these topics under **Topics → Add topic**: 3 partitions, cleanup policy `delete`, and the retention shown.

| Topic | Written by | Read by (consumer group) | Retention |
|---|---|---|---|
| `identiti.account.events` | Identiti | Helpan `helpan.identiti.account.events.consumer` · KP `kp.identiti.account.events.consumer` · Todoku `todoku.identiti.account.events.consumer` · Klokd `klokd.identiti.account.events.consumer` | 7 days |
| `identiti.phone.events` | Identiti | KP `kp.identiti.phone.events.consumer` · Todoku `todoku.identiti.phone.events.consumer` · Klokd `klokd.identiti.phone.events.consumer` | 7 days |
| `identiti.step_up.events` | Identiti | Todoku `todoku.identiti.step_up.events.consumer` | 1 day (OTP is short-lived) |
| `identiti.kyc.events` | Identiti | — (none yet) | 7 days |
| `identiti.kyb.events` | Identiti | — | 7 days |
| `identiti.consent.events` | Identiti | — | 7 days |
| `kp.payment.events` | Kipkiren Pay | — | 7 days |
| `kp.payout.events` | Kipkiren Pay | Klokd `klokd.kp.payout.events.consumer` | 7 days |
| `kp.wallet.events` | Kipkiren Pay | — (Chapaa round-up, later) | 7 days |
| `kp.charge.events` | Kipkiren Pay | — | 7 days |
| `kp.goal.events` | Kipkiren Pay | — | 7 days |
| `kp.probe.events` | Kipkiren Pay | — (health probe) | 1 day |
| `todoku.delivery.events` | Todoku | — | 7 days |
| `helpan.authority.events` | Helpan | — (KP / Todoku revocation listeners, later) | 7 days |
| `helpan.action.events` | Helpan | — | 7 days |
| `helpan.briefing.events` | Helpan | — | 7 days |
| `helpan.audit.events` | Helpan | — | 30 days |

That's 17 topics. The database of each rail is the system of record; Kafka is a delivery channel, so 7 days just has to cover an outage. A new consumer starts from *new* events (`fromBeginning: false`), so retention doesn't affect first boot.

---

## 4. Service accounts, keys and ACLs

Under **Accounts & access → Service accounts**, create five accounts: **`sa-identiti`, `sa-kp`, `sa-todoku`, `sa-helpan`, `sa-klokd`**. Create **one cluster API key per account** (key = `KAFKA_SASL_USERNAME`, secret = `KAFKA_SASL_PASSWORD`).

Then add the ACLs (**cluster → ACLs → Add ACL** for that service account). "Prefixed" means the rule covers every topic or group whose name starts with that string.

| Account | ALLOW on topics | ALLOW on consumer groups |
|---|---|---|
| `sa-identiti` | **WRITE, DESCRIBE** — prefixed `identiti.` | none |
| `sa-kp` | **WRITE, DESCRIBE** — prefixed `kp.` · **READ, DESCRIBE** — literal `identiti.account.events`, `identiti.phone.events` | **READ** — prefixed `kp.` |
| `sa-todoku` | **WRITE, DESCRIBE** — prefixed `todoku.` · **READ, DESCRIBE** — literal `identiti.step_up.events`, `identiti.phone.events`, `identiti.account.events` | **READ** — prefixed `todoku.` |
| `sa-helpan` | **WRITE, DESCRIBE** — prefixed `helpan.` · **READ, DESCRIBE** — literal `identiti.account.events` | **READ** — prefixed `helpan.` |
| `sa-klokd` | **READ, DESCRIBE** — literal `identiti.account.events`, `identiti.phone.events`, `kp.payout.events` | **READ** — prefixed `klokd.` |

- No account gets WRITE on another rail's prefix, and none gets cluster-level ALTER or CREATE.
- If a producer logs `ClusterAuthorizationFailed` on connect, add **IDEMPOTENT_WRITE on the cluster** for that account. The rails' producers are idempotent; current brokers only need topic WRITE, but older defaults also want this.
- Store each secret **only** in that rail's Railway variables. Never put it in a chat, a doc or a repo.

---

## 5. Railway variables — exact

Every service that touches Kafka gets these four, with its own rail's key:

```
KAFKA_BROKERS=pkc-xxxxx.eu-west-1.aws.confluent.cloud:9092
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME=<that rail's API key>
KAFKA_SASL_PASSWORD=<that rail's API secret>
```

`KAFKA_SSL` is not needed; it turns on automatically with SASL.

### Helpan (project `incredible-communication`)

1. **`helpan_ai`** (web): set the four variables above with `sa-helpan`'s key.
2. **New service `cascade`**: **+ Add → GitHub repo → `whyyam1/helpan_ai`**, rename it `cascade`, then set:
   ```
   RAILPACK_START_CMD=node dist/workers/cascadeRevocation/index.js
   DATABASE_URL=${{helpan_ai.DATABASE_URL}}
   KAFKA_BROKERS=${{helpan_ai.KAFKA_BROKERS}}
   KAFKA_SASL_MECHANISM=${{helpan_ai.KAFKA_SASL_MECHANISM}}
   KAFKA_SASL_USERNAME=${{helpan_ai.KAFKA_SASL_USERNAME}}
   KAFKA_SASL_PASSWORD=${{helpan_ai.KAFKA_SASL_PASSWORD}}
   ```
3. **New service `outbox`**: same repo, same five reference variables, and `RAILPACK_START_CMD=node dist/workers/kafkaOutbox/index.js`.

   Without `RAILPACK_START_CMD`, Railway boots the web server and the service crashes with `Missing required environment variable: AUTH_RAIL_PREFIX`. That's how the reaper failed on 26 Oct.

### Other rails

| Rail | Services that need the four variables | Account |
|---|---|---|
| Identiti | the Identiti service | `sa-identiti` |
| Kipkiren Pay | `kipkiren-pay-api` and `kipkiren-pay-worker` (use `${{kipkiren-pay-api.KAFKA_*}}` references on the worker) | `sa-kp` |
| Todoku | the API service and its worker | `sa-todoku` |
| Klokd | the new bridge service (§7) | `sa-klokd` |

Kipkiren Pay's local `.env` has `KAFKA_BROKERS=localhost:9092` and Todoku's has `placeholder:9092`. Those are local values only; Railway is what counts.

---

## 6. Order of switch-on

Consumers start from new events, so **turn on readers before writers**, or the first events are lost to them:

1. Cluster, topics and ACLs (§2–§4).
2. **Readers first:** Helpan `cascade`, then Kipkiren Pay and Todoku workers, then the Klokd bridge.
3. **Writers:** Helpan `helpan_ai` + `outbox` (the outbox drains its backlog on connect), then Kipkiren Pay and Todoku APIs, then **Identiti last**.
4. Run the checks in §8.

---

## 7. Per-rail follow-ups (for each rail's own session)

- **Klokd:** octopus-api has no Kafka client. Build the **bridge** Klokd proposed:
  - A small worker in the octopus-api repo, deployed as its own Railway service.
  - It consumes `identiti.account.events`, `identiti.phone.events` and `kp.payout.events`, using groups prefixed `klokd.`.
  - It forwards each event to octopus-api's existing signed webhook handlers. The API process stays Kafka-free.
  - It uses `sa-klokd`'s key.
- **Client library (all rails):** kafkajs is unmaintained. **Helpan has moved to `@confluentinc/kafka-javascript` 1.11.0**, Confluent's maintained client with a KafkaJS-compatible API. Identiti, Kipkiren Pay and Todoku should switch before real traffic, each in its own session. It's mostly an import change; Helpan's migration commit is the reference.
- **Identiti:** nothing beyond §5. `KafkaJsEventProducer` activates as soon as `KAFKA_BROKERS` is set.

---

## 8. Done when (Helpan runs these)

1. The `cascade` log shows it subscribed to `identiti.account.events`, and the `outbox` log shows `connected to brokers`.
2. `kafka_outbox` drains to zero pending rows.
3. Suspending a sandbox account at Identiti revokes that account's Helpan authorities within seconds, with an `authority.revoke` audit entry and `reason=account_suspended`. `npm run audit:verify` stays CHAIN INTACT.
4. Helpan's deep health reports `kafka: healthy`.
5. **ACL spot-check:** using `sa-helpan`'s key, a write to `identiti.account.events` is **denied**.

---

## 9. Rotation (post-breach)

To rotate a rail's key:
1. Create a second API key for the same service account.
2. Update that rail's Railway `KAFKA_SASL_USERNAME` / `KAFKA_SASL_PASSWORD` (references update the workers too) and redeploy.
3. Confirm consumers reconnect.
4. **Delete the old key.**

Rotate one rail at a time; the other rails are unaffected.
