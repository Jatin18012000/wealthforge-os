import type { PrismaClient } from "@prisma/client";
import { loadEffectivePlanRecords, loadLiabilities } from "../data/loaders";
import {
  buildInsight,
  buildScenarioResult,
  computeCagr,
  insufficient,
  monthsUntilTarget,
  ok,
  projectFutureValue,
  simulateDebtPrepayment,
  summarizeMonth,
  type Computed,
  type DebtAmortizationResult,
  type Insight,
  type MetricDefinition,
  type ScenarioResult,
} from "../domain";
import { resolveInceptionDate } from "./analyticsView";
import { computeNetWorthAsOf } from "./commandCenterView";
import { computePortfolioValueAt } from "./investmentIntelligenceView";

/**
 * IM-06 Scenario Engine (v1.1, `docs/21_INTELLIGENCE_MASTER_PLAN.md`).
 *
 * Every growth-rate assumption here is an *observed* CAGR
 * (`computeCagr` between the earliest recorded data and now) — never an
 * invented market-return figure. Where that CAGR cannot be computed
 * (insufficient history), the whole widget reports insufficient-data
 * rather than substituting a guessed rate. The only genuinely assumed
 * numbers are (a) a small set of illustrative comparison points (SIP
 * increase percentages, prepayment amounts) that exist to demonstrate the
 * mechanism, not to recommend a specific figure, and (b) the Financial
 * Independence Projection's 4%-rule / 25x-expenses convention, which is a
 * widely-used external methodology (not a project-specific rule) and is
 * disclosed as an explicit assumption, never presented as fact. Nothing
 * here writes to a real record — every result is a `ScenarioResult<T>`
 * (IM-01) with its assumptions retained and the standard disclaimer
 * attached.
 *
 * Goal Trade-Off Simulator is also named under this module in the v1.1
 * directive, but it was already built in IM-04
 * (`src/views/goalLiabilityIntelligenceView.ts`) — it is not duplicated here.
 */

const SIP_INCREASE_METRIC: MetricDefinition = {
  id: "sip_increase_simulator",
  label: "SIP Increase Simulator",
  unit: "money",
  description: "Projected portfolio value at illustrative SIP increase percentages, using the portfolio's own observed CAGR.",
};

const DEBT_PREPAYMENT_METRIC: MetricDefinition = {
  id: "debt_prepayment_simulator",
  label: "Debt Prepayment Simulator",
  unit: "months",
  description: "How far illustrative extra monthly payments would shorten each liability's payoff and reduce total interest.",
};

const WEALTH_PROJECTION_METRIC: MetricDefinition = {
  id: "wealth_projection",
  label: "Wealth Projection",
  unit: "money",
  description: "Projected net worth at several horizons, using net worth's own observed CAGR and the latest month's retained cash.",
};

const FI_PROJECTION_METRIC: MetricDefinition = {
  id: "financial_independence_projection",
  label: "Financial Independence Projection",
  unit: "months",
  description: "Months until projected net worth reaches 25x annual expense (the 4% rule), an explicitly disclosed external convention.",
};

// --- Shared types -----------------------------------------------------

export interface SipIncreaseRow {
  readonly increaseRatio: number;
  readonly horizonYears: number;
  readonly projectedCorpus: Computed<number>;
}

export interface DebtPrepaymentRow {
  readonly liabilityId: string;
  readonly liabilityName: string;
  readonly extraMonthlyMinorUnits: number;
  readonly result: Computed<DebtAmortizationResult>;
}

export interface WealthProjectionRow {
  readonly horizonYears: number;
  readonly projectedNetWorth: Computed<number>;
}

export interface ScenarioEngineView {
  readonly sipIncreaseSimulator: Insight<ScenarioResult<readonly SipIncreaseRow[]>>;
  readonly debtPrepaymentSimulator: Insight<ScenarioResult<readonly DebtPrepaymentRow[]>>;
  readonly wealthProjection: Insight<ScenarioResult<readonly WealthProjectionRow[]>>;
  readonly financialIndependenceProjection: Insight<ScenarioResult<Computed<number>>>;
}

