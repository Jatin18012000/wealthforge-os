import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { exportFullBackup, restoreFullBackup } from "../../src/backup";
import { createTestDb } from "../setup/testDb";

describe("Backup / restore", () => {
  const testDb = createTestDb();
  const backupDir = mkdtempSync(path.join(tmpdir(), "wealthforge-backup-"));
  const safetyDir = path.join(backupDir, "safety");

  afterEach(async () => {
    // Keep each test's fixture data isolated.
    await testDb.db.activity.deleteMany();
    await testDb.db.goal.deleteMany();
    await testDb.db.appSetting.deleteMany();
  });

  afterAll(async () => {
    await testDb.cleanup();
    rmSync(backupDir, { recursive: true, force: true });
  });

  it("round-trips: export then restore reproduces the same data", async () => {
    await testDb.db.goal.create({
      data: {
        name: "Round-trip goal",
        kind: "custom",
        targetAmountMinorUnits: 10_000,
        priorityRank: 1,
        lifecycleState: "planned",
      },
    });
    await testDb.db.appSetting.create({
      data: { key: "test_setting", valueJson: JSON.stringify({ a: 1 }) },
    });

    const backupPath = await exportFullBackup(testDb.db, backupDir);

    // Mutate the live data after the backup was taken.
    await testDb.db.goal.deleteMany();
    await testDb.db.appSetting.deleteMany();
    expect(await testDb.db.goal.count()).toBe(0);

    // Restoring the identical (unmodified) state back is not a "newer data"
    // conflict — the live DB has strictly less data than the backup, so
    // nothing would be lost by restoring.
    const result = await restoreFullBackup(testDb.db, backupPath, safetyDir);
    expect(result.status).toBe("restored");

    const goals = await testDb.db.goal.findMany();
    const settings = await testDb.db.appSetting.findMany();
    expect(goals).toHaveLength(1);
    expect(goals[0]!.name).toBe("Round-trip goal");
    expect(settings).toHaveLength(1);
    expect(JSON.parse(settings[0]!.valueJson)).toEqual({ a: 1 });
  });

  it("blocks a restore that would discard data newer than the backup, unless forced", async () => {
    await testDb.db.goal.create({
      data: {
        name: "Old goal",
        kind: "custom",
        targetAmountMinorUnits: 1_000,
        priorityRank: 1,
        lifecycleState: "planned",
      },
    });
    const backupPath = await exportFullBackup(testDb.db, backupDir);

    // Simulate time passing and new data being entered after the backup.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await testDb.db.goal.create({
      data: {
        name: "New goal entered after backup",
        kind: "custom",
        targetAmountMinorUnits: 2_000,
        priorityRank: 2,
        lifecycleState: "planned",
      },
    });

    const blocked = await restoreFullBackup(testDb.db, backupPath, safetyDir);
    expect(blocked.status).toBe("conflict");
    // Data must be untouched when blocked.
    expect(await testDb.db.goal.count()).toBe(2);

    // A safety backup must still have been taken even though restore was blocked.
    expect(blocked.safetyBackupPath).toBeTruthy();

    const forced = await restoreFullBackup(testDb.db, backupPath, safetyDir, { force: true });
    expect(forced.status).toBe("restored");
    const goalsAfterForce = await testDb.db.goal.findMany();
    expect(goalsAfterForce).toHaveLength(1);
    expect(goalsAfterForce[0]!.name).toBe("Old goal");
  });

  it("records an audit_event for both backup and restore", async () => {
    await testDb.db.auditEvent.deleteMany();
    const backupPath = await exportFullBackup(testDb.db, backupDir);
    await restoreFullBackup(testDb.db, backupPath, safetyDir);

    const events = await testDb.db.auditEvent.findMany();
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toContain("backup");
    expect(kinds).toContain("restore");
  });
});
