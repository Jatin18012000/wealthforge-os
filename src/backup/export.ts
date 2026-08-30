import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { buildBackupPayload, countRows } from "./payload";

/**
 * Dumps every table to one JSON backup file. Per docs/16_DATA_MIGRATION.md,
 * a full backup must capture the database, historical records, revisions,
 * goals, transactions, settings, audit logs, and provenance — this reads
 * every table, not a curated subset.
 */
export async function exportFullBackup(
  db: PrismaClient,
  outDir: string,
  fileName = `wealthforge-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  trigger: "manual" | "automatic" = "manual",
): Promise<string> {
  const payload = await buildBackupPayload(db);

  await mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, fileName);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");

  await db.auditEvent.create({
    data: {
      kind: "backup",
      payloadJson: JSON.stringify({ filePath, trigger, tableCounts: countRows(payload) }),
    },
  });

  return filePath;
}
