import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getScenarioEngineView } from "../../src/views/scenarioEngineView";
import { createTestDb } from "../setup/testDb";

const ASOF = new Date("2026-08-31T00:00:00Z");

describe("scenario engine view — empty database", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reports insufficient data across every widget when nothing has been recorded", async () => {
    const view = await getScenarioEngineView(db, ASOF, null);

    expect(view.sipIncreaseSimulator.result.kind).toBe("insufficient-data");
    expect(view.debtPrepaymentSimulator.result.kind).toBe("insufficient-data");
    expect(view.wealthProjection.result.kind).toBe("insufficient-data");
    expect(view.financialIndependenceProjection.result.kind).toBe("insufficient-data");
  });
});

describe("scenario engine view — with real reference data", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const stock = await db.instrument.create({
      data: { kind: "equity", identifier: "GROWTH", displayName: "Growth Co" },
    });

    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-01-01T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: stock.id,
        asOfDate: new Date("2026-01-01T00:00:00Z"),
        quantity: 100,
        unit: "shares",
        trustState: "validated",
      },
    });
    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-08-31T00:00:00Z"), priceMinorUnits: 1_500, source: "test" },
    });

    await db.liability.create({
      data: {
        name: "Personal Loan",
        kind: "other",
        principalMinorUnits: 60_000,
        outstandingMinorUnits: 50_000,
        outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
        interestRateBps: 1_200,
        tenureMonths: 24,
        emiAmountMinorUnits: 5_000,
      },
    });

    await db.planRecord.createMany({
      data: [
        {
          periodMonth: "2026-08",
          category: "income",
          labelRaw: "Salary",
          labelNormalized: "salary",
          amountMinorUnits: 100_000,
          trustState: "validated",
        },
        {
          periodMonth: "2026-08",
          category: "expense",
          labelRaw: "Expenses",
          labelNormalized: "expenses",
          amountMinorUnits: 30_000,
          trustState: "validated",
        },
        {
          periodMonth: "2026-08",
          category: "emi",
          labelRaw: "EMI",
          labelNormalized: "emi",
          amountMinorUnits: 5_000,
          trustState: "validated",
        },
        {
          periodMonth: "2026-08",
          category: "investment",
          labelRaw: "SIP",
          labelNormalized: "sip",
          amountMinorUnits: 20_000,
          trustState: "validated",
        },
      ],
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("projects SIP growth at illustrative increase percentages using the portfolio's own observed CAGR", async () => {
    const view = await getScenarioEngineView(db, ASOF, "2026-08");
    expect(view.sipIncreaseSimulator.result.kind).toBe("ok");
    if (view.sipIncreaseSimulator.result.kind !== "ok") return;
    const scenario = view.sipIncreaseSimulator.result.value;

    expect(scenario.disclaimer).toMatch(/not a guarantee/i);
    expect(scenario.assumptions.currentMonthlyInvestmentMinorUnits).toBe(20_000);
    expect(scenario.base).toHaveLength(9); // 3 increase ratios x 3 horizons

    const zeroIncrease5y = scenario.base.find((r) => r.increaseRatio === 0 && r.horizonYears === 5);
    const quarterIncrease5y = scenario.base.find((r) => r.increaseRatio === 0.25 && r.horizonYears === 5);
    expect(zeroIncrease5y?.projectedCorpus.kind).toBe("ok");
    expect(quarterIncrease5y?.projectedCorpus.kind).toBe("ok");
    if (zeroIncrease5y?.projectedCorpus.kind === "ok" && quarterIncrease5y?.projectedCorpus.kind === "ok") {
      // A higher SIP always projects a higher corpus at the same horizon.
      expect(quarterIncrease5y.projectedCorpus.value).toBeGreaterThan(zeroIncrease5y.projectedCorpus.value);
    }
  });

  it("amortizes the liability and never mutates the recorded EMI or outstanding balance", async () => {
    const before = await db.liability.findFirstOrThrow({ where: { name: "Personal Loan" } });
    const view = await getScenarioEngineView(db, ASOF, "2026-08");
    expect(view.debtPrepaymentSimulator.result.kind).toBe("ok");
    if (view.debtPrepaymentSimulator.result.kind !== "ok") return;
    const scenario = view.debtPrepaymentSimulator.result.value;
    expect(scenario.base).toHaveLength(3); // one liability x 3 illustrative extras

    const baseline = scenario.base.find((r) => r.extraMonthlyMinorUnits === 0);
    expect(baseline?.result.kind).toBe("ok");
    if (baseline?.result.kind === "ok") {
      expect(baseline.result.value.monthsToPayoff).toBeGreaterThan(0);
    }

    const after = await db.liability.findFirstOrThrow({ where: { name: "Personal Loan" } });
    expect(after.outstandingMinorUnits).toBe(before.outstandingMinorUnits);
    expect(after.emiAmountMinorUnits).toBe(before.emiAmountMinorUnits);
  });

  it("projects net worth growth using net worth's own observed CAGR and the latest month's retained cash", async () => {
    const view = await getScenarioEngineView(db, ASOF, "2026-08");
    expect(view.wealthProjection.result.kind).toBe("ok");
    if (view.wealthProjection.result.kind !== "ok") return;
    const scenario = view.wealthProjection.result.value;

    expect(scenario.assumptions.openingNetWorthMinorUnits).toBe(100_000); // 150,000 portfolio - 50,000 liability
    expect(scenario.assumptions.monthlyRetainedMinorUnits).toBe(65_000); // 100,000 - 30,000 - 5,000
    expect(scenario.base).toHaveLength(3);

    const fiveYear = scenario.base.find((r) => r.horizonYears === 5);
    const twentyYear = scenario.base.find((r) => r.horizonYears === 20);
    expect(fiveYear?.projectedNetWorth.kind).toBe("ok");
    expect(twentyYear?.projectedNetWorth.kind).toBe("ok");
    if (fiveYear?.projectedNetWorth.kind === "ok" && twentyYear?.projectedNetWorth.kind === "ok") {
      expect(twentyYear.projectedNetWorth.value).toBeGreaterThan(fiveYear.projectedNetWorth.value);
    }
  });

  it("computes a financial independence timeline against the disclosed 4%-rule target, reachable within the search horizon", async () => {
    const view = await getScenarioEngineView(db, ASOF, "2026-08");
    expect(view.financialIndependenceProjection.result.kind).toBe("ok");
    if (view.financialIndependenceProjection.result.kind !== "ok") return;
    const scenario = view.financialIndependenceProjection.result.value;

    expect(scenario.assumptions.safeWithdrawalRateBps).toBe(400); // 4%
    // Annual expense = (30,000 + 5,000) * 12 = 420,000; FI target = 420,000 / 0.04 = 10,500,000.
    expect(scenario.assumptions.fiTargetMinorUnits).toBe(10_500_000);
    expect(scenario.base.kind).toBe("ok");
    if (scenario.base.kind === "ok") {
      expect(scenario.base.value).toBeGreaterThan(0);
    }
  });
});
