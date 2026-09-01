import type { PrismaClient } from "@prisma/client";
import { loadEffectivePlanRecords, loadGoalActivities, loadGoals, loadLiabilities } from "../data/loaders";
import {
  activeGoalsByPriority,
  addMonthsClamped,
  buildInsight,
  buildScenarioResult,
  computeGoalProgress,
  daysBetween,
  insufficient,
  ok,
  projectEmiRelease,
  projectGoalCompletion,
  safeRatio,
  splitEmiByPayer,
  summarizeMonth,
  type Computed,
  type EmiPaymentInput,
  type GoalInput,
  type GoalProgress,
  type GoalProjection,
  type Insight,
  type LiabilityDetail,
  type MetricDefinition,
  type PayerShare,
  type ReleaseSchedule,
  type ScenarioResult,
} from "../domain";

/**
 * IM-04 Goal & Liability Intelligence (v1.1, `docs/21_INTELLIGENCE_MASTER_PLAN.md`).
 *
 * Every widget here composes existing engine outputs
 * (`computeGoalProgress`, `projectGoalCompletion`, `projectEmiRelease`,
 * `splitEmiByPayer`) — none introduces a second calculation path.
 *
 * Emergency Fund Runway is a deliberate exception: `docs/19_OPEN_DECISIONS.md`
 * D-017 records that no essential/discretionary expense split exists in the
 * data model, so the widget always reports insufficient-data rather than
 * silently substituting total spending for essential spending.
 */

const GOAL_FUNDING_RADAR_METRIC: MetricDefinition = {
  id: "goal_funding_radar",
  label: "Goal Funding Radar",
  unit: "money",
  description: "Every active goal's progress and projected completion, in priority order.",
};

const GOAL_COLLISION_METRIC: MetricDefinition = {
  id: "goal_collision_detector",
  label: "Goal Collision Detector",
  unit: "money",
  description: "Whether active goals with stated target dates collectively demand more than the household's demonstrated monthly funding capacity.",
};

const EMERGENCY_FUND_RUNWAY_METRIC: MetricDefinition = {
  id: "emergency_fund_runway",
  label: "Emergency Fund Runway",
  unit: "months",
  description: "Months of essential spending the emergency fund balance covers.",
};

const DEBT_FREEDOM_METRIC: MetricDefinition = {
  id: "debt_freedom_meter",
  label: "Debt Freedom Meter",
  unit: "ratio",
  description: "Aggregate share of principal repaid, and the latest projected debt-free date across all liabilities.",
};

const EMI_RELEASE_TIMELINE_METRIC: MetricDefinition = {
  id: "emi_release_timeline",
  label: "EMI Release Timeline",
  unit: "months",
  description: "Per-liability projected date each EMI obligation ends, from confirmed payments or the recorded tenure.",
};

const GOAL_TRADEOFF_METRIC: MetricDefinition = {
  id: "goal_tradeoff_simulator",
  label: "Goal Trade-Off Simulator",
  unit: "months",
  description: "Simulates sequential, priority-order funding of active goals at a stated monthly capacity — a scenario, never a mutation of real records.",
};

// --- Shared types -----------------------------------------------------

export interface GoalRadarRow {
  readonly goal: GoalInput;
  readonly progress: GoalProgress;
  readonly projection: Computed<GoalProjection>;
}

export interface CollidingGoal {
  readonly goalId: string;
  readonly name: string;
  readonly targetDate: Date;
  readonly remainingMinorUnits: number;
  readonly requiredMonthlyMinorUnits: number;
}

export interface GoalCollision {
  readonly collidingGoals: readonly CollidingGoal[];
  readonly totalRequiredMonthlyMinorUnits: number;
  readonly monthlyCapacityMinorUnits: number;
  readonly shortfallMinorUnits: number;
}

export interface DebtFreedomSummary {
  readonly totalPrincipalMinorUnits: number;
  readonly totalOutstandingMinorUnits: number;
  readonly repaidRatio: number;
  readonly latestDebtFreeDate: Date;
  readonly liabilitiesExcluded: readonly string[];
}

export interface EmiReleaseRow {
  readonly liability: LiabilityDetail;
  readonly release: Computed<ReleaseSchedule>;
  readonly payerShares: Computed<readonly PayerShare[]>;
}

export interface GoalTradeOffRow {
  readonly goalId: string;
  readonly name: string;
  readonly remainingMinorUnits: number;
  readonly monthsUntilFundingStarts: number;
  readonly monthsToComplete: number;
  readonly projectedCompletionDate: Date;
}

