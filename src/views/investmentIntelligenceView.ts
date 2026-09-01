import type { PrismaClient } from "@prisma/client";
import { loadActivities, loadDistinctSnapshotDates, loadEffectivePlanRecords } from "../data/loaders";
import {
  buildDecomposition,
  buildInsight,
  computeCagr,
  computeXirr,
  insufficient,
  isTrusted,
  monthsInRange,
  ok,
  safeRatio,
  type AllocationComparisonRow,
  type AllocationSlice,
  type CashFlow,
  type Computed,
  type DateRange,
  type Decomposition,
  type Exclusion,
  type Insight,
  type MetricDefinition,
  type ProfitAndLoss,
} from "../domain";
import { ensureIndexInstruments, TRACKED_INDICES } from "../market";
import { buildAllocationComparison } from "./analyticsView";
import { getPortfolioView, type HoldingRow, type PortfolioView } from "./portfolioView";

/**
 * IM-03 Investment Intelligence (v1.1, `docs/21_INTELLIGENCE_MASTER_PLAN.md`).
 *
 * Every widget here composes existing engine outputs
 * (`getPortfolioView`, `comparePlannedAllocation`, `computeCagr`,
 * `computeXirr`, `buildDecomposition`) — none introduces a second
 * calculation path for a number the engine already produces.
 *
 * Known data-completeness limitation (recorded in
 * `docs/18_FAILURE_MODES.md`): the documented portfolio ingestion path
 * (position-snapshot import, `docs/09_INGESTION_ARCHITECTURE.md`)
 * deliberately never fabricates a `buy`/`sip`/`sell` Activity record from
 * an observed quantity change. Every widget below that depends on those
 * Activity records (Growth Decomposition, Contribution vs Return,
 * Portfolio Performance's XIRR, Investment Plan Adherence) is therefore
 * only as complete as what a user has manually recorded as a transaction —
 * it is expected, not a defect, for these to report zero contribution or
 * insufficient-data in a data set that only ever imported snapshots.
 */

// --- Metric definitions ---------------------------------------------------

const PORTFOLIO_XRAY_METRIC: MetricDefinition = {
  id: "portfolio_xray",
  label: "Portfolio X-Ray",
  unit: "money",
  description: "Every trusted holding, its weight, price, cost basis and P&L where known.",
};

const PLANNED_VS_ACTUAL_ALLOCATION_METRIC: MetricDefinition = {
  id: "planned_vs_actual_allocation",
  label: "Planned vs Actual Allocation",
  unit: "money",
  description: "Investment lines planned in the budget compared against what the portfolio actually holds.",
};

const GROWTH_DECOMPOSITION_METRIC: MetricDefinition = {
  id: "portfolio_growth_decomposition",
  label: "Portfolio Growth Decomposition",
  unit: "money",
  description: "Decomposes the change in portfolio value between two dates into contributions, withdrawals, and market movement.",
};

const CONTRIBUTION_VS_RETURN_METRIC: MetricDefinition = {
  id: "contribution_vs_return",
  label: "Contribution vs Return",
  unit: "money",
  description: "Net money moved in versus the residual value change attributable to market movement.",
};

const PORTFOLIO_PERFORMANCE_METRIC: MetricDefinition = {
  id: "portfolio_performance",
  label: "Portfolio Performance",
  unit: "ratio",
  description: "Aggregate profit and loss, CAGR and XIRR, each reported only when its underlying data is sufficient.",
};

const CONCENTRATION_HEATMAP_METRIC: MetricDefinition = {
  id: "concentration_heatmap",
  label: "Concentration Heatmap",
  unit: "ratio",
  description: "Portfolio weight by instrument and by asset class, with the existing concentration threshold applied.",
};

const DRAWDOWN_MONITOR_METRIC: MetricDefinition = {
  id: "drawdown_monitor",
  label: "Drawdown Monitor",
  unit: "ratio",
  description: "Peak-to-trough decline in portfolio value across actual recorded observation dates.",
};

const PORTFOLIO_VS_BENCHMARK_METRIC: MetricDefinition = {
  id: "portfolio_vs_benchmark",
  label: "Portfolio vs Benchmark",
  unit: "ratio",
  description: "Portfolio return versus each tracked index's return over the same dates, only where both have dated observations.",
};

