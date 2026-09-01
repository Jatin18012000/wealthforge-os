import type { PrismaClient } from "@prisma/client";
import { loadPositionsAsOf, loadValuations } from "../data/loaders";
import {
  computeNetWorth,
  emiBurdenForPayer,
  valuePortfolio,
  type AssetInput,
  type Computed,
  type LiabilityInput,
  type NetWorth,
} from "../domain";
import { formatMoney, formatPriceAge } from "../presentation/format";
import { getBudgetView, type BudgetView } from "./budgetView";
import { getGoalsView, type GoalsView } from "./goalsView";
import { getLiabilitiesView, getPrimaryPayerName, type LiabilitiesView } from "./liabilitiesView";
import { CASH_ASSET_CLASS, getPortfolioView, type PortfolioView } from "./portfolioView";

/** A price older than this is flagged as stale on the Command Center and counted against Financial Health Score's data-freshness component. */
export const STALE_AFTER_DAYS = 7;

export type AlertLevel = "caution" | "info";

export interface DashboardAlert {
  readonly level: AlertLevel;
  readonly title: string;
  readonly detail: string;
}

export interface CommandCenterView {
  readonly asOf: Date;
  readonly netWorth: Computed<NetWorth>;
  readonly cashMinorUnits: number | null;
  readonly portfolio: PortfolioView;
  readonly budget: BudgetView | null;
  readonly goals: GoalsView;
  readonly liabilities: LiabilitiesView;
  readonly emiBurden: Computed<{ totalShareMinorUnits: number; burdenRatio: number }> | null;
  readonly alerts: readonly DashboardAlert[];
}

/**
 * Assembles the landing screen.
 *
 * Every figure here comes from the engine; this function selects and labels,
 * it does not calculate. Where the engine reports insufficient data, that
 * result is passed through to the UI intact rather than being smoothed into
 * a zero.
 */
export async function getCommandCenterView(
  db: PrismaClient,
  asOf: Date,
  periodMonth: string | null,
  availablePeriods: readonly string[],
): Promise<CommandCenterView> {
  const portfolio = await getPortfolioView(db, asOf);
  const goals = await getGoalsView(db, asOf);
  const liabilities = await getLiabilitiesView(db, asOf);
  const budget =
    periodMonth === null ? null : await getBudgetView(db, periodMonth, availablePeriods);

  const { netWorth, cashMinorUnits } = await computeNetWorthAsOf(db, asOf, portfolio, liabilities);

  const primaryPayer = await getPrimaryPayerName(db);
  const takeHome =
    budget?.summary.kind === "ok" ? budget.summary.value.incomeMinorUnits : 0;
  const emiBurden =
    primaryPayer === null
      ? null
      : emiBurdenForPayer(
          liabilities.cards.map((card) => card.liability),
          primaryPayer,
          takeHome,
          asOf,
        );

  return {
    asOf,
    netWorth,
    cashMinorUnits,
    portfolio,
    budget,
    goals,
    liabilities,
    emiBurden,
    alerts: await buildAlerts(db, portfolio, budget, goals),
  };
}

/**
 * Net worth at an arbitrary date, composed from the same portfolio/cash/
 * liability views the Command Center itself uses. Factored out so the v1.1
 * intelligence layer (`wealthIntelligenceView.ts`'s Net Worth Trajectory)
 * can compute it for a series of historical dates without duplicating this
 * composition (CLAUDE.md, "no parallel implementations").
 *
 * Callers that already have a `PortfolioView`/`LiabilitiesView` for `asOf`
 * (e.g. this file's own `getCommandCenterView`) may pass them in to avoid
 * recomputing; omit either to have this function load them.
 */
export async function computeNetWorthAsOf(
  db: PrismaClient,
  asOf: Date,
  portfolio?: PortfolioView,
  liabilities?: LiabilitiesView,
): Promise<{ netWorth: Computed<NetWorth>; cashMinorUnits: number | null }> {
  const resolvedPortfolio = portfolio ?? (await getPortfolioView(db, asOf));
  const resolvedLiabilities = liabilities ?? (await getLiabilitiesView(db, asOf));

  // Cash is an instrument priced at ₹1 per unit, so the same valuation path
  // covers it; it is separated out here only for display.
  const cashPositions = (await loadPositionsAsOf(db, asOf)).filter(
    (position) => position.assetClass === CASH_ASSET_CLASS,
  );
  const valuations = await loadValuations(db, asOf);
  const cashValuation =
    cashPositions.length === 0 ? null : valuePortfolio(cashPositions, valuations, asOf);
  const cashMinorUnits =
    cashValuation !== null && cashValuation.kind === "ok"
      ? cashValuation.value.totalMinorUnits
      : null;

  const assets: AssetInput[] = [];
  if (resolvedPortfolio.valuation.kind === "ok") {
    assets.push({
      id: "portfolio",
      label: "Portfolio",
      kind: "portfolio",
      valueMinorUnits: resolvedPortfolio.valuation.value.totalMinorUnits,
      trustState: "validated",
    });
  }
  if (cashMinorUnits !== null) {
    assets.push({
      id: "cash",
      label: "Cash",
      kind: "cash",
      valueMinorUnits: cashMinorUnits,
      trustState: "validated",
    });
  }

  const liabilityInputs: LiabilityInput[] = resolvedLiabilities.cards.map((card) => ({
    id: card.liability.id,
    name: card.liability.name,
    outstandingMinorUnits: card.liability.outstandingMinorUnits,
    outstandingAsOf: card.liability.outstandingAsOf,
    trustState: "validated",
  }));

  return {
    netWorth: computeNetWorth(assets, liabilityInputs, asOf),
    cashMinorUnits,
  };
}

