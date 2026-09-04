import { afterAll, describe, expect, it } from "vitest";
import { getOverallSavingsRateView } from "../../src/views/savingsRateView";
import { createTestDb } from "../setup/testDb";

const ASOF = new Date("2026-08-31T00:00:00Z");

describe("overall savings rate view — no month resolved", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reports insufficient data with no milestone, rather than guessing a month", async () => {
    const view = await getOverallSavingsRateView(db, ASOF, null);
    expect(view.insight.result.kind).toBe("insufficient-data");
    expect(view.milestones).toEqual([]);
  });
});

describe("overall savings rate view — a month with income, investment, EF, and leftover cash", () => {
  const testDb = createTestDb();
  const db = testDb.db;
  const PERIOD_MONTH = "2026-08";

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("computes the owner's defined rate: (investment + EF + leftover) / income", async () => {
    await db.planRecord.create({
      data: {
        periodMonth: PERIOD_MONTH,
        category: "income",
        labelRaw: "Salary",
        labelNormalized: "Salary",
        amountMinorUnits: 100_00,
        trustState: "validated",
      },
    });

    const equity = await db.instrument.create({
      data: { kind: "equity", displayName: "Reliance" },
    });
    const gold = await db.instrument.create({
      data: { kind: "gold", displayName: "Gold ETF-like" },
    });
    await db.activity.create({
      data: {
        kind: "buy",
        instrumentId: equity.id,
        amountMinorUnits: 15_00,
        occurredOn: new Date("2026-08-10T00:00:00Z"),
        trustState: "validated",
      },
    });
    // Gold is deliberately excluded from the owner's definition
    // ("stock, mutual fund, ETF, PF") — this activity must not be counted.
    await db.activity.create({
      data: {
        kind: "buy",
        instrumentId: gold.id,
        amountMinorUnits: 50_00,
        occurredOn: new Date("2026-08-10T00:00:00Z"),
        trustState: "validated",
      },
    });

    const efGoal = await db.goal.create({
      data: {
        name: "Emergency Fund",
        kind: "emergency_fund",
        targetAmountMinorUnits: 1,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: efGoal.id,
        amountMinorUnits: 5_00,
        occurredOn: new Date("2026-08-12T00:00:00Z"),
        trustState: "validated",
      },
    });

    const view = await getOverallSavingsRateView(db, ASOF, PERIOD_MONTH);
    expect(view.insight.result.kind).toBe("ok");
    if (view.insight.result.kind !== "ok") return;
    const summary = view.insight.result.value;

    expect(summary.incomeMinorUnits).toBe(100_00);
    expect(summary.netInvestmentContributionMinorUnits).toBe(15_00); // gold excluded
    expect(summary.netEmergencyFundContributionMinorUnits).toBe(5_00);
    expect(summary.leftoverCashMinorUnits).toBe(100_00); // no expense/emi/investment plan lines recorded
    expect(summary.ratio).toEqual({ kind: "ok", value: 1.2 }); // (15+5+100)/100

    expect(view.milestones).toContainEqual({
      kind: "savings_rate_target_reached",
      label: "Overall savings rate reached 25% of income",
    });
  });

  it("nets a sell against buys for the counted instrument kinds", async () => {
    const mf = await db.instrument.create({
      data: { kind: "mutual_fund", displayName: "Axis Bluechip" },
    });
    await db.activity.create({
      data: {
        kind: "buy",
        instrumentId: mf.id,
        amountMinorUnits: 20_00,
        occurredOn: new Date("2026-08-15T00:00:00Z"),
        trustState: "validated",
      },
    });
    await db.activity.create({
      data: {
        kind: "sell",
        instrumentId: mf.id,
        amountMinorUnits: 8_00,
        occurredOn: new Date("2026-08-16T00:00:00Z"),
        trustState: "validated",
      },
    });

    const view = await getOverallSavingsRateView(db, ASOF, PERIOD_MONTH);
    expect(view.insight.result.kind).toBe("ok");
    if (view.insight.result.kind !== "ok") return;
    // Previous test's equity buy (15_00) + this mutual fund net (20_00 - 8_00 = 12_00).
    expect(view.insight.result.value.netInvestmentContributionMinorUnits).toBe(15_00 + 12_00);
  });
});
