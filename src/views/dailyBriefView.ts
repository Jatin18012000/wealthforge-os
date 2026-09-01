import type { PrismaClient } from "@prisma/client";
import { resolvePeriod } from "../domain";
import { formatDate, formatMoney, formatRatio } from "../presentation/format";
import { getBehavioralIntelligenceView } from "./behavioralIntelligenceView";
import { getCommandCenterView } from "./commandCenterView";
import { listPeriods, resolveAsOf, resolveLatestPeriod } from "./context";
import { getGoalLiabilityIntelligenceView } from "./goalLiabilityIntelligenceView";
import { getInvestmentIntelligenceView } from "./investmentIntelligenceView";
import { fact, inference, recommendation, type Report, type ReportLine, type ReportSection } from "./reportView";
import { getWealthIntelligenceView } from "./wealthIntelligenceView";

/**
 * IM-07 WealthForge Daily Brief (v1.1, `docs/21_INTELLIGENCE_MASTER_PLAN.md`,
 * spec in `docs/24_DAILY_BRIEF_SPEC.md`).
 *
 * This is a `Report` (the same M10 rule-based, FACT/INFERENCE/RECOMMENDATION
 * structure `src/views/reportView.ts` already defines) built from the v1.1
 * intelligence layer's own `Insight<T>` outputs (IM-02 through IM-05)
 * instead of the M10/M11 report's Command Center + Market sections. It
 * introduces no new calculation: every line here restates a figure an
 * existing view already computed. `src/ai/analyst.ts`'s `explainReport`
 * (unchanged) turns this `Report` into a grounded natural-language brief —
 * the AI never sees anything but this text, never calculates a figure of
 * its own, and any response asserting a number not present here is
 * rejected before it reaches the screen (`docs/12_AI_ANALYST_SPEC.md`
 * grounding architecture, reused as-is).
 */

const BRIEF_RANGE_KEY = "6m" as const;

export async function getDailyBriefReport(db: PrismaClient): Promise<Report> {
  const asOf = await resolveAsOf(db);
  const periodMonth = await resolveLatestPeriod(db);
  const periods = await listPeriods(db);

  const commandCenter = await getCommandCenterView(db, asOf, periodMonth, periods);
  const rangeResult = resolvePeriod(BRIEF_RANGE_KEY, { anchor: asOf });

  const [wealth, investment, goalLiability, behavioral] = await Promise.all([
    rangeResult.kind === "ok" ? getWealthIntelligenceView(db, rangeResult.value, asOf) : null,
    rangeResult.kind === "ok" ? getInvestmentIntelligenceView(db, rangeResult.value, asOf) : null,
    getGoalLiabilityIntelligenceView(db, asOf, periodMonth),
    getBehavioralIntelligenceView(db, asOf),
  ]);

  return {
    generatedAt: new Date(),
    asOf,
    periodMonth,
    sections: [
      positionSection(commandCenter),
      changesSection(behavioral),
      whySection(wealth),
      deviationsSection(investment, goalLiability),
      risksSection(investment, behavioral),
      goalsSection(goalLiability),
      portfolioSection(investment),
      dataQualitySection(behavioral),
    ],
  };
}

function insufficientLine(reasons: readonly string[]): ReportLine {
  return fact(`Insufficient data — ${reasons.length > 0 ? reasons.join("; ") : "not enough trusted data"}`);
}

// --- Position: what do I have right now -------------------------------------------------------

function positionSection(
  commandCenter: Awaited<ReturnType<typeof getCommandCenterView>>,
): ReportSection {
  const lines: ReportLine[] = [];

  lines.push(
    commandCenter.netWorth.kind === "ok"
      ? fact(`Net worth is ${formatMoney(commandCenter.netWorth.value.netWorthMinorUnits)} as of ${formatDate(commandCenter.asOf)}`)
      : insufficientLine(commandCenter.netWorth.reasons),
  );
  lines.push(
    commandCenter.portfolio.valuation.kind === "ok"
      ? fact(`Portfolio is valued at ${formatMoney(commandCenter.portfolio.valuation.value.totalMinorUnits)} across ${commandCenter.portfolio.holdings.length} holding(s)`)
      : insufficientLine(commandCenter.portfolio.valuation.reasons),
  );
  lines.push(
    fact(
      `Cash on hand: ${commandCenter.cashMinorUnits === null ? "no cash balance recorded" : formatMoney(commandCenter.cashMinorUnits)}`,
    ),
  );
  lines.push(fact(`Total liabilities outstanding: ${formatMoney(commandCenter.liabilities.totalOutstandingMinorUnits)}`));

  return { title: "Position", lines };
}

