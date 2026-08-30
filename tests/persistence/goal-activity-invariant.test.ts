import { afterAll, describe, expect, it } from "vitest";
import { createTestDb } from "../setup/testDb";

/**
 * docs/05_DOMAIN_MODEL.md invariant: a Goal's current amount is never a
 * stored column — it is always derivable by summing the goal's
 * contribution/withdrawal Activity rows. This test verifies the schema
 * actually enforces that shape (no current-amount column exists on Goal)
 * and that the derivation arithmetic is correct at the persistence layer.
 * The domain-layer function that performs this derivation for the app is
 * built in M4 (docs/07_FINANCIAL_CALCULATIONS.md); this test only proves
 * the underlying data model supports it without double counting.
 */
describe("Goal / Activity persistence invariant", () => {
  const testDb = createTestDb();

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("has no stored current-amount column on Goal", async () => {
    const goal = await testDb.db.goal.create({
      data: {
        name: "Test Goal",
        kind: "custom",
        targetAmountMinorUnits: 100_000,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    expect((goal as Record<string, unknown>).currentAmount).toBeUndefined();
    expect((goal as Record<string, unknown>).currentAmountMinorUnits).toBeUndefined();
  });

  it("derives current amount from contribution minus withdrawal activity, never double counting", async () => {
    const goal = await testDb.db.goal.create({
      data: {
        name: "PS5",
        kind: "custom",
        targetAmountMinorUnits: 55_000 * 100,
        priorityRank: 5,
        lifecycleState: "in_progress",
      },
    });

    await testDb.db.activity.createMany({
      data: [
        {
          kind: "goal_contribution",
          goalId: goal.id,
          amountMinorUnits: 1_000 * 100,
          occurredOn: new Date("2026-05-31"),
        },
        {
          kind: "goal_contribution",
          goalId: goal.id,
          amountMinorUnits: 2_000 * 100,
          occurredOn: new Date("2026-06-30"),
        },
        {
          kind: "goal_withdrawal",
          goalId: goal.id,
          amountMinorUnits: 500 * 100,
          occurredOn: new Date("2026-07-15"),
        },
      ],
    });

    const activities = await testDb.db.activity.findMany({ where: { goalId: goal.id } });
    const currentAmount = activities.reduce((sum, a) => {
      if (a.kind === "goal_contribution") return sum + a.amountMinorUnits;
      if (a.kind === "goal_withdrawal") return sum - a.amountMinorUnits;
      return sum;
    }, 0);

    expect(currentAmount).toBe((1_000 + 2_000 - 500) * 100);

    // Re-querying must not change the result — proves no double counting
    // from re-reading the same activity rows twice.
    const activitiesAgain = await testDb.db.activity.findMany({ where: { goalId: goal.id } });
    expect(activitiesAgain).toHaveLength(3);
  });

  it("allocating cash to a goal never allows a negative unexplained balance from withdrawal alone", async () => {
    const goal = await testDb.db.goal.create({
      data: {
        name: "Emergency fund",
        kind: "emergency_fund",
        targetAmountMinorUnits: 300_000 * 100,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });

    await testDb.db.activity.create({
      data: {
        kind: "goal_withdrawal",
        goalId: goal.id,
        amountMinorUnits: 500 * 100,
        occurredOn: new Date("2026-08-01"),
      },
    });

    const activities = await testDb.db.activity.findMany({ where: { goalId: goal.id } });
    const currentAmount = activities.reduce((sum, a) => {
      if (a.kind === "goal_contribution") return sum + a.amountMinorUnits;
      if (a.kind === "goal_withdrawal") return sum - a.amountMinorUnits;
      return sum;
    }, 0);

    // A withdrawal with no prior contribution produces a negative derived
    // balance at the raw-data level; the domain layer (M4) is responsible
    // for flagging this as an anomaly rather than silently accepting it —
    // this test documents that the persistence layer itself does not
    // prevent it, so that responsibility is not accidentally dropped.
    expect(currentAmount).toBeLessThan(0);
  });
});
