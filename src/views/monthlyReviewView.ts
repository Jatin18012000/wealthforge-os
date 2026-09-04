import type { PrismaClient } from "@prisma/client";
import { periodMonthOf } from "../domain";
import { formatDate, formatMoney, formatPeriodMonth, formatRatio } from "../presentation/format";
import { getAnalyticsView, type AnalyticsView } from "./analyticsView";
import { getBehavioralIntelligenceView } from "./behavioralIntelligenceView";
import { getBudgetView, type BudgetView } from "./budgetView";
import { listPeriods, resolveAsOf, resolveLatestPeriod } from "./context";
import { getGoalLiabilityIntelligenceView } from "./goalLiabilityIntelligenceView";
import { fact, inference, recommendation, type Report, type ReportLine, type ReportSection } from "./reportView";

/**
 * v1.1.1 F9 — Monthly Financial Review.
 *
 * A second `Report` (the same FACT/INFERENCE/RECOMMENDATION structure
 * `src/views/reportView.ts` already defines, and the Daily Brief already
 * reuses for a different scope in `dailyBriefView.ts`) — this one scoped
 * to a single completed month rather than "right now." Every section
 * restates a figure an existing view already computed for that month
 * (Analytics' own month-over-month comparison, the Budget screen's own
 * monthly summary and plan-vs-reality, the Goal/Liability intelligence
 * layer's own current standing) — no new calculation is introduced here.
 *
 * The reviewed month is the most recently *completed* one relative to
 * `asOf` — the same "previous-month" period Analytics already resolves —
 * so a review generated mid-month never reports on data that is still
 * incomplete.
 */

function insufficientLine(reasons: readonly string[]): ReportLine {
  return fact(
    `Insufficient data — ${reasons.length > 0 ? reasons.join("; ") : "not enough trusted data"}`,
  );
}

function periodSection(reviewedMonth: string | null, analytics: AnalyticsView): ReportSection {
  const lines: ReportLine[] = [];
  if (reviewedMonth === null) {
    lines.push(
      analytics.range.kind === "insufficient-data"
        ? insufficientLine(analytics.range.reasons)
        : fact("No completed month could be resolved yet."),
    );
    return { title: "Period", lines };
  }
  lines.push(fact(`Reviewing ${formatPeriodMonth(reviewedMonth)}, the most recently completed month.`));
  for (const note of analytics.comparison?.coverageNotes ?? []) {
    lines.push(inference(note));
  }
  return { title: "Period", lines };
}

function incomeExpenseSection(budget: BudgetView | null): ReportSection {
  const lines: ReportLine[] = [];
  if (budget === null || budget.summary.kind !== "ok") {
    lines.push(insufficientLine(budget !== null && budget.summary.kind === "insufficient-data" ? budget.summary.reasons : []));
    return { title: "Income & Expenses", lines };
  }

  const summary = budget.summary.value;
  lines.push(fact(`Income: ${formatMoney(summary.incomeMinorUnits)}`));
  lines.push(fact(`Expenses: ${formatMoney(summary.expenseMinorUnits)}`));
  lines.push(fact(`EMIs: ${formatMoney(summary.emiMinorUnits)}`));
  lines.push(fact(`Investments: ${formatMoney(summary.investmentMinorUnits)}`));
  lines.push(fact(`Retained (income − expenses − EMIs): ${formatMoney(summary.retainedMinorUnits)}`));
  lines.push(fact(`Left over cash (retained − investments): ${formatMoney(summary.unallocatedMinorUnits)}`));
  lines.push(
    summary.savingsRate.kind === "ok"
      ? fact(`Savings rate: ${formatRatio(summary.savingsRate.value)}`)
      : insufficientLine(summary.savingsRate.reasons),
  );

  return { title: "Income & Expenses", lines };
}

function monthOverMonthSection(analytics: AnalyticsView): ReportSection {
  const lines: ReportLine[] = [];
  const comparison = analytics.comparison;
  if (comparison === null) {
    lines.push(fact("No prior month is available to compare against."));
    return { title: "Month-over-month", lines };
  }

  for (const variance of [...comparison.budgetVariances, ...comparison.activityVariances]) {
    if (variance.incomplete || variance.absoluteMinorUnits === null) continue;
    lines.push(
      fact(
        `${variance.metric} ${variance.absoluteMinorUnits >= 0 ? "increased" : "decreased"} by ${formatMoney(Math.abs(variance.absoluteMinorUnits))} versus the prior month`,
      ),
    );
  }
  if (lines.length === 0) lines.push(fact("No complete month-over-month comparison is available yet."));

  return { title: "Month-over-month", lines };
}

