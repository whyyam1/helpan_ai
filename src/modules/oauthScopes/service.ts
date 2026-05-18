/**
 * OAuth scope catalogue service.
 *
 * Read-mostly. The single write path (`createScope`) writes an audit_log
 * entry under actor_type='operator' so admin actions on the catalogue are
 * traceable via the same hash chain as user/agent activity.
 */

import { appendAuditEntry } from '../../lib/auditWriter.js';
import type { Db } from '../../db/client.js';
import {
  getScopeById,
  insertScope,
  listScopes,
  type InsertOauthScopeInput,
  type OauthScopeRow,
} from './repo.js';
import type {
  OauthScopeDto,
  ScopeCategory,
  ScopeRail,
  ElevationFriction,
} from './schemas.js';

function toDto(row: OauthScopeRow): OauthScopeDto {
  const dto: OauthScopeDto = {
    id: row.id,
    name: row.name,
    description: row.description,
    rail: row.rail,
    category: row.category,
    default_grantable: row.defaultGrantable,
    elevation_friction: row.elevationFriction,
    per_scope_amount_ceiling_minor:
      row.perScopeAmountCeilingMinor === null ? null : Number(row.perScopeAmountCeilingMinor),
    per_scope_period_ceiling_minor:
      row.perScopePeriodCeilingMinor === null ? null : Number(row.perScopePeriodCeilingMinor),
    per_scope_max_ttl_seconds: row.perScopeMaxTtlSeconds,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
  return dto;
}

export async function listOauthScopes(
  db: Db,
  args: { rail?: ScopeRail }
): Promise<readonly OauthScopeDto[]> {
  const rows = await listScopes(db, args);
  return rows.map(toDto);
}

export interface CreateScopeArgs {
  id: string;
  name: string;
  description: string;
  rail: ScopeRail;
  category: ScopeCategory;
  defaultGrantable: boolean;
  elevationFriction?: ElevationFriction;
  perScopeAmountCeilingMinor?: number | null;
  perScopePeriodCeilingMinor?: number | null;
  perScopeMaxTtlSeconds?: number;
}

export interface OperatorAuditContext {
  readonly appId: string;
  readonly requestId: string;
  readonly traceparent?: string;
}

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_ELEVATION: ElevationFriction = 'low';

export async function createOauthScope(
  db: Db,
  audit: OperatorAuditContext,
  args: CreateScopeArgs
): Promise<OauthScopeDto> {
  const existing = await getScopeById(db, args.id);
  if (existing) {
    const err = new Error(`Scope already exists: ${args.id}`) as Error & {
      code: string;
      statusCode: number;
      field: string;
    };
    err.code = 'OAUTH_SCOPE_EXISTS';
    err.statusCode = 409;
    err.field = 'id';
    throw err;
  }

  // Wrap the row insert and audit append in a single transaction so a
  // failed audit chain insert rolls back the scope creation too.
  const inserted: OauthScopeRow = await db.transaction(async (tx) => {
    const input: InsertOauthScopeInput = {
      id: args.id,
      name: args.name,
      description: args.description,
      rail: args.rail,
      category: args.category,
      defaultGrantable: args.defaultGrantable,
      elevationFriction: args.elevationFriction ?? DEFAULT_ELEVATION,
      perScopeMaxTtlSeconds: args.perScopeMaxTtlSeconds ?? DEFAULT_TTL_SECONDS,
      ...(args.perScopeAmountCeilingMinor !== undefined
        ? { perScopeAmountCeilingMinor: args.perScopeAmountCeilingMinor }
        : {}),
      ...(args.perScopePeriodCeilingMinor !== undefined
        ? { perScopePeriodCeilingMinor: args.perScopePeriodCeilingMinor }
        : {}),
    };
    const row = await insertScope(tx as unknown as Db, input);
    await appendAuditEntry(tx, {
      actorType: 'operator',
      actorId: `app:${audit.appId}`,
      action: 'oauth_scope.create',
      resourceType: 'oauth_scope',
      resourceId: row.id,
      appId: audit.appId,
      requestId: audit.requestId,
      ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
      outcome: 'success',
      initiatedBy: 'human',
      detail: {
        rail: args.rail,
        category: args.category,
        default_grantable: args.defaultGrantable,
        per_scope_max_ttl_seconds: input.perScopeMaxTtlSeconds,
      },
    });
    return row;
  });

  return toDto(inserted);
}
