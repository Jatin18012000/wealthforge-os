import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadEffectivePlanRecords,
  loadGoalActivities,
  loadGoals,
  loadLiabilities,
} from "../../src/data/loaders";
import {
  computeGoalProgress,
  emiBurdenForPayer,
  expectOk,
  splitEmiByPayer,
  summarizeMonth,
  sumMinorUnits,
} from "../../src/domain";
import { importBudgetWorkbook } from "../../src/ingestion";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/budget");
const BASE = path.join(FIXTURES, "2026-budget-v1-base.xlsx");
const MODIFIED_AUGUST = path.join(FIXTURES, "2026-budget-v2-modified-august.xlsx");

/**
 * The M3→M4 vertical slice: a workbook goes in, and trustworthy figures come
 * out the far end of the deterministic engine. Values are asserted against
 * the fixture's own numbers, so a regression anywhere along the chain —
 * parsing, normalization, persistence, loading, or arithmetic — fails here.
 */
describe("workbook to financial figures, end to end", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeEach(async () => {
    await db.revision.deleteMany();
    await db.planRecord.deleteMany();
    await db.sheetSnapshot.deleteMany();
    await db.sourceDocument.deleteMany();
    await db.activity.deleteMany();
    await db.liabilityPayerSplit.deleteMany();
    await db.liability.deleteMany();
    await db.goal.deleteMany();
    await db.auditEvent.deleteMany();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("computes August's budget from the imported workbook", async () => {
    await importBudgetWorkbook(db, BASE, { defaultYear: 2026 });

    const records = await loadEffectivePlanRecords(db, "2026-08");
    const budget = expectOk(summarizeMonth(records, "2026-08"));

    // Straight from the fixture: salary 63,500; groceries 8,100 + utilities
    // 3,050 + rent 0; EMI 28,000; SIP 16,500 + PF 2,200.
    expect(budget.incomeMinorUnits).toBe(63_500 * 100);
    expect(budget.expenseMinorUnits).toBe((8_100 + 3_050 + 0) * 100);
    expect(budget.emiMinorUnits).toBe(28_000 * 100);
    expect(budget.investmentMinorUnits).toBe((16_500 + 2_200) * 100);

    expect(budget.retainedMinorUnits).toBe((63_500 - 11_150 - 28_000) * 100);
    expect(budget.unallocatedMinorUnits).toBe((63_500 - 11_150 - 28_000 - 18_700) * 100);
    expect(expectOk(budget.savingsRate)).toBeCloseTo(24_350 / 63_500, 10);
  });

  it("reflects a corrected month without counting the superseded value", async () => {
    await importBudgetWorkbook(db, BASE, { defaultYear: 2026 });
    const before = expectOk(
      summarizeMonth(await loadEffectivePlanRecords(db, "2026-08"), "2026-08"),
    );

    await importBudgetWorkbook(db, MODIFIED_AUGUST, { defaultYear: 2026 });
    const after = expectOk(
      summarizeMonth(await loadEffectivePlanRecords(db, "2026-08"), "2026-08"),
    );

    // Groceries corrected from 8,100 to 8,600 — expenses rise by exactly 500,
    // and the superseded 8,100 row must not also be counted.
    expect(after.expenseMinorUnits - before.expenseMinorUnits).toBe(500 * 100);
    expect(after.expenseMinorUnits).toBe((8_600 + 3_050) * 100);

    // The original is still on record, just no longer effective.
    const superseded = await db.planRecord.findMany({ where: { trustState: "superseded" } });
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.amountMinorUnits).toBe(8_100 * 100);
  });

  it("keeps every imported month independently computable", async () => {
    await importBudgetWorkbook(db, BASE, { defaultYear: 2026 });

    const months = ["2026-05", "2026-06", "2026-07", "2026-08"];
    const incomes: number[] = [];

    for (const month of months) {
      const budget = expectOk(
        summarizeMonth(await loadEffectivePlanRecords(db, month), month),
      );
      incomes.push(budget.incomeMinorUnits);
    }

    // May and June at 62,000; July and August at 63,500 — the mid-year raise.
    expect(incomes).toEqual([62_000 * 100, 62_000 * 100, 63_500 * 100, 63_500 * 100]);
  });

  it("derives goal progress and EMI burden from persisted records", async () => {
    const goal = await db.goal.create({
      data: {
        name: "Emergency fund",
        kind: "emergency_fund",
        targetAmountMinorUnits: 300_000 * 100,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    await db.activity.createMany({
      data: [
        {
          kind: "goal_contribution",
          goalId: goal.id,
          amountMinorUnits: 10_000 * 100,
          occurredOn: new Date("2026-07-31T00:00:00Z"),
          trustState: "validated",
        },
        {
          kind: "goal_contribution",
          goalId: goal.id,
          amountMinorUnits: 15_000 * 100,
          occurredOn: new Date("2026-08-31T00:00:00Z"),
          trustState: "validated",
        },
      ],
    });

    const liability = await db.liability.create({
      data: {
        name: "Home Loan / LAP",
        kind: "home_loan",
        principalMinorUnits: 2_500_000 * 100,
        outstandingMinorUnits: 2_373_000 * 100,
        outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
        interestRateBps: 850,
        tenureMonths: 180,
        emiAmountMinorUnits: 28_416 * 100,
      },
    });
    await db.liabilityPayerSplit.createMany({
      data: [
        {
          liabilityId: liability.id,
          payerName: "User",
          shareBps: 3_519,
          effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        },
        {
          liabilityId: liability.id,
          payerName: "Father & Brother",
          shareBps: 6_481,
          effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        },
      ],
    });

    const asOf = new Date("2026-08-31T00:00:00Z");
    const goals = await loadGoals(db);
    const activities = await loadGoalActivities(db);
    const liabilities = await loadLiabilities(db);

    const progress = computeGoalProgress(goals[0]!, activities);
    expect(progress.currentAmountMinorUnits).toBe(25_000 * 100);
    expect(progress.isProtected).toBe(true);

    const shares = expectOk(splitEmiByPayer(liabilities[0]!, asOf));
    expect(sumMinorUnits(shares.map((s) => s.shareMinorUnits))).toBe(28_416 * 100);

    // The user pays ₹10,000 of a ₹28,416 household EMI, against ₹63,500
    // take-home — roughly 15.7%, not the 44.8% the full EMI would imply.
    const burden = expectOk(emiBurdenForPayer(liabilities, "User", 63_500 * 100, asOf));
    expect(burden.burdenRatio).toBeCloseTo(0.1575, 3);
  });
});
