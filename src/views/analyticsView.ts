import type { PrismaClient } from "@prisma/client";
import { loadEffectivePlanRecords } from "../data/loaders";
import {
  comparePeriods,
  comparePlannedAllocation,
  computePeriodMetrics,
  monthsInRange,
  precedingRange,
  resolvePeriod,
  sameRangePriorYear,
  type ActivityFilter,
  type AllocationComparisonRow,
  type Computed,
  type DateRange,
  type FilterableActivity,
  type PeriodComparison,
  type PeriodKey,
} from "../domain";
import { getPortfolioView } from "./portfolioView";

export type ComparisonMode = "preceding" | "prior-year" | "custom";

export interface AnalyticsFilters extends ActivityFilter {
  /** Restrict the observed-allocation comparison to these asset classes. */
  readonly assetClasses?: readonly string[];
}

export interface AnalyticsView {
  readonly periodKey: PeriodKey;
  readonly comparisonMode: ComparisonMode;
  /** Insufficient when the period cannot be resolved at all. */
  readonly range: Computed<DateRange>;
  /** Absent when the range could not be resolved. */
  readonly comparison: PeriodComparison | null;
  readonly allocation: readonly AllocationComparisonRow[];
  readonly availableActivityKinds: readonly string[];
  readonly availableAssetClasses: readonly string[];
  readonly inceptionDate: Date | null;
}

/**
 * The Analytics view model.
 *
 * The engine does the period maths, the aggregation and the comparison; this
 * layer resolves what the user selected, loads the data, and hands the
 * result through unchanged — including its coverage warnings, which must
 * reach the screen rather than being smoothed away here.
 */
export async function getAnalyticsView(
  db: PrismaClient,
  anchor: Date,
  periodKey: PeriodKey,
  options: {
    readonly comparisonMode?: ComparisonMode;
    readonly custom?: DateRange;
    /** Required when comparisonMode is "custom" — docs/11_ANALYTICS_SPEC.md's "any two arbitrary periods". */
    readonly customComparison?: DateRange;
    readonly filters?: AnalyticsFilters;
  } = {},
): Promise<AnalyticsView> {
  const comparisonMode = options.comparisonMode ?? "preceding";
  const filters = options.filters ?? {};

  const inceptionDate = await resolveInceptionDate(db);
  const availableActivityKinds = await listActivityKinds(db);
  const availableAssetClasses = await listAssetClasses(db);

  const rangeResult = resolvePeriod(periodKey, {
    anchor,
    inceptionDate,
    ...(options.custom === undefined ? {} : { custom: options.custom }),
  });

  if (rangeResult.kind !== "ok") {
    return {
      periodKey,
      comparisonMode,
      range: rangeResult,
      comparison: null,
      allocation: [],
      availableActivityKinds,
      availableAssetClasses,
      inceptionDate,
    };
  }

  const range = rangeResult.value;

  if (comparisonMode === "custom" && options.customComparison === undefined) {
    // "Custom comparison: any two arbitrary periods" needs both sides
    // explicit — there is no sensible default second range to fall back to.
    return {
      periodKey,
      comparisonMode,
      range: rangeResult,
      comparison: null,
      allocation: await buildAllocationComparison(db, anchor, range, filters),
      availableActivityKinds,
      availableAssetClasses,
      inceptionDate,
    };
  }

  const priorRange =
    comparisonMode === "custom"
      ? (options.customComparison as DateRange)
      : comparisonMode === "prior-year"
        ? sameRangePriorYear(range)
        : precedingRange(range);

  const planRecords = await loadEffectivePlanRecords(db);
  const activities = await loadFilterableActivities(db);

  const activityFilter: ActivityFilter = {
    ...(filters.kinds === undefined ? {} : { kinds: filters.kinds }),
    ...(filters.instrumentIds === undefined ? {} : { instrumentIds: filters.instrumentIds }),
  };

  const comparison = comparePeriods(
    computePeriodMetrics(range, planRecords, activities, activityFilter),
    computePeriodMetrics(priorRange, planRecords, activities, activityFilter),
  );

  return {
    periodKey,
    comparisonMode,
    range: rangeResult,
    comparison,
    allocation: await buildAllocationComparison(db, anchor, range, filters),
    availableActivityKinds,
    availableAssetClasses,
    inceptionDate,
  };
}

