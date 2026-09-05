import { rupeesToMinorUnits } from "./money";
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
 * The Emergency Fund, Overall Savings Rate, and Portfolio Value milestones
 * were added once the account owner supplied the thresholds that were
 * missing (6 months of essential spending; 25% of income; a ₹10L → ₹25L →
 * ₹50L → ₹1Cr chain) — see `src/domain/emergencyFund.ts` and
 * `src/domain/savingsRate.ts` for the first two. These numbers are the
 * owner's own stated targets, never invented here.
 */

export type MilestoneKind =
  | "goal_achieved"
  | "liability_paid_off"
  | "emergency_fund_target_reached"
  | "savings_rate_target_reached"
  | "portfolio_value_target_reached";

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

export interface PortfolioValueThreshold {
  readonly amountMinorUnits: number;
  /** Display label for this rung of the chain — a fact about the owner's stated target, not a formatting rule. */
  readonly label: string;
}

/** The owner's own stated chain: ₹10L → ₹25L → ₹50L → ₹1Cr. */
export const PORTFOLIO_VALUE_MILESTONE_THRESHOLDS: readonly PortfolioValueThreshold[] = [
  { amountMinorUnits: rupeesToMinorUnits(1_000_000), label: "₹10L" },
  { amountMinorUnits: rupeesToMinorUnits(2_500_000), label: "₹25L" },
  { amountMinorUnits: rupeesToMinorUnits(5_000_000), label: "₹50L" },
  { amountMinorUnits: rupeesToMinorUnits(10_000_000), label: "₹1Cr" },
];

/**
 * The Portfolio Value milestones: one entry per rung of the owner's stated
 * chain that the current portfolio value has reached (or exceeded).
 * `currentValue` is whatever the Portfolio X-Ray / Command Center headline
 * already computed — this function only compares it against each rung, it
 * introduces no new valuation.
 */
export function detectPortfolioValueMilestones(
  currentValue: Computed<number>,
  thresholds: readonly PortfolioValueThreshold[],
): readonly Milestone[] {
  if (currentValue.kind !== "ok") return [];
  return thresholds
    .filter((threshold) => currentValue.value >= threshold.amountMinorUnits)
    .map((threshold) => ({
      kind: "portfolio_value_target_reached" as const,
      label: `Portfolio crossed ${threshold.label}`,
    }));
}
