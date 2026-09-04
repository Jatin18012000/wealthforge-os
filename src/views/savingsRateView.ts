import type { PrismaClient } from "@prisma/client";
import {
  buildInsight,
  computeOverallSavingsRate,
  detectSavingsRateMilestone,
  isTrusted,
  OVERALL_SAVINGS_RATE_MILESTONE_RATIO,
  summarizeMonth,
  type Computed,
  type Insight,
  type Milestone,
  type MetricDefinition,
} from "../domain";
import { loadEffectivePlanRecords } from "../data/loaders";

/**
 * Overall Savings Rate (v1.1.1 F8, second resolved sub-item).
 *
 * A metric distinct from `MonthlyBudget.savingsRate`/`investmentRate`
 * (`src/domain/budget.ts`) — the account owner's own definition: net
 * stock/mutual-fund/ETF/EPF contributions, plus net Emergency Fund
 * contributions, plus whatever cash was left over unallocated, divided by
 * income, for one month. `src/domain/savingsRate.ts` does the arithmetic;
 * this module only assembles the month-scoped inputs from already-existing
 * tables — no new figure is calculated here either.
 */

const OVERALL_SAVINGS_RATE_METRIC: MetricDefinition = {
  id: "overall_savings_rate",
  label: "Overall Savings Rate",
  unit: "ratio",
  description:
    "Net stock/mutual-fund/ETF/EPF contributions, plus net Emergency Fund contributions, plus leftover unallocated cash, divided by income, for the latest complete month.",
};

const INVESTMENT_KINDS_COUNTED = new Set(["equity", "etf", "mutual_fund", "epf"]);

function parsePeriodMonth(periodMonth: string): { year: number; month: number } {
  const [yearPart, monthPart] = periodMonth.split("-");
  return { year: Number(yearPart), month: Number(monthPart) };
}

function inMonth(occurredOn: Date, year: number, month: number): boolean {
  return occurredOn.getUTCFullYear() === year && occurredOn.getUTCMonth() + 1 === month;
}

export interface OverallSavingsRateSummary {
  readonly ratio: Computed<number>;
  readonly netInvestmentContributionMinorUnits: number;
  readonly netEmergencyFundContributionMinorUnits: number;
  readonly leftoverCashMinorUnits: number;
  readonly incomeMinorUnits: number;
}

export interface OverallSavingsRateView {
  readonly insight: Insight<OverallSavingsRateSummary>;
  readonly milestones: readonly Milestone[];
}

export async function getOverallSavingsRateView(
  db: PrismaClient,
  asOf: Date,
  periodMonth: string | null,
): Promise<OverallSavingsRateView> {
  if (periodMonth === null) {
    const insight = buildInsight<OverallSavingsRateSummary>({
      metric: OVERALL_SAVINGS_RATE_METRIC,
      result: {
        kind: "insufficient-data" as const,
        reasons: ["no month has been imported yet"],
      },
      asOf,
      calculationBasis: "Requires at least one month of imported budget data.",
    });
    return { insight, milestones: [] };
  }

  const { year, month } = parsePeriodMonth(periodMonth);

  const planRecords = await loadEffectivePlanRecords(db, periodMonth);
  const budget = summarizeMonth(planRecords, periodMonth);
  const incomeMinorUnits = budget.kind === "ok" ? budget.value.incomeMinorUnits : 0;
  const leftoverCashMinorUnits = budget.kind === "ok" ? budget.value.unallocatedMinorUnits : 0;

  const investmentActivityRows = await db.activity.findMany({
    where: { kind: { in: ["buy", "sell", "sip"] }, instrumentId: { not: null } },
    include: { instrument: true },
  });
  const netInvestmentContributionMinorUnits = investmentActivityRows
    .filter(
      (row) =>
        isTrusted(row.trustState) &&
        inMonth(row.occurredOn, year, month) &&
        row.instrument !== null &&
        INVESTMENT_KINDS_COUNTED.has(row.instrument.kind),
    )
    .reduce((sum, row) => sum + (row.kind === "sell" ? -row.amountMinorUnits : row.amountMinorUnits), 0);

  const emergencyFundActivityRows = await db.activity.findMany({
    where: { kind: { in: ["goal_contribution", "goal_withdrawal"] }, goalId: { not: null } },
    include: { goal: true },
  });
  const netEmergencyFundContributionMinorUnits = emergencyFundActivityRows
    .filter(
      (row) =>
        isTrusted(row.trustState) &&
        inMonth(row.occurredOn, year, month) &&
        row.goal !== null &&
        row.goal.kind === "emergency_fund",
    )
    .reduce(
      (sum, row) => sum + (row.kind === "goal_withdrawal" ? -row.amountMinorUnits : row.amountMinorUnits),
      0,
    );

  const ratio = computeOverallSavingsRate({
    incomeMinorUnits,
    netInvestmentContributionMinorUnits,
    netEmergencyFundContributionMinorUnits,
    leftoverCashMinorUnits,
  });

  const insight = buildInsight({
    metric: OVERALL_SAVINGS_RATE_METRIC,
    result: {
      kind: "ok" as const,
      value: {
        ratio,
        netInvestmentContributionMinorUnits,
        netEmergencyFundContributionMinorUnits,
        leftoverCashMinorUnits,
        incomeMinorUnits,
      },
    },
    asOf,
    calculationBasis: `(net stock/MF/ETF/EPF contributions + net Emergency Fund contributions + leftover unallocated cash) ÷ income, for ${periodMonth}.`,
  });

  const milestones = detectSavingsRateMilestone(ratio, OVERALL_SAVINGS_RATE_MILESTONE_RATIO);

  return { insight, milestones };
}