// --- Changes: what changed since last time -------------------------------------------------------

function changesSection(behavioral: Awaited<ReturnType<typeof getBehavioralIntelligenceView>>): ReportSection {
  const lines: ReportLine[] = [];

  if (behavioral.whatsChanged.result.kind !== "ok") {
    lines.push(insufficientLine(behavioral.whatsChanged.result.reasons));
    return { title: "Changes", lines };
  }

  const changed = behavioral.whatsChanged.result.value;
  for (const variance of [...changed.budgetVariances, ...changed.activityVariances]) {
    if (variance.incomplete || variance.absoluteMinorUnits === null) continue;
    lines.push(fact(`${variance.metric} changed by ${formatMoney(variance.absoluteMinorUnits)} month-over-month`));
  }
  if (changed.netWorthVariance.kind === "ok") {
    lines.push(fact(`Net worth moved by ${formatMoney(changed.netWorthVariance.value.deltaMinorUnits)} over the same window`));
  }
  if (lines.length === 0) lines.push(fact("No complete month-over-month comparison is available yet."));

  return { title: "Changes", lines };
}

// --- Why: what is driving the change -------------------------------------------------------

function whySection(wealth: Awaited<ReturnType<typeof getWealthIntelligenceView>> | null): ReportSection {
  const lines: ReportLine[] = [];

  if (wealth === null || wealth.netWorthWaterfall.result.kind !== "ok") {
    lines.push(
      insufficientLine(wealth !== null && wealth.netWorthWaterfall.result.kind === "insufficient-data" ? wealth.netWorthWaterfall.result.reasons : []),
    );
    return { title: "Why", lines };
  }

  const decomposition = wealth.netWorthWaterfall.result.value;
  for (const step of decomposition.steps) {
    lines.push(fact(`${step.label}: ${formatMoney(step.amountMinorUnits)}`));
  }
  if (!decomposition.isComplete && decomposition.unexplainedMinorUnits !== null) {
    lines.push(inference(`${formatMoney(decomposition.unexplainedMinorUnits)} of the change is unexplained by the above`));
  }

  return { title: "Why", lines };
}

// --- Deviations: plan vs reality -------------------------------------------------------

function deviationsSection(
  investment: Awaited<ReturnType<typeof getInvestmentIntelligenceView>> | null,
  goalLiability: Awaited<ReturnType<typeof getGoalLiabilityIntelligenceView>>,
): ReportSection {
  const lines: ReportLine[] = [];

  if (investment !== null && investment.plannedVsActualAllocation.result.kind === "ok") {
    for (const row of investment.plannedVsActualAllocation.result.value) {
      if (row.status === "overweight" || row.status === "underweight") {
        lines.push(inference(`${row.label} is ${row.status} relative to plan`));
      }
    }
  }

  if (goalLiability.goalCollisionDetector.result.kind === "ok") {
    const collision = goalLiability.goalCollisionDetector.result.value;
    lines.push(
      inference(
        `Active goals with a target date collectively need ${formatMoney(collision.totalRequiredMonthlyMinorUnits)}/month, against ${formatMoney(collision.monthlyCapacityMinorUnits)}/month of unallocated cash`,
      ),
    );
    if (collision.shortfallMinorUnits > 0) {
      lines.push(
        recommendation(
          "Consider reviewing goal target dates or funding priority — combined demand currently exceeds capacity",
        ),
      );
    }
  }

  if (lines.length === 0) lines.push(fact("No plan-vs-reality deviation is currently flagged."));

  return { title: "Deviations", lines };
}

// --- Risks -------------------------------------------------------