/**
 * Surfaces what needs attention.
 *
 * These are drawn from real engine output — records the trust model excluded,
 * prices the freshness rule considers old, position changes ingestion could
 * not reconcile — rather than from thresholds invented for the UI.
 */
async function buildAlerts(
  db: PrismaClient,
  portfolio: PortfolioView,
  budget: BudgetView | null,
  goals: GoalsView,
): Promise<DashboardAlert[]> {
  const alerts: DashboardAlert[] = [];

  const needsReview = await db.planRecord.count({
    where: { trustState: "needs_review", supersededById: null },
  });
  const positionsNeedingReview = await db.positionSnapshot.count({
    where: { trustState: "needs_review", supersededById: null },
  });

  if (needsReview + positionsNeedingReview > 0) {
    alerts.push({
      level: "caution",
      title: `${needsReview + positionsNeedingReview} records need review`,
      detail:
        "They are excluded from every total until resolved, so the figures below are understated by whatever they hold.",
    });
  }

  if (portfolio.exclusions.length > 0) {
    alerts.push({
      level: "caution",
      title: `${portfolio.exclusions.length} holdings could not be valued`,
      detail: portfolio.exclusions.map((exclusion) => exclusion.label).join(", "),
    });
  }

  if (portfolio.stalestPriceAgeDays !== null && portfolio.stalestPriceAgeDays > STALE_AFTER_DAYS) {
    alerts.push({
      level: "caution",
      title: `Prices are ${formatPriceAge(portfolio.stalestPriceAgeDays)}`,
      detail:
        "Portfolio value reflects the last dated closing prices on record, not live quotes.",
    });
  }

  for (const slice of portfolio.concentrated) {
    alerts.push({
      level: "info",
      title: `${slice.key} is a large share of the portfolio`,
      detail: `${formatMoney(slice.valueMinorUnits)} — above the 25% concentration threshold.`,
    });
  }

  const emergencyFund = goals.active.find((card) => card.progress.isProtected);
  if (emergencyFund && emergencyFund.progress.remainingMinorUnits > 0) {
    alerts.push({
      level: "info",
      title: "Emergency fund is not yet fully funded",
      detail: `${formatMoney(emergencyFund.progress.remainingMinorUnits)} remaining. It is the highest-priority goal and is protected from ordinary reallocation.`,
    });
  }

  if (budget?.planVsReality.kind === "ok" && budget.planVsReality.value.hasNoActuals) {
    alerts.push({
      level: "info",
      title: "No confirmed activity recorded for this month",
      detail:
        "Plan vs Reality has nothing to compare against yet, so variances are shown as uncovered rather than as zero.",
    });
  }

  for (const card of goals.active) {
    if (card.progress.anomaly !== null) {
      alerts.push({
        level: "caution",
        title: `"${card.goal.name}" has an inconsistent balance`,
        detail: card.progress.anomaly,
      });
    }
  }

  alerts.push(...(await unexplainedPositionChangeAlerts(db)));

  return alerts;
}

export interface UnexplainedPositionChange {
  readonly instrumentLabel: string;
  readonly previousQuantity: number;
  readonly newQuantity: number;
  readonly reconciled: boolean;
}

/**
 * Holdings whose quantity changed with no transaction accounting for it, as
 * recorded by the most recent snapshot import.
 *
 * Ingestion deliberately refuses to invent a trade to explain such a change
 * (docs/09_INGESTION_ARCHITECTURE.md). Exported so both the Command
 * Center's own alerts and the v1.1 intelligence layer (Financial Anomaly
 * Detector, Data Health) surface the same underlying finding rather than
 * re-parsing the audit log a second way.
 */
export async function getUnexplainedPositionChanges(
  db: PrismaClient,
): Promise<readonly UnexplainedPositionChange[]> {
  const latestImport = await db.auditEvent.findFirst({
    where: { kind: "import", payloadJson: { contains: "portfolioSnapshot" } },
    orderBy: { createdAt: "desc" },
  });
  if (latestImport === null) return [];

  let changes: UnexplainedPositionChange[];
  try {
    const payload: unknown = JSON.parse(latestImport.payloadJson);
    const snapshot = (payload as { portfolioSnapshot?: { observedChanges?: unknown } })
      .portfolioSnapshot;
    changes = Array.isArray(snapshot?.observedChanges)
      ? (snapshot.observedChanges as UnexplainedPositionChange[])
      : [];
  } catch {
    return [];
  }

  return changes.filter((change) => !change.reconciled);
}

/**
 * That decision is only useful if the unexplained change actually reaches
 * the user, which is what this does — otherwise the honesty is buried in
 * an audit log nobody reads.
 */
async function unexplainedPositionChangeAlerts(
  db: PrismaClient,
): Promise<DashboardAlert[]> {
  const changes = await getUnexplainedPositionChanges(db);
  return changes.map((change) => ({
    level: "caution" as const,
    title: `${change.instrumentLabel} changed with no recorded transaction`,
    detail: `Quantity moved from ${change.previousQuantity} to ${change.newQuantity} between statements. It is reported rather than recorded as a trade — confirm what happened.`,
  }));
}
