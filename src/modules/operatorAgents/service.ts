/**
 * Operator > Agents service.
 *
 * All write paths audit-log under actor_type='operator'. Status transitions
 * additionally set the corresponding timestamp column (`suspended_at` /
 * `retired_at`) so downstream consumers (Helpan Console activity view) can
 * surface "when did this happen?" without joining the audit log.
 */

import { generateUlid } from '@kmv/platform-shared/ulid';
import { appendAuditEntry } from '../../lib/auditWriter.js';
import type { Db } from '../../db/client.js';
import {
  getAgentById,
  insertAgent,
  updateAgentStatus,
  type AgentRow,
} from './repo.js';
import type { AgentClass, AgentDto, AgentStatus } from './schemas.js';

const AGENT_ID_PREFIX = 'agt_';

function toDto(row: AgentRow): AgentDto {
  return {
    id: row.id,
    name: row.name,
    agent_class: row.agentClass,
    owner_app_id: row.ownerAppId,
    third_party_oauth_client_id: row.thirdPartyOauthClientId,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    suspended_at: row.suspendedAt ? row.suspendedAt.toISOString() : null,
    retired_at: row.retiredAt ? row.retiredAt.toISOString() : null,
  };
}

export interface OperatorAuditContext {
  readonly appId: string;
  readonly requestId: string;
  readonly traceparent?: string;
}

export interface RegisterAgentArgs {
  name: string;
  agentClass: AgentClass;
  ownerAppId?: string;
  thirdPartyOauthClientId?: string;
}

function railError(code: string, statusCode: number, message: string, field?: string): Error {
  const err = new Error(message) as Error & {
    code: string;
    statusCode: number;
    field?: string;
  };
  err.code = code;
  err.statusCode = statusCode;
  if (field !== undefined) err.field = field;
  return err;
}

export async function registerAgent(
  db: Db,
  audit: OperatorAuditContext,
  args: RegisterAgentArgs
): Promise<AgentDto> {
  // Class-specific invariants (defence in depth on top of AJV).
  if (args.agentClass === 'portfolio_app' && !args.ownerAppId) {
    throw railError(
      'AGENT_OWNER_REQUIRED',
      400,
      'owner_app_id required for agent_class=portfolio_app',
      'owner_app_id'
    );
  }
  if (args.agentClass === 'third_party_oauth' && !args.thirdPartyOauthClientId) {
    throw railError(
      'AGENT_OAUTH_CLIENT_REQUIRED',
      400,
      'third_party_oauth_client_id required for agent_class=third_party_oauth',
      'third_party_oauth_client_id'
    );
  }

  const id = `${AGENT_ID_PREFIX}${generateUlid()}`;
  const created: AgentRow = await db.transaction(async (tx) => {
    const row = await insertAgent(tx as unknown as Db, {
      id,
      name: args.name,
      agentClass: args.agentClass,
      ...(args.ownerAppId !== undefined ? { ownerAppId: args.ownerAppId } : {}),
      ...(args.thirdPartyOauthClientId !== undefined
        ? { thirdPartyOauthClientId: args.thirdPartyOauthClientId }
        : {}),
    });
    await appendAuditEntry(tx, {
      actorType: 'operator',
      actorId: `app:${audit.appId}`,
      action: 'agent.register',
      resourceType: 'agent',
      resourceId: id,
      appId: audit.appId,
      requestId: audit.requestId,
      ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
      outcome: 'success',
      initiatedBy: 'human',
      detail: {
        agent_class: args.agentClass,
        ...(args.ownerAppId !== undefined ? { owner_app_id: args.ownerAppId } : {}),
        ...(args.thirdPartyOauthClientId !== undefined
          ? { third_party_oauth_client_id: args.thirdPartyOauthClientId }
          : {}),
      },
    });
    return row;
  });
  return toDto(created);
}

export async function readAgent(db: Db, id: string): Promise<AgentDto | null> {
  const row = await getAgentById(db, id);
  return row ? toDto(row) : null;
}

export interface UpdateStatusArgs {
  status: AgentStatus;
  reason?: string;
}

export async function changeAgentStatus(
  db: Db,
  audit: OperatorAuditContext,
  id: string,
  args: UpdateStatusArgs
): Promise<AgentDto | null> {
  const updated: AgentRow | null = await db.transaction(async (tx) => {
    const existing = await getAgentById(tx as unknown as Db, id);
    if (!existing) return null;
    const now = new Date();
    const patch: { status: AgentStatus; suspendedAt?: Date | null; retiredAt?: Date | null } = {
      status: args.status,
    };
    if (args.status === 'suspended') patch.suspendedAt = now;
    if (args.status === 'active') patch.suspendedAt = null;
    if (args.status === 'retired') patch.retiredAt = now;
    const row = await updateAgentStatus(tx as unknown as Db, id, patch);
    if (!row) return null;
    await appendAuditEntry(tx, {
      actorType: 'operator',
      actorId: `app:${audit.appId}`,
      action: 'agent.status_change',
      resourceType: 'agent',
      resourceId: id,
      appId: audit.appId,
      requestId: audit.requestId,
      ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
      outcome: 'success',
      initiatedBy: 'human',
      detail: {
        from: existing.status,
        to: args.status,
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      },
    });
    return row;
  });
  return updated ? toDto(updated) : null;
}
