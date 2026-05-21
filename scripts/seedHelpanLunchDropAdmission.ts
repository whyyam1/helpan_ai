/**
 * H-10 — Admit `helpan-lunchdrop-v1` to the rail-side agent registry.
 *
 *   npm run db:seed:helpan-lunchdrop
 *
 * Mirror of `scripts/seedHelpanKlokdAdmission.ts` (H-9). Stable id per
 * memory `project-stable-agent-ids` — Lunch Drop's backend references this
 * exact name on dispatch.
 *
 * Safety policy per Per-App Patterns §2.6:
 *   - audience_posture       = 'general'
 *   - category_whitelist     = ['food']  (sentinel — Lunch Drop's
 *                                          actual menu categories live
 *                                          app-side; this row asserts
 *                                          the agent operates inside
 *                                          food semantics)
 *   - category_blacklist     = []
 *   - location_precision_floor = 'merchant_level'
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { generateUlid } from '@kmv/platform-shared/ulid';
import { agents, safetyPolicies } from '../src/db/schema/index.js';
import { appendAuditEntry } from '../src/lib/auditWriter.js';

const AGENT_ID = 'helpan-lunchdrop-v1';
const OWNER_APP_ID = 'lunchdrop';
const BOOTSTRAP_OPERATOR_APP = 'lunchdrop';

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
        name: 'Helpan Lunch Drop',
        agentClass: 'portfolio_app',
        ownerAppId: OWNER_APP_ID,
        status: 'active',
        metadata: {
          sprint: 'H-10',
          phase: 'v1.0',
          capabilities: [
            'lunchdrop.weekly_plan_briefings',
            'lunchdrop.write.orders',
            'lunchdrop.read.zone_feed',
          ],
          source_pack: 'helpan-ai-per-app-integration-patterns-v1.md §2',
        },
      })
      .onConflictDoNothing({ target: agents.id });

    await tx
      .insert(safetyPolicies)
      .values({
        id: `sp_${generateUlid()}`,
        appId: AGENT_ID,
        categoryWhitelist: ['food'],
        categoryBlacklist: [],
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
      requestId: `seed-helpan-lunchdrop-${Date.now()}`,
      outcome: 'success',
      initiatedBy: 'human',
      agentId: AGENT_ID,
      detail: {
        agent_class: 'portfolio_app',
        owner_app_id: OWNER_APP_ID,
        admission_sprint: 'H-10',
        new_to_registry: beforeAgent.length === 0,
      },
    });
  });

  console.warn('[seed:helpan-lunchdrop] helpan-lunchdrop-v1 admission complete');
  console.warn(
    `  agents row    : ${beforeAgent.length === 0 ? 'CREATED' : 'already present (unchanged)'}`
  );
  console.warn(
    `  safety policy : ${beforePolicy.length === 0 ? 'CREATED' : 'already present (unchanged)'}`
  );
  console.warn(`  audit_log     : appended ${beforeAgent.length === 0 ? 'first-admission' : 're-run'} entry`);
} catch (err) {
  console.error('[seed:helpan-lunchdrop] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
