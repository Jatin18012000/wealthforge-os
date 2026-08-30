import { describe, expect, it } from "vitest";
import {
  activeGoalsByPriority,
  canAllocateToGoal,
  canWithdrawForOrdinarySpending,
  computeGoalProgress,
  expectOk,
  projectGoalCompletion,
  type GoalActivityInput,
  type GoalInput,
} from "../../src/domain";

const goal = (overrides: Partial<GoalInput> = {}): GoalInput => ({
  id: "g1",
  name: "PS5",
  kind: "custom",
  targetAmountMinorUnits: 5_500_000,
  targetDate: null,
  priorityRank: 5,
  lifecycleState: "in_progress",
  ...overrides,
});

const contribution = (amount: number, id = "c1"): GoalActivityInput => ({
  id,
  goalId: "g1",
  kind: "goal_contribution",
  amountMinorUnits: amount,
  occurredOn: new Date("2026-08-01T00:00:00Z"),
  trustState: "validated",
});

describe("goal progress", () => {
  it("derives the balance from activity, never from a stored field", () => {
    const progress = computeGoalProgress(goal(), [
      contribution(100_000, "c1"),
      contribution(200_000, "c2"),
      {
        id: "w1",
        goalId: "g1",
        kind: "goal_withdrawal",
        amountMinorUnits: 50_000,
        occurredOn: new Date("2026-08-20T00:00:00Z"),
        trustState: "validated",
      },
    ]);

    expect(progress.currentAmountMinorUnits).toBe(250_000);
    expect(progress.remainingMinorUnits).toBe(5_500_000 - 250_000);
    expect(progress.contributionCount).toBe(2);
    expect(progress.withdrawalCount).toBe(1);
    expect(expectOk(progress.progressRatio)).toBeCloseTo(250_000 / 5_500_000, 10);
  });

  it("ignores untrusted activity and other goals' activity", () => {
    const progress = computeGoalProgress(goal(), [
      contribution(100_000, "c1"),
      { ...contribution(999_999, "untrusted"), trustState: "needs_review" },
      { ...contribution(999_999, "other-goal"), goalId: "g2" },
    ]);

    expect(progress.currentAmountMinorUnits).toBe(100_000);
  });

  it("surfaces a negative derived balance as an anomaly instead of clamping it", () => {
    const progress = computeGoalProgress(goal(), [
      {
        id: "w1",
        goalId: "g1",
        kind: "goal_withdrawal",
        amountMinorUnits: 50_000,
        occurredOn: new Date("2026-08-20T00:00:00Z"),
        trustState: "validated",
      },
    ]);

    // Flooring at zero would hide a genuine data error.
    expect(progress.currentAmountMinorUnits).toBe(-50_000);
    expect(progress.anomaly).toContain("withdrawals exceed contributions");
  });

  it("reports progress against a zero target as undefined", () => {
    const progress = computeGoalProgress(goal({ targetAmountMinorUnits: 0 }), []);
    expect(progress.progressRatio.kind).toBe("insufficient-data");
  });

  it("marks the emergency fund as protected", () => {
    expect(computeGoalProgress(goal({ kind: "emergency_fund" }), []).isProtected).toBe(true);
    expect(computeGoalProgress(goal(), []).isProtected).toBe(false);
  });
});

describe("allocation guards", () => {
  it("refuses an allocation larger than the cash actually available", () => {
    // The reconciliation invariant: cash out must equal goal balance in.
    const check = canAllocateToGoal(goal(), 200_000, 100_000);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("exceeds unallocated cash");
  });

  it("allows an allocation within available cash", () => {
    expect(canAllocateToGoal(goal(), 100_000, 100_000).allowed).toBe(true);
  });

  it("refuses non-positive allocations", () => {
    expect(canAllocateToGoal(goal(), 0, 100_000).allowed).toBe(false);
    expect(canAllocateToGoal(goal(), -100, 100_000).allowed).toBe(false);
  });

  it("refuses contributions to a finished or cancelled goal", () => {
    expect(canAllocateToGoal(goal({ lifecycleState: "achieved" }), 100, 100_000).allowed).toBe(false);
    expect(canAllocateToGoal(goal({ lifecycleState: "cancelled" }), 100, 100_000).allowed).toBe(false);
  });

  it("protects the emergency fund from ordinary reallocation", () => {
    const emergency = goal({ kind: "emergency_fund", name: "Emergency fund" });
    const check = canWithdrawForOrdinarySpending(emergency);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("protected");

    expect(canWithdrawForOrdinarySpending(goal()).allowed).toBe(true);
  });
});

describe("goal projection", () => {
  it("projects a completion date from a contribution rate", () => {
    const progress = computeGoalProgress(goal(), [contribution(500_000)]);
    const projection = expectOk(
      projectGoalCompletion(progress, 500_000, new Date("2026-08-31T00:00:00Z"), null),
    );

    // ₹50,000 remaining of ₹55,000 at ₹5,000/month → 10 months.
    expect(projection.monthsToTarget).toBe(10);
    expect(projection.projectedCompletion.getUTCFullYear()).toBe(2027);
    expect(projection.projectedCompletion.getUTCMonth()).toBe(5); // June
    // 31 Aug + 10 months must clamp to 30 June, not roll over to 1 July.
    expect(projection.projectedCompletion.getUTCDate()).toBe(30);
  });

  it("does not let a month-end rollover flip a target-date verdict", () => {
    const progress = computeGoalProgress(goal(), [contribution(500_000)]);
    // Projecting from 31 Aug 2026 by 10 months lands on 30 June 2027. A
    // naive setUTCMonth would give 1 July and wrongly report a miss.
    const projection = expectOk(
      projectGoalCompletion(
        progress,
        500_000,
        new Date("2026-08-31T00:00:00Z"),
        new Date("2027-06-30T00:00:00Z"),
      ),
    );
    expect(projection.missesTargetDate).toBe(false);
  });

  it("flags a projection that lands after the goal's target date", () => {
    const progress = computeGoalProgress(goal(), []);
    const projection = expectOk(
      projectGoalCompletion(
        progress,
        100_000,
        new Date("2026-08-31T00:00:00Z"),
        new Date("2027-01-01T00:00:00Z"),
      ),
    );
    expect(projection.missesTargetDate).toBe(true);
  });

  it("refuses to project without a positive contribution rate", () => {
    const progress = computeGoalProgress(goal(), []);
    expect(
      projectGoalCompletion(progress, 0, new Date("2026-08-31T00:00:00Z"), null).kind,
    ).toBe("insufficient-data");
  });

  it("does not project a goal that is already funded", () => {
    const progress = computeGoalProgress(goal(), [contribution(6_000_000)]);
    expect(
      projectGoalCompletion(progress, 100_000, new Date("2026-08-31T00:00:00Z"), null).kind,
    ).toBe("insufficient-data");
  });
});

describe("goal priority", () => {
  it("orders active goals by priority and drops inactive ones", () => {
    const goals = [
      goal({ id: "car", name: "Car", kind: "car", priorityRank: 2 }),
      goal({ id: "ef", name: "Emergency fund", kind: "emergency_fund", priorityRank: 1 }),
      goal({ id: "watch", name: "Apple Watch", lifecycleState: "achieved", priorityRank: 6 }),
      goal({ id: "marriage", name: "Marriage", kind: "marriage", priorityRank: 3, lifecycleState: "planned" }),
    ];

    expect(activeGoalsByPriority(goals).map((g) => g.name)).toEqual([
      "Emergency fund",
      "Car",
      "Marriage",
    ]);
  });
});
