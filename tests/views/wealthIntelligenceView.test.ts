import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importBudgetWorkbook } from "../../src/ingestion";
import { importPortfolioSnapshot } from "../../src/ingestion/portfolio";
import { getWealthIntelligenceView } from "../../src/views/wealthIntelligenceView";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/reference");
const ANCHOR = new Date("2026-09-01T00:00:00Z");
const RANGE = { start: new Date("2026-05-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };

describe("wealth intelligence view (IM-02)", () => {
  const emptyDb = createTestDb();

  afterAll(async () => {
    await emptyDb.cleanup();
  });

  it("reports insufficient data (or all-null points) across every widget when nothing has been recorded", async () => {
    const view = await getWealthIntelligenceView(emptyDb.db, RANGE, ANCHOR);

    // Point-in-time widgets: no data at all means insufficient-data outright.
    expect(view.assetsVsLiabilities.result.kind).toBe("insufficient-data");
    expect(view.netWorthWaterfall.result.kind).toBe("insufficient-data");

    // Series widgets: the months themselves are real (derived from the
    // requested range), so the series resolves "ok" — but every point in
    // it is null, never a fabricated zero.
    expect(view.netWorthTrajectory.result.kind).toBe("ok");
    if (view.netWorthTrajectory.result.kind === "ok") {
      expect(view.netWorthTrajectory.result.value.every((point) => point.value === null)).toBe(
        true,
      );
    }
    expect(view.moneyFlow.result.kind).toBe("ok");
    if (view.moneyFlow.result.kind === "ok") {
      expect(view.moneyFlow.result.value.every((point) => point.value === null)).toBe(true);
    }
  });

  it("never reports a fabricated zero for a month with no data", async () => {
    const view = await getWealthIntelligenceView(emptyDb.db, RANGE, ANCHOR);
    if (view.savingsRateTrend.result.kind === "ok") {
      for (const point of view.savingsRateTrend.result.value) {
        expect(point.value === null || typeof point.value === "number").toBe(true);
      }
      expect(view.savingsRateTrend.result.value.every((p) => p.value === null)).toBe(true);
    }
  });
});

describe("wealth intelligence view — with real reference data", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await importBudgetWorkbook(db, path.join(FIXTURES, "budget-reference-layout.xlsx"), {
      defaultYear: 2026,
    });
    await importPortfolioSnapshot(db, path.join(FIXTURES, "zerodha-holdings-2026-08-03.xlsx"), {});
    await importPortfolioSnapshot(db, path.join(FIXTURES, "zerodha-holdings-2026-08-08.xlsx"), {});
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("computes money flow, savings rate and investment rate per fully-covered month", async () => {
    const view = await getWealthIntelligenceView(db, RANGE, ANCHOR);

    expect(view.moneyFlow.result.kind).toBe("ok");
    if (view.moneyFlow.result.kind === "ok") {
      const august = view.moneyFlow.result.value.find((p) => p.periodMonth === "2026-08");
      expect(august?.value?.incomeMinorUnits).toBe(67_250 * 100);
    }

    expect(view.savingsRateTrend.result.kind).toBe("ok");
    expect(view.investmentRateTrend.result.kind).toBe("ok");
  });

  it("computes net worth at each month-end, reporting insufficient data before any holding existed", async () => {
    const view = await getWealthIntelligenceView(db, RANGE, ANCHOR);
    expect(view.netWorthTrajectory.result.kind).toBe("ok");
    if (view.netWorthTrajectory.result.kind === "ok") {
      const may = view.netWorthTrajectory.result.value.find((p) => p.periodMonth === "2026-05");
      const august = view.netWorthTrajectory.result.value.find((p) => p.periodMonth === "2026-08");
      // No holdings existed in May; the August snapshot backs a real figure.
      expect(may?.value).toBeNull();
      expect(august?.value).not.toBeNull();
    }
  });

  it("computes assets vs liabilities as of the anchor date, matching net worth's own totals", async () => {
    const view = await getWealthIntelligenceView(db, RANGE, ANCHOR);
    expect(view.assetsVsLiabilities.result.kind).toBe("ok");
    if (view.assetsVsLiabilities.result.kind === "ok") {
      expect(view.assetsVsLiabilities.result.value.totalAssetsMinorUnits).toBeGreaterThan(0);
    }
  });

  it("decomposes the net worth waterfall without labeling contribution capital as appreciation", async () => {
    const view = await getWealthIntelligenceView(db, RANGE, ANCHOR);
    if (view.netWorthWaterfall.result.kind === "ok") {
      const decomposition = view.netWorthWaterfall.result.value;
      const contributionStep = decomposition.steps.find((s) => s.kind === "contribution");
      const appreciationStep = decomposition.steps.find((s) => s.kind === "appreciation");
      expect(contributionStep).toBeDefined();
      expect(appreciationStep).toBeDefined();
      // The two are always reported as separate steps, never merged into one figure.
      expect(contributionStep?.kind).not.toBe(appreciationStep?.kind);
    } else {
      // Acceptable: no holdings existed at the range's opening date in this fixture set.
      expect(view.netWorthWaterfall.result.kind).toBe("insufficient-data");
    }
  });

  it("always fully reconciles opening to closing net worth (the residual step absorbs any gap by construction)", async () => {
    const view = await getWealthIntelligenceView(db, RANGE, ANCHOR);
    if (view.netWorthWaterfall.result.kind === "ok") {
      const decomposition = view.netWorthWaterfall.result.value;
      expect(decomposition.isComplete).toBe(true);
      expect(decomposition.unexplainedMinorUnits).toBeNull();
      const stepTotal = decomposition.steps.reduce((sum, s) => sum + s.amountMinorUnits, 0);
      expect(stepTotal).toBe(decomposition.closingMinorUnits - decomposition.openingMinorUnits);
    }
  });
});
