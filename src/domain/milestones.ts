import type { Computed } from "./result";

/**
 * Financial Milestones (v1.1.1 F8) — the two sub-items judged safe to build
 * without inventing a threshold (`docs/30_V1_1_1_COMMAND_CENTER_POLISH.md`,
 * F8): a goal reaching 100% funded, and a liability's EMI obligation
 * reaching zero payments remaining. Both booleans already exist as
 * already-computed fields elsewhere (`GoalProgress.progressRatio`,
 * `ReleaseSchedule.paymentsRemaining`) — this module only names the
 * boundary condition and the label, it introduces no new figure.
 *
 * The other three named sub-items — an emergency-fund threshold, a
 * portfolio-value threshold, and a savings-rate milestone — are
 * deliberately NOT implemented here: each requires picking a round number
 * or percentage that no document in this repository defines, which would
 * violate "never invent a new financial fact." They stay unbuilt until a
 * real threshold is supplied, per the same reasoning as D-017.
 */

export type MilestoneKind = "goal_achieved" | "liability_paid_off";

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
