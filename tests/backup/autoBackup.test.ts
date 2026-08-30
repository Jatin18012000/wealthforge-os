import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { backupAfterImport, ensureAutomaticBackup } from "../../src/backup";
import { createTestDb } from "../setup/testDb";

describe("automatic backup scheduling", () => {
  const testDb = createTestDb();
  const db = testDb.db;
  const backupDir = mkdtempSync(path.join(tmpdir(), "wealthforge-auto-backup-"));

  afterAll(async () => {
    await testDb.cleanup();
    rmSync(backupDir, { recursive: true, force: true });
  });

  it("runs a backup the first time it is ever checked", async () => {
    const result = await ensureAutomaticBackup(db, backupDir);
    expect(result.ranBackup).toBe(true);
    expect(result.filePath).not.toBeNull();
  });

  it("does not run again before the interval elapses", async () => {
    const result = await ensureAutomaticBackup(db, backupDir);
    expect(result.ranBackup).toBe(false);
    expect(result.filePath).toBeNull();
    expect(result.nextDueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("respects a configured interval override", async () => {
    await db.appSetting.upsert({
      where: { key: "autoBackupIntervalHours" },
      create: { key: "autoBackupIntervalHours", valueJson: "0.00001" },
      update: { valueJson: "0.00001" },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = await ensureAutomaticBackup(db, backupDir);
    expect(result.ranBackup).toBe(true);
  });

  it("records the automatic trigger on the audit_event it writes", async () => {
    await db.appSetting
      .delete({ where: { key: "autoBackupIntervalHours" } })
      .catch(() => undefined);
    await db.appSetting
      .delete({ where: { key: "lastAutoBackupAt" } })
      .catch(() => undefined);

    await ensureAutomaticBackup(db, backupDir);

    const events = await db.auditEvent.findMany({
      where: { kind: "backup" },
      orderBy: { createdAt: "desc" },
    });
    const payload = JSON.parse(events[0]!.payloadJson);
    expect(payload.trigger).toBe("automatic");
  });

  it("backupAfterImport always runs, ignoring the interval", async () => {
    const first = await backupAfterImport(db, backupDir);
    const second = await backupAfterImport(db, backupDir);
    expect(first).not.toBe(second);
  });
});