const INVESTMENT_PLAN_ADHERENCE_METRIC: MetricDefinition = {
  id: "investment_plan_adherence",
  label: "Investment Plan Adherence",
  unit: "money",
  description: "Planned investment amount versus confirmed buy/SIP activity, per fully-covered month.",
};

// --- Shared types -----------------------------------------------------

export interface XRayHoldingRow {
  readonly instrumentLabel: string;
  readonly assetClass: string;
  readonly quantity: number;
  readonly priceMinorUnits: number;
  readonly priceAsOf: Date;
  readonly priceAgeDays: number;
  readonly valueMinorUnits: number;
  readonly weightRatio: number | null;
  readonly costBasisMinorUnits: number | null;
  readonly profitAndLoss: Computed<ProfitAndLoss>;
}

export interface PortfolioXRay {
  readonly holdings: readonly XRayHoldingRow[];
  readonly totalMinorUnits: number;
  readonly exclusions: readonly Exclusion[];
}

export interface AllocationDriftRow extends AllocationComparisonRow {
  readonly status: "matched" | "overweight" | "underweight" | "planned_only" | "observed_only";
}

export interface ContributionVsReturn {
  readonly openingMinorUnits: number;
  readonly closingMinorUnits: number;
  readonly netContributionMinorUnits: number;
  readonly returnMinorUnits: number;
}

export interface AggregatePnl {
  readonly costBasisMinorUnits: number;
  readonly currentValueMinorUnits: number;
  readonly absoluteMinorUnits: number;
  readonly ratio: number;
  readonly holdingsWithCostBasis: number;
  readonly holdingsWithoutCostBasis: number;
}

export interface PortfolioPerformance {
  readonly aggregatePnl: Computed<AggregatePnl>;
  readonly cagr: Computed<number>;
  readonly xirr: Computed<number>;
}

export interface ConcentrationHeatmap {
  readonly byInstrument: readonly AllocationSlice[];
  readonly byAssetClass: readonly AllocationSlice[];
  readonly concentratedThresholdRatio: number;
}

export interface DrawdownPoint {
  readonly asOf: Date;
  readonly valueMinorUnits: number;
}

export interface DrawdownResult {
  readonly series: readonly DrawdownPoint[];
  readonly peak: DrawdownPoint;
  readonly trough: DrawdownPoint;
  readonly maxDrawdownRatio: number;
  readonly currentDrawdownRatio: number;
  readonly recovered: boolean;
}

export interface BenchmarkRow {
  readonly indexCode: string;
  readonly indexLabel: string;
  readonly result: Computed<{ readonly portfolioReturnRatio: number; readonly indexReturnRatio: number }>;
}

export interface AdherenceRow {
  readonly periodMonth: string;
  readonly status: "insufficient-data" | "exact" | "under-invested" | "over-invested";
  readonly plannedMinorUnits: number | null;
  readonly actualMinorUnits: number | null;
}

export interface InvestmentIntelligenceView {
  readonly portfolioXRay: Insight<PortfolioXRay>;
  readonly plannedVsActualAllocation: Insight<readonly AllocationDriftRow[]>;
  readonly growthDecomposition: Insight<Decomposition>;
  readonly contributionVsReturn: Insight<ContributionVsReturn>;
  readonly performance: Insight<PortfolioPerformance>;
  readonly concentrationHeatmap: Insight<ConcentrationHeatmap>;
  readonly drawdownMonitor: Insight<DrawdownResult>;
  readonly portfolioVsBenchmark: Insight<readonly BenchmarkRow[]>;
  readonly planAdherence: Insight<readonly AdherenceRow[]>;
}

const CONCENTRATION_THRESHOLD = 0.25;

export async function getInvestmentIntelligenceView(
  db: PrismaClient,
  range: DateRange,
  asOf: Date,
): Promise<InvestmentIntelligenceView> {
  const portfolio = await getPortfolioView(db, asOf);
  const closingAsOf = new Date(range.end.getTime() - 1);

  const growthDecomposition = await buildGrowthDecomposition(db, range, closingAsOf);

  return {
    portfolioXRay: buildPortfolioXRay(portfolio, asOf),
    plannedVsActualAllocation: await buildPlannedVsActualAllocation(db, asOf, range),
    growthDecomposition,
    contributionVsReturn: buildContributionVsReturn(growthDecomposition, closingAsOf),
    performance: await buildPerformance(db, portfolio, range, closingAsOf),
    concentrationHeatmap: buildConcentrationHeatmap(portfolio, asOf),
    drawdownMonitor: await buildDrawdownMonitor(db, range, asOf),
    portfolioVsBenchmark: await buildPortfolioVsBenchmark(db, range, closingAsOf),
    planAdherence: await buildPlanAdherence(db, range),
  };
}

