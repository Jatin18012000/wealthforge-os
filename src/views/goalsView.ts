import type { PrismaClient } from "@prisma/client";
import { loadGoalActivities, loadGoals } from "../data/loaders";
import {
  activeGoalsByPriority,
  computeGoalProgress,
  projectGoalCompletion,
  type Computed,
  type GoalInput,
  type GoalProgress,
  type GoalProjection,
} from "../domain";

export interface GoalCard {
  readonly goal: GoalInput;
  readonly progress: GoalProgress;
  readonly projection: Computed<GoalProjection>;
}

export interface GoalsView {
  readonly active: readonly GoalCard[];
  readonly inactive: readonly GoalCard[];
  /** Sum of contributions across all goals, for the Command Center tile. */
  readonly totalAllocatedMinorUnits: number;
}

/**
 * Builds a card per goal.
 *
 * Progress is always derived from activity by the engine — never read from a
 * stored total — so a goal card cannot drift from the transactions behind it
 * (docs/05_DOMAIN_MODEL.md invariants).
 */
export async function getGoalsView(db: PrismaClient, asOf: Date): Promise<GoalsView> {
  const goals = await loadGoals(db);
  const activities = await loadGoalActivities(db);

  const cards: GoalCard[] = goals.map((goal) => {
    const progress = computeGoalProgress(goal, activities);

    // A projection needs a contribution rate. Recent months of actual
    // contributions are the only honest basis available, and where there are
    // none the engine correctly refuses to project rather than assuming one.
    const monthlyContribution = averageMonthlyContribution(activities, goal.id, asOf);

    return {
      goal,
      progress,
      projection: projectGoalCompletion(progress, monthlyContribution, asOf, goal.targetDate),
    };
  });

  const activeIds = new Set(activeGoalsByPriority(goals).map((goal) => goal.id));

  return {
    active: cards
      .filter((card) => activeIds.has(card.goal.id))
      .sort((a, b) => a.goal.priorityRank - b.goal.priorityRank),
    inactive: cards
      .filter((card) => !activeIds.has(card.goal.id))
      .sort((a, b) => a.goal.priorityRank - b.goal.priorityRank),
    totalAllocatedMinorUnits: cards.reduce(
      (total, card) => total + Math.max(card.progress.currentAmountMinorUnits, 0),
      0,
    ),
  };
}

const MONTHS_CONSIDERED = 6;

/**
 * Mean monthly contribution over the recent window, counting only months
 * that have elapsed. Returns 0 when there is no contribution history, which
 * makes the engine report the projection as insufficient rather than
 * inventing a funding rate.
 */
function averageMonthlyContribution(
  activities: readonly { goalId: string; kind: string; amountMinorUnits: number; occurredOn: Date }[],
  goalId: string,
  asOf: Date,
): number {
  const windowStart = new Date(asOf.getTime());
  windowStart.setUTCMonth(windowStart.getUTCMonth() - MONTHS_CONSIDERED);

  const contributions = activities.filter(
    (activity) =>
      activity.goalId === goalId &&
      activity.kind === "goal_contribution" &&
      activity.occurredOn >= windowStart &&
      activity.occurredOn <= asOf,
  );

  if (contributions.length === 0) return 0;

  const total = contributions.reduce((sum, a) => sum + a.amountMinorUnits, 0);
  const monthsSpanned = new Set(
    contributions.map((a) => `${a.occurredOn.getUTCFullYear()}-${a.occurredOn.getUTCMonth()}`),
  ).size;

  return Math.floor(total / Math.max(monthsSpanned, 1));
}
