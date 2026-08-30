import type { PrismaClient } from "@prisma/client";
import type { BackupPayload } from "./types";

export async function buildBackupPayload(db: PrismaClient): Promise<BackupPayload> {
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    tables: {
      sourceDocument: await db.sourceDocument.findMany(),
      sheetSnapshot: await db.sheetSnapshot.findMany(),
      instrument: await db.instrument.findMany(),
      planRecord: await db.planRecord.findMany(),
      positionSnapshot: await db.positionSnapshot.findMany(),
      valuation: await db.valuation.findMany(),
      liability: await db.liability.findMany(),
      liabilityPayerSplit: await db.liabilityPayerSplit.findMany(),
      goal: await db.goal.findMany(),
      activity: await db.activity.findMany(),
      insurancePolicy: await db.insurancePolicy.findMany(),
      revision: await db.revision.findMany(),
      manualAdjustment: await db.manualAdjustment.findMany(),
      auditEvent: await db.auditEvent.findMany(),
      appSetting: await db.appSetting.findMany(),
    },
  };
}

export function countRows(payload: BackupPayload): Record<string, number> {
  return Object.fromEntries(
    Object.entries(payload.tables).map(([table, rows]) => [table, (rows as unknown[]).length]),
  );
}

/** Field names, in preference order, that carry a meaningful "last changed" timestamp for a row. */
const TIMESTAMP_FIELD_CANDIDATES = [
  "updatedAt",
  "createdAt",
  "importedAt",
  "uploadedAt",
  "occurredOn",
  "fetchedAt",
  "outstandingAsOf",
  "asOfDate",
  "effectiveFrom",
];

/**
 * The newest timestamp found anywhere in the payload. Used by restore to
 * detect whether the live database holds data created/changed after the
 * backup being restored was taken (docs/16_DATA_MIGRATION.md restore safety
 * sequence) — a coarse but conservative signal: if in doubt, it treats the
 * data as newer and surfaces a conflict rather than silently proceeding.
 */
export function getNewestTimestamp(payload: BackupPayload): Date | null {
  let newest: Date | null = null;
  for (const [table, rows] of Object.entries(payload.tables)) {
    // audit_event is an operational log, not financial data — every backup
    // and restore call writes one, which would otherwise make "current"
    // look newer than any backup purely from the act of backing up. Restore
    // conflict detection is about substantive data changing, so it's excluded.
    if (table === "auditEvent") continue;
    for (const row of rows as Array<Record<string, unknown>>) {
      for (const field of TIMESTAMP_FIELD_CANDIDATES) {
        const value = row[field];
        if (typeof value === "string" || value instanceof Date) {
          const date = new Date(value);
          if (!Number.isNaN(date.getTime()) && (!newest || date > newest)) {
            newest = date;
          }
        }
      }
    }
  }
  return newest;
}
