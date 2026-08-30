/**
 * Full-backup payload shape. One JSON document capturing every table, per
 * docs/16_DATA_MIGRATION.md. Order matters for restore: parents before
 * children, so foreign keys resolve on insert.
 */
export interface BackupPayload {
  formatVersion: 1;
  exportedAt: string; // ISO timestamp
  tables: {
    sourceDocument: unknown[];
    sheetSnapshot: unknown[];
    instrument: unknown[];
    planRecord: unknown[];
    positionSnapshot: unknown[];
    valuation: unknown[];
    liability: unknown[];
    liabilityPayerSplit: unknown[];
    goal: unknown[];
    activity: unknown[];
    insurancePolicy: unknown[];
    revision: unknown[];
    manualAdjustment: unknown[];
    auditEvent: unknown[];
    appSetting: unknown[];
  };
}

/**
 * Table order for delete (children first) and insert (parents first).
 * Includes `auditEvent` for completeness of the export payload — restore
 * (src/backup/restore.ts) deliberately excludes it from the wipe/reinsert
 * cycle since it's an append-only log, not restorable state.
 */
export const TABLE_ORDER_PARENTS_FIRST: Array<keyof BackupPayload["tables"]> = [
  "sourceDocument",
  "instrument",
  "goal",
  "liability",
  "sheetSnapshot",
  "planRecord",
  "positionSnapshot",
  "valuation",
  "liabilityPayerSplit",
  "activity",
  "insurancePolicy",
  "revision",
  "manualAdjustment",
  "auditEvent",
  "appSetting",
];

export interface RestoreConflict {
  reason: string;
  currentNewestTimestamp: string;
  backupNewestTimestamp: string;
}

export interface RestoreResult {
  status: "restored" | "conflict";
  safetyBackupPath: string;
  conflict?: RestoreConflict;
}
