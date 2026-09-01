import type { PrismaClient } from "@prisma/client";
import { trustStateSummary } from "../data/dataCenterStore";
import { loadActivities, loadEffectivePlanRecords } from "../data/loaders";
import {
  addMonthsClamped,
  buildInsight,
  comparePeriods,
  computePeriodMetrics,
  insufficient,
  ok,
  precedingRange,
  type Computed,
  type DateRange,
  type Insight,
  type MetricDefinition,
  type MetricVariance,
  type PeriodCoverage,
} from "../domain";
import { resolveInceptionDate } from "./analyticsView";
import {
  computeNetWorthAsOf,
  getUnexplainedPositionChanges,
  STALE_AFTER_DAYS,
  type UnexplainedPositionChange,
} from "./commandCenterView";
import { getGoalsView } from "./goalsView";
import { getPortfolioView } from "./portfolioView";

/**
 * IM-05 Behavioral & Data Intelligence (v1.1, `docs/21_INTELLIGENCE_MASTER_PLAN.md`).
 *
 * "What's Changed" is built entirely from the existing M7 period-comparison
 * engine (`getAnalyticsView`'s own preceding-month comparison) plus
 * `computeNetWorthAsOf` at the same two dates — no new comparison logic.
 * Financial Anomaly Detector only lists findings the engine already
 * produces elsewhere (unexplained position changes, goal balance
 * anomalies, untrusted records) — it never invents a new detection
 * heuristic or a fabricated explanation for why something changed.
 * Financial Health Score is explicitly scoped to *data/process health*
 * (trust, freshness, absence of known anomalies) rather than a financial
 * adequacy judgment — every component's point value and reason is
 * disclosed in the result, not hidden inside a single number.
 *
 * Investment Plan Adherence is also named under this module in the v1.1
 * directive, but it was already built in IM-03
 * (`src/views/investmentIntelligenceView.ts`) — it is not duplicated here.
 */

const WHATS_CHANGED_METRIC: MetricDefinition = {
  id: "whats_changed",
  label: "What's Changed",
  unit: "money",
  description: "Month-over-month variance in budget totals, confirmed activity, and net worth.",
};

const ANOMALY_DETECTOR_METRIC: MetricDefinition = {
  id: "financial_anomaly_detector",
  label: "Financial Anomaly Detector",
  unit: "count",
  description: "A consolidated list of anomalies the engine already flags elsewhere — never a new detection heuristic.",
};

const HEALTH_SCORE_METRIC: MetricDefinition = {
  id: "financial_health_score",
  label: "Financial Health Score",
  unit: "count",
  description: "A transparent, decomposable data/process health score (0-100) — not a judgment about financial adequacy.",
};

const DATA_HEALTH_METRIC: MetricDefinition = {
  id: "data_health",
  label: "Data Health",
  unit: "count",
  description: "Trust-state counts per record type, unexplained position changes, and price freshness.",
};

const HISTORICAL_COVERAGE_METRIC: MetricDefinition = {
  id: "historical_coverage",
  label: "Historical Coverage",
  unit: "months",
  description: "Which months since inception have complete, partial, or missing budget data.",
};

// --- Shared types -----------------------------------------------------

export interface NetWorthVariance {
  readonly openMinorUnits: number;
  readonly closeMinorUnits: number;
  readonly deltaMinorUnits: number;
}

export interface WhatsChangedResult {
  readonly budgetVariances: readonly MetricVariance[];
  readonly activityVariances: readonly MetricVariance[];
  readonly netWorthVariance: Computed<NetWorthVariance>;
  readonly coverageNotes: readonly string[];
}

export type AnomalyKind = "untrusted_records" | "unexplained_position_change" | "goal_balance_anomaly";

export interface AnomalyFinding {
  readonly kind: AnomalyKind;
  readonly description: string;
}

export interface HealthScoreComponent {
  readonly label: string;
  readonly points: number;
  readonly maxPoints: number;
  readonly why: string;
}

