import type { PrismaClient } from "@prisma/client";
import { loadActivities, loadEffectivePlanRecords, loadGoals } from "../data/loaders";
import {
  comparePlanVsActual,
  insufficient,
  isTrusted,
  ok,
  summarizeMonth,
  type Computed,
  type MonthlyBudget,
  type PlanCategory,
  type PlanVsReality,
} from "../domain";
import { formatTrustState } from "../presentation/format";

export interface BudgetLineRow {
  readonly id: string;
  readonly labelRaw: string;
  readonly category: PlanCategory;
  readonly amountMinorUnits: number | null;
  readonly trustState: string;
  readonly trustLabel: string;
  readonly isTrusted: boolean;
}

export interface AllocatableGoal {
  readonly id: string;
  readonly name: string;
}

export interface BudgetView {
  readonly periodMonth: string;
  readonly availablePeriods: readonly string[];
  readonly summary: Computed<MonthlyBudget>;
  readonly planVsReality: Computed<PlanVsReality>;
  readonly lines: readonly BudgetLineRow[];
  /**
   * Left-over cash already moved into goals this period (docs/04_USER_FLOWS.md,
   * "Allocate leftover cash to a goal"), and what remains after that. Kept
   * separate from `summary.unallocatedMinorUnits` rather than folded into
   * it: that figure is a property of the plan (income − expenses − EMIs −
   * investments) and stays comparable across periods regardless of what a
   * user has since chosen to do with the cash it describes.
   */
  readonly alreadyAllocatedToGoalsMinorUnits: number;
  readonly remainingToAllocateMinorUnits: Computed<number>;
  /** Goals open to a new contribution — excludes achieved/cancelled goals. */
  readonly allocatableGoals: readonly AllocatableGoal[];
}

const CATEGORY_ORDER: readonly PlanCategory[] = ["income", "expense", "emi", "investment"];

/**
 * Sum of confirmed goal_contribution minus goal_withdrawal activity for a
 * period, trusted records only — the same "moved to a goal" total used both
 * to display remaining left-over cash and to validate a new allocation
 * request, so the two can never disagree.
 */
export async function getAlreadyAllocatedToGoalsMinorUnits(
  db: PrismaClient,
  periodMonth: string,
): Promise<number> {
  const [yearPart, monthPart] = periodMonth.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);

  const rows = await db.activity.findMany({
    where: { kind: { in: ["goal_contribution", "goal_withdrawal"] } },
  });

  return rows
    .filter(
      (row) =>
        isTrusted(row.trustState) &&
        row.occurredOn.getUTCFullYear() === year &&
        row.occurredOn.getUTCMonth() + 1 === month,
    )
    .reduce(
      (sum, row) => sum + (row.kind === "goal_contribution" ? row.amountMinorUnits : -row.amountMinorUnits),
      0,
    );
}

export async function getBudgetView(
  db: PrismaClient,
  periodMonth: string,
  availablePeriods: readonly string[],
): Promise<BudgetView> {
  const records = await loadEffectivePlanRecords(db, periodMonth);
  const activities = await loadActivities(db);

  const rows = await db.planRecord.findMany({
    where: { periodMonth, supersededById: null },
    orderBy: [{ category: "asc" }, { labelNormalized: "asc" }],
  });

  const lines: BudgetLineRow[] = rows
    .map((row) => ({
      id: row.id,
      labelRaw: row.labelRaw,
      category: row.category as PlanCategory,
      amountMinorUnits: row.amountMinorUnits,
      trustState: row.trustState,
      trustLabel: formatTrustState(row.trustState),
      isTrusted: row.trustState === "validated" || row.trustState === "verified",
    }))
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.labelRaw.localeCompare(b.labelRaw),
    );

  const summary = summarizeMonth(records, periodMonth);
  const alreadyAllocatedToGoalsMinorUnits = await getAlreadyAllocatedToGoalsMinorUnits(
    db,
    periodMonth,
  );

  const goals = await loadGoals(db);
  const allocatableGoals: AllocatableGoal[] = goals
    .filter((goal) => goal.lifecycleState !== "achieved" && goal.lifecycleState !== "cancelled")
    .map((goal) => ({ id: goal.id, name: goal.name }));

  return {
    periodMonth,
    availablePeriods,
    summary,
    planVsReality: comparePlanVsActual(records, activities, periodMonth),
    lines,
    alreadyAllocatedToGoalsMinorUnits,
    remainingToAllocateMinorUnits:
      summary.kind === "ok"
        ? ok(summary.value.unallocatedMinorUnits - alreadyAllocatedToGoalsMinorUnits)
        : insufficient(...summary.reasons),
    allocatableGoals,
  };
}
