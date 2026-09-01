import { STALE_AFTER_DAYS } from "./commandCenterView";
import type { BehavioralIntelligenceView } from "./behavioralIntelligenceView";
import type { GoalLiabilityIntelligenceView } from "./goalLiabilityIntelligenceView";
import type { InvestmentIntelligenceView } from "./investmentIntelligenceView";

/**
 * v1.1.1 F1 — Prioritized "What Needs Attention" (`docs/30_V1_1_1_COMMAND_CENTER_POLISH.md`).
 *
 * A pure aggregator, not a calculator: every item below reads a field an
 * existing IM-03/IM-04/IM-05 view-model already computed (a concentration
 * ratio past `flagConcentration`'s own threshold, a goal's own
 * `missesTargetDate` flag, an anomaly the Financial Anomaly Detector
 * already found, `insufficient-data` on Emergency Fund Runway per D-017,
 * etc.). It introduces no new financial fact, no new threshold, and no
 * second calculation path — it only classifies facts the engine already
 * produced into four severity tiers so the owner can see what matters
 * most without reading every widget individually.
 *
 * Severity is deliberately structural, never a fabricated score: each
 * tier is a fixed, documented mapping from a specific existing field to
 * CRITICAL/IMPORTANT/WATCH, and HEALTHY is simply the absence of anything
 * in the other three (never a positive claim manufactured to fill the
 * tier).
 */

export type AttentionSeverity = "critical" | "important" | "watch";

export interface AttentionItem {
  readonly severity: AttentionSeverity;
  readonly title: string;
  readonly detail: string;
}

export interface AttentionPanel {
  readonly critical: readonly AttentionItem[];
  readonly important: readonly AttentionItem[];
  readonly watch: readonly AttentionItem[];
  /** True only when all three tiers above are empty — never a separate, invented "all good" calculation. */
  readonly isHealthy: boolean;
}

export interface AttentionPanelInput {
  readonly investment: InvestmentIntelligenceView | null;
  readonly goalLiability: GoalLiabilityIntelligenceView;
  readonly behavioral: BehavioralIntelligenceView;
  /** From `CommandCenterView.portfolio.stalestPriceAgeDays` — reused, not recomputed. */
  readonly portfolioStalestPriceAgeDays: number | null;
}

