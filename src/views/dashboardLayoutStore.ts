import type { PrismaClient } from "@prisma/client";
import {
  normalizeDashboardLayoutPreferences,
  type DashboardLayoutPreferences,
} from "../domain";

/**
 * Persistence for v1.1.1 F4 (dashboard personalization).
 *
 * Preferences live in the generic `AppSetting` key-value table — the same
 * table already used for `autoBackupIntervalHours` — so this feature needs
 * no schema migration. The stored JSON is never trusted as-is: every read
 * goes through `normalizeDashboardLayoutPreferences`, so a hand-edited or
 * corrupted row degrades to safe defaults rather than crashing the Command
 * Center render path (docs/18_FAILURE_MODES.md: a preference is cosmetic,
 * and must never become an outage).
 */

const DASHBOARD_LAYOUT_SETTING_KEY = "dashboardLayoutPreferences";

export async function getDashboardLayoutPreferences(
  db: PrismaClient,
): Promise<DashboardLayoutPreferences> {
  const setting = await db.appSetting.findUnique({
    where: { key: DASHBOARD_LAYOUT_SETTING_KEY },
  });
  if (setting === null) return normalizeDashboardLayoutPreferences(undefined);

  let parsed: unknown;
  try {
    parsed = JSON.parse(setting.valueJson);
  } catch {
    parsed = undefined;
  }
  return normalizeDashboardLayoutPreferences(parsed);
}

/**
 * Saves preferences. Always re-normalizes before writing — a form
 * submission is untrusted input just like a stored row, and this is the
 * one place both paths funnel through before touching the database.
 */
export async function saveDashboardLayoutPreferences(
  db: PrismaClient,
  preferences: unknown,
): Promise<DashboardLayoutPreferences> {
  const normalized = normalizeDashboardLayoutPreferences(preferences);
  await db.appSetting.upsert({
    where: { key: DASHBOARD_LAYOUT_SETTING_KEY },
    create: {
      key: DASHBOARD_LAYOUT_SETTING_KEY,
      valueJson: JSON.stringify(normalized),
    },
    update: { valueJson: JSON.stringify(normalized) },
  });
  return normalized;
}

export async function resetDashboardLayoutPreferences(
  db: PrismaClient,
): Promise<DashboardLayoutPreferences> {
  return saveDashboardLayoutPreferences(db, undefined);
}