export interface GoalLiabilityIntelligenceView {
  readonly goalFundingRadar: Insight<readonly GoalRadarRow[]>;
  readonly goalCollisionDetector: Insight<GoalCollision>;
  readonly emergencyFundRunway: Insight<{ readonly monthsOfRunway: number }>;
  readonly debtFreedomMeter: Insight<DebtFreedomSummary>;
  readonly emiReleaseTimeline: Insight<readonly EmiReleaseRow[]>;
  readonly goalTradeOffSimulator: Insight<ScenarioResult<readonly GoalTradeOffRow[]>>;
}

const APPROX_DAYS_PER_MONTH = 30;

export async function getGoalLiabilityIntelligenceView(
  db: PrismaClient,
  asOf: Date,
  latestPeriodMonth: string | null,
): Promise<GoalLiabilityIntelligenceView> {
  const goals = await loadGoals(db);
  const goalActivities = await loadGoalActivities(db);
  const active = activeGoalsByPriority(goals);

  const radarRows: GoalRadarRow[] = active.map((goal) => {
    const progress = computeGoalProgress(goal, goalActivities);
    const monthlyContribution = averageMonthlyGoalContribution(goalActivities, goal.id, asOf);
    return {
      goal,
      progress,
      projection: projectGoalCompletion(progress, monthlyContribution, asOf, goal.targetDate),
    };
  });

  const planRecords = await loadEffectivePlanRecords(db);
  const capacity = latestPeriodMonth === null ? null : summarizeMonth(planRecords, latestPeriodMonth);
  const capacityMinorUnits = capacity !== null && capacity.kind === "ok" ? capacity.value.unallocatedMinorUnits : null;

  const liabilities = await loadLiabilities(db);
  const paymentRows = await db.activity.findMany({
    where: { kind: "emi_payment", liabilityId: { not: null } },
  });
  const payments: EmiPaymentInput[] = paymentRows.map((row) => ({
    id: row.id,
    liabilityId: row.liabilityId as string,
    amountMinorUnits: row.amountMinorUnits,
    occurredOn: row.occurredOn,
    trustState: row.trustState,
  }));

  return {
    goalFundingRadar: buildGoalFundingRadar(radarRows, asOf),
    goalCollisionDetector: buildGoalCollisionDetector(active, radarRows, capacityMinorUnits, asOf),
    emergencyFundRunway: buildEmergencyFundRunway(asOf),
    debtFreedomMeter: buildDebtFreedomMeter(liabilities, payments, asOf),
    emiReleaseTimeline: buildEmiReleaseTimeline(liabilities, payments, asOf),
    goalTradeOffSimulator: buildGoalTradeOffSimulator(active, radarRows, capacityMinorUnits, asOf),
  };
}

const MONTHS_CONSIDERED = 6;

function averageMonthlyGoalContribution(
  activities: readonly { goalId: string; kind: string; amountMinorUnits: number; occurredOn: Date }[],
  goalId: string,
  asOf: Date,
): number {
  const windowStart = new Date(asOf.getTime());
  windowStart.setUTCMonth(windowStart.getUTCMonth() - MONTHS_CONSIDERED);

  const contributions = activities.filter(
    (a) => a.goalId === goalId && a.kind === "goal_contribution" && a.occurredOn >= windowStart && a.occurredOn <= asOf,
  );
  if (contributions.length === 0) return 0;

  const total = contributions.reduce((sum, a) => sum + a.amountMinorUnits, 0);
  const monthsSpanned = new Set(
    contributions.map((a) => `${a.occurredOn.getUTCFullYear()}-${a.occurredOn.getUTCMonth()}`),
  ).size;
  return Math.floor(total / Math.max(monthsSpanned, 1));
}

// --- Goal Funding Radar -------------------------------------------------------

function buildGoalFundingRadar(rows: readonly GoalRadarRow[], asOf: Date): Insight<readonly GoalRadarRow[]> {
  if (rows.length === 0) {
    return buildInsight({
      metric: GOAL_FUNDING_RADAR_METRIC,
      result: insufficient("no active goal is recorded"),
      asOf,
      calculationBasis: "activeGoalsByPriority over the recorded goals.",
    });
  }
  return buildInsight({
    metric: GOAL_FUNDING_RADAR_METRIC,
    result: ok(rows),
    asOf,
    calculationBasis:
      "computeGoalProgress (derived from trusted goal_contribution/goal_withdrawal activity) and projectGoalCompletion (a trailing 6-month average contribution rate) — the same functions and rate the Goals screen itself uses.",
  });
}

// --- Goal Collision Detector -------------------------------------------------------

function monthsUntil(asOf: Date, target: Date): number {
  return Math.max(1, Math.ceil(daysBetween(target, asOf) / APPROX_DAYS_PER_MONTH));
}

