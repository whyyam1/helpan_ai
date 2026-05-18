/**
 * Drizzle data-access for `briefings`.
 *
 * Every function takes a `tx: Tx` (a Drizzle transaction handle, opened by
 * `app.withCustomerContext`) so RLS GUCs are guaranteed to be set before
 * any query runs. Calling these from outside a `withCustomerContext` block
 * is a programming error — RLS would deny rows for the SELECT-as-user
 * policies and writes would fail the WITH CHECK clause.
 *
 * `account_uuid` parameters on the read paths look redundant given RLS
 * already filters to the user's rows; including it in the WHERE allows
 * the planner to use the (account_uuid, status) index without first
 * scanning the RLS-eligible set, and provides a defence-in-depth mismatch
 * detector (returns 0 rows if RLS and the GUC ever drift).
 */

import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { briefings } from '../../db/schema/briefings.js';
import type { Tx } from '../../plugins/rlsContext.js';
import type { BriefingStatus, BriefingType } from './schemas.js';

export interface BriefingRow {
  id: string;
  accountUuid: string;
  appId: string;
  agentId: string | null;
  briefingType: BriefingType;
  status: BriefingStatus;
  intent: Record<string, unknown>;
  expiresAt: Date | null;
  appCorrelationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}

export interface InsertBriefingInput {
  id: string;
  accountUuid: string;
  appId: string;
  agentId?: string | null;
  briefingType: BriefingType;
  intent: Record<string, unknown>;
  expiresAt?: Date | null;
  appCorrelationId?: string | null;
}

export async function insertBriefing(tx: Tx, input: InsertBriefingInput): Promise<BriefingRow> {
  const rows = (await tx
    .insert(briefings)
    .values({
      id: input.id,
      accountUuid: input.accountUuid,
      appId: input.appId,
      agentId: input.agentId ?? null,
      briefingType: input.briefingType,
      status: 'active',
      intent: input.intent,
      expiresAt: input.expiresAt ?? null,
      appCorrelationId: input.appCorrelationId ?? null,
    })
    .returning()) as unknown as BriefingRow[];
  // Insert always returns one row; defensive null guard for the type checker.
  if (rows.length !== 1) throw new Error('insertBriefing: expected exactly one row');
  return rows[0]!;
}

export async function getBriefingById(
  tx: Tx,
  id: string,
  accountUuid: string
): Promise<BriefingRow | null> {
  const rows = (await tx
    .select()
    .from(briefings)
    .where(and(eq(briefings.id, id), eq(briefings.accountUuid, accountUuid)))
    .limit(1)) as unknown as BriefingRow[];
  return rows[0] ?? null;
}

export interface ListBriefingsInput {
  accountUuid: string;
  appId?: string;
  status?: BriefingStatus;
  /** Cursor: ISO `created_at` of the last row in the previous page + ULID. */
  cursorCreatedAt?: Date;
  cursorId?: string;
  limit: number;
}

export async function listBriefings(
  tx: Tx,
  input: ListBriefingsInput
): Promise<readonly BriefingRow[]> {
  const filters: SQL[] = [eq(briefings.accountUuid, input.accountUuid)];
  if (input.appId) filters.push(eq(briefings.appId, input.appId));
  if (input.status) filters.push(eq(briefings.status, input.status));
  if (input.cursorCreatedAt && input.cursorId) {
    // Strict (created_at, id) ordering — prefer rows strictly older than the
    // cursor, with ties broken on id descending.
    const ltCreated = lt(briefings.createdAt, input.cursorCreatedAt);
    const eqCreatedLtId = and(
      eq(briefings.createdAt, input.cursorCreatedAt),
      lt(briefings.id, input.cursorId)
    ) as SQL;
    filters.push(or(ltCreated, eqCreatedLtId) as SQL);
  }

  const rows = (await tx
    .select()
    .from(briefings)
    .where(and(...filters))
    .orderBy(desc(briefings.createdAt), desc(briefings.id))
    .limit(input.limit)) as unknown as BriefingRow[];
  return rows;
}

export interface UpdateBriefingInput {
  status?: BriefingStatus;
  intent?: Record<string, unknown>;
  expiresAt?: Date | null;
}

export async function updateBriefing(
  tx: Tx,
  id: string,
  accountUuid: string,
  patch: UpdateBriefingInput
): Promise<BriefingRow | null> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) update['status'] = patch.status;
  if (patch.intent !== undefined) update['intent'] = patch.intent;
  if (patch.expiresAt !== undefined) update['expiresAt'] = patch.expiresAt;

  const rows = (await tx
    .update(briefings)
    .set(update)
    .where(and(eq(briefings.id, id), eq(briefings.accountUuid, accountUuid)))
    .returning()) as unknown as BriefingRow[];
  return rows[0] ?? null;
}

export async function softRevokeBriefing(
  tx: Tx,
  id: string,
  accountUuid: string
): Promise<BriefingRow | null> {
  const now = new Date();
  const rows = (await tx
    .update(briefings)
    .set({ status: 'revoked', revokedAt: now, updatedAt: now })
    .where(and(eq(briefings.id, id), eq(briefings.accountUuid, accountUuid)))
    .returning()) as unknown as BriefingRow[];
  return rows[0] ?? null;
}

