/**
 * Quick post-H-8c verification of the live Supabase state. Read-only.
 *   npm exec tsx -- --env-file=.env scripts/verifyH8c.ts
 */
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const newScopes = (await sql`
    SELECT id, rail, category, per_scope_max_ttl_seconds
    FROM oauth_scopes
    WHERE id IN ('delivery.dispatch', 'discovery.query',
                 'kws.dns.write', 'kws.ssl.write', 'kws.mx.write',
                 'kws.domain.write', 'kws.uptime.write')
    ORDER BY id
  `) as unknown as readonly { id: string; rail: string; category: string; per_scope_max_ttl_seconds: number }[];

  console.warn(`oauth_scopes — new entries: ${newScopes.length}/7`);
  for (const s of newScopes) {
    console.warn(`  ${s.id.padEnd(22)} rail=${s.rail.padEnd(24)} cat=${s.category.padEnd(15)} ttl=${s.per_scope_max_ttl_seconds}s`);
  }

  const agentRow = (await sql`
    SELECT id, name, agent_class, owner_app_id, status
    FROM agents WHERE id = 'helpan-kws-v1'
  `) as unknown as readonly { id: string; name: string; agent_class: string; owner_app_id: string; status: string }[];

  console.warn(`\nagents — helpan-kws-v1: ${agentRow.length === 1 ? 'PRESENT' : 'MISSING'}`);
  if (agentRow[0]) {
    const a = agentRow[0];
    console.warn(`  id=${a.id} name="${a.name}" class=${a.agent_class} owner=${a.owner_app_id} status=${a.status}`);
  }

  const policyRow = (await sql`
    SELECT id, app_id, category_blacklist, audience_posture
    FROM safety_policies WHERE app_id = 'helpan-kws-v1'
  `) as unknown as readonly { id: string; app_id: string; category_blacklist: string[]; audience_posture: string }[];

  console.warn(`\nsafety_policies — helpan-kws-v1: ${policyRow.length === 1 ? 'PRESENT' : 'MISSING'}`);
  if (policyRow[0]) {
    const p = policyRow[0];
    console.warn(`  id=${p.id} blacklist=${JSON.stringify(p.category_blacklist)} posture=${p.audience_posture}`);
  }

  const auditRow = (await sql`
    SELECT id, action, actor_type, actor_id, agent_id, resource_id
    FROM audit_log
    WHERE action = 'agent.register' AND resource_id = 'helpan-kws-v1'
    ORDER BY created_at DESC LIMIT 1
  `) as unknown as readonly { id: string; action: string; actor_type: string; actor_id: string; agent_id: string; resource_id: string }[];

  console.warn(`\naudit_log — admission entry: ${auditRow.length === 1 ? 'PRESENT' : 'MISSING'}`);
  if (auditRow[0]) {
    const a = auditRow[0];
    console.warn(`  ${a.action} · ${a.actor_type}=${a.actor_id} · agent_id=${a.agent_id} · resource=${a.resource_id}`);
  }

  const chainLen = (await sql`
    SELECT count(*)::int AS n FROM audit_log WHERE action <> 'audit_log.genesis'
  `) as unknown as readonly { n: number }[];
  console.warn(`\naudit chain length (excl. genesis): ${chainLen[0]?.n ?? 0}`);
} finally {
  await sql.end({ timeout: 5 });
}
