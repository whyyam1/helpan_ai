/**
 * Health-check business logic.
 *
 * H-5 wires real probes for `briefings`, `events_ingest`, and `kafka`.
 * Other components stay `unavailable` because they are genuinely not
 * wired yet:
 *   - Identiti:  H4 joint contract pending (H-3)
 *   - KP:        KP-8 (delegated authority validator) pending
 *   - Todoku:    relying-party plumbing lands in H-4
 *   - LLM:       provider open per Confirmation Memo §5.8
 *
 * Worst component status wins for the rolled-up `status`. `ok` is true
 * iff the rolled-up status is `healthy`.
 */

import type { Sql } from '../../db/client.js';
import type { ComponentStatus, DeepHealthResponse } from './schemas.js';

const PROBE_TIMEOUT_MS = 1500;

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race<T>([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} probe timeout`)), PROBE_TIMEOUT_MS);
    }),
  ]);
}

async function probeDatabase(sql: Sql): Promise<ComponentStatus> {
  try {
    await withTimeout(sql`SELECT 1`, 'database');
    return 'healthy';
  } catch {
    return 'unavailable';
  }
}

async function probeBriefings(sql: Sql): Promise<ComponentStatus> {
  try {
    await withTimeout(sql`SELECT 1 FROM briefings LIMIT 1`, 'briefings');
    return 'healthy';
  } catch {
    return 'unavailable';
  }
}

async function probeEventsIngest(sql: Sql): Promise<ComponentStatus> {
  try {
    await withTimeout(sql`SELECT 1 FROM events_ingested LIMIT 1`, 'events_ingest');
    return 'healthy';
  } catch {
    return 'unavailable';
  }
}

async function probeAuthorities(sql: Sql): Promise<ComponentStatus> {
  try {
    await withTimeout(sql`SELECT 1 FROM delegated_authorities LIMIT 1`, 'authorities');
    return 'healthy';
  } catch {
    return 'unavailable';
  }
}

function rollUp(components: Record<string, ComponentStatus | undefined>): ComponentStatus {
  let worst: ComponentStatus = 'healthy';
  for (const status of Object.values(components)) {
    if (status === 'unavailable') return 'unavailable';
    if (status === 'degraded') worst = 'degraded';
  }
  return worst;
}

export interface DeepHealthDeps {
  readonly sql: Sql;
  /**
   * Truthy when a producer was registered. The rail does not pulse-poll
   * the broker — `kafka.publish` failures are surfaced to callers
   * synchronously. This probe reports `healthy` iff a producer is wired,
   * `unavailable` otherwise.
   */
  readonly hasKafkaProducer: boolean;
}

export async function gatherDeepHealth(deps: DeepHealthDeps): Promise<DeepHealthResponse> {
  const [database, briefings, eventsIngest, authorities] = await Promise.all([
    probeDatabase(deps.sql),
    probeBriefings(deps.sql),
    probeEventsIngest(deps.sql),
    probeAuthorities(deps.sql),
  ]);
  const components: DeepHealthResponse['components'] = {
    database,
    briefings,
    events_ingest: eventsIngest,
    authorities,
    kafka: deps.hasKafkaProducer ? 'healthy' : 'unavailable',
    identiti: 'unavailable',
    kipkiren_pay: 'unavailable',
    todoku: 'unavailable',
    llm_provider: 'unavailable',
  };

  const status = rollUp(components);
  return {
    ok: status === 'healthy',
    status,
    components,
  };
}
