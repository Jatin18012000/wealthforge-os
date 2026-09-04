import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getGoalLiabilityIntelligenceView } from "../../src/views/goalLiabilityIntelligenceView";
import { createTestDb } from "../setup/testDb";

const ASOF = new Date("2026-08-31T00:00:00Z");

describe("goal & liability intelligence view — empty database", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reports insufficient data across every widget when nothing has been recorded", async () => {
    const view = await getGoalLiabilityIntelligenceView(db, ASOF, null);

    expect(view.goalFundingRadar.result.kind).toBe("insufficient-data");
    expect(view.goalCollisionDetector.result.kind).toBe("insufficient-data");
    expect(view.debtFreedomMeter.result.kind).toBe("insufficient-data");
    expect(view.emiReleaseTimeline.result.kind).toBe("insufficient-data");
    expect(view.goalTradeOffSimulator.result.kind).toBe("insufficient-data");

    // Emergency Fund Runway always reports insufficient — D-017 — with or
    // without any data, since no essential-expense split exists at all.
    expect(view.emergencyFundRunway.result.kind).toBe("insufficient-data");

    // No milestone is a complete, correct answer with no data — never
    // insufficient-data (there's nothing here that could be "insufficient").
    expect(view.milestones).toEqual([]);
  });
});

describe("goal & liability intelligence view — Milestones (v1.1.1 F8)", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const goal = await db.goal.create({
      data: {
        name: "Emergency Fund",
        kind: "emergency_fund",
        targetAmountMinorUnits: 100_000,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 100_000,
        occurredOn: new Date("2026-08-01T00:00:00Z"),
        trustState: "validated",
      },
    });

    const liability = await db.liability.create({
      data: {
        name: "Short Personal Loan",
        kind: "other",
        principalMinorUnits: 10_000,
        outstandingMinorUnits: 0,
        outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
        interestRateBps: 1_200,
        tenureMonths: 1,
        emiAmountMinorUnits: 10_000,
      },
    });
    await db.activity.create({
      data: {
        kind: "emi_payment",
        liabilityId: liability.id,
        amountMinorUnits: 10_000,
        occurredOn: new Date("2026-08-01T00:00:00Z"),
        trustState: "validated",
      },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("flags a goal at 100% funded and a liability with zero payments remaining", async () => {
    const view = await getGoalLiabilityIntelligenceView(db, ASOF, null);
    expect(view.milestones).toContainEqual({
      kind: "goal_achieved",
      label: "Emergency Fund — goal achieved (100% funded)",
    });
    expect(view.milestones).toContainEqual({
      kind: "liability_paid_off",
      label: "Short Personal Loan — fully paid off",
    });
  });
});

describe("goal & liability intelligence view — Goal Funding Radar", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const goal = await db.goal.create({
      data: {
        name: "Car",
        kind: "car",
        targetAmountMinorUnits: 1_000_000,
        targetDate: new Date("2027-12-31T00:00:00Z"),
        priorityRank: 2,
        lifecycleState: "in_progress",
      },
    });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 100_000,
        occurredOn: new Date("2026-08-01T00:00:00Z"),
        trustState: "validated",
      },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reuses computeGoalProgress and projectGoalCompletion, exactly as the Goals screen does", async () => {
    const view = await getGoalLiabilityIntelligenceView(db, ASOF, null);
    expect(view.goalFundingRadar.result.kind).toBe("ok");
    if (view.goalFundingRadar.result.kind !== "ok") return;
    const [row] = view.goalFundingRadar.result.value;
    expect(row?.progress.currentAmountMinorUnits).toBe(100_000);
    expect(row?.progress.remainingMinorUnits).toBe(900_000);
    // Only one month of contribution exists, so a rate cannot be trusted
    // beyond that single data point, but a projection should still resolve.
    expect(["ok", "insufficient-data"]).toContain(row?.projection.kind);
  });
});

