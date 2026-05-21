/**
 * H-11 — Admit `helpan-chapaa-v1` to the rail-side agent registry.
 *
 *   npm run db:seed:helpan-chapaa
 *
 * Highest-stakes integration in the portfolio (Per-App Patterns §3.1).
 * Stable name per memory `project-stable-agent-ids`.
 *
 * Safety policy per §3.6 — strict behavioural-data containment is enforced
 * primarily via the scope catalogue (`chapaa.read.behavioural` has
 * `default_grantable=FALSE` and `elevation_friction='high'`) and the
 * Console behavioural-friction screen (deferred per RECAP §6.19). The
 * safety_policies row documents the intent:
 *
 *   - audience_posture       = 'general'
 *   - category_whitelist     = ['savings', 'financial_wellness']
 *   - category_blacklist     = ['behavioural_aggregate_export'] (sentinel
 *                                 marking the §3.6 cross-app default-block)
 *   - location_precision_floor = 'neighbourhood_level' (savings activity is
 *                                 not location-coupled at this resolution)
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { generateUlid } from '@kmv/platform-shared/ulid';
import { agents, safetyPolicies } from '../src/db/schema/index.js';
import { appendAuditEntry } from '../src/lib/auditWriter.js';

const AGENT_ID = 'helpan-chapaa-v1';
const OWNER_APP_ID = 'chapaa';
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
        name: 'Helpan Chapaa',
        agentClass: 'portfolio_app',
        ownerAppId: OWNER_APP_ID,
        status: 'active',
        metadata: {
          sprint: 'H-11',
          phase: 'v1.0',
          stakes: 'highest-portfolio',
          capabilities: [
            'chapaa.goal_acceleration_briefings',
            'chapaa.round_up_offer_briefings',
            'chapaa.write.deposit',
            'chapaa.read.credit_unlock_status',
            'chapaa.read.goals',
            'chapaa.read.behavioural', // friction-screen scope (§4.2 Console spec)
          ],
          mmf_rebalance_posture: 'suggest_only_v1_0',
          source_pack: 'helpan-ai-per-app-integration-patterns-v1.md §3',
        },
      })
      .onConflictDoNothing({ target: agents.id });

    await tx
      .insert(safetyPolicies)
      .values({
        id: `sp_${generateUlid()}`,
        appId: AGENT_ID,
        categoryWhitelist: ['savings', 'financial_wellness'],
        categoryBlacklist: ['behavioural_aggregate_export'],
        contentModerationRules: [],
        audiencePosture: 'general',
        locationPrecisionFloor: 'neighbourhood_level',
      })
      .onConflictDoNothing();

    await appendAuditEntry(tx as never, {
      actorType: 'operator',
      actorId: `app:${BOOTSTRAP_OPERATOR_APP}`,
      action: 'agent.register',
      resourceType: 'agent',
      resourceId: AGENT_ID,
      appId: BOOTSTRAP_OPERATOR_APP,
      requestId: `seed-helpan-chapaa-${Date.now()}`,
      outcome: 'success',
      initiatedBy: 'human',
      agentId: AGENT_ID,
      detail: {
        agent_class: 'portfolio_app',
        owner_app_id: OWNER_APP_ID,
        admission_sprint: 'H-11',
        stakes: 'highest-portfolio',
        new_to_registry: beforeAgent.length === 0,
      },
    });
  });

  console.warn('[seed:helpan-chapaa] helpan-chapaa-v1 admission complete');
  console.warn(
    `  agents row    : ${beforeAgent.length === 0 ? 'CREATED' : 'already present (unchanged)'}`
  );
  console.warn(
    `  safety policy : ${beforePolicy.length === 0 ? 'CREATED' : 'already present (unchanged)'}`
  );
  console.warn(`  audit_log     : appended ${beforeAgent.length === 0 ? 'first-admission' : 're-run'} entry`);
} catch (err) {
  console.error('[seed:helpan-chapaa] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