export interface HealthScore {
  readonly totalPoints: number;
  readonly maxPoints: number;
  readonly components: readonly HealthScoreComponent[];
}

export interface DataHealth {
  readonly trustSummaries: Awaited<ReturnType<typeof trustStateSummary>>;
  readonly unexplainedPositionChanges: readonly UnexplainedPositionChange[];
  readonly stalestPriceAgeDays: number | null;
  readonly isStale: boolean;
}

export interface HistoricalCoverage {
  readonly inceptionDate: Date;
  readonly coverage: PeriodCoverage;
}

export interface BehavioralIntelligenceView {
  readonly whatsChanged: Insight<WhatsChangedResult>;
  readonly anomalyDetector: Insight<readonly AnomalyFinding[]>;
  readonly healthScore: Insight<HealthScore>;
  readonly dataHealth: Insight<DataHealth>;
  readonly historicalCoverage: Insight<HistoricalCoverage>;
}

export async function getBehavioralIntelligenceView(
  db: PrismaClient,
  asOf: Date,
): Promise<BehavioralIntelligenceView> {
  const [whatsChanged, anomalyDetector, dataHealth, historicalCoverage] = await Promise.all([
    buildWhatsChanged(db, asOf),
    buildAnomalyDetector(db, asOf),
    buildDataHealth(db, asOf),
    buildHistoricalCoverage(db, asOf),
  ]);

  return {
    whatsChanged,
    anomalyDetector,
    healthScore: buildHealthScore(dataHealth, anomalyDetector, asOf),
    dataHealth,
    historicalCoverage,
  };
}

// --- What's Changed -------------------------------------------------------

async function buildWhatsChanged(db: PrismaClient, asOf: Date): Promise<Insight<WhatsChangedResult>> {
  // A calendar-month-aligned range, not a rolling 30-day window — a rolling
  // window touches two months without fully covering either, and
  // computePeriodMetrics correctly refuses to count a partially-covered
  // month rather than pro-rating it (docs/11_ANALYTICS_SPEC.md).
  const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const currentRange: DateRange = { start: monthStart, end: addMonthsClamped(monthStart, 1) };
  const priorRange = precedingRange(currentRange);

  const planRecords = await loadEffectivePlanRecords(db);
  const activities = await loadActivities(db);

  const comparison = comparePeriods(
    computePeriodMetrics(currentRange, planRecords, activities),
    computePeriodMetrics(priorRange, planRecords, activities),
  );

  const openNetWorth = await computeNetWorthAsOf(db, priorRange.start);
  const closeNetWorth = await computeNetWorthAsOf(db, new Date(currentRange.end.getTime() - 1));

  const netWorthVariance: Computed<NetWorthVariance> =
    openNetWorth.netWorth.kind === "ok" && closeNetWorth.netWorth.kind === "ok"
      ? ok({
          openMinorUnits: openNetWorth.netWorth.value.netWorthMinorUnits,
          closeMinorUnits: closeNetWorth.netWorth.value.netWorthMinorUnits,
          deltaMinorUnits:
            closeNetWorth.netWorth.value.netWorthMinorUnits - openNetWorth.netWorth.value.netWorthMinorUnits,
        })
      : insufficient("net worth could not be computed at both the start of the prior month and now");

  return buildInsight({
    metric: WHATS_CHANGED_METRIC,
    result: ok({
      budgetVariances: comparison.budgetVariances,
      activityVariances: comparison.activityVariances,
      netWorthVariance,
      coverageNotes: comparison.coverageNotes,
    }),
    asOf,
    calculationBasis:
      "comparePeriods (M7) between the current and preceding calendar month's computePeriodMetrics — the same functions the Analytics screen uses — plus computeNetWorthAsOf at the same two boundary dates.",
  });
}

// --- Financial Anomaly Detector -------------------------------------------------------