// --- Portfolio X-Ray -------------------------------------------------------

function buildPortfolioXRay(portfolio: PortfolioView, asOf: Date): Insight<PortfolioXRay> {
  if (portfolio.valuation.kind !== "ok") {
    return buildInsight({
      metric: PORTFOLIO_XRAY_METRIC,
      result: insufficient(...portfolio.valuation.reasons),
      asOf,
      calculationBasis: "Reads getPortfolioView's valuation; reports the same insufficiency it does.",
    });
  }

  const totalMinorUnits = portfolio.valuation.value.totalMinorUnits;
  const holdings: XRayHoldingRow[] = portfolio.holdings.map((h: HoldingRow) => ({
    instrumentLabel: h.instrumentLabel,
    assetClass: h.assetClass,
    quantity: h.quantity,
    priceMinorUnits: h.priceMinorUnits,
    priceAsOf: h.priceAsOf,
    priceAgeDays: h.priceAgeDays,
    valueMinorUnits: h.valueMinorUnits,
    weightRatio: safeRatio(h.valueMinorUnits, totalMinorUnits),
    costBasisMinorUnits: h.profitAndLoss.kind === "ok" ? h.profitAndLoss.value.costBasisMinorUnits : null,
    profitAndLoss: h.profitAndLoss,
  }));

  return buildInsight({
    metric: PORTFOLIO_XRAY_METRIC,
    result: ok({ holdings, totalMinorUnits, exclusions: portfolio.exclusions }),
    asOf,
    calculationBasis:
      "getPortfolioView's trusted, priced holdings; weight is each holding's value over the valued total; P&L is computeProfitAndLoss, unavailable where no cost basis was ever recorded.",
  });
}

// --- Planned vs Actual Allocation -------------------------------------------------------

async function buildPlannedVsActualAllocation(
  db: PrismaClient,
  asOf: Date,
  range: DateRange,
): Promise<Insight<readonly AllocationDriftRow[]>> {
  const rows = await buildAllocationComparison(db, asOf, range, {});

  if (rows.length === 0) {
    return buildInsight({
      metric: PLANNED_VS_ACTUAL_ALLOCATION_METRIC,
      result: insufficient("no planned investment lines and no held instruments to compare"),
      asOf,
      calculationBasis: "comparePlannedAllocation over the last fully-covered month's investment plan vs current holdings.",
    });
  }

  const drift: AllocationDriftRow[] = rows.map((row) => ({
    ...row,
    status:
      row.plannedMinorUnits === null
        ? "observed_only"
        : row.observedMinorUnits === null
          ? "planned_only"
          : row.observedRatio === row.plannedRatio
            ? "matched"
            : (row.observedRatio ?? 0) > (row.plannedRatio ?? 0)
              ? "overweight"
              : "underweight",
  }));

  return buildInsight({
    metric: PLANNED_VS_ACTUAL_ALLOCATION_METRIC,
    result: ok(drift),
    asOf,
    calculationBasis:
      "comparePlannedAllocation (the same function the Analytics screen uses) against the last fully-covered month's investment plan lines and the current portfolio's holdings. Status is a sign comparison of observed vs planned share — never a fabricated tolerance band.",
  });
}

// --- Portfolio Growth Decomposition / Contribution vs Return -------------------------------------------------------

/**
 * Total valued portfolio (excluding cash) at an arbitrary date.
 *
 * Exported so the v1.1 scenario engine (SIP Increase Simulator, Wealth
 * Projection) can derive an observed growth rate from real history
 * instead of assuming one — the same rule this file already follows for
 * every other widget here.
 */
export async function computePortfolioValueAt(db: PrismaClient, asOf: Date): Promise<Computed<number>> {
  const view = await getPortfolioView(db, asOf);
  return view.valuation.kind === "ok"
    ? ok(view.valuation.value.totalMinorUnits)
    : insufficient(...view.valuation.reasons);
}

