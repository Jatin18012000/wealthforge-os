import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importBudgetWorkbook } from "../../src/ingestion";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/budget");
const fixture = (name: string) => path.join(FIXTURES, name);

const BASE = fixture("2026-budget-v1-base.xlsx");
const MODIFIED_AUGUST = fixture("2026-budget-v2-modified-august.xlsx");
const RENAMED_AUGUST = fixture("2026-budget-v3-renamed-august.xlsx");
const DELETED_AUGUST = fixture("2026-budget-v4-deleted-august.xlsx");
const MALFORMED = fixture("2026-budget-v5-malformed.xlsx");
const UNEXPECTED_SHEET = fixture("2026-budget-v6-unexpected-sheet.xlsx");
const IDENTICAL_REUPLOAD = fixture("2026-budget-v7-identical-reupload.xlsx");
const CONFLICTING_ROWS = fixture("2026-budget-v8-conflicting-rows.xlsx");
const DUPLICATE_ROWS = fixture("2026-budget-v9-duplicate-rows.xlsx");

const OPTIONS = { defaultYear: 2026 };

describe("budget workbook ingestion", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeEach(async () => {
    await db.revision.deleteMany();
    await db.planRecord.deleteMany();
    await db.sheetSnapshot.deleteMany();
    await db.sourceDocument.deleteMany();
    await db.auditEvent.deleteMany();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("scans every sheet on a first import and reports them all as new", async () => {
    const audit = await importBudgetWorkbook(db, BASE, OPTIONS);

    expect(audit.sheetsScanned).toBe(5);
    expect(audit.counts.new).toBe(5);
    expect(audit.counts.modified).toBe(0);
    expect(audit.counts.unchanged).toBe(0);
    expect(audit.counts.conflict).toBe(0);
    expect(audit.isRepeatUpload).toBe(false);

    // Four month sheets produce plan records; "Core expenses" is a reference
    // sheet and carries no period, so it contributes none.
    const records = await db.planRecord.findMany();
    expect(records.length).toBe(4 * 7);
    expect(new Set(records.map((r) => r.periodMonth))).toEqual(
      new Set(["2026-05", "2026-06", "2026-07", "2026-08"]),
    );

    const reference = await db.sheetSnapshot.findFirst({
      where: { sheetName: "Core expenses" },
    });
    expect(reference?.sheetKind).toBe("reference");
  });

  it("stores provenance and normalized labels alongside the raw source text", async () => {
    await importBudgetWorkbook(db, BASE, OPTIONS);

    const salary = await db.planRecord.findFirstOrThrow({
      where: { periodMonth: "2026-08", category: "income" },
    });

    expect(salary.labelRaw).toBe("Salary (take-home)");
    expect(salary.labelNormalized).toBe("salary take home");
    expect(salary.amountMinorUnits).toBe(63_500 * 100);
    expect(salary.trustState).toBe("validated");
    expect(salary.sourceDocumentId).not.toBeNull();
    expect(salary.sheetSnapshotId).not.toBeNull();
  });

  it("is idempotent: re-uploading identical content creates no new records", async () => {
    const first = await importBudgetWorkbook(db, BASE, OPTIONS);
    const recordsAfterFirst = await db.planRecord.count();

    const second = await importBudgetWorkbook(db, IDENTICAL_REUPLOAD, OPTIONS);

    expect(second.counts.unchanged).toBe(5);
    expect(second.counts.new).toBe(0);
    expect(second.counts.modified).toBe(0);
    expect(second.recordsCreated).toBe(0);
    expect(second.recordsSuperseded).toBe(0);

    expect(await db.planRecord.count()).toBe(recordsAfterFirst);
    expect(first.recordsCreated).toBeGreaterThan(0);
  });

  it("treats a byte-identical re-upload of the same file as a repeat upload", async () => {
    await importBudgetWorkbook(db, BASE, OPTIONS);
    const repeat = await importBudgetWorkbook(db, BASE, OPTIONS);

    expect(repeat.isRepeatUpload).toBe(true);
    expect(repeat.counts.unchanged).toBe(5);
    // The same file must not produce a second source_document row.
    expect(await db.sourceDocument.count()).toBe(1);
  });

  it("revises a corrected historical month without destroying the original", async () => {
    await importBudgetWorkbook(db, BASE, OPTIONS);

    const before = await db.planRecord.findFirstOrThrow({
      where: { periodMonth: "2026-08", labelNormalized: "groceries" },
    });
    expect(before.amountMinorUnits).toBe(8_100 * 100);

    const audit = await importBudgetWorkbook(db, MODIFIED_AUGUST, OPTIONS);

    expect(audit.counts.modified).toBe(1);
    expect(audit.counts.unchanged).toBe(4);
    expect(audit.recordsSuperseded).toBe(1);

    // Original retained, untouched in value, marked superseded and pointed
    // at its replacement.
    const originalAfter = await db.planRecord.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(originalAfter.amountMinorUnits).toBe(8_100 * 100);
    expect(originalAfter.trustState).toBe("superseded");
    expect(originalAfter.supersededById).not.toBeNull();

    // Current effective value is the correction.
    const effective = await db.planRecord.findFirstOrThrow({
      where: {
        periodMonth: "2026-08",
        labelNormalized: "groceries",
        supersededById: null,
      },
    });
    expect(effective.amountMinorUnits).toBe(8_600 * 100);

    // The change is recorded as a revision with both values.
    const revision = await db.revision.findFirstOrThrow({
      where: { entityType: "plan_record", entityId: before.id },
    });
    expect(JSON.parse(revision.originalValueJson).amountMinorUnits).toBe(8_100 * 100);
    expect(JSON.parse(revision.revisedValueJson).amountMinorUnits).toBe(8_600 * 100);
  });

  it("touches only the modified sheet's records, leaving other months untouched", async () => {
    await importBudgetWorkbook(db, BASE, OPTIONS);
    const julyBefore = await db.planRecord.findMany({
      where: { periodMonth: "2026-07" },
      orderBy: { labelNormalized: "asc" },
    });

    await importBudgetWorkbook(db, MODIFIED_AUGUST, OPTIONS);

    const julyAfter = await db.planRecord.findMany({
      where: { periodMonth: "2026-07" },
      orderBy: { labelNormalized: "asc" },
    });
    expect(julyAfter).toEqual(julyBefore);
  });

  it("flags a vanished sheet as deleted-or-renamed and keeps its history", async () => {
    await importBudgetWorkbook(db, BASE, OPTIONS);
    const augustRecordsBefore = await db.planRecord.count({
      where: { periodMonth: "2026-08" },
    });
    expect(augustRecordsBefore).toBeGreaterThan(0);

    const audit = await importBudgetWorkbook(db, DELETED_AUGUST, OPTIONS);

    expect(audit.counts.deleted_renamed).toBe(1);
    expect(
      audit.sheets.find((s) => s.classification === "deleted_renamed")?.sheetName,
    ).toBe("August");

    // Historical data is sacred: the records survive the sheet's removal.
    expect(await db.planRecord.count({ where: { periodMonth: "2026-08" } })).toBe(
      augustRecordsBefore,
    );
  });

  it("reports a renamed sheet as both a new sheet and a vanished one, without guessing", async () => {
    await importBudgetWorkbook(db, BASE, OPTIONS);
    const audit = await importBudgetWorkbook(db, RENAMED_AUGUST, OPTIONS);

    const classifications = Object.fromEntries(
      audit.sheets.map((s) => [s.sheetName, s.classification]),
    );
    expect(classifications["Aug-26"]).toBe("new");
    expect(classifications["August"]).toBe("deleted_renamed");

    // "Aug-26" resolves to the same period as the sheet it replaced, so the
    // rename must not fragment or duplicate August's history. The renamed
    // sheet carries identical content, so the period must still hold exactly
    // one effective record per budget line — a rename must never double-count.
    const effective = await db.planRecord.findMany({
      where: { periodMonth: "2026-08", supersededById: null },
    });
    expect(effective).toHaveLength(7);

    const labels = effective.map((r) => r.labelNormalized).sort();
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("flags malformed cells for review instead of coercing them", async () => {
    const audit = await importBudgetWorkbook(db, MALFORMED, OPTIONS);

    expect(audit.rowsNeedingReview).toBeGreaterThan(0);

    const needsReview = await db.planRecord.findMany({
      where: { trustState: "needs_review" },
    });
    expect(needsReview.length).toBeGreaterThan(0);

    // The unparseable "TBD" amount is stored as NULL, never as 0 — a missing
    // value and a genuine zero are different financial claims.
    const tbdRow = await db.planRecord.findFirstOrThrow({
      where: { periodMonth: "2026-08", labelNormalized: "sip total" },
    });
    expect(tbdRow.amountMinorUnits).toBeNull();
    expect(tbdRow.trustState).toBe("needs_review");

    // The converse must also hold: a genuine ₹0 line (the fixtures' "Rent/
    // Housing" rows) stays 0 and stays trusted — it is a real claim, not a
    // parse failure, and must not be swept into needs_review.
    const genuineZero = await db.planRecord.findFirstOrThrow({
      where: { periodMonth: "2026-08", labelNormalized: "rent housing" },
    });
    expect(genuineZero.amountMinorUnits).toBe(0);
    expect(genuineZero.trustState).toBe("validated");
  });

  it("surfaces an unexpected sheet rather than importing or ignoring it silently", async () => {
    const audit = await importBudgetWorkbook(db, UNEXPECTED_SHEET, OPTIONS);

    const notes = audit.sheets.find((s) => s.sheetName === "Random Notes");
    expect(notes?.kind).toBe("unrecognized");
    expect(audit.sheetIssues.some((issue) => issue.includes("Random Notes"))).toBe(true);

    // Retained for provenance, but contributes no budget data.
    const snapshot = await db.sheetSnapshot.findFirstOrThrow({
      where: { sheetName: "Random Notes" },
    });
    expect(snapshot.sheetKind).toBe("unrecognized");
  });

  it("refuses to write anything from a sheet making contradictory claims", async () => {
    const audit = await importBudgetWorkbook(db, CONFLICTING_ROWS, OPTIONS);

    expect(audit.counts.conflict).toBe(1);
    const conflict = audit.sheets.find((s) => s.classification === "conflict");
    expect(conflict?.sheetName).toBe("August");
    expect(conflict?.conflictReason).toContain("Groceries");

    // Nothing from the conflicting sheet may be persisted — picking either
    // value would silently discard the other.
    expect(await db.planRecord.count({ where: { periodMonth: "2026-08" } })).toBe(0);

    // The other months import normally; one bad sheet doesn't block the file.
    expect(await db.planRecord.count({ where: { periodMonth: "2026-07" } })).toBe(7);

    // The conflict is retained for review, not silently dropped.
    const snapshot = await db.sheetSnapshot.findFirstOrThrow({
      where: { sheetName: "August" },
    });
    expect(snapshot.classification).toBe("conflict");
    expect(audit.sheetIssues.some((i) => i.includes("Groceries"))).toBe(true);
  });

  it("flags exact duplicate rows rather than collapsing or double counting them", async () => {
    const audit = await importBudgetWorkbook(db, DUPLICATE_ROWS, OPTIONS);

    // Identical rows make the same claim twice, so this is not a conflict —
    // but it is unresolvable without a human, so both copies are flagged.
    expect(audit.counts.conflict).toBe(0);

    const groceries = await db.planRecord.findMany({
      where: { periodMonth: "2026-08", labelNormalized: "groceries" },
    });
    expect(groceries).toHaveLength(2);
    // Neither copy is trusted, so the duplicate cannot inflate any total...
    expect(groceries.every((r) => r.trustState === "needs_review")).toBe(true);
    // ...and neither was silently discarded either.
    expect(groceries.every((r) => r.amountMinorUnits === 8_100 * 100)).toBe(true);
  });

  it("writes an Import Audit as an audit event on every upload", async () => {
    await importBudgetWorkbook(db, BASE, OPTIONS);

    const event = await db.auditEvent.findFirstOrThrow({ where: { kind: "import" } });
    const payload = JSON.parse(event.payloadJson);
    expect(payload.sheetsScanned).toBe(5);
    expect(payload.counts.new).toBe(5);
    expect(payload.fileHash).toHaveLength(64);
  });
});

describe("displayFileName override", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("records the display name instead of the on-disk path's basename when supplied", async () => {
    // Mirrors what src/app/data-center/actions.ts does with a browser
    // upload: the file lives on disk under a generated name, but the
    // Import Audit and provenance list should show what the user uploaded.
    const audit = await importBudgetWorkbook(db, BASE, {
      ...OPTIONS,
      displayFileName: "August Household Budget.xlsx",
    });

    expect(audit.fileName).toBe("August Household Budget.xlsx");

    const stored = await db.sourceDocument.findFirst();
    expect(stored?.fileName).toBe("August Household Budget.xlsx");
  });

  it("falls back to the path's basename when no override is given", async () => {
    await db.sourceDocument.deleteMany();
    const audit = await importBudgetWorkbook(db, BASE, OPTIONS);
    expect(audit.fileName).toBe(path.basename(BASE));
  });
});