describe("goal & liability intelligence view — Goal Collision Detector & Trade-Off Simulator", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await db.goal.create({
      data: {
        name: "Car",
        kind: "car",
        targetAmountMinorUnits: 600_000,
        targetDate: new Date("2026-11-29T00:00:00Z"), // 90 days after ASOF
        priorityRank: 2,
        lifecycleState: "in_progress",
      },
    });
    await db.goal.create({
      data: {
        name: "Marriage",
        kind: "marriage",
        targetAmountMinorUnits: 200_000,
        targetDate: new Date("2026-10-30T00:00:00Z"), // 60 days after ASOF
        priorityRank: 3,
        lifecycleState: "in_progress",
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
          labelRaw: "Groceries",
          labelNormalized: "groceries",
          amountMinorUnits: 40_000,
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

  it("flags a collision when combined goal demand exceeds the latest month's unallocated cash, without deciding which goal loses", async () => {
    const view = await getGoalLiabilityIntelligenceView(db, ASOF, "2026-08");
    expect(view.goalCollisionDetector.result.kind).toBe("ok");
    if (view.goalCollisionDetector.result.kind !== "ok") return;
    const collision = view.goalCollisionDetector.result.value;

    // capacity = income 100,000 - expense 40,000 - investment 20,000 = 40,000
    expect(collision.monthlyCapacityMinorUnits).toBe(40_000);
    const car = collision.collidingGoals.find((g) => g.name === "Car");
    const marriage = collision.collidingGoals.find((g) => g.name === "Marriage");
    expect(car?.requiredMonthlyMinorUnits).toBe(200_000); // 600,000 / 3 months
    expect(marriage?.requiredMonthlyMinorUnits).toBe(100_000); // 200,000 / 2 months
    expect(collision.totalRequiredMonthlyMinorUnits).toBe(300_000);
    expect(collision.shortfallMinorUnits).toBe(260_000);

    // The detector never states which goal should be sacrificed — it only
    // reports the same rows and the shortfall, leaving the existing fixed
    // priority order as the only ordering ever applied.
    expect(Object.keys(collision)).not.toContain("recommendedGoalToDrop");
  });

  it("simulates sequential priority-order funding as a labeled scenario that never mutates real records", async () => {
    const beforeGoals = await db.goal.findMany();
    const view = await getGoalLiabilityIntelligenceView(db, ASOF, "2026-08");
    expect(view.goalTradeOffSimulator.result.kind).toBe("ok");
    if (view.goalTradeOffSimulator.result.kind !== "ok") return;
    const scenario = view.goalTradeOffSimulator.result.value;

    expect(scenario.disclaimer).toMatch(/not a guarantee/i);
    expect(scenario.assumptions.monthlyCapacityMinorUnits).toBe(40_000);

    const [car, marriage] = scenario.base;
    // Car is priority rank 2 (funded first among these two); gets full
    // capacity exclusively until done: 600,000 / 40,000 = 15 months.
    expect(car?.monthsUntilFundingStarts).toBe(0);
    expect(car?.monthsToComplete).toBe(15);
    // Marriage (rank 3) only starts once Car completes.
    expect(marriage?.monthsUntilFundingStarts).toBe(15);
    expect(marriage?.monthsToComplete).toBe(5); // 200,000 / 40,000

    // Verify no real goal record was touched by running the simulation.
    const afterGoals = await db.goal.findMany();
    expect(afterGoals).toEqual(beforeGoals);
  });
});

describe("goal & liability intelligence view — Debt Freedom Meter & EMI Release Timeline", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await db.liability.create({
      data: {
        name: "Personal Loan",
        kind: "other",
        principalMinorUnits: 1_000_000,
        outstandingMinorUnits: 800_000,
        outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
        interestRateBps: 1_200,
        tenureMonths: 100,
        emiAmountMinorUnits: 10_000,
      },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("computes aggregate repaid ratio and the latest projected debt-free date from projectEmiRelease", async () => {
    const view = await getGoalLiabilityIntelligenceView(db, ASOF, null);
    expect(view.debtFreedomMeter.result.kind).toBe("ok");
    if (view.debtFreedomMeter.result.kind !== "ok") return;
    const meter = view.debtFreedomMeter.result.value;

    expect(meter.totalPrincipalMinorUnits).toBe(1_000_000);
    expect(meter.totalOutstandingMinorUnits).toBe(800_000);
    expect(meter.repaidRatio).toBeCloseTo(0.2, 10);
    expect(meter.latestDebtFreeDate).toBeInstanceOf(Date);
    expect(meter.liabilitiesExcluded).toHaveLength(0);
  });

  it("never assumes an EMI has ended merely because a plausible date has passed — no payments means fromScheduleOnly", async () => {
    const view = await getGoalLiabilityIntelligenceView(db, ASOF, null);
    expect(view.emiReleaseTimeline.result.kind).toBe("ok");
    if (view.emiReleaseTimeline.result.kind !== "ok") return;
    const [row] = view.emiReleaseTimeline.result.value;
    expect(row?.release.kind).toBe("ok");
    if (row?.release.kind === "ok") {
      expect(row.release.value.paymentsMade).toBe(0);
      expect(row.release.value.paymentsRemaining).toBe(100);
      expect(row.release.value.fromScheduleOnly).toBe(true);
    }
    // No payer split was recorded, so the per-payer share is honestly
    // insufficient rather than guessed.
    expect(row?.payerShares.kind).toBe("insufficient-data");
  });
});

describe("goal & liability intelligence view — Emergency Fund Runway (D-017 resolved)", () => {
  const testDb = createTestDb();
  const db = testDb.db;
  const PERIOD_MONTH = "2026-08";

  beforeAll(async () => {
    await db.goal.create({
      data: {
        name: "Emergency Fund",
        kind: "emergency_fund",
        targetAmountMinorUnits: 1, // ignored by the runway calculation — target is derived
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    await db.planRecord.create({
      data: {
        periodMonth: PERIOD_MONTH,
        category: "expense",
        labelRaw: "Rent",
        labelNormalized: "Rent",
        amountMinorUnits: 40_000,
        trustState: "validated",
      },
    });
    await db.planRecord.create({
      data: {
        periodMonth: PERIOD_MONTH,
        category: "emi",
        labelRaw: "Home Loan EMI",
        labelNormalized: "Home Loan EMI",
        amountMinorUnits: 10_000,
        trustState: "validated",
      },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reports insufficient data when no Emergency Fund goal exists", async () => {
    const emptyDb = createTestDb();
    const view = await getGoalLiabilityIntelligenceView(emptyDb.db, ASOF, PERIOD_MONTH);
    expect(view.emergencyFundRunway.result.kind).toBe("insufficient-data");
    await emptyDb.cleanup();
  });

  it("computes balance, target (6x essential spend), and runway once a goal and essential spend exist", async () => {
    const goal = await db.goal.findFirstOrThrow({ where: { kind: "emergency_fund" } });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 150_000,
        occurredOn: new Date("2026-08-01T00:00:00Z"),
        trustState: "validated",
      },
    });

    const view = await getGoalLiabilityIntelligenceView(db, ASOF, PERIOD_MONTH);
    expect(view.emergencyFundRunway.result.kind).toBe("ok");
    if (view.emergencyFundRunway.result.kind !== "ok") return;
    const summary = view.emergencyFundRunway.result.value;

    expect(summary.currentBalanceMinorUnits).toBe(150_000);
    expect(summary.essentialSpendMinorUnits).toBe(50_000); // 40,000 expense + 10,000 EMI
    expect(summary.targetMinorUnits).toBe(300_000); // 6 x 50,000
    expect(summary.monthsOfRunway).toEqual({ kind: "ok", value: 3 }); // 150,000 / 50,000
  });

  it("flags the Emergency Fund milestone once runway reaches 6 months, and includes it among milestones", async () => {
    const goal = await db.goal.findFirstOrThrow({ where: { kind: "emergency_fund" } });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 150_000, // brings total to 300,000 = 6 x 50,000
        occurredOn: new Date("2026-08-05T00:00:00Z"),
        trustState: "validated",
      },
    });

    const view = await getGoalLiabilityIntelligenceView(db, ASOF, PERIOD_MONTH);
    expect(view.emergencyFundRunway.result.kind).toBe("ok");
    if (view.emergencyFundRunway.result.kind === "ok") {
      expect(view.emergencyFundRunway.result.value.monthsOfRunway).toEqual({ kind: "ok", value: 6 });
    }
    expect(view.milestones).toContainEqual({
      kind: "emergency_fund_target_reached",
      label: "Emergency fund reached 6 months of essential spending",
    });
  });
});
