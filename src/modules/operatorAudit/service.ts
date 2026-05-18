/**
 * Operator > Audit service — read-only query.
 *
 * Cursor encoding mirrors the briefings module (base64url of
 * `<created_at_iso>|<id>`) so any operator tooling that already understands
 * one cursor format works on both.
 */

import { listAuditEntries, type AuditLogRow } from './repo.js';
import type { Db } from '../../db/client.js';
import type { AuditEntryDto, ActorType, Outcome } from './schemas.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function toDto(row: AuditLogRow): AuditEntryDto {
  return {
    id: row.id,
    app_id: row.appId,
    actor_type: row.actorType as ActorType,
    actor_id: row.actorId,
    agent_id: row.agentId,
    delegated_authority_jti: row.delegatedAuthorityJti,
    initiated_by: row.initiatedBy,
    account_uuid: row.accountUuid,
    action: row.action,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    target_rail: row.targetRail,
    target_operation: row.targetOperation,
    request_id: row.requestId,
    traceparent: row.traceparent,
    outcome: row.outcome as Outcome,
    detail: row.detail,
    previous_hash: row.previousHash,
    entry_hash: row.entryHash,
    created_at: row.createdAt.toISOString(),
  };
}

function encodeCursor(row: AuditLogRow): string {
  const raw = `${row.createdAt.toISOString()}|${row.id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeCursor(encoded: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep <= 0 || sep === raw.length - 1) return null;
    const isoCreatedAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    const createdAt = new Date(isoCreatedAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export interface ListAuditArgs {
  accountUuid?: string;
  agentId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}

export interface ListAuditResult {
  readonly items: readonly AuditEntryDto[];
  readonly nextCursor: string | null;
}

export async function listAudit(
  db: Db,
  args: ListAuditArgs
): Promise<ListAuditResult> {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  let cursorCreatedAt: Date | undefined;
  let cursorId: string | undefined;
  if (args.cursor) {
    const decoded = decodeCursor(args.cursor);
    if (!decoded) {
      const err = new Error('Invalid pagination cursor') as Error & {
        statusCode: number;
        code: string;
        field: string;
      };
      err.statusCode = 400;
      err.code = 'REQ_INVALID';
      err.field = 'cursor';
      throw err;
    }
    cursorCreatedAt = decoded.createdAt;
    cursorId = decoded.id;
  }

  const rows = await listAuditEntries(db, {
    limit: limit + 1,
    ...(args.accountUuid !== undefined ? { accountUuid: args.accountUuid } : {}),
    ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
    ...(args.action !== undefined ? { action: args.action } : {}),
    ...(args.from !== undefined ? { from: args.from } : {}),
    ...(args.to !== undefined ? { to: args.to } : {}),
    ...(cursorCreatedAt !== undefined ? { cursorCreatedAt } : {}),
    ...(cursorId !== undefined ? { cursorId } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = hasMore ? page[page.length - 1] : undefined;
  return {
    items: page.map(toDto),
    nextCursor: lastRow ? encodeCursor(lastRow) : null,
  };
}