async function buildGrowthDecomposition(
  db: PrismaClient,
  range: DateRange,
  closingAsOf: Date,
): Promise<Insight<Decomposition>> {
  const opening = await computePortfolioValueAt(db, range.start);
  const closing = await computePortfolioValueAt(db, closingAsOf);

  if (opening.kind !== "ok" || closing.kind !== "ok") {
    return buildInsight({
      metric: GROWTH_DECOMPOSITION_METRIC,
      result: insufficient(
        "portfolio value could not be computed at both the opening and closing dates",
        ...(opening.kind === "insufficient-data" ? opening.reasons : []),
        ...(closing.kind === "insufficient-data" ? closing.reasons : []),
      ),
      asOf: closingAsOf,
      calculationBasis: "Requires a trusted, priced portfolio valuation at both ends of the range.",
    });
  }

  const activities = (await loadActivities(db)).filter(
    (a) => isTrusted(a.trustState) && a.occurredOn >= range.start && a.occurredOn < range.end,
  );
  const contributionMinorUnits = activities
    .filter((a) => a.kind === "sip" || a.kind === "buy")
    .reduce((sum, a) => sum + a.amountMinorUnits, 0);
  const withdrawalMinorUnits = activities
    .filter((a) => a.kind === "sell")
    .reduce((sum, a) => sum + a.amountMinorUnits, 0);

  const explainedSoFar = contributionMinorUnits - withdrawalMinorUnits;
  const appreciationMinorUnits = closing.value - opening.value - explainedSoFar;

  const decomposition = buildDecomposition(opening.value, closing.value, [
    { kind: "contribution", label: "New investment capital (buy/SIP)", amountMinorUnits: contributionMinorUnits },
    { kind: "withdrawal", label: "Withdrawals (sell)", amountMinorUnits: -withdrawalMinorUnits },
    {
      kind: "appreciation",
      label: "Market movement & unconfirmed changes (residual)",
      amountMinorUnits: appreciationMinorUnits,
    },
  ]);

  return buildInsight({
    metric: GROWTH_DECOMPOSITION_METRIC,
    result: ok(decomposition),
    asOf: closingAsOf,
    calculationBasis:
      "Opening/closing portfolio value from getPortfolioView; contributions/withdrawals from confirmed buy/sip/sell activity in range. The residual step also absorbs any unexplained quantity change ingestion recorded rather than a confirmed trade — it is never claimed as pure market movement (docs/09_INGESTION_ARCHITECTURE.md).",
  });
}

function buildContributionVsReturn(
  growthDecomposition: Insight<Decomposition>,
  closingAsOf: Date,
): Insight<ContributionVsReturn> {
  if (growthDecomposition.result.kind !== "ok") {
    return buildInsight({
      metric: CONTRIBUTION_VS_RETURN_METRIC,
      result: insufficient(...growthDecomposition.result.reasons),
      asOf: closingAsOf,
      calculationBasis: "Derived from Portfolio Growth Decomposition; reports the same insufficiency it does.",
    });
  }

  const d = growthDecomposition.result.value;
  const contributionStep = d.steps.find((s) => s.kind === "contribution");
  const withdrawalStep = d.steps.find((s) => s.kind === "withdrawal");
  const returnStep = d.steps.find((s) => s.kind === "appreciation");

  return buildInsight({
    metric: CONTRIBUTION_VS_RETURN_METRIC,
    result: ok({
      openingMinorUnits: d.openingMinorUnits,
      closingMinorUnits: d.closingMinorUnits,
      netContributionMinorUnits: (contributionStep?.amountMinorUnits ?? 0) + (withdrawalStep?.amountMinorUnits ?? 0),
      returnMinorUnits: returnStep?.amountMinorUnits ?? 0,
    }),
    asOf: closingAsOf,
    calculationBasis:
      "netContribution = contribution + withdrawal steps; return = the residual appreciation step, both read from Portfolio Growth Decomposition rather than recomputed.",
  });
}

// --- Portfolio Performance -------------------------------------------------------