// Illustrative comparison points only — never a recommendation.
const SIP_INCREASE_RATIOS: readonly number[] = [0, 0.1, 0.25];
const PROJECTION_HORIZONS_YEARS: readonly number[] = [5, 10, 20];
const PREPAYMENT_ILLUSTRATIVE_EXTRA_MINOR_UNITS: readonly number[] = [0, 200_000, 500_000];

// The 4% rule / 25x-annual-expense convention — a widely-used external FI
// heuristic, not a project-specific financial rule. Disclosed as an
// assumption, never presented as this system's own recommendation.
const SAFE_WITHDRAWAL_RATE = 0.04;

export async function getScenarioEngineView(
  db: PrismaClient,
  asOf: Date,
  latestPeriodMonth: string | null,
): Promise<ScenarioEngineView> {
  const inceptionDate = await resolveInceptionDate(db);
  const planRecords = await loadEffectivePlanRecords(db);
  const latestSummary = latestPeriodMonth === null ? null : summarizeMonth(planRecords, latestPeriodMonth);

  return {
    sipIncreaseSimulator: await buildSipIncreaseSimulator(db, asOf, inceptionDate, latestSummary),
    debtPrepaymentSimulator: await buildDebtPrepaymentSimulator(db, asOf),
    wealthProjection: await buildWealthProjection(db, asOf, inceptionDate, latestSummary),
    financialIndependenceProjection: await buildFinancialIndependenceProjection(
      db,
      asOf,
      inceptionDate,
      latestSummary,
    ),
  };
}

async function observedPortfolioCagr(db: PrismaClient, inceptionDate: Date | null, asOf: Date): Promise<Computed<number>> {
  if (inceptionDate === null) return insufficient("no data has been recorded yet");
  const [opening, closing] = await Promise.all([
    computePortfolioValueAt(db, inceptionDate),
    computePortfolioValueAt(db, asOf),
  ]);
  if (opening.kind !== "ok" || closing.kind !== "ok") {
    return insufficient("portfolio value is not available at both inception and now");
  }
  return computeCagr({
    beginValueMinorUnits: opening.value,
    endValueMinorUnits: closing.value,
    beginDate: inceptionDate,
    endDate: asOf,
  });
}

async function observedNetWorthCagr(db: PrismaClient, inceptionDate: Date | null, asOf: Date): Promise<Computed<number>> {
  if (inceptionDate === null) return insufficient("no data has been recorded yet");
  const [opening, closing] = await Promise.all([
    computeNetWorthAsOf(db, inceptionDate),
    computeNetWorthAsOf(db, asOf),
  ]);
  if (opening.netWorth.kind !== "ok" || closing.netWorth.kind !== "ok") {
    return insufficient("net worth is not available at both inception and now");
  }
  return computeCagr({
    beginValueMinorUnits: opening.netWorth.value.netWorthMinorUnits,
    endValueMinorUnits: closing.netWorth.value.netWorthMinorUnits,
    beginDate: inceptionDate,
    endDate: asOf,
  });
}

// --- SIP Increase Simulator -------------------------------------------------------

async function buildSipIncreaseSimulator(
  db: PrismaClient,
  asOf: Date,
  inceptionDate: Date | null,
  latestSummary: ReturnType<typeof summarizeMonth> | null,
): Promise<Insight<ScenarioResult<readonly SipIncreaseRow[]>>> {
  if (latestSummary === null || latestSummary.kind !== "ok" || latestSummary.value.investmentMinorUnits <= 0) {
    return buildInsight({
      metric: SIP_INCREASE_METRIC,
      result: insufficient(
        "no positive planned investment amount is available for the latest budget month to use as the current monthly SIP",
      ),
      asOf,
      calculationBasis: "The current monthly SIP is the latest fully-covered month's investmentMinorUnits.",
    });
  }

  const [growth, opening] = await Promise.all([
    observedPortfolioCagr(db, inceptionDate, asOf),
    computePortfolioValueAt(db, asOf),
  ]);

  if (growth.kind !== "ok" || opening.kind !== "ok") {
    return buildInsight({
      metric: SIP_INCREASE_METRIC,
      result: insufficient(
        "requires both an observed portfolio CAGR since inception and a current portfolio value",
        ...(growth.kind === "insufficient-data" ? growth.reasons : []),
        ...(opening.kind === "insufficient-data" ? opening.reasons : []),
      ),
      asOf,
      calculationBasis: "computeCagr on the portfolio's own value from inception to now.",
    });
  }

  const currentMonthlyInvestment = latestSummary.value.investmentMinorUnits;
  const rows: SipIncreaseRow[] = [];
  for (const ratio of SIP_INCREASE_RATIOS) {
    for (const years of PROJECTION_HORIZONS_YEARS) {
      rows.push({
        increaseRatio: ratio,
        horizonYears: years,
        projectedCorpus: projectFutureValue({
          openingMinorUnits: opening.value,
          monthlyContributionMinorUnits: Math.round(currentMonthlyInvestment * (1 + ratio)),
          annualGrowthRatio: growth.value,
          months: years * 12,
        }),
      });
    }
  }

  const scenario = buildScenarioResult(
    {
      currentMonthlyInvestmentMinorUnits: currentMonthlyInvestment,
      observedAnnualGrowthRatioBps: Math.round(growth.value * 10_000),
    },
    rows,
  );

  return buildInsight({
    metric: SIP_INCREASE_METRIC,
    result: ok(scenario),
    asOf,
    calculationBasis:
      "projectFutureValue compounding the current portfolio value at the portfolio's own observed CAGR (since inception), with the current monthly investment scaled by illustrative increase percentages (0%/10%/25% — comparison points, not a recommendation). Never mutates the underlying budget plan.",
  });
}

