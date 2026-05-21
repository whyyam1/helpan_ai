/**
 * H-9 — Admit `helpan-klokd-v1` to the rail-side agent registry.
 *
 *   npm run db:seed:helpan-klokd
 *
 * Mirror of `scripts/seedHelpanKwsAdmission.ts` (H-8c). Stable id per
 * memory `project-stable-agent-ids` — KMV's Klokd backend references this
 * exact name when calling /v1/actions/dispatch on behalf of an employer or
 * worker.
 *
 * Safety policy per Per-App Patterns §1.6:
 *   - audience_posture       = 'general'
 *   - category_whitelist     = []  (open)
 *   - category_blacklist     = []  (open)
 *   - location_precision_floor = 'merchant_level'
 *
 * No category restrictions at v1.0 — content moderation is enforced
 * app-side per the spec. The Phase-2 path (auto-signup) gates on each
 * worker's explicit klokd.write.shift_signup authority; the safety policy
 * does not need to encode that.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { generateUlid } from '@kmv/platform-shared/ulid';
import { agents, safetyPolicies } from '../src/db/schema/index.js';
import { appendAuditEntry } from '../src/lib/auditWriter.js';

const AGENT_ID = 'helpan-klokd-v1';
const OWNER_APP_ID = 'klokd';
const BOOTSTRAP_OPERATOR_APP = 'lunchdrop'; // bootstrap admin tenant — see RECAP §1

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Source .env or pass it inline.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const db = drizzle(sql);

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
        name: 'Helpan Klokd',
        agentClass: 'portfolio_app',
        ownerAppId: OWNER_APP_ID,
        status: 'active',
        metadata: {
          sprint: 'H-9',
          phase: 'v1.0',
          capabilities: [
            'klokd.shift_search_briefings',
            'klokd.write.shift_signup',
            'klokd.write.shift_pay',
            'klokd.read.worker_reputation',
          ],
          source_pack: 'helpan-ai-per-app-integration-patterns-v1.md §1',
        },
      })
      .onConflictDoNothing({ target: agents.id });

    await tx
      .insert(safetyPolicies)
      .values({
        id: `sp_${generateUlid()}`,
        appId: AGENT_ID,
        categoryBlacklist: [],
        categoryWhitelist: [],
        contentModerationRules: [],
        audiencePosture: 'general',
        locationPrecisionFloor: 'merchant_level',
      })
      .onConflictDoNothing();

    await appendAuditEntry(tx as never, {
      actorType: 'operator',
      actorId: `app:${BOOTSTRAP_OPERATOR_APP}`,
      action: 'agent.register',
      resourceType: 'agent',
      resourceId: AGENT_ID,
      appId: BOOTSTRAP_OPERATOR_APP,
      requestId: `seed-helpan-klokd-${Date.now()}`,
      outcome: 'success',
      initiatedBy: 'human',
      agentId: AGENT_ID,
      detail: {
        agent_class: 'portfolio_app',
        owner_app_id: OWNER_APP_ID,
        admission_sprint: 'H-9',
        new_to_registry: beforeAgent.length === 0,
      },
    });
  });

  console.warn('[seed:helpan-klokd] helpan-klokd-v1 admission complete');
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
  console.error('[seed:helpan-klokd] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
