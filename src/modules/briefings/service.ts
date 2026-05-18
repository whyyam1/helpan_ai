/**
 * Briefings service — orchestration between the repo and the audit writer,
 * plus DB-row → wire-DTO mapping.
 *
 * The route layer in `routes.ts` opens a `withCustomerContext` transaction
 * once per request and passes the resulting `tx` here. Every read and write
 * uses that transaction, so the row-level GUCs set by `rlsContext.ts` are
 * in force for every query.
 */

import { generateUlid } from '@kmv/platform-shared/ulid';
import { appendAuditEntry } from '../../lib/auditWriter.js';
import type { Tx } from '../../plugins/rlsContext.js';
import {
  getBriefingById,
  insertBriefing,
  listBriefings,
  softRevokeBriefing,
  updateBriefing,
  type BriefingRow,
  type ListBriefingsInput,
} from './repo.js';
import type { BriefingDto, BriefingStatus, BriefingType } from './schemas.js';

const BRIEFING_ID_PREFIX = 'brf_';
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function newBriefingId(): string {
  return `${BRIEFING_ID_PREFIX}${generateUlid()}`;
}

export function toBriefingDto(row: BriefingRow): BriefingDto {
  return {
    id: row.id,
    account_uuid: row.accountUuid,
    app_id: row.appId,
    agent_id: row.agentId,
    briefing_type: row.briefingType,
    status: row.status,
    intent: row.intent,
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Cursor encoding: base64url(`<ISO created_at>|<id>`). Opaque to clients.
 * We use base64url to keep the cursor URL-safe without further escaping.
 */
export function encodeCursor(row: BriefingRow): string {
  const raw = `${row.createdAt.toISOString()}|${row.id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeCursor(
  encoded: string
): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep <= 0 || sep === raw.length - 1) return null;
    const isoCreatedAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    const createdAt = new Date(isoCreatedAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    if (!id.startsWith(BRIEFING_ID_PREFIX)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export interface AuditContext {
  readonly accountUuid: string;
  readonly appId: string;
  readonly requestId: string;
  readonly traceparent?: string;
}

export interface CreateBriefingArgs {
  readonly accountUuid: string;
  readonly appId: string;
  readonly briefingType: BriefingType;
  readonly intent: Record<string, unknown>;
  readonly agentId?: string;
  readonly expiresAt?: Date | null;
  readonly appCorrelationId?: string;
}

export async function createBriefing(
  tx: Tx,
  audit: AuditContext,
  args: CreateBriefingArgs
): Promise<BriefingDto> {
  const id = newBriefingId();
  const row = await insertBriefing(tx, {
    id,
    accountUuid: args.accountUuid,
    appId: args.appId,
    agentId: args.agentId ?? null,
    briefingType: args.briefingType,
    intent: args.intent,
    expiresAt: args.expiresAt ?? null,
    appCorrelationId: args.appCorrelationId ?? null,
  });
  await appendAuditEntry(tx, {
    actorType: 'user',
    actorId: audit.accountUuid,
    accountUuid: audit.accountUuid,
    action: 'briefing.create',
    resourceType: 'briefing',
    resourceId: id,
    appId: audit.appId,
    requestId: audit.requestId,
    traceparent: audit.traceparent,
    outcome: 'success',
    initiatedBy: 'human',
    detail: {
      briefing_type: args.briefingType,
      app_id: args.appId,
      ...(args.agentId !== undefined ? { agent_id: args.agentId } : {}),
      ...(args.expiresAt ? { expires_at: args.expiresAt.toISOString() } : {}),
    },
  });
  return toBriefingDto(row);
}

export async function readBriefing(
  tx: Tx,
  accountUuid: string,
  id: string
): Promise<BriefingDto | null> {
  const row = await getBriefingById(tx, id, accountUuid);
  return row ? toBriefingDto(row) : null;
}

export interface ListBriefingsArgs {
  readonly accountUuid: string;
  readonly appId?: string;
  readonly status?: BriefingStatus;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListBriefingsResult {
  readonly items: readonly BriefingDto[];
  readonly nextCursor: string | null;
}

export async function listBriefingsForCustomer(
  tx: Tx,
  args: ListBriefingsArgs
): Promise<ListBriefingsResult> {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
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

  const repoArgs: ListBriefingsInput = {
    accountUuid: args.accountUuid,
    limit: limit + 1, // fetch one extra to detect whether another page exists
    ...(args.appId !== undefined ? { appId: args.appId } : {}),
    ...(args.status !== undefined ? { status: args.status } : {}),
    ...(cursorCreatedAt !== undefined ? { cursorCreatedAt } : {}),
    ...(cursorId !== undefined ? { cursorId } : {}),
  };
  const rows = await listBriefings(tx, repoArgs);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = hasMore ? page[page.length - 1] : undefined;
  return {
    items: page.map(toBriefingDto),
    nextCursor: lastRow ? encodeCursor(lastRow) : null,
  };
}

export interface UpdateBriefingArgs {
  readonly status?: BriefingStatus;
  readonly intent?: Record<string, unknown>;
  readonly expiresAt?: Date | null;
}

export async function patchBriefing(
  tx: Tx,
  audit: AuditContext,
  id: string,
  patch: UpdateBriefingArgs
): Promise<BriefingDto | null> {
  // Empty patch shortcut — return the existing row, no audit entry.
  const isNoop =
    patch.status === undefined && patch.intent === undefined && patch.expiresAt === undefined;
  if (isNoop) {
    const existing = await getBriefingById(tx, id, audit.accountUuid);
    return existing ? toBriefingDto(existing) : null;
  }

  const row = await updateBriefing(tx, id, audit.accountUuid, {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.intent !== undefined ? { intent: patch.intent } : {}),
    ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
  });
  if (!row) return null;
  await appendAuditEntry(tx, {
    actorType: 'user',
    actorId: audit.accountUuid,
    accountUuid: audit.accountUuid,
    action: 'briefing.update',
    resourceType: 'briefing',
    resourceId: id,
    appId: audit.appId,
    requestId: audit.requestId,
    traceparent: audit.traceparent,
    outcome: 'success',
    initiatedBy: 'human',
    detail: {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.intent !== undefined ? { intent_changed: true } : {}),
      ...(patch.expiresAt !== undefined
        ? { expires_at: patch.expiresAt ? patch.expiresAt.toISOString() : null }
        : {}),
    },
  });
  return toBriefingDto(row);
}

export async function revokeBriefing(
  tx: Tx,
  audit: AuditContext,
  id: string
): Promise<BriefingDto | null> {
  // If already revoked, soft-revoke is a no-op at the row level (status
  // stays 'revoked', revoked_at advances to NOW). For idempotency we only
  // emit one audit entry on the transition active|paused → revoked.
  const existing = await getBriefingById(tx, id, audit.accountUuid);
  if (!existing) return null;
  const wasAlreadyRevoked = existing.status === 'revoked';
  const row = await softRevokeBriefing(tx, id, audit.accountUuid);
  if (!row) return null;
  if (!wasAlreadyRevoked) {
    await appendAuditEntry(tx, {
      actorType: 'user',
      actorId: audit.accountUuid,
      accountUuid: audit.accountUuid,
      action: 'briefing.revoke',
      resourceType: 'briefing',
      resourceId: id,
      appId: audit.appId,
      requestId: audit.requestId,
      traceparent: audit.traceparent,
      outcome: 'success',
      initiatedBy: 'human',
      detail: { previous_status: existing.status },
    });
  }
  return toBriefingDto(row);
}
