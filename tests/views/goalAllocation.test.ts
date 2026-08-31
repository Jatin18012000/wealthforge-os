import { afterAll, describe, expect, it } from "vitest";
import { canAllocateToGoal } from "../../src/domain";
import { getBudgetView } from "../../src/views/budgetView";
import { createTestDb } from "../setup/testDb";

/**
 * docs/04_USER_FLOWS.md, "Allocate leftover cash to a goal": the Budget
 * screen must show what is left of the period's unallocated cash *after*
 * earlier allocations, and the domain check that gates a new allocation
 * (`canAllocateToGoal`) must be given exactly that figure — never the raw
 * plan-level `unallocatedMinorUnits`, or two allocations in one period could
 * together exceed the cash that was actually left over.
 */
describe("goal allocation (Budget screen)", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function seedMonth(periodMonth: string): Promise<void> {
    await db.planRecord.createMany({
      data: [
        {
          periodMonth,
          category: "income",
          labelRaw: "Salary",
          labelNormalized: "salary",
          amountMinorUnits: 100_000 * 100,
          trustState: "validated",
        },
        {
          periodMonth,
          category: "expense",
          labelRaw: "Rent",
          labelNormalized: "rent",
          amountMinorUnits: 30_000 * 100,
          trustState: "validated",
        },
      ],
    });
  }

  it("reports the full unallocated amount as remaining when nothing has been allocated yet", async () => {
    await seedMonth("2026-01");
    const view = await getBudgetView(db, "2026-01", ["2026-01"]);
    expect(view.alreadyAllocatedToGoalsMinorUnits).toBe(0);
    expect(view.remainingToAllocateMinorUnits).toEqual({
      kind: "ok",
      value: 70_000 * 100,
    });
  });

  it("subtracts a recorded contribution from what remains to allocate", async () => {
    await seedMonth("2026-02");
    const goal = await db.goal.create({
      data: {
        name: "PS5",
        kind: "custom",
        targetAmountMinorUnits: 50_000 * 100,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 10_000 * 100,
        occurredOn: new Date("2026-02-15T00:00:00Z"),
        trustState: "verified",
      },
    });

    const view = await getBudgetView(db, "2026-02", ["2026-02"]);
    expect(view.alreadyAllocatedToGoalsMinorUnits).toBe(10_000 * 100);
    expect(view.remainingToAllocateMinorUnits).toEqual({
      kind: "ok",
      value: 60_000 * 100,
    });
  });

  it("excludes achieved and cancelled goals from the allocatable list", async () => {
    await seedMonth("2026-03");
    await db.goal.create({
      data: {
        name: "Done goal",
        kind: "custom",
        targetAmountMinorUnits: 1_000 * 100,
        priorityRank: 1,
        lifecycleState: "achieved",
      },
    });
    await db.goal.create({
      data: {
        name: "Open goal",
        kind: "custom",
        targetAmountMinorUnits: 1_000 * 100,
        priorityRank: 2,
        lifecycleState: "planned",
      },
    });

    const view = await getBudgetView(db, "2026-03", ["2026-03"]);
    const names = view.allocatableGoals.map((g) => g.name);
    expect(names).toContain("Open goal");
    expect(names).not.toContain("Done goal");
  });

  it("canAllocateToGoal rejects an allocation that would exceed what remains after earlier allocations", async () => {
    await seedMonth("2026-04");
    const goal = await db.goal.create({
      data: {
        name: "Trip",
        kind: "custom",
        targetAmountMinorUnits: 1_00_000 * 100,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 65_000 * 100,
        occurredOn: new Date("2026-04-05T00:00:00Z"),
        trustState: "verified",
      },
    });

    const view = await getBudgetView(db, "2026-04", ["2026-04"]);
    expect(view.remainingToAllocateMinorUnits).toEqual({ kind: "ok", value: 5_000 * 100 });

    const check = canAllocateToGoal(
      { ...goal, lifecycleState: goal.lifecycleState as "in_progress" },
      10_000 * 100,
      (view.remainingToAllocateMinorUnits as { kind: "ok"; value: number }).value,
    );
    expect(check.allowed).toBe(false);
  });

  it("canAllocateToGoal accepts an allocation within what remains", async () => {
    await seedMonth("2026-05");
    const goal = await db.goal.create({
      data: {
        name: "Trip 2",
        kind: "custom",
        targetAmountMinorUnits: 1_00_000 * 100,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });

    const view = await getBudgetView(db, "2026-05", ["2026-05"]);
    const check = canAllocateToGoal(
      { ...goal, lifecycleState: goal.lifecycleState as "in_progress" },
      5_000 * 100,
      (view.remainingToAllocateMinorUnits as { kind: "ok"; value: number }).value,
    );
    expect(check.allowed).toBe(true);
  });
});
