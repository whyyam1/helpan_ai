/**
 * Drizzle data-access for `oauth_scopes`.
 *
 * The catalogue is read-mostly: GET on hot paths during agent registration,
 * POST is rare (admin-only). All rows go through validation in the route /
 * service layer — the repo trusts well-typed inputs.
 */

import { and, asc, eq } from 'drizzle-orm';
import { oauthScopes } from '../../db/schema/oauthScopes.js';
import type { Db } from '../../db/client.js';
import type {
  ElevationFriction,
  ScopeCategory,
  ScopeRail,
  ScopeStatus,
} from './schemas.js';

export interface OauthScopeRow {
  id: string;
  name: string;
  description: string;
  rail: ScopeRail;
  category: ScopeCategory;
  defaultGrantable: boolean;
  elevationFriction: ElevationFriction;
  perScopeAmountCeilingMinor: bigint | null;
  perScopePeriodCeilingMinor: bigint | null;
  perScopeMaxTtlSeconds: number;
  status: ScopeStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertOauthScopeInput {
  id: string;
  name: string;
  description: string;
  rail: ScopeRail;
  category: ScopeCategory;
  defaultGrantable: boolean;
  elevationFriction: ElevationFriction;
  perScopeAmountCeilingMinor?: number | null;
  perScopePeriodCeilingMinor?: number | null;
  perScopeMaxTtlSeconds: number;
}

export async function listScopes(
  db: Db,
  args: { rail?: ScopeRail }
): Promise<readonly OauthScopeRow[]> {
  const filters = args.rail ? [eq(oauthScopes.rail, args.rail)] : [];
  const rows = (await db
    .select()
    .from(oauthScopes)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(oauthScopes.rail), asc(oauthScopes.id))) as unknown as OauthScopeRow[];
  return rows;
}

export async function getScopeById(db: Db, id: string): Promise<OauthScopeRow | null> {
  const rows = (await db
    .select()
    .from(oauthScopes)
    .where(eq(oauthScopes.id, id))
    .limit(1)) as unknown as OauthScopeRow[];
  return rows[0] ?? null;
}

export async function insertScope(
  db: Db,
  input: InsertOauthScopeInput
): Promise<OauthScopeRow> {
  const rows = (await db
    .insert(oauthScopes)
    .values({
      id: input.id,
      name: input.name,
      description: input.description,
      rail: input.rail,
      category: input.category,
      defaultGrantable: input.defaultGrantable,
      elevationFriction: input.elevationFriction,
      perScopeAmountCeilingMinor:
        input.perScopeAmountCeilingMinor !== undefined &&
        input.perScopeAmountCeilingMinor !== null
          ? BigInt(input.perScopeAmountCeilingMinor)
          : null,
      perScopePeriodCeilingMinor:
        input.perScopePeriodCeilingMinor !== undefined &&
        input.perScopePeriodCeilingMinor !== null
          ? BigInt(input.perScopePeriodCeilingMinor)
          : null,
      perScopeMaxTtlSeconds: input.perScopeMaxTtlSeconds,
    })
    .returning()) as unknown as OauthScopeRow[];
  if (rows.length !== 1) throw new Error('insertScope: expected one row');
  return rows[0]!;
}