function buildGoalCollisionDetector(
  active: readonly GoalInput[],
  radarRows: readonly GoalRadarRow[],
  capacityMinorUnits: number | null,
  asOf: Date,
): Insight<GoalCollision> {
  const withDeadlines = active
    .filter((goal) => goal.targetDate !== null && goal.targetDate.getTime() > asOf.getTime())
    .map((goal) => {
      const row = radarRows.find((r) => r.goal.id === goal.id) as GoalRadarRow;
      return { goal, remainingMinorUnits: row.progress.remainingMinorUnits };
    })
    .filter((entry) => entry.remainingMinorUnits > 0);

  if (withDeadlines.length < 2) {
    return buildInsight({
      metric: GOAL_COLLISION_METRIC,
      result: insufficient(
        "fewer than two active, unfunded goals have a future target date; there is nothing to collide",
      ),
      asOf,
      calculationBasis: "Requires at least two active goals with a future target date and a positive remaining amount.",
    });
  }

  if (capacityMinorUnits === null || capacityMinorUnits <= 0) {
    return buildInsight({
      metric: GOAL_COLLISION_METRIC,
      result: insufficient(
        "no positive unallocated-cash figure is available for the latest budget month; collision requires a funding-capacity baseline to compare demand against",
      ),
      asOf,
      calculationBasis: "Compares combined goal demand against summarizeMonth's unallocatedMinorUnits for the latest fully-covered month.",
    });
  }

  const collidingGoals: CollidingGoal[] = withDeadlines.map(({ goal, remainingMinorUnits }) => {
    const months = monthsUntil(asOf, goal.targetDate as Date);
    return {
      goalId: goal.id,
      name: goal.name,
      targetDate: goal.targetDate as Date,
      remainingMinorUnits,
      requiredMonthlyMinorUnits: Math.ceil(remainingMinorUnits / months),
    };
  });

  const totalRequiredMonthlyMinorUnits = collidingGoals.reduce((sum, g) => sum + g.requiredMonthlyMinorUnits, 0);

  return buildInsight({
    metric: GOAL_COLLISION_METRIC,
    result: ok({
      collidingGoals,
      totalRequiredMonthlyMinorUnits,
      monthlyCapacityMinorUnits: capacityMinorUnits,
      shortfallMinorUnits: Math.max(0, totalRequiredMonthlyMinorUnits - capacityMinorUnits),
    }),
    asOf,
    calculationBasis:
      "Each goal's own required monthly amount is its remaining balance divided by the whole months (approximated at 30 days each) until its own target date; these are summed and compared to the latest month's unallocatedMinorUnits. This identifies that goals collectively outdemand capacity — it does not decide which goal to prioritize; the existing fixed priority order (docs/02_REQUIREMENTS.md) remains the only ordering this system applies.",
    severity: totalRequiredMonthlyMinorUnits > capacityMinorUnits ? "caution" : "info",
  });
}

// --- Emergency Fund Runway -------------------------------------------------------

function buildEmergencyFundRunway(asOf: Date): Insight<{ readonly monthsOfRunway: number }> {
  return buildInsight({
    metric: EMERGENCY_FUND_RUNWAY_METRIC,
    result: insufficient(
      "no essential/discretionary expense split exists in the budget data model (docs/19_OPEN_DECISIONS.md, D-017); runway is never approximated from total spending, which would conflate discretionary and essential expense",
    ),
    asOf,
    calculationBasis:
      "Would divide the emergency fund's current balance (see Goal Funding Radar) by average monthly essential spending, once an essential-expense field exists. Not computed today per D-017.",
  });
}

// --- Debt Freedom Meter -------------------------------------------------------

function buildDebtFreedomMeter(
  liabilities: readonly LiabilityDetail[],
  payments: readonly EmiPaymentInput[],
  asOf: Date,
): Insight<DebtFreedomSummary> {
  if (liabilities.length === 0) {
    return buildInsight({
      metric: DEBT_FREEDOM_METRIC,
      result: insufficient("no liability is recorded"),
      asOf,
      calculationBasis: "Requires at least one recorded liability.",
    });
  }

  const releasable: Array<{ liability: LiabilityDetail; release: ReleaseSchedule }> = [];
  const excluded: string[] = [];
  for (const liability of liabilities) {
    const release = projectEmiRelease(liability, payments, asOf);
    if (release.kind === "ok") {
      releasable.push({ liability, release: release.value });
    } else {
      excluded.push(liability.name);
    }
  }

  if (releasable.length === 0) {
    return buildInsight({
      metric: DEBT_FREEDOM_METRIC,
      result: insufficient(
        "no liability has a recorded tenure; a debt-free date cannot be projected for any of them",
      ),
      asOf,
      calculationBasis: "projectEmiRelease per liability.",
    });
  }

  const totalPrincipalMinorUnits = liabilities.reduce((sum, l) => sum + l.principalMinorUnits, 0);
  const totalOutstandingMinorUnits = liabilities.reduce((sum, l) => sum + l.outstandingMinorUnits, 0);
  const repaidRatio =
    safeRatio(totalPrincipalMinorUnits - totalOutstandingMinorUnits, totalPrincipalMinorUnits) ?? 0;

  const latestDebtFreeDate = releasable.reduce(
    (latest, r) => (r.release.projectedFinalPayment > latest ? r.release.projectedFinalPayment : latest),
    releasable[0]?.release.projectedFinalPayment as Date,
  );

  return buildInsight({
    metric: DEBT_FREEDOM_METRIC,
    result: ok({
      totalPrincipalMinorUnits,
      totalOutstandingMinorUnits,
      repaidRatio,
      latestDebtFreeDate,
      liabilitiesExcluded: excluded,
    }),
    asOf,
    calculationBasis:
      "repaidRatio = (total principal − total outstanding) / total principal, across every recorded liability. The debt-free date is the latest projectEmiRelease date among liabilities with a recorded tenure; a liability without one is listed as excluded rather than silently dropped from the date but kept in the principal/outstanding totals.",
  });
}

