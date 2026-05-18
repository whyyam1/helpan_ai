/**
 * Operator > Safety Policies service.
 *
 * PUT is RFC-compliant upsert: an unknown policy_id creates the row, a known
 * one replaces it. `app_id` is frozen for an existing row — attempting to
 * change it returns 409 to make the constraint explicit instead of letting
 * a stray write change which app a policy governs.
 *
 * Default whitelist/blacklist/moderation arrays match the table defaults.
 */

import { appendAuditEntry } from '../../lib/auditWriter.js';
import type { Db } from '../../db/client.js';
import {
  getSafetyPolicyByAppId,
  getSafetyPolicyById,
  insertSafetyPolicy,
  listSafetyPolicies,
  replaceSafetyPolicy,
  type SafetyPolicyRow,
} from './repo.js';
import type {
  AudiencePosture,
  ContentModerationRule,
  LocationPrecisionFloor,
  SafetyPolicyDto,
} from './schemas.js';

function toDto(row: SafetyPolicyRow): SafetyPolicyDto {
  return {
    id: row.id,
    app_id: row.appId,
    category_whitelist: row.categoryWhitelist,
    category_blacklist: row.categoryBlacklist,
    content_moderation_rules: row.contentModerationRules,
    audience_posture: row.audiencePosture,
    location_precision_floor: row.locationPrecisionFloor,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export interface OperatorAuditContext {
  readonly appId: string;
  readonly requestId: string;
  readonly traceparent?: string;
}

export interface PutSafetyPolicyArgs {
  id: string;
  appId: string;
  categoryWhitelist?: string[];
  categoryBlacklist?: string[];
  contentModerationRules?: ContentModerationRule[];
  audiencePosture?: AudiencePosture;
  locationPrecisionFloor?: LocationPrecisionFloor | null;
}

function railError(
  code: string,
  statusCode: number,
  message: string,
  field?: string,
  detail?: Record<string, unknown>
): Error {
  const err = new Error(message) as Error & {
    code: string;
    statusCode: number;
    field?: string;
    detail?: Record<string, unknown>;
  };
  err.code = code;
  err.statusCode = statusCode;
  if (field !== undefined) err.field = field;
  if (detail !== undefined) err.detail = detail;
  return err;
}

export async function listAllSafetyPolicies(db: Db): Promise<readonly SafetyPolicyDto[]> {
  const rows = await listSafetyPolicies(db);
  return rows.map(toDto);
}

interface PutResult {
  readonly dto: SafetyPolicyDto;
  readonly created: boolean;
}

export async function putSafetyPolicy(
  db: Db,
  audit: OperatorAuditContext,
  pathPolicyId: string,
  args: PutSafetyPolicyArgs
): Promise<PutResult> {
  if (args.id !== pathPolicyId) {
    throw railError(
      'REQ_INVALID',
      400,
      'Body `id` does not match path `policy_id`',
      'id',
      { path: pathPolicyId, body: args.id }
    );
  }

  const result: PutResult = await db.transaction(async (tx) => {
    const existing = await getSafetyPolicyById(tx as unknown as Db, pathPolicyId);
    if (existing && existing.appId !== args.appId) {
      throw railError(
        'SAFETY_POLICY_APP_ID_FROZEN',
        409,
        '`app_id` cannot change for an existing safety policy',
        'app_id',
        { current: existing.appId, requested: args.appId }
      );
    }

    if (!existing) {
      // Insert path — enforce UNIQUE(app_id) at the service layer with a
      // clear error so the caller gets a 409 instead of a raw DB error.
      const otherForApp = await getSafetyPolicyByAppId(tx as unknown as Db, args.appId);
      if (otherForApp) {
        throw railError(
          'SAFETY_POLICY_APP_HAS_POLICY',
          409,
          'A safety policy already exists for this app under a different id',
          'app_id',
          { existing_id: otherForApp.id }
        );
      }
      const inserted = await insertSafetyPolicy(tx as unknown as Db, {
        id: args.id,
        appId: args.appId,
        categoryWhitelist: args.categoryWhitelist ?? [],
        categoryBlacklist: args.categoryBlacklist ?? [],
        contentModerationRules: args.contentModerationRules ?? [],
        audiencePosture: args.audiencePosture ?? 'general',
        ...(args.locationPrecisionFloor !== undefined
          ? { locationPrecisionFloor: args.locationPrecisionFloor }
          : {}),
      });
      await appendAuditEntry(tx, {
        actorType: 'operator',
        actorId: `app:${audit.appId}`,
        action: 'safety_policy.create',
        resourceType: 'safety_policy',
        resourceId: inserted.id,
        appId: audit.appId,
        requestId: audit.requestId,
        ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
        outcome: 'success',
        initiatedBy: 'human',
        detail: {
          target_app_id: inserted.appId,
          audience_posture: inserted.audiencePosture,
        },
      });
      return { dto: toDto(inserted), created: true };
    }

    const replaced = await replaceSafetyPolicy(tx as unknown as Db, pathPolicyId, {
      categoryWhitelist: args.categoryWhitelist ?? existing.categoryWhitelist,
      categoryBlacklist: args.categoryBlacklist ?? existing.categoryBlacklist,
      contentModerationRules: args.contentModerationRules ?? existing.contentModerationRules,
      audiencePosture: args.audiencePosture ?? existing.audiencePosture,
      locationPrecisionFloor:
        args.locationPrecisionFloor !== undefined
          ? args.locationPrecisionFloor
          : existing.locationPrecisionFloor,
    });
    if (!replaced) {
      throw new Error('safety policy disappeared mid-transaction');
    }
    await appendAuditEntry(tx, {
      actorType: 'operator',
      actorId: `app:${audit.appId}`,
      action: 'safety_policy.update',
      resourceType: 'safety_policy',
      resourceId: replaced.id,
      appId: audit.appId,
      requestId: audit.requestId,
      ...(audit.traceparent ? { traceparent: audit.traceparent } : {}),
      outcome: 'success',
      initiatedBy: 'human',
      detail: {
        target_app_id: replaced.appId,
        audience_posture: replaced.audiencePosture,
      },
    });
    return { dto: toDto(replaced), created: false };
  });

  return result;
}
