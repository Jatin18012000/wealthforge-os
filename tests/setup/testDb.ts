import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Spins up an isolated SQLite database in a temp directory and syncs the
 * current Prisma schema to it, so persistence tests never touch the real
 * dev database at data/wealthforge.db.
 */
export function createTestDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "wealthforge-test-"));
  const dbPath = path.join(dir, "test.db");
  const url = `file:${dbPath}`;

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  const db = new PrismaClient({ datasources: { db: { url } } });

  return {
    db,
    dir,
    async cleanup() {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
