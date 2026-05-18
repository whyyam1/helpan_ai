/**
 * Drizzle data-access for `safety_policies`.
 *
 * Table is platform-owned (no RLS). Single row per app enforced by
 * `UNIQUE(app_id)`.
 */

import { asc, eq } from 'drizzle-orm';
import { safetyPolicies } from '../../db/schema/safetyPolicies.js';
import type { Db } from '../../db/client.js';
import type {
  AudiencePosture,
  ContentModerationRule,
  LocationPrecisionFloor,
} from './schemas.js';

export interface SafetyPolicyRow {
  id: string;
  appId: string;
  categoryWhitelist: string[];
  categoryBlacklist: string[];
  contentModerationRules: ContentModerationRule[];
  audiencePosture: AudiencePosture;
  locationPrecisionFloor: LocationPrecisionFloor | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listSafetyPolicies(db: Db): Promise<readonly SafetyPolicyRow[]> {
  const rows = (await db
    .select()
    .from(safetyPolicies)
    .orderBy(asc(safetyPolicies.appId))) as unknown as SafetyPolicyRow[];
  return rows;
}

export async function getSafetyPolicyById(
  db: Db,
  id: string
): Promise<SafetyPolicyRow | null> {
  const rows = (await db
    .select()
    .from(safetyPolicies)
    .where(eq(safetyPolicies.id, id))
    .limit(1)) as unknown as SafetyPolicyRow[];
  return rows[0] ?? null;
}

export async function getSafetyPolicyByAppId(
  db: Db,
  appId: string
): Promise<SafetyPolicyRow | null> {
  const rows = (await db
    .select()
    .from(safetyPolicies)
    .where(eq(safetyPolicies.appId, appId))
    .limit(1)) as unknown as SafetyPolicyRow[];
  return rows[0] ?? null;
}

export interface UpsertSafetyPolicyInput {
  id: string;
  appId: string;
  categoryWhitelist: string[];
  categoryBlacklist: string[];
  contentModerationRules: ContentModerationRule[];
  audiencePosture: AudiencePosture;
  locationPrecisionFloor?: LocationPrecisionFloor | null;
}

export async function insertSafetyPolicy(
  db: Db,
  input: UpsertSafetyPolicyInput
): Promise<SafetyPolicyRow> {
  const rows = (await db
    .insert(safetyPolicies)
    .values({
      id: input.id,
      appId: input.appId,
      categoryWhitelist: input.categoryWhitelist,
      categoryBlacklist: input.categoryBlacklist,
      contentModerationRules: input.contentModerationRules,
      audiencePosture: input.audiencePosture,
      locationPrecisionFloor: input.locationPrecisionFloor ?? null,
    })
    .returning()) as unknown as SafetyPolicyRow[];
  if (rows.length !== 1) throw new Error('insertSafetyPolicy: expected one row');
  return rows[0]!;
}

export async function replaceSafetyPolicy(
  db: Db,
  id: string,
  patch: {
    categoryWhitelist: string[];
    categoryBlacklist: string[];
    contentModerationRules: ContentModerationRule[];
    audiencePosture: AudiencePosture;
    locationPrecisionFloor: LocationPrecisionFloor | null;
  }
): Promise<SafetyPolicyRow | null> {
  const rows = (await db
    .update(safetyPolicies)
    .set({
      categoryWhitelist: patch.categoryWhitelist,
      categoryBlacklist: patch.categoryBlacklist,
      contentModerationRules: patch.contentModerationRules,
      audiencePosture: patch.audiencePosture,
      locationPrecisionFloor: patch.locationPrecisionFloor,
      updatedAt: new Date(),
    })
    .where(eq(safetyPolicies.id, id))
    .returning()) as unknown as SafetyPolicyRow[];
  return rows[0] ?? null;
}