/**
 * Compares the investment lines planned in the budget against what the
 * portfolio actually holds.
 *
 * Planned lines come from the last fully-covered month in the range, since a
 * plan is stated per month and summing several months would compare a
 * multi-month intention against a single point-in-time holding.
 */
export async function buildAllocationComparison(
  db: PrismaClient,
  anchor: Date,
  range: DateRange,
  filters: AnalyticsFilters,
): Promise<readonly AllocationComparisonRow[]> {
  const planRecords = await loadEffectivePlanRecords(db);

  // The planned side uses only months the range FULLY covers — the same rule
  // the budget totals use. Including a month the range merely clips would
  // make this table disagree with the variance table directly above it,
  // showing August's plan while the budget reports August as uncounted.
  const { fullyCovered } = monthsInRange(range);
  const monthsWithPlan = new Set(planRecords.map((record) => record.periodMonth));
  const usableMonths = fullyCovered.filter((month) => monthsWithPlan.has(month)).sort();

  const latestMonth = usableMonths[usableMonths.length - 1];

  const plannedRows = await db.planRecord.findMany({
    where:
      latestMonth === undefined
        ? { id: "__none__" }
        : { periodMonth: latestMonth, category: "investment", supersededById: null },
  });

  const planned = plannedRows
    .filter((row) => row.amountMinorUnits !== null)
    .map((row) => ({ label: row.labelRaw, amountMinorUnits: row.amountMinorUnits as number }));

  const portfolio = await getPortfolioView(db, anchor);
  const observed = portfolio.holdings
    .filter(
      (holding) =>
        filters.assetClasses === undefined ||
        filters.assetClasses.length === 0 ||
        filters.assetClasses.includes(holding.assetClass),
    )
    .map((holding) => ({
      label: holding.instrumentLabel,
      valueMinorUnits: holding.valueMinorUnits,
    }));

  return comparePlannedAllocation(planned, observed);
}

async function loadFilterableActivities(db: PrismaClient): Promise<FilterableActivity[]> {
  const rows = await db.activity.findMany();
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    amountMinorUnits: row.amountMinorUnits,
    occurredOn: row.occurredOn,
    trustState: row.trustState,
    instrumentId: row.instrumentId,
  }));
}

/** The earliest date any data covers, used for "since inception". */
async function resolveInceptionDate(db: PrismaClient): Promise<Date | null> {
  const earliestPlan = await db.planRecord.findFirst({
    where: { supersededById: null },
    orderBy: { periodMonth: "asc" },
    select: { periodMonth: true },
  });
  const earliestActivity = await db.activity.findFirst({
    orderBy: { occurredOn: "asc" },
    select: { occurredOn: true },
  });
  const earliestPosition = await db.positionSnapshot.findFirst({
    orderBy: { asOfDate: "asc" },
    select: { asOfDate: true },
  });

  const candidates: Date[] = [];
  if (earliestPlan !== null) candidates.push(new Date(`${earliestPlan.periodMonth}-01T00:00:00Z`));
  if (earliestActivity !== null) candidates.push(earliestActivity.occurredOn);
  if (earliestPosition !== null) candidates.push(earliestPosition.asOfDate);

  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, date) => (date < earliest ? date : earliest));
}

async function listActivityKinds(db: PrismaClient): Promise<string[]> {
  const rows = await db.activity.findMany({ distinct: ["kind"], select: { kind: true } });
  return rows.map((row) => row.kind).sort();
}

async function listAssetClasses(db: PrismaClient): Promise<string[]> {
  const rows = await db.instrument.findMany({ distinct: ["kind"], select: { kind: true } });
  return rows
    .map((row) => row.kind)
    .filter((kind) => kind !== "cash")
    .sort();
}
