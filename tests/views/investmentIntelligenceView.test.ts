import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInvestmentIntelligenceView } from "../../src/views/investmentIntelligenceView";
import { createTestDb } from "../setup/testDb";

const RANGE = { start: new Date("2026-05-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };
const ASOF = new Date("2026-08-31T23:59:59.000Z");

describe("investment intelligence view — empty database", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reports insufficient data across every widget when nothing has been recorded", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);

    expect(view.portfolioXRay.result.kind).toBe("insufficient-data");
    expect(view.plannedVsActualAllocation.result.kind).toBe("insufficient-data");
    expect(view.growthDecomposition.result.kind).toBe("insufficient-data");
    expect(view.contributionVsReturn.result.kind).toBe("insufficient-data");
    expect(view.concentrationHeatmap.result.kind).toBe("insufficient-data");
    expect(view.drawdownMonitor.result.kind).toBe("insufficient-data");

    // Performance is "ok" at the wrapper level — it always reports a
    // structure — but every metric inside it is its own insufficient-data,
    // never a fabricated zero.
    expect(view.performance.result.kind).toBe("ok");
    if (view.performance.result.kind === "ok") {
      expect(view.performance.result.value.aggregatePnl.kind).toBe("insufficient-data");
      expect(view.performance.result.value.cagr.kind).toBe("insufficient-data");
      expect(view.performance.result.value.xirr.kind).toBe("insufficient-data");
    }

    // No confirmed buy/SIP has ever been recorded, so adherence is
    // insufficient for every month rather than "missed investment".
    expect(view.planAdherence.result.kind).toBe("ok");
    if (view.planAdherence.result.kind === "ok") {
      expect(view.planAdherence.result.value.every((row) => row.status === "insufficient-data")).toBe(
        true,
      );
    }

    // No dated observation exists for any tracked index either.
    expect(view.portfolioVsBenchmark.result.kind).toBe("ok");
    if (view.portfolioVsBenchmark.result.kind === "ok") {
      expect(
        view.portfolioVsBenchmark.result.value.every((row) => row.result.kind === "insufficient-data"),
      ).toBe(true);
    }
  });
});

describe("investment intelligence view — Portfolio X-Ray", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const priced = await db.instrument.create({
      data: { kind: "equity", identifier: "PRICED", displayName: "Priced Co" },
    });
    await db.valuation.create({
      data: { instrumentId: priced.id, asOfDate: new Date("2026-08-01T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: priced.id,
        asOfDate: new Date("2026-08-01T00:00:00Z"),
        quantity: 10,
        unit: "shares",
        costBasisMinorUnits: 8_000,
        trustState: "validated",
      },
    });

    const noCostBasis = await db.instrument.create({
      data: { kind: "mutual_fund", identifier: "NOCOST", displayName: "No Cost Basis Fund" },
    });
    await db.valuation.create({
      data: { instrumentId: noCostBasis.id, asOfDate: new Date("2026-08-01T00:00:00Z"), priceMinorUnits: 500, source: "test" },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: noCostBasis.id,
        asOfDate: new Date("2026-08-01T00:00:00Z"),
        quantity: 20,
        unit: "units",
        trustState: "validated",
      },
    });

    const untrusted = await db.instrument.create({
      data: { kind: "equity", identifier: "UNTRUSTED", displayName: "Needs Review Co" },
    });
    await db.valuation.create({
      data: { instrumentId: untrusted.id, asOfDate: new Date("2026-08-01T00:00:00Z"), priceMinorUnits: 2_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: untrusted.id,
        asOfDate: new Date("2026-08-01T00:00:00Z"),
        quantity: 5,
        unit: "shares",
        trustState: "needs_review",
      },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("shows current value for every trusted holding and marks P&L unavailable where no cost basis was recorded", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.portfolioXRay.result.kind).toBe("ok");
    if (view.portfolioXRay.result.kind !== "ok") return;

    const { holdings, totalMinorUnits, exclusions } = view.portfolioXRay.result.value;

    // The needs_review holding never reaches the total; it is excluded with a reason.
    expect(holdings.some((h) => h.instrumentLabel === "Needs Review Co")).toBe(false);
    expect(exclusions.some((e) => e.label === "Needs Review Co")).toBe(true);

    const priced = holdings.find((h) => h.instrumentLabel === "Priced Co");
    expect(priced?.valueMinorUnits).toBe(10_000);
    expect(priced?.profitAndLoss.kind).toBe("ok");
    if (priced?.profitAndLoss.kind === "ok") {
      expect(priced.profitAndLoss.value.absoluteMinorUnits).toBe(2_000);
    }
    expect(priced?.weightRatio).toBeCloseTo(10_000 / totalMinorUnits, 10);

    const noCost = holdings.find((h) => h.instrumentLabel === "No Cost Basis Fund");
    expect(noCost?.valueMinorUnits).toBe(10_000);
    expect(noCost?.profitAndLoss.kind).toBe("insufficient-data");
    expect(noCost?.costBasisMinorUnits).toBeNull();

    expect(totalMinorUnits).toBe(20_000);
  });
});