async function buildPerformance(
  db: PrismaClient,
  portfolio: PortfolioView,
  range: DateRange,
  closingAsOf: Date,
): Promise<Insight<PortfolioPerformance>> {
  const withCostBasis = portfolio.holdings.filter((h) => h.profitAndLoss.kind === "ok");
  const aggregatePnl: Computed<AggregatePnl> =
    withCostBasis.length === 0
      ? insufficient("no holding in the current portfolio has a recorded cost basis")
      : ok({
          costBasisMinorUnits: withCostBasis.reduce(
            (sum, h) => sum + (h.profitAndLoss.kind === "ok" ? h.profitAndLoss.value.costBasisMinorUnits : 0),
            0,
          ),
          currentValueMinorUnits: withCostBasis.reduce((sum, h) => sum + h.valueMinorUnits, 0),
          absoluteMinorUnits: withCostBasis.reduce(
            (sum, h) => sum + (h.profitAndLoss.kind === "ok" ? h.profitAndLoss.value.absoluteMinorUnits : 0),
            0,
          ),
          ratio: safeRatio(
            withCostBasis.reduce(
              (sum, h) => sum + (h.profitAndLoss.kind === "ok" ? h.profitAndLoss.value.absoluteMinorUnits : 0),
              0,
            ),
            withCostBasis.reduce(
              (sum, h) => sum + (h.profitAndLoss.kind === "ok" ? h.profitAndLoss.value.costBasisMinorUnits : 0),
              0,
            ),
          ) ?? 0,
          holdingsWithCostBasis: withCostBasis.length,
          holdingsWithoutCostBasis: portfolio.holdings.length - withCostBasis.length,
        });

  const opening = await computePortfolioValueAt(db, range.start);
  const cagr: Computed<number> =
    opening.kind === "ok" && portfolio.valuation.kind === "ok"
      ? computeCagr({
          beginValueMinorUnits: opening.value,
          endValueMinorUnits: portfolio.valuation.value.totalMinorUnits,
          beginDate: range.start,
          endDate: closingAsOf,
        })
      : insufficient("portfolio value is not available at both the opening date and now");

  const activities = (await loadActivities(db)).filter(
    (a) =>
      isTrusted(a.trustState) &&
      a.occurredOn >= range.start &&
      a.occurredOn < range.end &&
      (a.kind === "buy" || a.kind === "sip" || a.kind === "sell"),
  );
  const flows: CashFlow[] = activities.map((a) => ({
    amountMinorUnits: a.kind === "sell" ? a.amountMinorUnits : -a.amountMinorUnits,
    date: a.occurredOn,
  }));
  if (portfolio.valuation.kind === "ok") {
    flows.push({ amountMinorUnits: portfolio.valuation.value.totalMinorUnits, date: closingAsOf });
  }
  const xirr = computeXirr(flows);

  return buildInsight({
    metric: PORTFOLIO_PERFORMANCE_METRIC,
    result: ok({ aggregatePnl, cagr, xirr }),
    asOf: closingAsOf,
    calculationBasis:
      "Aggregate P&L sums computeProfitAndLoss over holdings with a known cost basis only; CAGR uses computeCagr over the range's portfolio values; XIRR treats confirmed buy/SIP as outflows, sell as inflows, and the closing portfolio value as a final inflow — each is reported only when its own domain guard is satisfied, never estimated.",
  });
}

// --- Concentration Heatmap -------------------------------------------------------

function buildConcentrationHeatmap(portfolio: PortfolioView, asOf: Date): Insight<ConcentrationHeatmap> {
  if (portfolio.concentration.kind !== "ok" || portfolio.allocation.kind !== "ok") {
    const reasons =
      portfolio.concentration.kind === "insufficient-data"
        ? portfolio.concentration.reasons
        : portfolio.allocation.kind === "insufficient-data"
          ? portfolio.allocation.reasons
          : [];
    return buildInsight({
      metric: CONCENTRATION_HEATMAP_METRIC,
      result: insufficient(...reasons),
      asOf,
      calculationBasis: "Reads getPortfolioView's concentration/allocation; reports the same insufficiency they do.",
    });
  }

  return buildInsight({
    metric: CONCENTRATION_HEATMAP_METRIC,
    result: ok({
      byInstrument: portfolio.concentration.value,
      byAssetClass: portfolio.allocation.value,
      concentratedThresholdRatio: CONCENTRATION_THRESHOLD,
    }),
    asOf,
    calculationBasis:
      "concentrationByInstrument and allocationByAssetClass, the same functions the Portfolio screen uses; the 25% threshold is the same one flagConcentration already applies there, not a new one invented for this widget.",
  });
}

