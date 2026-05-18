# Migrations

Hand-authored SQL, registered with Drizzle's runtime migrator via `meta/_journal.json`. Order and grouping match `helpan-ai-schema-erd-v1.md` §5 exactly.

| File | Tables | Lands |
|---|---|---|
| `0001_universal_tables.sql` | `app_credentials`, `idempotency_keys`, `audit_log`, `kafka_offsets`, `webhook_deliveries`. Plus pgcrypto + audit-log genesis row. | First — required by every authenticated request |
| `0002_oauth_scopes.sql` | `oauth_scopes` + canonical scope seed | Second — `agents` and `app_credentials` reference scope IDs |
| `0003_agents_safety.sql` | `agents`, `safety_policies` | After scopes (FKs from agents to oauth_scopes are read-time only, not declared) |
| `0004_briefings_events.sql` | `briefings`, `events_ingested`, `briefing_matches` | After agents (briefings.agent_id FK) |
| `0005_authorities_actions.sql` | `delegated_authorities`, `authority_usage`, `actions` | After agents + scopes (FKs) |
| `0006_rls_policies.sql` | RLS enabled on briefings, delegated_authorities, actions, audit_log | Last — references columns from 0003–0005 |

## Why hand-authored, not `drizzle-kit generate`

drizzle-kit can't express:

- The audit-log genesis row (a literal INSERT for hash-chain integrity).
- `CREATE EXTENSION pgcrypto` (required for the genesis hash).
- Row-Level Security `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` statements.
- The OAuth scope catalogue seed.
- Hand-written constraint names that match `helpan-ai-schema-erd-v1.md` exactly.

The Drizzle ORM schema in `../schema/` is the source of truth for **type-safe queries**. The SQL files in this directory are the source of truth for **what's actually in the database**. Run `npm run db:check` to detect drift.

## Adding a new migration

1. Add the next file: `0007_<short_name>.sql`.
2. Append a corresponding entry to `meta/_journal.json` with `idx: 6` and a fresh `when` timestamp (epoch ms).
3. If the change touches tables that the Drizzle schema models, update `../schema/<table>.ts` to match.
4. Run `npm run db:migrate` against a fresh local Postgres to verify the migration applies cleanly.
