import { safeRatio, sumMinorUnits } from "./money";
import { insufficient, ok, type Computed, type Exclusion } from "./result";
import { isTrusted, untrustedReason } from "./trust";

export type PlanCategory = "income" | "expense" | "investment" | "emi";

export interface PlanRecordInput {
  readonly id: string;
  readonly periodMonth: string; // "YYYY-MM"
  readonly category: PlanCategory;
  readonly labelRaw: string;
  /** Null when the source cell had no extractable amount — never treated as 0. */
  readonly amountMinorUnits: number | null;
  readonly trustState: string;
}

export interface MonthlyBudget {
  readonly periodMonth: string;
  readonly incomeMinorUnits: number;
  readonly expenseMinorUnits: number;
  readonly emiMinorUnits: number;
  readonly investmentMinorUnits: number;
  /** Expenses + EMI: money consumed, not retained in any form. */
  readonly committedOutflowMinorUnits: number;
  /** Income − expenses − EMI. Money retained, whether invested or left as cash. */
  readonly retainedMinorUnits: number;
  /** Income − expenses − EMI − investments. Cash left genuinely unallocated. */
  readonly unallocatedMinorUnits: number;
  /** Retained ÷ income. Insufficient when no trusted income is recorded. */
  readonly savingsRate: Computed<number>;
  /** Investments ÷ income. Insufficient when no trusted income is recorded. */
  readonly investmentRate: Computed<number>;
  readonly exclusions: readonly Exclusion[];
}

/**
 * Summarizes one month's plan records.
 *
 * Components are reported separately rather than pre-collapsed into a
 * single "surplus", because whether EMI and investment count as outflows
 * depends on the question being asked. `retained` (money not consumed) and
 * `unallocated` (cash genuinely left over) are both exposed so neither
 * reading is hidden — see docs/19_OPEN_DECISIONS.md, D-010.
 */
export function summarizeMonth(
  records: readonly PlanRecordInput[],
  periodMonth: string,
): Computed<MonthlyBudget> {
  const exclusions: Exclusion[] = [];
  const forMonth = records.filter((record) => record.periodMonth === periodMonth);

  const trusted: PlanRecordInput[] = [];
  for (const record of forMonth) {
    if (!isTrusted(record.trustState)) {
      exclusions.push({
        recordId: record.id,
        label: record.labelRaw,
        reason: untrustedReason(record.trustState),
      });
      continue;
    }
    if (record.amountMinorUnits === null) {
      // A trusted record with no extractable amount should not exist, but if
      // it does it must not silently contribute zero to a total.
      exclusions.push({
        recordId: record.id,
        label: record.labelRaw,
        reason: "no extractable amount",
      });
      continue;
    }
    trusted.push(record);
  }

  if (trusted.length === 0) {
    return insufficient(
      `no trusted budget records for ${periodMonth}`,
      ...exclusions.map((e) => `${e.label}: ${e.reason}`),
    );
  }

  const totalFor = (category: PlanCategory): number =>
    sumMinorUnits(
      trusted.filter((r) => r.category === category).map((r) => r.amountMinorUnits as number),
    );

  const incomeMinorUnits = totalFor("income");
  const expenseMinorUnits = totalFor("expense");
  const emiMinorUnits = totalFor("emi");
  const investmentMinorUnits = totalFor("investment");

  const committedOutflowMinorUnits = expenseMinorUnits + emiMinorUnits;
  const retainedMinorUnits = incomeMinorUnits - committedOutflowMinorUnits;
  const unallocatedMinorUnits = retainedMinorUnits - investmentMinorUnits;

  const noIncome = insufficient<number>(
    `no trusted income recorded for ${periodMonth}; rates against income are undefined`,
  );
  const savingsRatio = safeRatio(retainedMinorUnits, incomeMinorUnits);
  const investmentRatio = safeRatio(investmentMinorUnits, incomeMinorUnits);

  return ok({
    periodMonth,
    incomeMinorUnits,
    expenseMinorUnits,
    emiMinorUnits,
    investmentMinorUnits,
    committedOutflowMinorUnits,
    retainedMinorUnits,
    unallocatedMinorUnits,
    savingsRate: savingsRatio === null ? noIncome : ok(savingsRatio),
    investmentRate: investmentRatio === null ? noIncome : ok(investmentRatio),
    exclusions,
  });
}