// --- Drawdown Monitor -------------------------------------------------------

async function buildDrawdownMonitor(
  db: PrismaClient,
  range: DateRange,
  asOf: Date,
): Promise<Insight<DrawdownResult>> {
  const allDates = await loadDistinctSnapshotDates(db, asOf);
  const dates = allDates.filter((d) => d >= range.start && d <= asOf);

  const points: DrawdownPoint[] = [];
  for (const date of dates) {
    const value = await computePortfolioValueAt(db, date);
    if (value.kind === "ok") points.push({ asOf: date, valueMinorUnits: value.value });
  }

  if (points.length < 2) {
    return buildInsight({
      metric: DRAWDOWN_MONITOR_METRIC,
      result: insufficient(
        `only ${points.length} valued observation${points.length === 1 ? "" : "s"} in range; at least 2 are required to establish a drawdown`,
      ),
      asOf,
      calculationBasis: "Requires at least two distinct, valued portfolio-observation dates.",
    });
  }

  let runningPeak = points[0] as DrawdownPoint;
  let worstDrawdownRatio = 0;
  let peakAtWorst = runningPeak;
  let troughAtWorst = runningPeak;

  for (const point of points) {
    if (point.valueMinorUnits > runningPeak.valueMinorUnits) runningPeak = point;
    const drawdownRatio = safeRatio(point.valueMinorUnits - runningPeak.valueMinorUnits, runningPeak.valueMinorUnits) ?? 0;
    if (drawdownRatio < worstDrawdownRatio) {
      worstDrawdownRatio = drawdownRatio;
      peakAtWorst = runningPeak;
      troughAtWorst = point;
    }
  }

  const latest = points[points.length - 1] as DrawdownPoint;
  const currentDrawdownRatio = safeRatio(latest.valueMinorUnits - runningPeak.valueMinorUnits, runningPeak.valueMinorUnits) ?? 0;

  return buildInsight({
    metric: DRAWDOWN_MONITOR_METRIC,
    result: ok({
      series: points,
      peak: peakAtWorst,
      trough: troughAtWorst,
      maxDrawdownRatio: worstDrawdownRatio,
      currentDrawdownRatio,
      recovered: currentDrawdownRatio >= 0,
    }),
    asOf,
    calculationBasis:
      "Portfolio value (getPortfolioView) sampled only at dates a position snapshot was actually recorded (loadDistinctSnapshotDates) — never a fabricated daily series. Drawdown is the running peak-to-point decline; the worst such decline in the series is reported as the maximum.",
  });
}

// --- Portfolio vs Benchmark -------------------------------------------------------

async function priceAtOrBefore(db: PrismaClient, instrumentId: string, asOf: Date) {
  return db.valuation.findFirst({
    where: { instrumentId, asOfDate: { lte: asOf } },
    orderBy: { asOfDate: "desc" },
  });
}

