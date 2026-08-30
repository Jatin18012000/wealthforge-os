import type { PrismaClient } from "@prisma/client";
import { loadActivities, loadEffectivePlanRecords } from "../data/loaders";
import {
  comparePlanVsActual,
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

export interface BudgetView {
  readonly periodMonth: string;
  readonly availablePeriods: readonly string[];
  readonly summary: Computed<MonthlyBudget>;
  readonly planVsReality: Computed<PlanVsReality>;
  readonly lines: readonly BudgetLineRow[];
}

const CATEGORY_ORDER: readonly PlanCategory[] = ["income", "expense", "emi", "investment"];

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

  return {
    periodMonth,
    availablePeriods,
    summary: summarizeMonth(records, periodMonth),
    planVsReality: comparePlanVsActual(records, activities, periodMonth),
    lines,
  };
}
