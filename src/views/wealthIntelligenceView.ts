import type { PrismaClient } from "@prisma/client";
import { loadActivities, loadEffectivePlanRecords } from "../data/loaders";
import {
  buildDecomposition,
  buildInsight,
  buildMonthlySeries,
  insufficient,
  monthsInRange,
  ok,
  safeRatio,
  summarizeMonth,
  type Computed,
  type DateRange,
  type Decomposition,
  type Insight,
  type MetricDefinition,
  type TimeSeriesPoint,
} from "../domain";
import { computeNetWorthAsOf } from "./commandCenterView";

/**
 * IM-02 Wealth Intelligence (v1.1, `docs/21_INTELLIGENCE_MASTER_PLAN.md`).
 *
 * Every widget here composes existing engine outputs
 * (`computeNetWorthAsOf`, `summarizeMonth`) over a series of dates/months —
 * none introduces a new calculation. Historical net worth is only as rich
 * as the position/valuation history actually recorded: a month with no
 * snapshot at or before it reports insufficient data rather than
 * inventing one, exactly as `computeNetWorthAsOf` already does for a
 * single date.
 */

const NET_WORTH_METRIC: MetricDefinition = {
  id: "net_worth_trajectory",
  label: "Net Worth Trajectory",
  unit: "money",
  description: "Net worth (trusted assets minus trusted liabilities) at each month-end.",
};

const ASSETS_VS_LIABILITIES_METRIC: MetricDefinition = {
  id: "assets_vs_liabilities",
  label: "Assets vs Liabilities",
  unit: "money",
  description: "Total trusted assets and total trusted liabilities as of the same date.",
};

const NET_WORTH_WATERFALL_METRIC: MetricDefinition = {
  id: "net_worth_waterfall",
  label: "Net Worth Waterfall",
  unit: "money",
  description:
    "Decomposes the change in net worth between two dates into contributions, market movement, and liability change.",
};

const MONEY_FLOW_METRIC: MetricDefinition = {
  id: "monthly_money_flow",
  label: "Monthly Money Flow",
  unit: "money",
  description: "Income, expenses, EMIs and investments per month, from the budget plan.",
};

const SAVINGS_RATE_METRIC: MetricDefinition = {
  id: "savings_rate_trend",
  label: "Savings Rate Trend",
  unit: "ratio",
  description: "Retained income (income minus expenses minus EMIs) divided by income, per month.",
};

const INVESTMENT_RATE_METRIC: MetricDefinition = {
  id: "investment_rate_trend",
  label: "Investment Rate Trend",
  unit: "ratio",
  description: "Planned investment divided by income, per month.",
};

export interface WealthIntelligenceView {
  readonly netWorthTrajectory: Insight<readonly TimeSeriesPoint<number>[]>;
  readonly assetsVsLiabilities: Insight<{
    readonly totalAssetsMinorUnits: number;
    readonly totalLiabilitiesMinorUnits: number;
  }>;
  readonly netWorthWaterfall: Insight<Decomposition>;
  readonly moneyFlow: Insight<
    readonly TimeSeriesPoint<{
      readonly incomeMinorUnits: number;
      readonly expenseMinorUnits: number;
      readonly emiMinorUnits: number;
      readonly investmentMinorUnits: number;
      readonly unallocatedMinorUnits: number;
    }>[]
  >;
  readonly savingsRateTrend: Insight<readonly TimeSeriesPoint<number>[]>;
  readonly investmentRateTrend: Insight<readonly TimeSeriesPoint<number>[]>;
}

/** Month-end date (UTC) for a "YYYY-MM" period month, used to sample net worth once per month. */
function monthEndDate(periodMonth: string): Date {
  const [yearStr, monthStr] = periodMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59));
}

export async function getWealthIntelligenceView(
  db: PrismaClient,
  range: DateRange,
  asOf: Date,
): Promise<WealthIntelligenceView> {
  const coverage = monthsInRange(range);
  const months = coverage.fullyCovered;

  const [netWorthTrajectory, moneyFlow, savingsRateTrend, investmentRateTrend] =
    await Promise.all([
      buildNetWorthTrajectory(db, months, asOf),
      buildMoneyFlow(db, months),
      buildRateTrend(db, months, "savings"),
      buildRateTrend(db, months, "investment"),
    ]);

  return {
    netWorthTrajectory,
    assetsVsLiabilities: await buildAssetsVsLiabilities(db, asOf),
    netWorthWaterfall: await buildNetWorthWaterfall(db, range),
    moneyFlow,
    savingsRateTrend,
    investmentRateTrend,
  };
}