// --- Debt Prepayment Simulator -------------------------------------------------------

async function buildDebtPrepaymentSimulator(
  db: PrismaClient,
  asOf: Date,
): Promise<Insight<ScenarioResult<readonly DebtPrepaymentRow[]>>> {
  const liabilities = await loadLiabilities(db);
  if (liabilities.length === 0) {
    return buildInsight({
      metric: DEBT_PREPAYMENT_METRIC,
      result: insufficient("no liability is recorded"),
      asOf,
      calculationBasis: "Requires at least one recorded liability.",
    });
  }

  const rows: DebtPrepaymentRow[] = [];
  for (const liability of liabilities) {
    for (const extra of PREPAYMENT_ILLUSTRATIVE_EXTRA_MINOR_UNITS) {
      rows.push({
        liabilityId: liability.id,
        liabilityName: liability.name,
        extraMonthlyMinorUnits: extra,
        result: simulateDebtPrepayment(
          liability.outstandingMinorUnits,
          liability.interestRateBps,
          liability.emiAmountMinorUnits + extra,
        ),
      });
    }
  }

  const scenario = buildScenarioResult({ illustrativeExtraMinorUnits: PREPAYMENT_ILLUSTRATIVE_EXTRA_MINOR_UNITS.join(",") }, rows);

  return buildInsight({
    metric: DEBT_PREPAYMENT_METRIC,
    result: ok(scenario),
    asOf,
    calculationBasis:
      "simulateDebtPrepayment amortizes each liability's current outstanding balance at its recorded interest rate, with the recorded EMI plus an illustrative extra monthly amount (₹0/₹2,000/₹5,000 — comparison points, not a recommended prepayment). Never mutates the recorded liability, EMI, or tenure.",
  });
}

// --- Wealth Projection -------------------------------------------------------

async function currentNetWorthAndMonthlyRetained(
  db: PrismaClient,
  asOf: Date,
  latestSummary: ReturnType<typeof summarizeMonth> | null,
): Promise<Computed<{ readonly openingMinorUnits: number; readonly monthlyContributionMinorUnits: number }>> {
  const { netWorth } = await computeNetWorthAsOf(db, asOf);
  if (netWorth.kind !== "ok") {
    return insufficient("net worth is not currently computable", ...netWorth.reasons);
  }
  if (latestSummary === null || latestSummary.kind !== "ok") {
    return insufficient("no trusted budget data for the latest month; monthly retained cash is unknown");
  }
  return ok({
    openingMinorUnits: netWorth.value.netWorthMinorUnits,
    monthlyContributionMinorUnits: Math.max(latestSummary.value.retainedMinorUnits, 0),
  });
}

