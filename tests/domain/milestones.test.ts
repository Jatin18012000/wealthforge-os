import { describe, expect, it } from "vitest";
import { ok, insufficient } from "../../src/domain/result";
import { detectGoalMilestones, detectLiabilityMilestones } from "../../src/domain/milestones";

describe("detectGoalMilestones", () => {
  it("flags a goal whose progress ratio has reached exactly 100%", () => {
    const result = detectGoalMilestones([{ name: "Car", progressRatio: ok(1) }]);
    expect(result).toEqual([{ kind: "goal_achieved", label: "Car — goal achieved (100% funded)" }]);
  });

  it("flags a goal that has overshot 100% (e.g. via a manual override)", () => {
    const result = detectGoalMilestones([{ name: "Car", progressRatio: ok(1.2) }]);
    expect(result).toHaveLength(1);
  });

  it("does not flag a goal just below 100%", () => {
    const result = detectGoalMilestones([{ name: "Car", progressRatio: ok(0.999999) }]);
    expect(result).toHaveLength(0);
  });

  it("does not flag a goal with insufficient data, rather than guessing", () => {
    const result = detectGoalMilestones([
      { name: "Car", progressRatio: insufficient("no target amount") },
    ]);
    expect(result).toHaveLength(0);
  });

  it("returns one entry per achieved goal, preserving input order", () => {
    const result = detectGoalMilestones([
      { name: "A", progressRatio: ok(1) },
      { name: "B", progressRatio: ok(0.5) },
      { name: "C", progressRatio: ok(1) },
    ]);
    expect(result.map((m) => m.label)).toEqual([
      "A — goal achieved (100% funded)",
      "C — goal achieved (100% funded)",
    ]);
  });
});

describe("detectLiabilityMilestones", () => {
  it("flags a liability with zero payments remaining", () => {
    const result = detectLiabilityMilestones([{ name: "Home Loan", paymentsRemaining: 0 }]);
    expect(result).toEqual([{ kind: "liability_paid_off", label: "Home Loan — fully paid off" }]);
  });

  it("flags a liability with a negative payments-remaining figure (overpaid)", () => {
    const result = detectLiabilityMilestones([{ name: "Home Loan", paymentsRemaining: -1 }]);
    expect(result).toHaveLength(1);
  });

  it("does not flag a liability with payments still remaining", () => {
    const result = detectLiabilityMilestones([{ name: "Home Loan", paymentsRemaining: 1 }]);
    expect(result).toHaveLength(0);
  });
});