describe("investment intelligence view — Planned vs Actual Allocation", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await db.planRecord.createMany({
      data: [
        {
          periodMonth: "2026-08",
          category: "investment",
          labelRaw: "Equity Fund",
          labelNormalized: "equity fund",
          amountMinorUnits: 10_000,
          trustState: "validated",
        },
        {
          periodMonth: "2026-08",
          category: "investment",
          labelRaw: "Planned Only Fund",
          labelNormalized: "planned only fund",
          amountMinorUnits: 5_000,
          trustState: "validated",
        },
      ],
    });

    const equity = await db.instrument.create({
      data: { kind: "equity", identifier: "EQFUND", displayName: "Equity Fund" },
    });
    await db.valuation.create({
      data: { instrumentId: equity.id, asOfDate: new Date("2026-08-01T00:00:00Z"), priceMinorUnits: 100, source: "test" },
    });
    await db.positionSnapshot.create({
      data: { instrumentId: equity.id, asOfDate: new Date("2026-08-01T00:00:00Z"), quantity: 400, unit: "units", trustState: "validated" },
    });

    const observedOnly = await db.instrument.create({
      data: { kind: "gold", identifier: "GOLD", displayName: "Gold ETF" },
    });
    await db.valuation.create({
      data: { instrumentId: observedOnly.id, asOfDate: new Date("2026-08-01T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: { instrumentId: observedOnly.id, asOfDate: new Date("2026-08-01T00:00:00Z"), quantity: 10, unit: "units", trustState: "validated" },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("keeps a planned-only line and an observed-only line distinct, and flags drift direction from the sign of the gap", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.plannedVsActualAllocation.result.kind).toBe("ok");
    if (view.plannedVsActualAllocation.result.kind !== "ok") return;
    const rows = view.plannedVsActualAllocation.result.value;

    const equityFund = rows.find((r) => r.label === "Equity Fund");
    expect(equityFund?.plannedMinorUnits).toBe(10_000);
    expect(equityFund?.observedMinorUnits).toBe(40_000); // 400 * 100
    expect(equityFund?.status).toBe("overweight"); // 100% observed share vs a smaller planned share

    const plannedOnly = rows.find((r) => r.label === "Planned Only Fund");
    expect(plannedOnly?.status).toBe("planned_only");
    expect(plannedOnly?.observedMinorUnits).toBeNull();

    const observedOnly = rows.find((r) => r.label === "Gold ETF");
    expect(observedOnly?.status).toBe("observed_only");
    expect(observedOnly?.plannedMinorUnits).toBeNull();
  });
});

describe("investment intelligence view — Growth Decomposition, Contribution vs Return, Performance", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const stock = await db.instrument.create({
      data: { kind: "equity", identifier: "GROWTH", displayName: "Growth Co" },
    });

    // Opening: 100 units @ ₹10 = ₹1,000, cost basis ₹1,000 (bought at par).
    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-05-01T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: stock.id,
        asOfDate: new Date("2026-05-01T00:00:00Z"),
        quantity: 100,
        unit: "shares",
        costBasisMinorUnits: 100_000,
        trustState: "validated",
      },
    });

    // Mid-range: buy 50 more units @ ₹10 = ₹500 contribution. Quantity -> 150.
    await db.activity.create({
      data: {
        kind: "buy",
        instrumentId: stock.id,
        amountMinorUnits: 50_000,
        quantity: 50,
        occurredOn: new Date("2026-05-15T00:00:00Z"),
        trustState: "validated",
      },
    });
    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-05-15T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: stock.id,
        asOfDate: new Date("2026-05-15T00:00:00Z"),
        quantity: 150,
        unit: "shares",
        costBasisMinorUnits: 150_000,
        trustState: "validated",
      },
    });

    // Sell 20 units for ₹300 (some appreciation priced in). Quantity -> 130.
    await db.activity.create({
      data: {
        kind: "sell",
        instrumentId: stock.id,
        amountMinorUnits: 30_000,
        quantity: 20,
        occurredOn: new Date("2026-07-20T00:00:00Z"),
        trustState: "validated",
      },
    });
    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-07-20T00:00:00Z"), priceMinorUnits: 1_200, source: "test" },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: stock.id,
        asOfDate: new Date("2026-07-20T00:00:00Z"),
        quantity: 130,
        unit: "shares",
        costBasisMinorUnits: 130_000,
        trustState: "validated",
      },
    });

    // Closing: price rises to ₹15. Value = 130 * 1,500 = ₹1,950 = 195,000 paise.
    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-08-31T00:00:00Z"), priceMinorUnits: 1_500, source: "test" },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("decomposes growth into contribution, withdrawal and a residual — never labeling the buy as appreciation", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.growthDecomposition.result.kind).toBe("ok");
    if (view.growthDecomposition.result.kind !== "ok") return;
    const d = view.growthDecomposition.result.value;

    expect(d.openingMinorUnits).toBe(100_000); // 100 * 1,000
    expect(d.closingMinorUnits).toBe(195_000); // 130 * 1,500

    const contribution = d.steps.find((s) => s.kind === "contribution");
    const withdrawal = d.steps.find((s) => s.kind === "withdrawal");
    const appreciation = d.steps.find((s) => s.kind === "appreciation");
    expect(contribution?.amountMinorUnits).toBe(50_000);
    expect(withdrawal?.amountMinorUnits).toBe(-30_000);
    // opening 100,000 + contribution 50,000 - withdrawal 30,000 + residual = closing 195,000
    // residual = 195,000 - 100,000 - 50,000 + 30,000 = 75,000
    expect(appreciation?.amountMinorUnits).toBe(75_000);
    expect(d.isComplete).toBe(true);
    expect(d.unexplainedMinorUnits).toBeNull();
  });

  it("derives contribution vs return from the same decomposition rather than recomputing", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.contributionVsReturn.result.kind).toBe("ok");
    if (view.contributionVsReturn.result.kind !== "ok") return;
    const c = view.contributionVsReturn.result.value;

    expect(c.netContributionMinorUnits).toBe(50_000 - 30_000);
    expect(c.returnMinorUnits).toBe(75_000);
    expect(c.openingMinorUnits).toBe(100_000);
    expect(c.closingMinorUnits).toBe(195_000);
  });

  it("reports aggregate P&L, CAGR and XIRR only where each one's own data is sufficient", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.performance.result.kind).toBe("ok");
    if (view.performance.result.kind !== "ok") return;
    const { aggregatePnl, cagr, xirr } = view.performance.result.value;

    expect(aggregatePnl.kind).toBe("ok");
    if (aggregatePnl.kind === "ok") {
      expect(aggregatePnl.value.costBasisMinorUnits).toBe(130_000);
      expect(aggregatePnl.value.currentValueMinorUnits).toBe(195_000);
      expect(aggregatePnl.value.absoluteMinorUnits).toBe(65_000);
      expect(aggregatePnl.value.holdingsWithCostBasis).toBe(1);
      expect(aggregatePnl.value.holdingsWithoutCostBasis).toBe(0);
    }

    // The range spans May 1 – Aug 31, well over the 90-day annualization floor.
    expect(cagr.kind).toBe("ok");

    // Buy + sell both occurred, and a final "as if liquidated" inflow was
    // appended — enough for XIRR to solve.
    expect(xirr.kind).toBe("ok");
  });

  it("reports CAGR as insufficient rather than approximated for a window shorter than the annualization floor", async () => {
    const shortRange = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-15T00:00:00Z") };
    const view = await getInvestmentIntelligenceView(db, shortRange, new Date("2026-08-14T23:59:59Z"));
    if (view.performance.result.kind === "ok") {
      expect(view.performance.result.value.cagr.kind).toBe("insufficient-data");
    }
  });
});