async function buildNetWorthTrajectory(
  db: PrismaClient,
  months: readonly string[],
  asOf: Date,
): Promise<Insight<readonly TimeSeriesPoint<number>[]>> {
  if (months.length === 0) {
    return buildInsight({
      metric: NET_WORTH_METRIC,
      result: insufficient("the selected period contains no fully-covered month"),
      asOf,
      calculationBasis: "Net worth computed once per fully-covered month.",
    });
  }

  const points: TimeSeriesPoint<number>[] = [];
  for (const month of months) {
    const sampledAt = monthEndDate(month) > asOf ? asOf : monthEndDate(month);
    const { netWorth } = await computeNetWorthAsOf(db, sampledAt);
    points.push({ periodMonth: month, value: netWorth.kind === "ok" ? netWorth.value.netWorthMinorUnits : null });
  }

  return buildInsight({
    metric: NET_WORTH_METRIC,
    result: ok(points),
    asOf,
    calculationBasis:
      "computeNetWorthAsOf sampled at the end of each fully-covered month (or the as-of date, if earlier).",
    severity: points.every((p) => p.value === null) ? "notice" : "info",
  });
}

async function buildAssetsVsLiabilities(
  db: PrismaClient,
  asOf: Date,
): Promise<
  Insight<{ readonly totalAssetsMinorUnits: number; readonly totalLiabilitiesMinorUnits: number }>
> {
  const { netWorth } = await computeNetWorthAsOf(db, asOf);

  const result: Computed<{
    totalAssetsMinorUnits: number;
    totalLiabilitiesMinorUnits: number;
  }> =
    netWorth.kind === "ok"
      ? ok({
          totalAssetsMinorUnits: netWorth.value.totalAssetsMinorUnits,
          totalLiabilitiesMinorUnits: netWorth.value.totalLiabilitiesMinorUnits,
        })
      : insufficient(...netWorth.reasons);

  return buildInsight({
    metric: ASSETS_VS_LIABILITIES_METRIC,
    result,
    asOf,
    calculationBasis: "Read directly from computeNetWorthAsOf's totals.",
  });
}

/**
 * Decomposes net worth change over `range` into contributions (new
 * investment capital moved in), withdrawals, liability change, and a
 * market-movement remainder — never relabeling a contribution as
 * appreciation, and never distributing an unexplained gap across the known
 * steps (CLAUDE.md; `buildDecomposition`).
 */
async function buildNetWorthWaterfall(
  db: PrismaClient,
  range: DateRange,
): Promise<Insight<Decomposition>> {
  const opening = await computeNetWorthAsOf(db, range.start);
  const closingAsOf = new Date(range.end.getTime() - 1);
  const closing = await computeNetWorthAsOf(db, closingAsOf);

  if (opening.netWorth.kind !== "ok" || closing.netWorth.kind !== "ok") {
    const reasons = [
      ...(opening.netWorth.kind === "insufficient-data" ? opening.netWorth.reasons : []),
      ...(closing.netWorth.kind === "insufficient-data" ? closing.netWorth.reasons : []),
    ];
    return buildInsight({
      metric: NET_WORTH_WATERFALL_METRIC,
      result: insufficient(
        "net worth could not be computed at both the opening and closing dates",
        ...reasons,
      ),
      asOf: closingAsOf,
      calculationBasis: "Requires a trusted net worth figure at both ends of the range.",
    });
  }

  const activities = (await loadActivities(db)).filter(
    (activity) => activity.occurredOn >= range.start && activity.occurredOn < range.end,
  );
  const contributionMinorUnits = activities
    .filter((a) => a.kind === "sip" || a.kind === "buy")
    .reduce((sum, a) => sum + a.amountMinorUnits, 0);
  const withdrawalMinorUnits = activities
    .filter((a) => a.kind === "sell")
    .reduce((sum, a) => sum + a.amountMinorUnits, 0);

  const openingLiabilities = opening.netWorth.value.totalLiabilitiesMinorUnits;
  const closingLiabilities = closing.netWorth.value.totalLiabilitiesMinorUnits;
  // A liability that shrinks increases net worth, so its step is the negated change.
  const liabilityChangeMinorUnits = openingLiabilities - closingLiabilities;

  const openingMinorUnits = opening.netWorth.value.netWorthMinorUnits;
  const closingMinorUnits = closing.netWorth.value.netWorthMinorUnits;
  const explainedSoFar = contributionMinorUnits - withdrawalMinorUnits + liabilityChangeMinorUnits;
  const appreciationMinorUnits = closingMinorUnits - openingMinorUnits - explainedSoFar;

  const decomposition = buildDecomposition(openingMinorUnits, closingMinorUnits, [
    { kind: "contribution", label: "New investment capital", amountMinorUnits: contributionMinorUnits },
    { kind: "withdrawal", label: "Investment withdrawals", amountMinorUnits: -withdrawalMinorUnits },
    { kind: "liability_change", label: "Liability change", amountMinorUnits: liabilityChangeMinorUnits },
    {
      kind: "appreciation",
      label: "Market movement & unconfirmed changes (residual)",
      amountMinorUnits: appreciationMinorUnits,
    },
  ]);

  return buildInsight({
    metric: NET_WORTH_WATERFALL_METRIC,
    result: ok(decomposition),
    asOf: closingAsOf,
    calculationBasis:
      "Opening/closing net worth from computeNetWorthAsOf; contributions and withdrawals from confirmed sip/buy/sell activity in range; liability change from the same figures' liability totals. The residual step is deliberately not claimed as pure market movement: it also absorbs any holding-quantity change ingestion recorded as an unexplained observation rather than a confirmed trade (docs/09_INGESTION_ARCHITECTURE.md) — this widget cannot distinguish the two without inventing a transaction that was never confirmed, so it reports them together rather than mislabeling either.",
  });
}

