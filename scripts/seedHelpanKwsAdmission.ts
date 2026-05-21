/**
 * H-8c — Admit `helpan-kws-v1` to the Helpan AI rail-side agent registry.
 *
 *   npm run db:seed:helpan-kws
 *
 * Closes McKinsey P1 + Reboot Pack §14 open CEO action per the 21 May 2026
 * newdocs pack (NEWDOCS_INSTRUCTION_PACK.md §H-8c).
 *
 * Three rows in one transaction:
 *   1. `agents` — id LITERAL `helpan-kws-v1` (NOT the `agt_<ULID>` convention).
 *      The agent ID is the stable cross-rail identifier KWS-S9-001 references
 *      explicitly; the rail accepts this exception because the audit
 *      `agent_id` column needs to be a forensic-friendly name across rails.
 *   2. `safety_policies` — Phase 1 is enrichment-only; blacklist `write_money`
 *      so Phase 1 cannot dispatch payments even if a future scope wire-up
 *      tries to issue an authority for one.
 *   3. `audit_log` — chained entry recording the admission with operator
 *      actor (the bootstrap admin tenant) and the §A.11 indexed `agent_id`
 *      populated.
 *
 * Idempotent — re-running once admitted is a no-op on agents/safety_policies
 * (ON CONFLICT DO NOTHING) and writes a fresh audit row each time (audit log
 * is append-only by design; re-running is observable in the chain).
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { generateUlid } from '@kmv/platform-shared/ulid';
import { agents, safetyPolicies } from '../src/db/schema/index.js';
import { appendAuditEntry } from '../src/lib/auditWriter.js';

const AGENT_ID = 'helpan-kws-v1';
const OWNER_APP_ID = 'kipkiren_web_services';
const BOOTSTRAP_OPERATOR_APP = 'lunchdrop'; // first-tenant admin per H-1/H-6

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Source .env or pass it inline.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const db = drizzle(sql);

  // Check existence so we can report what changed.
  const beforeAgent = (await sql`
    SELECT id FROM agents WHERE id = ${AGENT_ID}
  `) as unknown as readonly { id: string }[];
  const beforePolicy = (await sql`
    SELECT id FROM safety_policies WHERE app_id = ${AGENT_ID}
  `) as unknown as readonly { id: string }[];

  await db.transaction(async (tx) => {
    await tx
      .insert(agents)
      .values({
        id: AGENT_ID,
        name: 'Helpan KWS',
        agentClass: 'portfolio_app',
        ownerAppId: OWNER_APP_ID,
        status: 'active',
        metadata: {
          sprint: 'H-8c',
          phase: 'phase_1_enrichment',
          source_pack: 'helpan_kws_instruction_pack v1',
          admission_pack: 'NEWDOCS_INSTRUCTION_PACK.md (21 May 2026)',
          // Capabilities ship at H-8d (Phase 1 enrichment runner); Phase 2
          // (autonomous DNS/SSL/MX/domain/uptime) gated on H-4 + ADR-KWS-002.
          capabilities_at_admission: 'paper-only',
        },
      })
      .onConflictDoNothing({ target: agents.id });

    await tx
      .insert(safetyPolicies)
      .values({
        id: `sp_${generateUlid()}`,
        appId: AGENT_ID,
        // Phase 1 = enrichment only. Block write_money outright; Phase 2's
        // autonomous-execution path must come back through a deliberate
        // safety-policy update (ADR-KWS-002).
        categoryBlacklist: ['write_money'],
        categoryWhitelist: [],
        contentModerationRules: [],
        audiencePosture: 'general',
      })
      .onConflictDoNothing();

    await appendAuditEntry(tx as never, {
      actorType: 'operator',
      actorId: `app:${BOOTSTRAP_OPERATOR_APP}`,
      action: 'agent.register',
      resourceType: 'agent',
      resourceId: AGENT_ID,
      appId: BOOTSTRAP_OPERATOR_APP,
      requestId: `seed-helpan-kws-${Date.now()}`,
      outcome: 'success',
      initiatedBy: 'human',
      // §A.11: agent_id is the agent that was *acted upon* here — the
      // forensic value of putting it in the indexed column is so cross-rail
      // audit reconciliation by KWS-side mirror finds this entry.
      agentId: AGENT_ID,
      detail: {
        agent_class: 'portfolio_app',
        owner_app_id: OWNER_APP_ID,
        admission_sprint: 'H-8c',
        source_pack: 'NEWDOCS_INSTRUCTION_PACK.md (21 May 2026)',
        new_to_registry: beforeAgent.length === 0,
      },
    });
  });

  console.warn('[seed:helpan-kws] helpan-kws-v1 admission complete');
  console.warn(
    `  agents row    : ${beforeAgent.length === 0 ? 'CREATED' : 'already present (unchanged)'}`
  );
  console.warn(
    `  safety policy : ${
      beforePolicy.length === 0 ? 'CREATED' : 'already present (unchanged)'
    }`
  );
  console.warn(`  audit_log     : appended ${beforeAgent.length === 0 ? 'first-admission' : 're-run'} entry`);
} catch (err) {
  console.error('[seed:helpan-kws] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