async function buildWealthProjection(
  db: PrismaClient,
  asOf: Date,
  inceptionDate: Date | null,
  latestSummary: ReturnType<typeof summarizeMonth> | null,
): Promise<Insight<ScenarioResult<readonly WealthProjectionRow[]>>> {
  const [growth, base] = await Promise.all([
    observedNetWorthCagr(db, inceptionDate, asOf),
    currentNetWorthAndMonthlyRetained(db, asOf, latestSummary),
  ]);

  if (growth.kind !== "ok" || base.kind !== "ok") {
    return buildInsight({
      metric: WEALTH_PROJECTION_METRIC,
      result: insufficient(
        "requires an observed net worth CAGR since inception, current net worth, and the latest month's retained cash",
        ...(growth.kind === "insufficient-data" ? growth.reasons : []),
        ...(base.kind === "insufficient-data" ? base.reasons : []),
      ),
      asOf,
      calculationBasis: "computeCagr on net worth from inception to now, plus the latest month's retainedMinorUnits.",
    });
  }

  const rows: WealthProjectionRow[] = PROJECTION_HORIZONS_YEARS.map((years) => ({
    horizonYears: years,
    projectedNetWorth: projectFutureValue({
      openingMinorUnits: base.value.openingMinorUnits,
      monthlyContributionMinorUnits: base.value.monthlyContributionMinorUnits,
      annualGrowthRatio: growth.value,
      months: years * 12,
    }),
  }));

  const scenario = buildScenarioResult(
    {
      openingNetWorthMinorUnits: base.value.openingMinorUnits,
      monthlyRetainedMinorUnits: base.value.monthlyContributionMinorUnits,
      observedAnnualGrowthRatioBps: Math.round(growth.value * 10_000),
    },
    rows,
  );

  return buildInsight({
    metric: WEALTH_PROJECTION_METRIC,
    result: ok(scenario),
    asOf,
    calculationBasis:
      "projectFutureValue compounding current net worth at net worth's own observed CAGR (since inception), with the latest month's retained cash (income − expenses − EMI) as the level monthly contribution. Never mutates any real record.",
  });
}

// --- Financial Independence Projection -------------------------------------------------------

async function buildFinancialIndependenceProjection(
  db: PrismaClient,
  asOf: Date,
  inceptionDate: Date | null,
  latestSummary: ReturnType<typeof summarizeMonth> | null,
): Promise<Insight<ScenarioResult<Computed<number>>>> {
  const [growth, base] = await Promise.all([
    observedNetWorthCagr(db, inceptionDate, asOf),
    currentNetWorthAndMonthlyRetained(db, asOf, latestSummary),
  ]);

  if (growth.kind !== "ok" || base.kind !== "ok" || latestSummary === null || latestSummary.kind !== "ok") {
    return buildInsight({
      metric: FI_PROJECTION_METRIC,
      result: insufficient(
        "requires an observed net worth CAGR, current net worth, the latest month's retained cash, and the latest month's expense total",
        ...(growth.kind === "insufficient-data" ? growth.reasons : []),
        ...(base.kind === "insufficient-data" ? base.reasons : []),
      ),
      asOf,
      calculationBasis: "Derived from the same inputs as Wealth Projection, plus the latest month's annualized expense.",
    });
  }

  const annualExpenseMinorUnits =
    (latestSummary.value.expenseMinorUnits + latestSummary.value.emiMinorUnits) * 12;
  const fiTargetMinorUnits = Math.round(annualExpenseMinorUnits / SAFE_WITHDRAWAL_RATE);

  const monthsToFi = monthsUntilTarget(
    base.value.openingMinorUnits,
    base.value.monthlyContributionMinorUnits,
    growth.value,
    fiTargetMinorUnits,
  );

  const scenario = buildScenarioResult(
    {
      safeWithdrawalRateBps: Math.round(SAFE_WITHDRAWAL_RATE * 10_000),
      fiTargetMinorUnits,
      annualExpenseMinorUnits,
      observedAnnualGrowthRatioBps: Math.round(growth.value * 10_000),
    },
    monthsToFi,
  );

  return buildInsight({
    metric: FI_PROJECTION_METRIC,
    result: ok(scenario),
    asOf,
    calculationBasis:
      "FI target = 25x the latest month's annualized expense+EMI (the widely-used 4%-rule convention — an explicit, disclosed external methodology, not a project-specific rule). monthsUntilTarget compounds current net worth at its own observed CAGR with the latest month's retained cash until that target is reached, or reports insufficient-data if it is not reached within the search horizon.",
  });
}