async function buildMoneyFlow(
  db: PrismaClient,
  months: readonly string[],
): Promise<
  Insight<
    readonly TimeSeriesPoint<{
      readonly incomeMinorUnits: number;
      readonly expenseMinorUnits: number;
      readonly emiMinorUnits: number;
      readonly investmentMinorUnits: number;
      readonly unallocatedMinorUnits: number;
    }>[]
  >
> {
  if (months.length === 0) {
    return buildInsight({
      metric: MONEY_FLOW_METRIC,
      result: insufficient("the selected period contains no fully-covered month"),
      asOf: new Date(),
      calculationBasis: "summarizeMonth, once per fully-covered month.",
    });
  }

  const planRecords = await loadEffectivePlanRecords(db);
  const series = buildMonthlySeries(months, (month) => {
    const summary = summarizeMonth(planRecords, month);
    if (summary.kind !== "ok") return null;
    return {
      incomeMinorUnits: summary.value.incomeMinorUnits,
      expenseMinorUnits: summary.value.expenseMinorUnits,
      emiMinorUnits: summary.value.emiMinorUnits,
      investmentMinorUnits: summary.value.investmentMinorUnits,
      unallocatedMinorUnits: summary.value.unallocatedMinorUnits,
    };
  });

  return buildInsight({
    metric: MONEY_FLOW_METRIC,
    result: ok(series),
    asOf: new Date(),
    calculationBasis: "summarizeMonth applied to each fully-covered month's trusted plan records.",
  });
}

async function buildRateTrend(
  db: PrismaClient,
  months: readonly string[],
  which: "savings" | "investment",
): Promise<Insight<readonly TimeSeriesPoint<number>[]>> {
  const metric = which === "savings" ? SAVINGS_RATE_METRIC : INVESTMENT_RATE_METRIC;

  if (months.length === 0) {
    return buildInsight({
      metric,
      result: insufficient("the selected period contains no fully-covered month"),
      asOf: new Date(),
      calculationBasis: "summarizeMonth's savingsRate/investmentRate, once per fully-covered month.",
    });
  }

  const planRecords = await loadEffectivePlanRecords(db);
  const series = buildMonthlySeries(months, (month) => {
    const summary = summarizeMonth(planRecords, month);
    if (summary.kind !== "ok") return null;
    const rate = which === "savings" ? summary.value.savingsRate : summary.value.investmentRate;
    return rate.kind === "ok" ? rate.value : null;
  });

  return buildInsight({
    metric,
    result: ok(series),
    asOf: new Date(),
    calculationBasis: `summarizeMonth's ${which}Rate applied to each fully-covered month.`,
  });
}

// Re-exported for widget tests that want to sanity-check a ratio directly
// without recomputing an entire month.
export { safeRatio };
