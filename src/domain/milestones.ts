import type { Computed } from "./result";

/**
 * Financial Milestones (v1.1.1 F8).
 *
 * Started with the two sub-items safe to build without inventing a
 * threshold (`docs/30_V1_1_1_COMMAND_CENTER_POLISH.md`, F8): a goal
 * reaching 100% funded, and a liability's EMI obligation reaching zero
 * payments remaining — both derived from already-computed fields
 * (`GoalProgress.progressRatio`, `ReleaseSchedule.paymentsRemaining`).
 *
 * The Emergency Fund and Overall Savings Rate milestones were added once
 * the account owner supplied the two thresholds that were missing (6
 * months of essential spending; 25% of income) — see
 * `src/domain/emergencyFund.ts` and `src/domain/savingsRate.ts`. Those
 * numbers are the owner's own stated targets, not invented here.
 *
 * The portfolio-value milestone remains deliberately NOT implemented:
 * no threshold for it has been supplied, and guessing one would violate
 * "never invent a new financial fact," the same reasoning as D-017.
 */

export type MilestoneKind =
  | "goal_achieved"
  | "liability_paid_off"
  | "emergency_fund_target_reached"
  | "savings_rate_target_reached";

export interface Milestone {
  readonly kind: MilestoneKind;
  readonly label: string;
}

export interface GoalMilestoneCandidate {
  readonly name: string;
  readonly progressRatio: Computed<number>;
}

/** A goal is "achieved" the moment its progress ratio reaches (or, from a manual override, exceeds) 100%. */
export function detectGoalMilestones(
  candidates: readonly GoalMilestoneCandidate[],
): readonly Milestone[] {
  return candidates
    .filter((c) => c.progressRatio.kind === "ok" && c.progressRatio.value >= 1)
    .map((c) => ({ kind: "goal_achieved" as const, label: `${c.name} — goal achieved (100% funded)` }));
}

export interface LiabilityMilestoneCandidate {
  readonly name: string;
  readonly paymentsRemaining: number;
}

/** A liability is "paid off" once its projected schedule has zero (or fewer) payments remaining. */
export function detectLiabilityMilestones(
  candidates: readonly LiabilityMilestoneCandidate[],
): readonly Milestone[] {
  return candidates
    .filter((c) => c.paymentsRemaining <= 0)
    .map((c) => ({ kind: "liability_paid_off" as const, label: `${c.name} — fully paid off` }));
}

/**
 * The Emergency Fund milestone: runway has reached (or exceeded) the
 * owner's stated 6-month target. `runwayMonths` is `computeEmergencyFundRunwayMonths`'s
 * own output — this function only names the boundary, it does not
 * recompute the ratio.
 */
export function detectEmergencyFundMilestone(
  runwayMonths: Computed<number>,
  targetMonths: number,
): readonly Milestone[] {
  if (runwayMonths.kind !== "ok" || runwayMonths.value < targetMonths) return [];
  return [
    {
      kind: "emergency_fund_target_reached",
      label: `Emergency fund reached ${targetMonths} months of essential spending`,
    },
  ];
}

/**
 * The Overall Savings Rate milestone: the rate has reached (or exceeded)
 * the owner's stated 25% target. `rate` is `computeOverallSavingsRate`'s
 * own output.
 */
export function detectSavingsRateMilestone(
  rate: Computed<number>,
  targetRatio: number,
): readonly Milestone[] {
  if (rate.kind !== "ok" || rate.value < targetRatio) return [];
  return [
    {
      kind: "savings_rate_target_reached",
      label: `Overall savings rate reached ${Math.round(targetRatio * 100)}% of income`,
    },
  ];
}
