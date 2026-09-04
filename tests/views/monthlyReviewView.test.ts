import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importBudgetWorkbook } from "../../src/ingestion";
import { getMonthlyReviewReport } from "../../src/views/monthlyReviewView";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/reference");

describe("monthly review — empty database", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("resolves a calendar month even with no data, but reports insufficient data in every data-bearing section", async () => {
    const report = await getMonthlyReviewReport(db);
    // "Previous month" is a calendar period, resolvable from today's date
    // alone — whether any data exists for it is a separate question each
    // section answers for itself below.
    expect(report.periodMonth).not.toBeNull();

    const incomeExpense = report.sections.find((s) => s.title === "Income & Expenses");
    expect(incomeExpense?.lines[0]?.text).toContain("Insufficient data");

    const planVsReality = report.sections.find((s) => s.title === "Plan vs reality");
    expect(planVsReality?.lines[0]?.text).toContain("Insufficient data");

    const goals = report.sections.find((s) => s.title === "Goals");
    expect(goals?.lines[0]?.text).toContain("Insufficient data");

    for (const section of report.sections) {
      expect(section.lines.length).toBeGreaterThan(0);
    }
  });
});

describe("monthly review — with imported budget data", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await importBudgetWorkbook(db, path.join(FIXTURES, "budget-reference-layout.xlsx"), {
      defaultYear: 2026,
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("produces every section, each labeled fact/inference/recommendation", async () => {
    const report = await getMonthlyReviewReport(db);
    expect(report.sections.map((s) => s.title)).toEqual([
      "Period",
      "Income & Expenses",
      "Month-over-month",
      "Plan vs reality",
      "Goals",
      "Liabilities & EMI",
      "Data quality",
    ]);

    for (const section of report.sections) {
      for (const line of section.lines) {
        expect(["fact", "inference", "recommendation"]).toContain(line.kind);
      }
    }
  });

  it("reviews the most recently completed month, never the current one", async () => {
    const report = await getMonthlyReviewReport(db);
    expect(report.periodMonth).not.toBeNull();
    const period = report.sections.find((s) => s.title === "Period");
    expect(period?.lines[0]?.text).toContain("most recently completed month");
  });

  it("carries a generation timestamp", async () => {
    const report = await getMonthlyReviewReport(db);
    expect(report.generatedAt).toBeInstanceOf(Date);
  });

  it("says so when no goal is tracked, rather than showing an empty section", async () => {
    const report = await getMonthlyReviewReport(db);
    const goals = report.sections.find((s) => s.title === "Goals");
    expect(goals?.lines.length).toBeGreaterThan(0);
  });
});