describe("investment intelligence view — Concentration Heatmap", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const big = await db.instrument.create({
      data: { kind: "equity", identifier: "BIG", displayName: "Big Holding" },
    });
    await db.valuation.create({
      data: { instrumentId: big.id, asOfDate: new Date("2026-08-01T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: { instrumentId: big.id, asOfDate: new Date("2026-08-01T00:00:00Z"), quantity: 900, unit: "shares", trustState: "validated" },
    });

    const small = await db.instrument.create({
      data: { kind: "gold", identifier: "SMALL", displayName: "Small Holding" },
    });
    await db.valuation.create({
      data: { instrumentId: small.id, asOfDate: new Date("2026-08-01T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: { instrumentId: small.id, asOfDate: new Date("2026-08-01T00:00:00Z"), quantity: 100, unit: "grams", trustState: "validated" },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("flags the 90% holding as concentrated using the same 25% threshold the Portfolio screen applies", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.concentrationHeatmap.result.kind).toBe("ok");
    if (view.concentrationHeatmap.result.kind !== "ok") return;
    const { byInstrument, concentratedThresholdRatio } = view.concentrationHeatmap.result.value;

    const big = byInstrument.find((s) => s.key === "Big Holding");
    expect(big?.ratio).toBeCloseTo(0.9, 10);
    expect(concentratedThresholdRatio).toBe(0.25);
    expect(big && big.ratio > concentratedThresholdRatio).toBe(true);
  });
});

describe("investment intelligence view — Drawdown Monitor", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const stock = await db.instrument.create({
      data: { kind: "equity", identifier: "DRAWDOWN", displayName: "Drawdown Co" },
    });

    const points: Array<{ date: string; priceMinorUnits: number }> = [
      { date: "2026-05-10T00:00:00Z", priceMinorUnits: 100_00 },
      { date: "2026-06-10T00:00:00Z", priceMinorUnits: 150_00 },
      { date: "2026-07-10T00:00:00Z", priceMinorUnits: 90_00 },
      { date: "2026-08-10T00:00:00Z", priceMinorUnits: 120_00 },
    ];

    for (const point of points) {
      await db.valuation.create({
        data: { instrumentId: stock.id, asOfDate: new Date(point.date), priceMinorUnits: point.priceMinorUnits, source: "test" },
      });
      await db.positionSnapshot.create({
        data: { instrumentId: stock.id, asOfDate: new Date(point.date), quantity: 10, unit: "shares", trustState: "validated" },
      });
    }
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("finds the worst peak-to-trough decline across actual observation dates, and reports the still-open drawdown from the all-time peak", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.drawdownMonitor.result.kind).toBe("ok");
    if (view.drawdownMonitor.result.kind !== "ok") return;
    const d = view.drawdownMonitor.result.value;

    // Values: 1,000 / 1,500 / 900 / 1,200 (rupees, *100 for minor units).
    expect(d.peak.valueMinorUnits).toBe(150_000);
    expect(d.trough.valueMinorUnits).toBe(90_000);
    expect(d.maxDrawdownRatio).toBeCloseTo((90_000 - 150_000) / 150_000, 10);
    expect(d.currentDrawdownRatio).toBeCloseTo((120_000 - 150_000) / 150_000, 10);
    expect(d.recovered).toBe(false);
    expect(d.series).toHaveLength(4);
  });

  it("reports insufficient data with fewer than two valued observations in range", async () => {
    const narrowRange = { start: new Date("2026-05-01T00:00:00Z"), end: new Date("2026-05-20T00:00:00Z") };
    const view = await getInvestmentIntelligenceView(db, narrowRange, new Date("2026-05-19T00:00:00Z"));
    expect(view.drawdownMonitor.result.kind).toBe("insufficient-data");
  });
});