async function buildPortfolioVsBenchmark(
  db: PrismaClient,
  range: DateRange,
  closingAsOf: Date,
): Promise<Insight<readonly BenchmarkRow[]>> {
  const instrumentIdByCode = await ensureIndexInstruments(db);

  const [openingPortfolio, closingPortfolio] = await Promise.all([
    computePortfolioValueAt(db, range.start),
    computePortfolioValueAt(db, closingAsOf),
  ]);

  const rows: BenchmarkRow[] = [];
  for (const index of TRACKED_INDICES) {
    const instrumentId = instrumentIdByCode.get(index.code) as string;
    const [startPrice, endPrice] = await Promise.all([
      priceAtOrBefore(db, instrumentId, range.start),
      priceAtOrBefore(db, instrumentId, closingAsOf),
    ]);

    if (startPrice === null || endPrice === null) {
      rows.push({
        indexCode: index.code,
        indexLabel: index.label,
        result: insufficient(
          `no dated ${index.label} observation at or before both range boundaries — D-007/D-016: manual entry or a market refresh is required before this index can be compared`,
        ),
      });
      continue;
    }

    if (openingPortfolio.kind !== "ok" || closingPortfolio.kind !== "ok") {
      rows.push({
        indexCode: index.code,
        indexLabel: index.label,
        result: insufficient("portfolio value is not available at both range boundaries"),
      });
      continue;
    }

    const indexReturnRatio = safeRatio(
      endPrice.priceMinorUnits - startPrice.priceMinorUnits,
      startPrice.priceMinorUnits,
    );
    const portfolioReturnRatio = safeRatio(
      closingPortfolio.value - openingPortfolio.value,
      openingPortfolio.value,
    );

    rows.push({
      indexCode: index.code,
      indexLabel: index.label,
      result:
        indexReturnRatio === null || portfolioReturnRatio === null
          ? insufficient("opening value is zero; a return ratio is undefined")
          : ok({ portfolioReturnRatio, indexReturnRatio }),
    });
  }

  return buildInsight({
    metric: PORTFOLIO_VS_BENCHMARK_METRIC,
    result: ok(rows),
    asOf: closingAsOf,
    calculationBasis:
      "Per tracked index (docs/MARKET_DATA_PROVIDER_EVALUATION.md, D-007): the last dated Valuation at or before each range boundary, from whatever manual entry or market refresh already populated it — never a live fetch from this view, never a fabricated index level. A missing dated observation on either side reports that index as insufficient rather than comparing against a stale or absent price.",
  });
}

// --- Investment Plan Adherence -------------------------------------------------------

async function buildPlanAdherence(db: PrismaClient, range: DateRange): Promise<Insight<readonly AdherenceRow[]>> {
  const activities = await loadActivities(db);
  const investmentActivities = activities.filter(
    (a) => isTrusted(a.trustState) && (a.kind === "buy" || a.kind === "sip"),
  );

  const { fullyCovered } = monthsInRange(range);

  if (investmentActivities.length === 0) {
    const rows: AdherenceRow[] = fullyCovered.map((periodMonth) => ({
      periodMonth,
      status: "insufficient-data",
      plannedMinorUnits: null,
      actualMinorUnits: null,
    }));
    return buildInsight({
      metric: INVESTMENT_PLAN_ADHERENCE_METRIC,
      result: rows.length === 0 ? insufficient("the selected period contains no fully-covered month") : ok(rows),
      asOf: range.end,
      calculationBasis:
        "No confirmed buy/SIP activity has ever been recorded in this data set. The documented portfolio ingestion path (position-snapshot import) never fabricates one from an observed quantity change, so adherence cannot be measured from transactions here rather than being reported as a missed investment.",
    });
  }

  const planRecords = await loadEffectivePlanRecords(db);

  const rows: AdherenceRow[] = fullyCovered.map((periodMonth) => {
    // Trusted, extractable investment lines only — the same filter
    // summarizeMonth applies before it will total a category, so a plan
    // line that is needs_review or has no extractable amount is treated as
    // no plan for the month rather than silently contributing zero.
    const investmentLines = planRecords.filter(
      (p) =>
        p.periodMonth === periodMonth &&
        p.category === "investment" &&
        isTrusted(p.trustState) &&
        p.amountMinorUnits !== null,
    );

    if (investmentLines.length === 0) {
      return { periodMonth, status: "insufficient-data", plannedMinorUnits: null, actualMinorUnits: null };
    }

    const plannedMinorUnits = investmentLines.reduce((sum, p) => sum + (p.amountMinorUnits as number), 0);

    const actualMinorUnits = investmentActivities
      .filter((a) => a.occurredOn.toISOString().slice(0, 7) === periodMonth)
      .reduce((sum, a) => sum + a.amountMinorUnits, 0);

    const status: AdherenceRow["status"] =
      actualMinorUnits === plannedMinorUnits ? "exact" : actualMinorUnits < plannedMinorUnits ? "under-invested" : "over-invested";

    return { periodMonth, status, plannedMinorUnits, actualMinorUnits };
  });

  return buildInsight({
    metric: INVESTMENT_PLAN_ADHERENCE_METRIC,
    result: rows.length === 0 ? insufficient("the selected period contains no fully-covered month") : ok(rows),
    asOf: range.end,
    calculationBasis:
      "Planned investment amount from the effective budget plan's investment-category lines; actual amount from confirmed buy/SIP activity in the same month. A month with no investment plan is flagged insufficient-data rather than a missed investment.",
  });
}