// --- EMI Release Timeline -------------------------------------------------------

function buildEmiReleaseTimeline(
  liabilities: readonly LiabilityDetail[],
  payments: readonly EmiPaymentInput[],
  asOf: Date,
): Insight<readonly EmiReleaseRow[]> {
  if (liabilities.length === 0) {
    return buildInsight({
      metric: EMI_RELEASE_TIMELINE_METRIC,
      result: insufficient("no liability is recorded"),
      asOf,
      calculationBasis: "Requires at least one recorded liability.",
    });
  }

  const rows: EmiReleaseRow[] = liabilities.map((liability) => ({
    liability,
    release: projectEmiRelease(liability, payments, asOf),
    payerShares: splitEmiByPayer(liability, asOf),
  }));

  return buildInsight({
    metric: EMI_RELEASE_TIMELINE_METRIC,
    result: ok(rows),
    asOf,
    calculationBasis:
      "projectEmiRelease per liability (the same function the Liabilities screen uses): from confirmed emi_payment activity where available, falling back to the recorded tenure and marked fromScheduleOnly when there is none. Never assumes an EMI has ended merely because a plausible date has passed.",
  });
}

// --- Goal Trade-Off Simulator -------------------------------------------------------

function buildGoalTradeOffSimulator(
  active: readonly GoalInput[],
  radarRows: readonly GoalRadarRow[],
  capacityMinorUnits: number | null,
  asOf: Date,
): Insight<ScenarioResult<readonly GoalTradeOffRow[]>> {
  const unfunded = active
    .map((goal) => {
      const row = radarRows.find((r) => r.goal.id === goal.id) as GoalRadarRow;
      return { goal, remainingMinorUnits: row.progress.remainingMinorUnits };
    })
    .filter((entry) => entry.remainingMinorUnits > 0);

  if (unfunded.length === 0) {
    return buildInsight({
      metric: GOAL_TRADEOFF_METRIC,
      result: insufficient("every active goal is already fully funded; there is nothing to simulate"),
      asOf,
      calculationBasis: "Requires at least one active goal with a positive remaining amount.",
    });
  }

  if (capacityMinorUnits === null || capacityMinorUnits <= 0) {
    return buildInsight({
      metric: GOAL_TRADEOFF_METRIC,
      result: insufficient(
        "no positive unallocated-cash figure is available for the latest budget month to use as the simulated monthly capacity",
      ),
      asOf,
      calculationBasis: "The scenario's capacity assumption is the latest fully-covered month's unallocatedMinorUnits.",
    });
  }

  let cumulativeMonths = 0;
  const rows: GoalTradeOffRow[] = unfunded.map(({ goal, remainingMinorUnits }) => {
    const monthsUntilFundingStarts = cumulativeMonths;
    const monthsToComplete = Math.ceil(remainingMinorUnits / capacityMinorUnits);
    cumulativeMonths += monthsToComplete;
    return {
      goalId: goal.id,
      name: goal.name,
      remainingMinorUnits,
      monthsUntilFundingStarts,
      monthsToComplete,
      projectedCompletionDate: addMonthsClamped(asOf, cumulativeMonths),
    };
  });

  const scenario = buildScenarioResult({ monthlyCapacityMinorUnits: capacityMinorUnits }, rows);

  return buildInsight({
    metric: GOAL_TRADEOFF_METRIC,
    result: ok(scenario),
    asOf,
    calculationBasis:
      "A scenario, not an observed fact: simulates the household's existing fixed priority order (docs/02_REQUIREMENTS.md) applying the full stated monthly capacity to the current top-priority unfunded goal exclusively until it completes, then the next. The capacity assumption defaults to the latest month's unallocatedMinorUnits; changing it never mutates any stored goal or activity record.",
  });
}