async function buildAnomalyDetector(db: PrismaClient, asOf: Date): Promise<Insight<readonly AnomalyFinding[]>> {
  const findings: AnomalyFinding[] = [];

  const trustSummaries = await trustStateSummary(db);
  for (const summary of trustSummaries) {
    const untrusted = summary.counts.needs_review + summary.counts.rejected;
    if (untrusted > 0) {
      findings.push({
        kind: "untrusted_records",
        description: `${untrusted} ${summary.label.toLowerCase()} record(s) are needs_review or rejected and excluded from every total`,
      });
    }
  }

  const changes = await getUnexplainedPositionChanges(db);
  for (const change of changes) {
    findings.push({
      kind: "unexplained_position_change",
      description: `${change.instrumentLabel} moved from ${change.previousQuantity} to ${change.newQuantity} between statements with no recorded transaction`,
    });
  }

  const goals = await getGoalsView(db, asOf);
  for (const card of [...goals.active, ...goals.inactive]) {
    if (card.progress.anomaly !== null) {
      findings.push({
        kind: "goal_balance_anomaly",
        description: `"${card.goal.name}": ${card.progress.anomaly}`,
      });
    }
  }

  return buildInsight({
    metric: ANOMALY_DETECTOR_METRIC,
    result: ok(findings),
    asOf,
    calculationBasis:
      "Consolidates trustStateSummary's needs_review/rejected counts, getUnexplainedPositionChanges (the same ingestion finding the Command Center alerts show), and each goal's own computeGoalProgress anomaly flag. No new anomaly is detected here that the engine did not already compute.",
    severity: findings.length > 0 ? "caution" : "info",
  });
}

// --- Financial Health Score -------------------------------------------------------

const TRUSTED_RECORDS_MAX_POINTS = 40;
const NO_UNEXPLAINED_CHANGES_POINTS = 20;
const NO_GOAL_ANOMALY_POINTS = 20;
const FRESH_PRICES_POINTS = 20;

function buildHealthScore(
  dataHealth: Insight<DataHealth>,
  anomalyDetector: Insight<readonly AnomalyFinding[]>,
  asOf: Date,
): Insight<HealthScore> {
  if (dataHealth.result.kind !== "ok" || anomalyDetector.result.kind !== "ok") {
    return buildInsight({
      metric: HEALTH_SCORE_METRIC,
      result: insufficient("requires Data Health and the Financial Anomaly Detector to both resolve"),
      asOf,
      calculationBasis: "Derived from Data Health and Financial Anomaly Detector; reports insufficient when either does.",
    });
  }

  const health = dataHealth.result.value;
  const findings = anomalyDetector.result.value;

  const totalRecords = health.trustSummaries.reduce(
    (sum, s) => sum + Object.values(s.counts).reduce((a, b) => a + b, 0),
    0,
  );
  const trustedRecords = health.trustSummaries.reduce(
    (sum, s) => sum + s.counts.validated + s.counts.verified,
    0,
  );
  const trustedRecordsPoints =
    totalRecords === 0 ? 0 : Math.round((trustedRecords / totalRecords) * TRUSTED_RECORDS_MAX_POINTS);

  const hasUnexplainedChanges = findings.some((f) => f.kind === "unexplained_position_change");
  const hasGoalAnomaly = findings.some((f) => f.kind === "goal_balance_anomaly");

  const components: HealthScoreComponent[] = [
    {
      label: "Trusted records",
      points: trustedRecordsPoints,
      maxPoints: TRUSTED_RECORDS_MAX_POINTS,
      why:
        totalRecords === 0
          ? "no records exist yet"
          : `${trustedRecords} of ${totalRecords} recorded budget/portfolio/activity records are validated or verified`,
    },
    {
      label: "No unexplained position changes",
      points: hasUnexplainedChanges ? 0 : NO_UNEXPLAINED_CHANGES_POINTS,
      maxPoints: NO_UNEXPLAINED_CHANGES_POINTS,
      why: hasUnexplainedChanges
        ? "at least one holding's quantity changed with no recorded transaction"
        : "every observed holding-quantity change is either reconciled or none has occurred",
    },
    {
      label: "No goal balance anomalies",
      points: hasGoalAnomaly ? 0 : NO_GOAL_ANOMALY_POINTS,
      maxPoints: NO_GOAL_ANOMALY_POINTS,
      why: hasGoalAnomaly
        ? "at least one goal's derived balance is negative (withdrawals exceed contributions)"
        : "no goal has a negative derived balance",
    },
    {
      label: "Prices are fresh",
      points: health.stalestPriceAgeDays === null || health.isStale ? 0 : FRESH_PRICES_POINTS,
      maxPoints: FRESH_PRICES_POINTS,
      why:
        health.stalestPriceAgeDays === null
          ? "no priced holding exists yet"
          : health.isStale
            ? `the stalest price is ${health.stalestPriceAgeDays} days old, past the ${STALE_AFTER_DAYS}-day threshold`
            : `the stalest price is ${health.stalestPriceAgeDays} days old, within the ${STALE_AFTER_DAYS}-day threshold`,
    },
  ];

  const totalPoints = components.reduce((sum, c) => sum + c.points, 0);
  const maxPoints = components.reduce((sum, c) => sum + c.maxPoints, 0);

  return buildInsight({
    metric: HEALTH_SCORE_METRIC,
    result: ok({ totalPoints, maxPoints, components }),
    asOf,
    calculationBasis:
      "An editorial, fully-disclosed sum of four data/process-health components (trusted-record share, absence of unexplained position changes, absence of goal balance anomalies, price freshness) — each with its own point value and reason shown above. This is not a claim about whether the household's finances are adequate; it never applies an invented threshold to a financial adequacy metric (e.g. savings rate) that no source document defines.",
  });
}

