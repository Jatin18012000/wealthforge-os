/**
 * Manual backup/restore CLI for local use ahead of the Data Center UI (M9).
 *
 * Usage:
 *   pnpm backup:export
 *   pnpm backup:restore -- <path-to-backup.json> [--force]
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { exportFullBackup, restoreFullBackup } from "../src/backup";

const BACKUP_DIR = path.resolve("data/backups");
const SAFETY_DIR = path.resolve("data/backups/safety");

async function main() {
  const [, , command, ...rest] = process.argv;
  const db = new PrismaClient();

  try {
    if (command === "export") {
      const filePath = await exportFullBackup(db, BACKUP_DIR);
      console.log(`Backup written to ${filePath}`);
      return;
    }

    if (command === "restore") {
      const backupFilePath = rest.find((arg) => !arg.startsWith("--"));
      const force = rest.includes("--force");
      if (!backupFilePath) {
        throw new Error("Usage: pnpm backup:restore -- <path-to-backup.json> [--force]");
      }
      const result = await restoreFullBackup(db, backupFilePath, SAFETY_DIR, { force });
      if (result.status === "conflict") {
        console.error("Restore blocked — conflict detected:");
        console.error(result.conflict);
        console.error(`A safety backup was still taken at ${result.safetyBackupPath}`);
        console.error("Re-run with --force to restore anyway.");
        process.exitCode = 1;
        return;
      }
      console.log(`Restored from ${backupFilePath}. Safety backup: ${result.safetyBackupPath}`);
      return;
    }

    console.error("Usage: pnpm backup:export | pnpm backup:restore -- <file> [--force]");
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
