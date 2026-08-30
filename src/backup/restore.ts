import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { exportFullBackup } from "./export";
import { buildBackupPayload, getNewestTimestamp } from "./payload";
import { TABLE_ORDER_PARENTS_FIRST, type BackupPayload, type RestoreResult } from "./types";

/**
 * Restore safety sequence (docs/16_DATA_MIGRATION.md, mandatory, no
 * exceptions):
 *   1. Take a safety backup of the current live state first.
 *   2. Compare the backup being restored against current data by timestamp.
 *   3. If the restore would overwrite data newer than the backup, surface
 *      the conflict and require an explicit `force` to proceed — never
 *      silently destroy newer data.
 *   4. On a confirmed restore, write an audit_event recording what happened.
 */
export async function restoreFullBackup(
  db: PrismaClient,
  backupFilePath: string,
  safetyBackupDir: string,
  options: { force?: boolean } = {},
): Promise<RestoreResult> {
  const safetyBackupPath = await exportFullBackup(db, safetyBackupDir);

  const raw = await readFile(backupFilePath, "utf-8");
  const backupPayload = JSON.parse(raw) as BackupPayload;
  if (backupPayload.formatVersion !== 1) {
    throw new Error(`Unsupported backup format version: ${String(backupPayload.formatVersion)}`);
  }

  const currentPayload = await buildBackupPayload(db);
  const currentNewest = getNewestTimestamp(currentPayload);
  const backupNewest = getNewestTimestamp(backupPayload);

  const wouldOverwriteNewerData =
    !options.force && currentNewest !== null && backupNewest !== null && currentNewest > backupNewest;

  if (wouldOverwriteNewerData) {
    return {
      status: "conflict",
      safetyBackupPath,
      conflict: {
        reason:
          "The live database contains data newer than this backup. Restoring would discard it. Re-run with force to proceed anyway.",
        currentNewestTimestamp: currentNewest!.toISOString(),
        backupNewestTimestamp: backupNewest?.toISOString() ?? "unknown",
      },
    };
  }

  await applyRestore(db, backupPayload);

  await db.auditEvent.create({
    data: {
      kind: "restore",
      payloadJson: JSON.stringify({
        backupFilePath,
        safetyBackupPath,
        forced: Boolean(options.force),
      }),
    },
  });

  return { status: "restored", safetyBackupPath };
}

// audit_event is an append-only, immutable log (docs/05_DOMAIN_MODEL.md:
// "an immutable log entry for imports, revisions, manual overrides, rule
// changes, and restores"). A restore must never wipe or replace it with a
// stale snapshot from the backup being restored — that would destroy the
// very trail that recorded this restore's own safety backup. Every other
// table is restored to the backup's snapshot; audit_event is left alone.
const RESTORABLE_TABLES = TABLE_ORDER_PARENTS_FIRST.filter((table) => table !== "auditEvent");

async function applyRestore(db: PrismaClient, payload: BackupPayload): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const table of [...RESTORABLE_TABLES].reverse()) {
      await deleteAllRows(tx as PrismaClient, table);
    }
    for (const table of RESTORABLE_TABLES) {
      const rows = payload.tables[table];
      if (rows.length === 0) continue;
      await insertRows(tx as PrismaClient, table, rows);
    }
  });
}

async function deleteAllRows(
  tx: PrismaClient,
  table: keyof BackupPayload["tables"],
): Promise<void> {
  const model = tx[table] as unknown as { deleteMany: () => Promise<unknown> };
  await model.deleteMany();
}

async function insertRows(
  tx: PrismaClient,
  table: keyof BackupPayload["tables"],
  rows: unknown[],
): Promise<void> {
  const model = tx[table] as unknown as { createMany: (args: { data: unknown[] }) => Promise<unknown> };
  await model.createMany({ data: rows.map(reviveDates) });
}

const DATE_FIELD_NAMES = new Set([
  "uploadedAt",
  "importedAt",
  "createdAt",
  "updatedAt",
  "occurredOn",
  "asOfDate",
  "fetchedAt",
  "outstandingAsOf",
  "effectiveFrom",
  "targetDate",
]);

/** Prisma expects Date objects for DateTime columns; JSON round-trips them as strings. */
function reviveDates(row: unknown): unknown {
  if (typeof row !== "object" || row === null) return row;
  const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    if (DATE_FIELD_NAMES.has(key) && typeof copy[key] === "string") {
      copy[key] = new Date(copy[key] as string);
    }
  }
  return copy;
}