// --- Data Health -------------------------------------------------------

async function buildDataHealth(db: PrismaClient, asOf: Date): Promise<Insight<DataHealth>> {
  const trustSummaries = await trustStateSummary(db);
  const unexplainedPositionChanges = await getUnexplainedPositionChanges(db);
  const portfolio = await getPortfolioView(db, asOf);

  return buildInsight({
    metric: DATA_HEALTH_METRIC,
    result: ok({
      trustSummaries,
      unexplainedPositionChanges,
      stalestPriceAgeDays: portfolio.stalestPriceAgeDays,
      isStale: portfolio.stalestPriceAgeDays !== null && portfolio.stalestPriceAgeDays > STALE_AFTER_DAYS,
    }),
    asOf,
    calculationBasis:
      "trustStateSummary (the same rollup the Data Center shows), getUnexplainedPositionChanges, and getPortfolioView's stalestPriceAgeDays against the same staleness threshold the Command Center alerts already use.",
  });
}

// --- Historical Coverage -------------------------------------------------------

async function buildHistoricalCoverage(db: PrismaClient, asOf: Date): Promise<Insight<HistoricalCoverage>> {
  const inceptionDate = await resolveInceptionDate(db);

  if (inceptionDate === null) {
    return buildInsight({
      metric: HISTORICAL_COVERAGE_METRIC,
      result: insufficient("no budget, activity, or position data has been recorded yet"),
      asOf,
      calculationBasis: "Requires at least one recorded plan record, activity, or position snapshot to establish an inception date.",
    });
  }

  const range: DateRange = { start: inceptionDate, end: new Date(asOf.getTime() + 1) };
  const planRecords = await loadEffectivePlanRecords(db);
  const { coverage } = computePeriodMetrics(range, planRecords, []);

  return buildInsight({
    metric: HISTORICAL_COVERAGE_METRIC,
    result: ok({ inceptionDate, coverage }),
    asOf,
    calculationBasis:
      "computePeriodMetrics's own PeriodCoverage (M7) — the same coverage object every analytics comparison already computes — over the range from the earliest recorded plan record/activity/position snapshot to the as-of date.",
  });
}
