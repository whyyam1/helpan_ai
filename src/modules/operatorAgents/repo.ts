/**
 * Drizzle data-access for `agents`.
 *
 * No RLS on this table — agents are platform-owned, not account-owned.
 * Access is gated at the route layer by `requireAdminScope`.
 */

import { eq } from 'drizzle-orm';
import { agents } from '../../db/schema/agents.js';
import type { Db } from '../../db/client.js';
import type { AgentClass, AgentStatus } from './schemas.js';

export interface AgentRow {
  id: string;
  name: string;
  agentClass: AgentClass;
  ownerAppId: string | null;
  thirdPartyOauthClientId: string | null;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
  suspendedAt: Date | null;
  retiredAt: Date | null;
}

export interface InsertAgentInput {
  id: string;
  name: string;
  agentClass: AgentClass;
  ownerAppId?: string | null;
  thirdPartyOauthClientId?: string | null;
}

export async function insertAgent(db: Db, input: InsertAgentInput): Promise<AgentRow> {
  const rows = (await db
    .insert(agents)
    .values({
      id: input.id,
      name: input.name,
      agentClass: input.agentClass,
      ownerAppId: input.ownerAppId ?? null,
      thirdPartyOauthClientId: input.thirdPartyOauthClientId ?? null,
      status: 'active',
    })
    .returning()) as unknown as AgentRow[];
  if (rows.length !== 1) throw new Error('insertAgent: expected one row');
  return rows[0]!;
}

export async function getAgentById(db: Db, id: string): Promise<AgentRow | null> {
  const rows = (await db
    .select()
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1)) as unknown as AgentRow[];
  return rows[0] ?? null;
}

export interface UpdateAgentStatusPatch {
  status: AgentStatus;
  suspendedAt?: Date | null;
  retiredAt?: Date | null;
}

export async function updateAgentStatus(
  db: Db,
  id: string,
  patch: UpdateAgentStatusPatch
): Promise<AgentRow | null> {
  const update: Record<string, unknown> = {
    status: patch.status,
    updatedAt: new Date(),
  };
  if (patch.suspendedAt !== undefined) update['suspendedAt'] = patch.suspendedAt;
  if (patch.retiredAt !== undefined) update['retiredAt'] = patch.retiredAt;
  const rows = (await db
    .update(agents)
    .set(update)
    .where(eq(agents.id, id))
    .returning()) as unknown as AgentRow[];
  return rows[0] ?? null;
}
