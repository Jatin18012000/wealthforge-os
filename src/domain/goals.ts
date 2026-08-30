import { addMonthsClamped } from "./dates";
import { safeRatio, sumMinorUnits } from "./money";
import { insufficient, ok, type Computed } from "./result";
import { isTrusted } from "./trust";

export type GoalLifecycle = "planned" | "in_progress" | "achieved" | "on_hold" | "cancelled";

export interface GoalInput {
  readonly id: string;
  readonly name: string;
  /** emergency_fund | car | marriage | third_floor | custom */
  readonly kind: string;
  readonly targetAmountMinorUnits: number;
  readonly targetDate: Date | null;
  readonly priorityRank: number;
  readonly lifecycleState: GoalLifecycle;
}

export interface GoalActivityInput {
  readonly id: string;
  readonly goalId: string;
  /** goal_contribution | goal_withdrawal */
  readonly kind: string;
  readonly amountMinorUnits: number;
  readonly occurredOn: Date;
  readonly trustState: string;
}

export interface GoalProgress {
  readonly goalId: string;
  readonly name: string;
  readonly targetAmountMinorUnits: number;
  /** Always derived from activity — never a stored, separately-editable field. */
  readonly currentAmountMinorUnits: number;
  readonly remainingMinorUnits: number;
  /** Current ÷ target, 0..n. Insufficient when the target is zero. */
  readonly progressRatio: Computed<number>;
  readonly contributionCount: number;
  readonly withdrawalCount: number;
  /** True for the emergency fund, which ordinary goal spending must not draw down. */
  readonly isProtected: boolean;
  /** Set when derived progress is negative, which should be impossible. */
  readonly anomaly: string | null;
}

/**
 * The emergency fund is protected: it is the household's highest-priority
 * goal and must never be silently consumed by ordinary goal reallocation
 * (docs/02_REQUIREMENTS.md priority order, docs/15 acceptance criteria).
 * Withdrawing from it requires an explicit, clearly-labeled action.
 */
export function isProtectedGoal(goal: GoalInput): boolean {
  return goal.kind === "emergency_fund";
}

/**
 * Derives a goal's balance from its activity history.
 *
 * The current amount is ALWAYS the sum of trusted contributions minus
 * trusted withdrawals — there is no stored current-amount field that could
 * drift out of step with the transactions behind it
 * (docs/05_DOMAIN_MODEL.md invariants).
 */
export function computeGoalProgress(
  goal: GoalInput,
  activities: readonly GoalActivityInput[],
): GoalProgress {
  const forGoal = activities.filter(
    (activity) => activity.goalId === goal.id && isTrusted(activity.trustState),
  );

  const contributions = forGoal.filter((a) => a.kind === "goal_contribution");
  const withdrawals = forGoal.filter((a) => a.kind === "goal_withdrawal");

  const currentAmountMinorUnits =
    sumMinorUnits(contributions.map((a) => a.amountMinorUnits)) -
    sumMinorUnits(withdrawals.map((a) => a.amountMinorUnits));

  const ratio = safeRatio(currentAmountMinorUnits, goal.targetAmountMinorUnits);

  return {
    goalId: goal.id,
    name: goal.name,
    targetAmountMinorUnits: goal.targetAmountMinorUnits,
    currentAmountMinorUnits,
    remainingMinorUnits: goal.targetAmountMinorUnits - currentAmountMinorUnits,
    progressRatio:
      ratio === null
        ? insufficient<number>(`goal "${goal.name}" has a zero target; progress share is undefined`)
        : ok(ratio),
    contributionCount: contributions.length,
    withdrawalCount: withdrawals.length,
    isProtected: isProtectedGoal(goal),
    // Surfaced rather than clamped: a negative balance means withdrawals
    // exceed contributions, which indicates a data error worth investigating,
    // not something to hide by flooring at zero.
    anomaly:
      currentAmountMinorUnits < 0
        ? `derived balance is negative (${currentAmountMinorUnits} paise): withdrawals exceed contributions`
        : null,
  };
}

export interface AllocationCheck {
  readonly allowed: boolean;
  readonly reason: string | null;
}

/**
 * Whether unallocated cash may be moved into a goal.
 *
 * Guards the reconciliation invariant: an allocation must decrease
 * unallocated cash and increase the goal balance by the same amount, so it
 * can never exceed the cash actually available
 * (docs/04_USER_FLOWS.md, "Allocate leftover cash to a goal").
 */
export function canAllocateToGoal(
  goal: GoalInput,
  amountMinorUnits: number,
  unallocatedCashMinorUnits: number,
): AllocationCheck {
  if (amountMinorUnits <= 0) {
    return { allowed: false, reason: "allocation amount must be greater than zero" };
  }
  if (amountMinorUnits > unallocatedCashMinorUnits) {
    return {
      allowed: false,
      reason: `allocation of ${amountMinorUnits} paise exceeds unallocated cash of ${unallocatedCashMinorUnits} paise`,
    };
  }
  if (goal.lifecycleState === "cancelled" || goal.lifecycleState === "achieved") {
    return {
      allowed: false,
      reason: `goal "${goal.name}" is ${goal.lifecycleState} and does not accept new contributions`,
    };
  }
  return { allowed: true, reason: null };
}

/**
 * Whether a goal may be drawn down by ordinary reallocation.
 * The emergency fund always requires an explicit, deliberate withdrawal.
 */
export function canWithdrawForOrdinarySpending(goal: GoalInput): AllocationCheck {
  if (isProtectedGoal(goal)) {
    return {
      allowed: false,
      reason: `"${goal.name}" is protected; it requires an explicit emergency-fund withdrawal rather than ordinary reallocation`,
    };
  }
  return { allowed: true, reason: null };
}

export interface GoalProjection {
  readonly goalId: string;
  readonly monthsToTarget: number;
  readonly projectedCompletion: Date;
  /** True when the projection lands after the goal's own target date. */
  readonly missesTargetDate: boolean;
}

/**
 * Projects when a goal completes at a given contribution rate.
 *
 * A projection is explicitly a projection: it is returned as its own type,
 * never folded into the goal's current amount
 * (docs/07, "Goal progress" — allocated cash, invested assets and
 * projections are kept distinct).
 */
export function projectGoalCompletion(
  progress: GoalProgress,
  monthlyContributionMinorUnits: number,
  from: Date,
  targetDate: Date | null,
): Computed<GoalProjection> {
  if (progress.remainingMinorUnits <= 0) {
    return insufficient(`goal "${progress.name}" is already fully funded; no projection is needed`);
  }
  if (monthlyContributionMinorUnits <= 0) {
    return insufficient(
      `goal "${progress.name}" has no positive monthly contribution; a completion date cannot be projected`,
    );
  }

  const monthsToTarget = Math.ceil(
    progress.remainingMinorUnits / monthlyContributionMinorUnits,
  );

  const projectedCompletion = addMonthsClamped(from, monthsToTarget);

  return ok({
    goalId: progress.goalId,
    monthsToTarget,
    projectedCompletion,
    missesTargetDate:
      targetDate !== null && projectedCompletion.getTime() > targetDate.getTime(),
  });
}

/** Goals in funding priority order (rank 1 first), excluding inactive ones. */
export function activeGoalsByPriority(goals: readonly GoalInput[]): readonly GoalInput[] {
  return [...goals]
    .filter((goal) => goal.lifecycleState === "planned" || goal.lifecycleState === "in_progress")
    .sort((a, b) => a.priorityRank - b.priorityRank);
}