export function buildAttentionPanel(input: AttentionPanelInput): AttentionPanel {
  const critical: AttentionItem[] = [];
  const important: AttentionItem[] = [];
  const watch: AttentionItem[] = [];

  const { investment, goalLiability, behavioral, portfolioStalestPriceAgeDays } = input;

  // --- CRITICAL: data-integrity breaks the Financial Anomaly Detector already found -------
  if (behavioral.anomalyDetector.result.kind === "ok") {
    for (const finding of behavioral.anomalyDetector.result.value) {
      if (finding.kind === "unexplained_position_change") {
        critical.push({
          severity: "critical",
          // Wording preserved verbatim from the pre-v1.1.1 Command Center
          // alert (`commandCenterView.ts`'s `unexplainedPositionChangeAlerts`)
          // so this remains findable the same way it always was.
          title: "Position changed with no recorded transaction",
          detail: finding.description,
        });
      } else if (finding.kind === "goal_balance_anomaly") {
        critical.push({
          severity: "critical",
          title: "Goal balance anomaly",
          detail: finding.description,
        });
      }
    }
  }

  // --- IMPORTANT: financial-deviation findings from IM-03/IM-04 -------
  if (behavioral.anomalyDetector.result.kind === "ok") {
    for (const finding of behavioral.anomalyDetector.result.value) {
      if (finding.kind === "untrusted_records") {
        important.push({
          severity: "important",
          title: "Untrusted records excluded from totals",
          detail: finding.description,
        });
      }
    }
  }

  if (investment !== null) {
    if (investment.portfolioXRay.result.kind === "ok" && investment.portfolioXRay.result.value.exclusions.length > 0) {
      const count = investment.portfolioXRay.result.value.exclusions.length;
      important.push({
        severity: "important",
        title: `${count} holding${count === 1 ? "" : "s"} could not be valued`,
        detail: investment.portfolioXRay.result.value.exclusions.map((e) => e.label).join(", "),
      });
    }

    if (investment.concentrationHeatmap.result.kind === "ok") {
      const { byInstrument, concentratedThresholdRatio } = investment.concentrationHeatmap.result.value;
      for (const slice of byInstrument) {
        if (slice.ratio > concentratedThresholdRatio) {
          important.push({
            severity: "important",
            title: `${slice.key} is concentrated`,
            detail: `${Math.round(slice.ratio * 100)}% of the priced portfolio — above the ${Math.round(concentratedThresholdRatio * 100)}% concentration threshold.`,
          });
        }
      }
    }

    if (investment.planAdherence.result.kind === "ok") {
      for (const row of investment.planAdherence.result.value) {
        if (row.status === "under-invested" || row.status === "over-invested") {
          important.push({
            severity: "important",
            title: `Investment plan ${row.status.replace("-", " ")} for ${row.periodMonth}`,
            detail: "Confirmed buy/SIP activity does not match the planned investment amount for this month.",
          });
        }
      }
    }
  }

  if (goalLiability.goalCollisionDetector.result.kind === "ok" && goalLiability.goalCollisionDetector.result.value.shortfallMinorUnits > 0) {
    important.push({
      severity: "important",
      title: "Goal funding demand exceeds capacity",
      detail:
        "Active goals with a target date collectively need more per month than the household's demonstrated unallocated cash. This identifies the conflict only — it does not decide which goal to prioritize.",
    });
  }

  if (goalLiability.debtFreedomMeter.result.kind === "ok" && goalLiability.debtFreedomMeter.result.value.liabilitiesExcluded.length > 0) {
    important.push({
      severity: "important",
      title: "A liability has no recorded tenure",
      detail: `Excluded from the debt-free date projection: ${goalLiability.debtFreedomMeter.result.value.liabilitiesExcluded.join(", ")}.`,
    });
  }

  if (goalLiability.goalFundingRadar.result.kind === "ok") {
    for (const row of goalLiability.goalFundingRadar.result.value) {
      if (row.projection.kind === "ok" && row.projection.value.missesTargetDate) {
        important.push({
          severity: "important",
          title: `"${row.goal.name}" is behind its target trajectory`,
          detail: `Projected completion (${row.projection.value.projectedCompletion.toISOString().slice(0, 10)}) is after the stated target date, at the current contribution rate.`,
        });
      }
    }
  }

  // --- WATCH: softer, named conditions -------
  if (portfolioStalestPriceAgeDays !== null && portfolioStalestPriceAgeDays > STALE_AFTER_DAYS) {
    watch.push({
      severity: "watch",
      title: "Portfolio prices are stale",
      detail: `The stalest price on record is ${portfolioStalestPriceAgeDays} days old, past the ${STALE_AFTER_DAYS}-day threshold. Values reflect the last dated closing prices, not live quotes.`,
    });
  }

  if (behavioral.historicalCoverage.result.kind === "ok") {
    const { monthsMissing, monthsPartial } = behavioral.historicalCoverage.result.value.coverage;
    if (monthsMissing.length > 0 || monthsPartial.length > 0) {
      watch.push({
        severity: "watch",
        title: "Historical coverage has gaps",
        detail: `${monthsMissing.length} month(s) missing, ${monthsPartial.length} month(s) only partially covered since inception.`,
      });
    }
  }

  if (goalLiability.emergencyFundRunway.result.kind === "insufficient-data") {
    watch.push({
      severity: "watch",
      title: "Emergency Fund Runway cannot be measured yet",
      detail: goalLiability.emergencyFundRunway.result.reasons.join("; "),
    });
  }

  return {
    critical,
    important,
    watch,
    isHealthy: critical.length === 0 && important.length === 0 && watch.length === 0,
  };
}
