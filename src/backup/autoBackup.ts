import type { PrismaClient } from "@prisma/client";
import { exportFullBackup } from "./export";

/**
 * Automatic backup on a schedule (docs/16_DATA_MIGRATION.md, "Automatic
 * backup"): by default, on startup after a threshold interval since the
 * last one, plus after every workbook import.
 *
 * This app has no long-running background process — it is a local Next.js
 * server started on demand — so "on startup" is implemented as "the next
 * time a page checks, if the threshold has elapsed." The Data Center screen
 * calls this on every render, which is the closest local-first equivalent
 * of a startup check without inventing a scheduler daemon this product
 * doesn't need.
 */

const LAST_AUTO_BACKUP_SETTING_KEY = "lastAutoBackupAt";
const INTERVAL_HOURS_SETTING_KEY = "autoBackupIntervalHours";

/** Finalized in M9: once a day is enough to bound data loss without cluttering the backup directory. */
export const DEFAULT_AUTO_BACKUP_INTERVAL_HOURS = 24;

async function readIntervalHours(db: PrismaClient): Promise<number> {
  const setting = await db.appSetting.findUnique({
    where: { key: INTERVAL_HOURS_SETTING_KEY },
  });
  if (setting === null) return DEFAULT_AUTO_BACKUP_INTERVAL_HOURS;

  const parsed = Number(JSON.parse(setting.valueJson));
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_AUTO_BACKUP_INTERVAL_HOURS;
}

export interface AutoBackupResult {
  readonly ranBackup: boolean;
  readonly filePath: string | null;
  readonly nextDueAt: Date;
}

/**
 * Takes a backup if the configured interval has elapsed since the last
 * automatic one, and records when it ran either way.
 *
 * Never throws on backup failure into the caller's render path — a failed
 * automatic backup is recorded... but here it is intentionally allowed to
 * propagate, because a Data Center screen that swallowed a backup failure
 * would be exactly the kind of silent failure this project refuses to
 * produce for financial data. Callers that must not block rendering on this
 * should call it outside the render path (e.g. fire-and-forget from a
 * server action) rather than this function pretending to succeed.
 */
export async function ensureAutomaticBackup(
  db: PrismaClient,
  outDir: string,
): Promise<AutoBackupResult> {
  const intervalHours = await readIntervalHours(db);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  const lastRun = await db.appSetting.findUnique({
    where: { key: LAST_AUTO_BACKUP_SETTING_KEY },
  });
  const lastRunAt =
    lastRun === null ? null : new Date(JSON.parse(lastRun.valueJson) as string);
  const now = new Date();

  const due = lastRunAt === null || now.getTime() - lastRunAt.getTime() >= intervalMs;

  if (!due) {
    return {
      ranBackup: false,
      filePath: null,
      nextDueAt: new Date(lastRunAt.getTime() + intervalMs),
    };
  }

  const filePath = await exportFullBackup(db, outDir, undefined, "automatic");

  await db.appSetting.upsert({
    where: { key: LAST_AUTO_BACKUP_SETTING_KEY },
    create: {
      key: LAST_AUTO_BACKUP_SETTING_KEY,
      valueJson: JSON.stringify(now.toISOString()),
    },
    update: { valueJson: JSON.stringify(now.toISOString()) },
  });

  return { ranBackup: true, filePath, nextDueAt: new Date(now.getTime() + intervalMs) };
}

/**
 * Called after a successful import (docs/16_DATA_MIGRATION.md: "plus after
 * every workbook import"). Unconditional — an import is exactly the kind of
 * event the interval-based check exists to not miss, so it bypasses the
 * threshold rather than waiting for it to elapse.
 */
export async function backupAfterImport(
  db: PrismaClient,
  outDir: string,
): Promise<string> {
  const filePath = await exportFullBackup(db, outDir, undefined, "automatic");
  await db.appSetting.upsert({
    where: { key: LAST_AUTO_BACKUP_SETTING_KEY },
    create: {
      key: LAST_AUTO_BACKUP_SETTING_KEY,
      valueJson: JSON.stringify(new Date().toISOString()),
    },
    update: { valueJson: JSON.stringify(new Date().toISOString()) },
  });
  return filePath;
}
