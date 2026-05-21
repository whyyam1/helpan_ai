/**
 * H-12 — Admit `helpan-family-discovery-v1` to the rail-side agent registry.
 *
 *   npm run db:seed:helpan-family-discovery
 *
 * Last per-app sprint. Agent-native from day one (Per-App Patterns §4.1) —
 * the agent IS the primary interaction model. Stable name per memory
 * `project-stable-agent-ids`. Brand name TBD per §4.8; the rail-side
 * identifier stays `helpan-family-discovery-v1` and the owner_app_id is
 * `family_discovery` per the spec's literal placeholder. Search-and-
 * replace these when the brand locks (before Stage 2).
 *
 * Safety policy per §4.6 — the only `family_friendly` audience in the
 * portfolio:
 *   - audience_posture       = 'family_friendly'
 *   - category_whitelist     = food / household / baby / school / basic-clothing
 *   - category_blacklist     = nightlife / alcohol / adult content
 *   - location_precision_floor = 'merchant_level'
 *
 * User-to-user agent communication is disabled (§4.6) — that constraint
 * is policy-level; no column carries it. Sentinel in the agent metadata.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { generateUlid } from '@kmv/platform-shared/ulid';
import { agents, safetyPolicies } from '../src/db/schema/index.js';
import { appendAuditEntry } from '../src/lib/auditWriter.js';

const AGENT_ID = 'helpan-family-discovery-v1';
const OWNER_APP_ID = 'family_discovery';
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
        name: 'Helpan [App Name] (family-discovery)',
        agentClass: 'portfolio_app',
        ownerAppId: OWNER_APP_ID,
        status: 'active',
        metadata: {
          sprint: 'H-12',
          phase: 'v1.0',
          posture: 'agent_native',
          brand_name_locked: false, // §4.8 — TBD until Stage 2
          capabilities: [
            'family_discovery.fresh_arrivals_briefings',
            'family_discovery.basket_auto_refill_briefings',
            'family_discovery.write.basket',
            'family_discovery.read.discovery',
          ],
          user_to_user_agent_comms: 'disabled', // §4.6
          mmf_rebalance_posture: 'not_applicable',
          source_pack: 'helpan-ai-per-app-integration-patterns-v1.md §4',
        },
      })
      .onConflictDoNothing({ target: agents.id });

    await tx
      .insert(safetyPolicies)
      .values({
        id: `sp_${generateUlid()}`,
        appId: AGENT_ID,
        categoryWhitelist: [
          'food',
          'household',
          'baby_goods',
          'school_supplies',
          'basic_clothing',
        ],
        categoryBlacklist: ['nightlife', 'alcohol', 'adult_content'],
        contentModerationRules: [
          // Sentinel — actual moderation runs app-side per §4.6 "strict
          // text + image moderation". This row marks intent.
          { kind: 'text_strict', enforce: 'app_side' },
          { kind: 'image_strict', enforce: 'app_side' },
        ],
        audiencePosture: 'family_friendly',
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
      requestId: `seed-helpan-family-discovery-${Date.now()}`,
      outcome: 'success',
      initiatedBy: 'human',
      agentId: AGENT_ID,
      detail: {
        agent_class: 'portfolio_app',
        owner_app_id: OWNER_APP_ID,
        admission_sprint: 'H-12',
        audience_posture: 'family_friendly',
        new_to_registry: beforeAgent.length === 0,
      },
    });
  });

  console.warn('[seed:helpan-family-discovery] helpan-family-discovery-v1 admission complete');
  console.warn(
    `  agents row    : ${beforeAgent.length === 0 ? 'CREATED' : 'already present (unchanged)'}`
  );
  console.warn(
    `  safety policy : ${beforePolicy.length === 0 ? 'CREATED' : 'already present (unchanged)'}`
  );
  console.warn(`  audit_log     : appended ${beforeAgent.length === 0 ? 'first-admission' : 're-run'} entry`);
} catch (err) {
  console.error('[seed:helpan-family-discovery] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
