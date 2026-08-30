import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { exportFullBackup } from "../../src/backup";
import { listBackupFiles } from "../../src/data/dataCenterStore";
import { getDataCenterView } from "../../src/views/dataCenterView";
import { createTestDb } from "../setup/testDb";

describe("Data Center view", () => {
  const testDb = createTestDb();
  const db = testDb.db;
  const backupDir = mkdtempSync(path.join(tmpdir(), "wealthforge-dc-backups-"));

  afterAll(async () => {
    await testDb.cleanup();
    rmSync(backupDir, { recursive: true, force: true });
  });

  it("decodes an import audit_event into a readable summary", async () => {
    await db.auditEvent.create({
      data: {
        kind: "import",
        payloadJson: JSON.stringify({
          fileName: "August.xlsx",
          sheets: [{ sheetName: "August" }],
          recordsCreated: 12,
          recordsSuperseded: 2,
        }),
      },
    });

    const view = await getDataCenterView(db);
    const entry = view.auditLog.find((row) => row.kind === "import");

    expect(entry?.summary).toContain("August.xlsx");
    expect(entry?.summary).toContain("12");
  });

  it("decodes a portfolio import audit_event distinctly from a budget one", async () => {
    await db.auditEvent.create({
      data: {
        kind: "import",
        payloadJson: JSON.stringify({
          portfolioSnapshot: {
            fileName: "holdings.xlsx",
            positionsCreated: 6,
            positionsRevised: 1,
            observedChanges: [{ instrumentLabel: "X" }],
          },
        }),
      },
    });

    const view = await getDataCenterView(db);
    const entry = view.auditLog.find((row) => row.summary.includes("holdings.xlsx"));

    expect(entry?.summary).toContain("Portfolio snapshot");
    expect(entry?.summary).toContain("1 unexplained change");
  });

  it("decodes backup and restore events, including the automatic trigger", async () => {
    await db.auditEvent.create({
      data: {
        kind: "backup",
        payloadJson: JSON.stringify({ filePath: "/tmp/x.json", trigger: "automatic" }),
      },
    });
    await db.auditEvent.create({
      data: {
        kind: "restore",
        payloadJson: JSON.stringify({ backupFilePath: "/tmp/x.json", forced: true }),
      },
    });

    const view = await getDataCenterView(db);
    expect(view.auditLog.find((e) => e.kind === "backup")?.summary).toContain(
      "automatic",
    );
    expect(view.auditLog.find((e) => e.kind === "restore")?.summary).toContain("forced");
  });

  it("decodes a market_refresh audit_event summarizing every source", async () => {
    await db.auditEvent.create({
      data: {
        kind: "market_refresh",
        payloadJson: JSON.stringify([
          { source: "AMFI (mutual funds)", updatedCount: 2, failedCount: 0 },
          { source: "Yahoo Finance (indices)", updatedCount: 3, failedCount: 1 },
        ]),
      },
    });

    const view = await getDataCenterView(db);
    const entry = view.auditLog.find((row) => row.kind === "market_refresh");
    expect(entry?.summary).toContain("AMFI (mutual funds): 2 updated, 0 failed");
    expect(entry?.summary).toContain("Yahoo Finance (indices): 3 updated, 1 failed");
  });

  it("falls back to a plain label rather than crashing on an unreadable payload", async () => {
    const created = await db.auditEvent.create({
      data: { kind: "import", payloadJson: "{not json" },
    });

    const view = await getDataCenterView(db);
    const entry = view.auditLog.find((row) => row.id === created.id);
    expect(entry?.summary).toBeTruthy();
  });

  it("finds the just-performed event when highlighted by id", async () => {
    const created = await db.auditEvent.create({
      data: {
        kind: "manual_override",
        payloadJson: JSON.stringify({ entityType: "goal", field: "targetAmount" }),
      },
    });

    const view = await getDataCenterView(db, { highlightEventId: created.id });
    expect(view.justPerformed?.id).toBe(created.id);
  });

  it("returns null for justPerformed when no id is given or none matches", async () => {
    expect((await getDataCenterView(db)).justPerformed).toBeNull();
    expect(
      (await getDataCenterView(db, { highlightEventId: "nope" })).justPerformed,
    ).toBeNull();
  });

  it("summarizes trust states across budget lines, snapshots and activity", async () => {
    await db.planRecord.create({
      data: {
        periodMonth: "2026-08",
        category: "income",
        labelRaw: "Salary",
        labelNormalized: "salary",
        amountMinorUnits: 1000,
        trustState: "needs_review",
      },
    });

    const view = await getDataCenterView(db);
    const budgetLines = view.trustSummaries.find((s) => s.entityType === "plan_record");
    expect(budgetLines?.counts.needs_review).toBeGreaterThanOrEqual(1);
  });

  it("lists source documents with their record counts", async () => {
    const doc = await db.sourceDocument.create({
      data: { fileName: "August.xlsx", fileHash: "hash-1", kind: "budget_workbook" },
    });
    await db.planRecord.create({
      data: {
        periodMonth: "2026-08",
        category: "expense",
        labelRaw: "Rent",
        labelNormalized: "rent",
        amountMinorUnits: 500,
        sourceDocumentId: doc.id,
      },
    });

    const view = await getDataCenterView(db);
    const found = view.sourceDocuments.find((row) => row.id === doc.id);
    expect(found?.planRecordCount).toBeGreaterThanOrEqual(1);
  });

  it("lists revisions with the entity they correct", async () => {
    await db.revision.create({
      data: {
        entityType: "plan_record",
        entityId: "rec-1",
        originalValueJson: JSON.stringify(100),
        revisedValueJson: JSON.stringify(150),
        source: "import",
        reason: "corrected in a later upload",
      },
    });

    const view = await getDataCenterView(db);
    expect(view.revisions.some((row) => row.entityId === "rec-1")).toBe(true);
  });

  it("lists backup files on disk, newest first", async () => {
    const first = await exportFullBackup(db, backupDir, "a.json");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await exportFullBackup(db, backupDir, "b.json");

    const files = await listBackupFiles(backupDir);
    expect(files.map((f) => f.path)).toEqual([second, first]);
  });

  it("reads an empty backup directory as no backups rather than an error", async () => {
    const files = await listBackupFiles(path.join(backupDir, "does-not-exist"));
    expect(files).toEqual([]);
  });
});