function risksSection(
  investment: Awaited<ReturnType<typeof getInvestmentIntelligenceView>> | null,
  behavioral: Awaited<ReturnType<typeof getBehavioralIntelligenceView>>,
): ReportSection {
  const lines: ReportLine[] = [];

  if (investment !== null && investment.concentrationHeatmap.result.kind === "ok") {
    for (const slice of investment.concentrationHeatmap.result.value.byInstrument) {
      if (slice.ratio > investment.concentrationHeatmap.result.value.concentratedThresholdRatio) {
        lines.push(inference(`${slice.key} is ${formatRatio(slice.ratio)} of the priced portfolio — concentrated`));
      }
    }
  }

  if (investment !== null && investment.drawdownMonitor.result.kind === "ok") {
    const d = investment.drawdownMonitor.result.value;
    if (!d.recovered) {
      lines.push(inference(`Portfolio is ${formatRatio(Math.abs(d.currentDrawdownRatio))} below its recorded peak`));
    }
  }

  if (behavioral.anomalyDetector.result.kind === "ok") {
    for (const finding of behavioral.anomalyDetector.result.value) {
      lines.push(inference(finding.description));
    }
  }

  if (lines.length === 0) lines.push(fact("No risk is currently flagged."));

  return { title: "Risks", lines };
}

// --- Goals -------------------------------------------------------

function goalsSection(goalLiability: Awaited<ReturnType<typeof getGoalLiabilityIntelligenceView>>): ReportSection {
  const lines: ReportLine[] = [];

  if (goalLiability.goalFundingRadar.result.kind !== "ok") {
    lines.push(insufficientLine(goalLiability.goalFundingRadar.result.reasons));
    return { title: "Goals", lines };
  }

  for (const row of goalLiability.goalFundingRadar.result.value) {
    const ratio = row.progress.progressRatio.kind === "ok" ? formatRatio(row.progress.progressRatio.value) : "unknown share";
    lines.push(
      fact(
        `${row.goal.name}: ${formatMoney(row.progress.currentAmountMinorUnits)} of ${formatMoney(row.goal.targetAmountMinorUnits)} (${ratio})`,
      ),
    );
  }

  return { title: "Goals", lines };
}

// --- Portfolio -------------------------------------------------------

function portfolioSection(investment: Awaited<ReturnType<typeof getInvestmentIntelligenceView>> | null): ReportSection {
  const lines: ReportLine[] = [];

  if (investment === null || investment.portfolioXRay.result.kind !== "ok") {
    lines.push(
      insufficientLine(
        investment !== null && investment.portfolioXRay.result.kind === "insufficient-data"
          ? investment.portfolioXRay.result.reasons
          : [],
      ),
    );
    return { title: "Portfolio", lines };
  }

  const holdings = [...investment.portfolioXRay.result.value.holdings].sort((a, b) => b.valueMinorUnits - a.valueMinorUnits);
  for (const holding of holdings.slice(0, 5)) {
    lines.push(fact(`${holding.instrumentLabel} (${holding.assetClass}): ${formatMoney(holding.valueMinorUnits)}`));
  }

  if (investment.performance.result.kind === "ok" && investment.performance.result.value.aggregatePnl.kind === "ok") {
    lines.push(fact(`Aggregate P&L on holdings with a known cost basis: ${formatMoney(investment.performance.result.value.aggregatePnl.value.absoluteMinorUnits)}`));
  }

  return { title: "Portfolio", lines };
}

// --- Data quality / review needed -------------------------------------------------------

function dataQualitySection(behavioral: Awaited<ReturnType<typeof getBehavioralIntelligenceView>>): ReportSection {
  const lines: ReportLine[] = [];

  if (behavioral.healthScore.result.kind === "ok") {
    const score = behavioral.healthScore.result.value;
    lines.push(fact(`Financial health score: ${score.totalPoints} of ${score.maxPoints}`));
    for (const component of score.components) {
      if (component.points < component.maxPoints) {
        lines.push(inference(`${component.label}: ${component.why}`));
      }
    }
  }

  if (behavioral.dataHealth.result.kind === "ok") {
    const health = behavioral.dataHealth.result.value;
    for (const summary of health.trustSummaries) {
      const untrusted = summary.counts.needs_review + summary.counts.rejected;
      if (untrusted > 0) {
        lines.push(
          recommendation(`Review the ${untrusted} ${summary.label.toLowerCase()} record(s) marked needs-review or rejected`),
        );
      }
    }
  }

  if (lines.length === 0) lines.push(fact("No data quality issue is currently flagged."));

  return { title: "Data quality", lines };
}
