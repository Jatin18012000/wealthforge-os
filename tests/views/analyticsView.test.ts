import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../src/domain";
import { importBudgetWorkbook } from "../../src/ingestion";
import { getAnalyticsView } from "../../src/views/analyticsView";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/reference");
const ANCHOR = new Date("2026-09-01T00:00:00Z");

describe("analytics view", () => {
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

  it("compares two whole months against each other", async () => {
    const view = await getAnalyticsView(db, ANCHOR, "previous-month");
    const range = expectOk(view.range);

    // Anchored at 1 September, the previous month is August and the
    // comparison is July.
    expect(range.start.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(view.comparison?.current.coverage.monthsCounted).toEqual(["2026-08"]);
    expect(view.comparison?.prior.coverage.monthsCounted).toEqual(["2026-07"]);

    const income = view.comparison?.budgetVariances.find((v) => v.metric === "Income");
    // August 67,250 against July 65,750.
    expect(income?.currentMinorUnits).toBe(67_250 * 100);
    expect(income?.priorMinorUnits).toBe(65_750 * 100);
    expect(income?.absoluteMinorUnits).toBe(1_500 * 100);
    expect(income?.incomplete).toBe(false);
  });

  it("reports complete coverage when both periods are whole months with data", async () => {
    const view = await getAnalyticsView(db, ANCHOR, "previous-month");
    expect(view.comparison?.coverageNotes).toEqual([]);
    expect(view.comparison?.current.coverage.isComplete).toBe(true);
  });

  it("warns rather than pro-rating when a range only clips months", async () => {
    const view = await getAnalyticsView(db, new Date("2026-08-20T00:00:00Z"), "15d");

    expect(view.comparison?.current.budget.kind).toBe("insufficient-data");
    expect(
      view.comparison?.coverageNotes.some((note) => note.includes("excluded rather than divided up")),
    ).toBe(true);
  });

  it("flags months inside the range that have no data at all", async () => {
    // Anchored so the range reaches back before any budget month exists.
    const view = await getAnalyticsView(db, ANCHOR, "1y");
    expect(
      view.comparison?.coverageNotes.some((note) => note.includes("not as zero")),
    ).toBe(true);
  });

  it("supports comparing against the same period last year", async () => {
    const view = await getAnalyticsView(db, ANCHOR, "previous-month", {
      comparisonMode: "prior-year",
    });

    expect(view.comparisonMode).toBe("prior-year");
    expect(view.comparison?.prior.range.start.toISOString().slice(0, 10)).toBe("2025-08-01");
    // Nothing was recorded a year earlier, so it is an absence, not a zero.
    expect(view.comparison?.prior.budget.kind).toBe("insufficient-data");
  });

  it("refuses a period it cannot resolve rather than inventing a range", async () => {
    const view = await getAnalyticsView(db, ANCHOR, "custom");

    expect(view.range.kind).toBe("insufficient-data");
    expect(view.comparison).toBeNull();
  });

  it("resolves since-inception from the earliest data actually recorded", async () => {
    const view = await getAnalyticsView(db, ANCHOR, "since-inception");
    const range = expectOk(view.range);

    // May is the first month in the workbook.
    expect(range.start.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("compares planned investment lines against holdings, keeping each side distinct", async () => {
    const view = await getAnalyticsView(db, ANCHOR, "previous-month");

    // No holdings imported in this database, so every planned line is
    // unmatched — and shows as unheld rather than as zero.
    expect(view.allocation.length).toBeGreaterThan(0);
    expect(view.allocation.every((row) => row.observedMinorUnits === null)).toBe(true);
    expect(view.allocation.some((row) => row.plannedMinorUnits !== null)).toBe(true);
  });

  it("uses only fully-covered months for the planned side, matching the variance table", async () => {
    // A 15-day range covers no whole month, so there is no plan to compare —
    // showing one would contradict the variance table directly above it.
    const view = await getAnalyticsView(db, new Date("2026-08-20T00:00:00Z"), "15d");
    expect(view.allocation.every((row) => row.plannedMinorUnits === null)).toBe(true);
  });
});
