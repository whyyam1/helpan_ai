/**
 * `safety_policies` — per-app safety policy: category whitelist/blacklist,
 * audience posture, content moderation rules, location precision floor.
 * ERD §1.9. One row per app (UNIQUE on app_id).
 *
 * Family-friendly safety for the family-discovery app is enforced at
 * `audience_posture = 'family_friendly'` and an explicit category blacklist.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

export const safetyPolicies = pgTable(
  'safety_policies',
  {
    id: text('id').primaryKey(),
    appId: text('app_id').notNull(),
    categoryWhitelist: text('category_whitelist').array().notNull().default(sql`'{}'::text[]`),
    categoryBlacklist: text('category_blacklist').array().notNull().default(sql`'{}'::text[]`),
    contentModerationRules: jsonb('content_moderation_rules').notNull().default(sql`'[]'::jsonb`),
    audiencePosture: text('audience_posture').notNull().default('general'),
    locationPrecisionFloor: text('location_precision_floor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appUniq: uniqueIndex('safety_policies_app_id_uniq').on(t.appId),
    audienceCheck: check(
      'safety_policies_audience_chk',
      sql`${t.audiencePosture} IN ('family_friendly', 'general', 'adult_confirmed')`
    ),
    locationCheck: check(
      'safety_policies_location_chk',
      sql`${t.locationPrecisionFloor} IS NULL OR ${t.locationPrecisionFloor} IN ('merchant_level', 'neighbourhood_level', 'city_level', 'none')`
    ),
  })
);

export type SafetyPolicyRow = typeof safetyPolicies.$inferSelect;
export type SafetyPolicyInsert = typeof safetyPolicies.$inferInsert;