// --- Plan vs Reality ------------------------------------------------------

export interface ActivityInput {
  readonly id: string;
  readonly kind: string;
  readonly amountMinorUnits: number;
  readonly occurredOn: Date;
  readonly trustState: string;
}

/**
 * Maps a confirmed activity to the budget category it realizes.
 *
 * Goal contributions and withdrawals map to nothing on purpose: they move
 * money between the household's own buckets rather than in or out of the
 * household, so counting them here would double-count money already
 * captured as income, expense, or investment
 * (docs/07, goal progress "prevent double counting").
 */
export function activityCategory(kind: string): PlanCategory | null {
  switch (kind) {
    case "one_time_income":
      return "income";
    case "one_time_expense":
      return "expense";
    case "sip":
    case "buy":
      return "investment";
    case "emi_payment":
      return "emi";
    default:
      return null;
  }
}

export type Coverage = "complete" | "no-actual-data";

export interface CategoryComparison {
  readonly category: PlanCategory;
  readonly plannedMinorUnits: number;
  /** Null when no confirmed activity exists for this category in the period. */
  readonly actualMinorUnits: number | null;
  readonly varianceMinorUnits: number | null;
  /** Variance as a ratio of plan. Null when planned is 0 (undefined) or no actuals. */
  readonly varianceRatio: number | null;
  readonly coverage: Coverage;
}

export interface PlanVsReality {
  readonly periodMonth: string;
  readonly categories: readonly CategoryComparison[];
  /** True when NO confirmed activity at all exists for the period. */
  readonly hasNoActuals: boolean;
}

/**
 * Compares intent against confirmed activity for one month.
 *
 * A category with no confirmed activity reports `actual: null` and
 * `coverage: "no-actual-data"` — never `actual: 0`. Absence of a record and
 * a genuine zero are different claims, and treating the former as the
 * latter would report a fictitious 100% underspend
 * (docs/11_ANALYTICS_SPEC.md, "Data-coverage warnings").
 */
export function comparePlanVsActual(
  planRecords: readonly PlanRecordInput[],
  activities: readonly ActivityInput[],
  periodMonth: string,
): Computed<PlanVsReality> {
  const summary = summarizeMonth(planRecords, periodMonth);
  if (summary.kind !== "ok") return summary;

  const [yearPart, monthPart] = periodMonth.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return insufficient(`"${periodMonth}" is not a valid YYYY-MM period`);
  }

  const trustedInPeriod = activities.filter((activity) => {
    if (!isTrusted(activity.trustState)) return false;
    const occurred = activity.occurredOn;
    return occurred.getUTCFullYear() === year && occurred.getUTCMonth() + 1 === month;
  });

  const actualTotals = new Map<PlanCategory, number>();
  for (const activity of trustedInPeriod) {
    const category = activityCategory(activity.kind);
    if (category === null) continue;
    actualTotals.set(category, (actualTotals.get(category) ?? 0) + activity.amountMinorUnits);
  }

  const planned: Record<PlanCategory, number> = {
    income: summary.value.incomeMinorUnits,
    expense: summary.value.expenseMinorUnits,
    investment: summary.value.investmentMinorUnits,
    emi: summary.value.emiMinorUnits,
  };

  const categories: CategoryComparison[] = (
    ["income", "expense", "investment", "emi"] as const
  ).map((category) => {
    const plannedMinorUnits = planned[category];
    const actual = actualTotals.get(category);

    if (actual === undefined) {
      return {
        category,
        plannedMinorUnits,
        actualMinorUnits: null,
        varianceMinorUnits: null,
        varianceRatio: null,
        coverage: "no-actual-data" as const,
      };
    }

    const varianceMinorUnits = actual - plannedMinorUnits;
    return {
      category,
      plannedMinorUnits,
      actualMinorUnits: actual,
      varianceMinorUnits,
      // Undefined against a zero plan — an infinite overspend ratio is not
      // a useful number to show.
      varianceRatio: safeRatio(varianceMinorUnits, plannedMinorUnits),
      coverage: "complete" as const,
    };
  });

  return ok({
    periodMonth,
    categories,
    hasNoActuals: actualTotals.size === 0,
  });
}