describe("investment intelligence view — Portfolio vs Benchmark", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const stock = await db.instrument.create({
      data: { kind: "equity", identifier: "BENCH", displayName: "Benchmarked Co" },
    });
    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-05-01T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-05-01T00:00:00Z"), quantity: 100, unit: "shares", trustState: "validated" },
    });
    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-08-31T00:00:00Z"), priceMinorUnits: 1_200, source: "test" },
    });

    // Only Nifty 50 gets dated observations at both boundaries; the others
    // are left with none, exactly like a fresh install with no market
    // refresh and no manual entry yet.
    const nifty = await db.instrument.create({
      data: { kind: "index", identifier: "NIFTY50", displayName: "Nifty 50" },
    });
    await db.valuation.create({
      data: { instrumentId: nifty.id, asOfDate: new Date("2026-05-01T00:00:00Z"), priceMinorUnits: 2_200_000, source: "test" },
    });
    await db.valuation.create({
      data: { instrumentId: nifty.id, asOfDate: new Date("2026-08-31T00:00:00Z"), priceMinorUnits: 2_420_000, source: "test" },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("compares the portfolio's own return against an index only where both ends have a dated observation, and never fabricates the rest", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.portfolioVsBenchmark.result.kind).toBe("ok");
    if (view.portfolioVsBenchmark.result.kind !== "ok") return;
    const rows = view.portfolioVsBenchmark.result.value;

    const nifty = rows.find((r) => r.indexCode === "NIFTY50");
    expect(nifty?.result.kind).toBe("ok");
    if (nifty?.result.kind === "ok") {
      expect(nifty.result.value.portfolioReturnRatio).toBeCloseTo(0.2, 10); // 1,000 -> 1,200
      expect(nifty.result.value.indexReturnRatio).toBeCloseTo(0.1, 10); // 22,00,000 -> 24,20,000
    }

    const sensex = rows.find((r) => r.indexCode === "SENSEX");
    expect(sensex?.result.kind).toBe("insufficient-data");
    const niftyMetal = rows.find((r) => r.indexCode === "NIFTY_METAL");
    expect(niftyMetal?.result.kind).toBe("insufficient-data");
  });
});