function planVsRealitySection(budget: BudgetView | null): ReportSection {
  const lines: ReportLine[] = [];
  if (budget === null || budget.planVsReality.kind !== "ok") {
    lines.push(insufficientLine(budget !== null && budget.planVsReality.kind === "insufficient-data" ? budget.planVsReality.reasons : []));
    return { title: "Plan vs reality", lines };
  }

  const reality = budget.planVsReality.value;
  for (const category of reality.categories) {
    if (category.actualMinorUnits === null) {
      lines.push(inference(`${category.category}: no confirmed activity recorded`));
      continue;
    }
    lines.push(
      fact(
        `${category.category}: planned ${formatMoney(category.plannedMinorUnits)}, actual ${formatMoney(category.actualMinorUnits)}`,
      ),
    );
  }
  if (reality.hasNoActuals) {
    lines.push(recommendation("Import this month's confirmed activity to compare it against plan."));
  }

  return { title: "Plan vs reality", lines };
}

function goalsSection(
  goalLiability: Awaited<ReturnType<typeof getGoalLiabilityIntelligenceView>>,
): ReportSection {
  const lines: ReportLine[] = [];
  if (goalLiability.goalFundingRadar.result.kind !== "ok") {
    lines.push(insufficientLine(goalLiability.goalFundingRadar.result.reasons));
    return { title: "Goals", lines };
  }

  for (const row of goalLiability.goalFundingRadar.result.value) {
    const ratio =
      row.progress.progressRatio.kind === "ok" ? formatRatio(row.progress.progressRatio.value) : "unknown share";
    lines.push(
      fact(
        `${row.goal.name}: ${formatMoney(row.progress.currentAmountMinorUnits)} of ${formatMoney(row.goal.targetAmountMinorUnits)} (${ratio})`,
      ),
    );
  }
  if (lines.length === 0) lines.push(fact("No active goal is currently tracked."));

  return { title: "Goals", lines };
}

function liabilitiesSection(
  goalLiability: Awaited<ReturnType<typeof getGoalLiabilityIntelligenceView>>,
): ReportSection {
  const lines: ReportLine[] = [];

  if (goalLiability.debtFreedomMeter.result.kind === "ok") {
    const meter = goalLiability.debtFreedomMeter.result.value;
    lines.push(
      fact(
        `Debt repaid: ${formatRatio(meter.repaidRatio)}, ${formatMoney(meter.totalOutstandingMinorUnits)} outstanding`,
      ),
    );
    lines.push(fact(`Projected debt-free date: ${formatDate(meter.latestDebtFreeDate)}`));
  } else {
    lines.push(insufficientLine(goalLiability.debtFreedomMeter.result.reasons));
  }

  return { title: "Liabilities & EMI", lines };
}

function dataQualitySection(
  behavioral: Awaited<ReturnType<typeof getBehavioralIntelligenceView>>,
): ReportSection {
  const lines: ReportLine[] = [];

  if (behavioral.dataHealth.result.kind === "ok") {
    const health = behavioral.dataHealth.result.value;
    for (const summary of health.trustSummaries) {
      const untrusted = summary.counts.needs_review + summary.counts.rejected;
      if (untrusted > 0) {
        lines.push(
          recommendation(
            `Review the ${untrusted} ${summary.label.toLowerCase()} record(s) marked needs-review or rejected`,
          ),
        );
      }
    }
  }
  if (lines.length === 0) lines.push(fact("No data quality issue is currently flagged."));

  return { title: "Data quality", lines };
}

export async function getMonthlyReviewReport(db: PrismaClient): Promise<Report> {
  const asOf = await resolveAsOf(db);
  const latestPeriod = await resolveLatestPeriod(db);
  const periods = await listPeriods(db);

  const analytics = await getAnalyticsView(db, asOf, "previous-month");
  const reviewedMonth =
    analytics.range.kind === "ok" ? periodMonthOf(analytics.range.value.start) : null;

  const [budget, goalLiability, behavioral] = await Promise.all([
    reviewedMonth === null ? Promise.resolve(null) : getBudgetView(db, reviewedMonth, periods),
    getGoalLiabilityIntelligenceView(db, asOf, latestPeriod),
    getBehavioralIntelligenceView(db, asOf),
  ]);

  return {
    generatedAt: new Date(),
    asOf,
    periodMonth: reviewedMonth,
    sections: [
      periodSection(reviewedMonth, analytics),
      incomeExpenseSection(budget),
      monthOverMonthSection(analytics),
      planVsRealitySection(budget),
      goalsSection(goalLiability),
      liabilitiesSection(goalLiability),
      dataQualitySection(behavioral),
    ],
  };
}