describe("investment intelligence view — Investment Plan Adherence", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await db.planRecord.createMany({
      data: [
        {
          periodMonth: "2026-06",
          category: "investment",
          labelRaw: "SIP",
          labelNormalized: "sip",
          amountMinorUnits: 10_000,
          trustState: "validated",
        },
        {
          periodMonth: "2026-07",
          category: "investment",
          labelRaw: "SIP",
          labelNormalized: "sip",
          amountMinorUnits: 10_000,
          trustState: "validated",
        },
        // August has no investment plan line at all.
      ],
    });

    const fund = await db.instrument.create({
      data: { kind: "mutual_fund", identifier: "SIPFUND", displayName: "SIP Fund" },
    });

    // June: exactly matches the plan.
    await db.activity.create({
      data: { kind: "sip", instrumentId: fund.id, amountMinorUnits: 10_000, occurredOn: new Date("2026-06-05T00:00:00Z"), trustState: "validated" },
    });
    // July: under-invested (only half the plan).
    await db.activity.create({
      data: { kind: "sip", instrumentId: fund.id, amountMinorUnits: 5_000, occurredOn: new Date("2026-07-05T00:00:00Z"), trustState: "validated" },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("compares planned vs confirmed SIP amount per month, flagging a month with no plan as insufficient rather than missed", async () => {
    const view = await getInvestmentIntelligenceView(db, RANGE, ASOF);
    expect(view.planAdherence.result.kind).toBe("ok");
    if (view.planAdherence.result.kind !== "ok") return;
    const rows = view.planAdherence.result.value;

    const may = rows.find((r) => r.periodMonth === "2026-05");
    expect(may?.status).toBe("insufficient-data");

    const june = rows.find((r) => r.periodMonth === "2026-06");
    expect(june?.status).toBe("exact");
    expect(june?.plannedMinorUnits).toBe(10_000);
    expect(june?.actualMinorUnits).toBe(10_000);

    const july = rows.find((r) => r.periodMonth === "2026-07");
    expect(july?.status).toBe("under-invested");
    expect(july?.actualMinorUnits).toBe(5_000);

    const august = rows.find((r) => r.periodMonth === "2026-08");
    expect(august?.status).toBe("insufficient-data");
    expect(august?.plannedMinorUnits).toBeNull();
  });
});
