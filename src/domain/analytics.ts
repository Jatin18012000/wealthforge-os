import { activityCategory, summarizeMonth, type ActivityInput, type PlanCategory, type PlanRecordInput } from "./budget";
import { safeRatio, sumMinorUnits } from "./money";
import { monthsInRange, periodMonthOf, rangeContains, type DateRange } from "./periods";
import { insufficient, ok, type Computed } from "./result";
import { isTrusted } from "./trust";

/**
 * Range analytics (docs/11_ANALYTICS_SPEC.md).
 *
 * The governing constraint: different data has different granularity, and
 * pretending otherwise invents figures.
 *
 * - **Budget data is monthly.** A month contributes to a range only when the
 *   range fully contains it. A 15-day window touching August cannot take
 *   "half of August's salary" — that number appears in no source.
 * - **Activity is exactly dated**, so it sums precisely over any range.
 * - **Portfolio and net worth are point-in-time**, compared at the range's
 *   endpoints rather than summed.
 *
 * Every result carries the coverage that produced it, so a total is never
 * silently short.
 */

export interface PeriodCoverage {
  /** Months fully inside the range, which contributed to budget totals. */
  readonly monthsCounted: readonly string[];
  /** Months the range touches but does not contain — deliberately excluded. */
  readonly monthsPartial: readonly string[];
  /** Fully-covered months for which no budget record exists at all. */
  readonly monthsMissing: readonly string[];
  /** True only when every fully-covered month has data and none is partial. */
  readonly isComplete: boolean;
  /** Human-readable caveats, empty when coverage is complete. */
  readonly notes: readonly string[];
}

export interface BudgetTotals {
  readonly incomeMinorUnits: number;
  readonly expenseMinorUnits: number;
  readonly emiMinorUnits: number;
  readonly investmentMinorUnits: number;
  readonly retainedMinorUnits: number;
  readonly unallocatedMinorUnits: number;
}

export interface PeriodMetrics {
  readonly range: DateRange;
  readonly coverage: PeriodCoverage;
  /** Insufficient when no fully-covered month has budget data. */
  readonly budget: Computed<BudgetTotals>;
  /** Confirmed activity totals by budget category, summed exactly over the range. */
  readonly activityByCategory: Readonly<Record<PlanCategory, number>>;
  readonly activityCount: number;
}

export interface ActivityFilter {
  /** Restrict to these activity kinds. Empty or absent means all kinds. */
  readonly kinds?: readonly string[];
  /** Restrict to these instrument ids. */
  readonly instrumentIds?: readonly string[];
}

export interface FilterableActivity extends ActivityInput {
  readonly instrumentId?: string | null;
}

/**
 * Aggregates everything measurable over a range.
 *
 * `planRecords` should already be the currently-effective records; this
 * function selects by period and trust, it does not resolve revisions.
 */
export function computePeriodMetrics(
  range: DateRange,
  planRecords: readonly PlanRecordInput[],
  activities: readonly FilterableActivity[],
  filter: ActivityFilter = {},
): PeriodMetrics {
  const { fullyCovered, partiallyCovered } = monthsInRange(range);

  const monthsWithData = new Set(
    planRecords.filter((record) => isTrusted(record.trustState)).map((r) => r.periodMonth),
  );
  const monthsMissing = fullyCovered.filter((month) => !monthsWithData.has(month));
  const monthsCounted = fullyCovered.filter((month) => monthsWithData.has(month));

  const notes: string[] = [];
  if (partiallyCovered.length > 0) {
    notes.push(
      `${partiallyCovered.length} month${partiallyCovered.length === 1 ? "" : "s"} (${partiallyCovered.join(", ")}) ${partiallyCovered.length === 1 ? "is" : "are"} only partly inside this range. Budget figures are recorded per whole month, so they are excluded rather than divided up.`,
    );
  }
  if (monthsMissing.length > 0) {
    notes.push(
      `No budget data for ${monthsMissing.join(", ")}. These months are counted as absent, not as zero.`,
    );
  }

  const coverage: PeriodCoverage = {
    monthsCounted,
    monthsPartial: partiallyCovered,
    monthsMissing,
    isComplete: partiallyCovered.length === 0 && monthsMissing.length === 0,
    notes,
  };

  return {
    range,
    coverage,
    budget: sumBudgetAcrossMonths(planRecords, monthsCounted),
    ...summarizeActivity(activities, range, filter),
  };
}

function sumBudgetAcrossMonths(
  planRecords: readonly PlanRecordInput[],
  months: readonly string[],
): Computed<BudgetTotals> {
  if (months.length === 0) {
    return insufficient(
      "no whole month with budget data falls inside this range",
    );
  }

  const totals = {
    incomeMinorUnits: 0,
    expenseMinorUnits: 0,
    emiMinorUnits: 0,
    investmentMinorUnits: 0,
  };

  for (const month of months) {
    const summary = summarizeMonth(planRecords, month);
    // A month with records but none trusted contributes nothing and is
    // already reported through coverage; skipping it here keeps the total
    // honest rather than adding a partial figure.
    if (summary.kind !== "ok") continue;

    totals.incomeMinorUnits += summary.value.incomeMinorUnits;
    totals.expenseMinorUnits += summary.value.expenseMinorUnits;
    totals.emiMinorUnits += summary.value.emiMinorUnits;
    totals.investmentMinorUnits += summary.value.investmentMinorUnits;
  }

  const retainedMinorUnits =
    totals.incomeMinorUnits - totals.expenseMinorUnits - totals.emiMinorUnits;

  return ok({
    ...totals,
    retainedMinorUnits,
    unallocatedMinorUnits: retainedMinorUnits - totals.investmentMinorUnits,
  });
}

function summarizeActivity(
  activities: readonly FilterableActivity[],
  range: DateRange,
  filter: ActivityFilter,
): { activityByCategory: Record<PlanCategory, number>; activityCount: number } {
  const byCategory: Record<PlanCategory, number> = {
    income: 0,
    expense: 0,
    investment: 0,
    emi: 0,
  };
  let activityCount = 0;

  for (const activity of activities) {
    if (!isTrusted(activity.trustState)) continue;
    if (!rangeContains(range, activity.occurredOn)) continue;
    if (!matchesFilter(activity, filter)) continue;

    const category = activityCategory(activity.kind);
    // Goal transfers move money between the household's own buckets and are
    // deliberately uncategorized, so they never inflate a period total.
    if (category === null) continue;

    byCategory[category] += activity.amountMinorUnits;
    activityCount += 1;
  }

  return { activityByCategory: byCategory, activityCount };
}

function matchesFilter(activity: FilterableActivity, filter: ActivityFilter): boolean {
  if (filter.kinds !== undefined && filter.kinds.length > 0) {
    if (!filter.kinds.includes(activity.kind)) return false;
  }
  if (filter.instrumentIds !== undefined && filter.instrumentIds.length > 0) {
    const id = activity.instrumentId;
    if (id === null || id === undefined || !filter.instrumentIds.includes(id)) return false;
  }
  return true;
}

// --- Comparison -----------------------------------------------------------

export interface MetricVariance {
  readonly metric: string;
  readonly currentMinorUnits: number | null;
  readonly priorMinorUnits: number | null;
  readonly absoluteMinorUnits: number | null;
  /** Null when the prior value is zero (undefined) or either side is absent. */
  readonly ratio: number | null;
  /** True when either side lacked the data to compute this metric. */
  readonly incomplete: boolean;
}

export interface PeriodComparison {
  readonly current: PeriodMetrics;
  readonly prior: PeriodMetrics;
  readonly budgetVariances: readonly MetricVariance[];
  readonly activityVariances: readonly MetricVariance[];
  /** Coverage caveats from either side, so a comparison is never silently uneven. */
  readonly coverageNotes: readonly string[];
}

const BUDGET_METRICS: ReadonlyArray<{ key: keyof BudgetTotals; label: string }> = [
  { key: "incomeMinorUnits", label: "Income" },
  { key: "expenseMinorUnits", label: "Expenses" },
  { key: "emiMinorUnits", label: "EMIs" },
  { key: "investmentMinorUnits", label: "Investments" },
  { key: "retainedMinorUnits", label: "Retained" },
  { key: "unallocatedMinorUnits", label: "Left over cash" },
];

const ACTIVITY_METRICS: ReadonlyArray<{ key: PlanCategory; label: string }> = [
  { key: "income", label: "Income received" },
  { key: "expense", label: "Expenses paid" },
  { key: "investment", label: "Invested" },
  { key: "emi", label: "EMI paid" },
];

/**
 * Compares two periods.
 *
 * A metric absent on either side yields nulls and `incomplete: true` rather
 * than being treated as zero — the difference between "spent nothing" and
 * "we have no record" is exactly what a variance table must not blur
 * (docs/11, "Data-coverage warnings").
 */
export function comparePeriods(
  current: PeriodMetrics,
  prior: PeriodMetrics,
): PeriodComparison {
  const budgetVariances = BUDGET_METRICS.map(({ key, label }) =>
    varianceOf(
      label,
      current.budget.kind === "ok" ? current.budget.value[key] : null,
      prior.budget.kind === "ok" ? prior.budget.value[key] : null,
    ),
  );

  const activityVariances = ACTIVITY_METRICS.map(({ key, label }) => {
    // Zero recorded activity is a real observation only when the period had
    // any activity at all; otherwise it is an absence.
    const currentValue = current.activityCount > 0 ? current.activityByCategory[key] : null;
    const priorValue = prior.activityCount > 0 ? prior.activityByCategory[key] : null;
    return varianceOf(label, currentValue, priorValue);
  });

  const coverageNotes = [
    ...current.coverage.notes.map((note) => `Selected period: ${note}`),
    ...prior.coverage.notes.map((note) => `Comparison period: ${note}`),
  ];

  return { current, prior, budgetVariances, activityVariances, coverageNotes };
}

function varianceOf(
  metric: string,
  currentMinorUnits: number | null,
  priorMinorUnits: number | null,
): MetricVariance {
  if (currentMinorUnits === null || priorMinorUnits === null) {
    return {
      metric,
      currentMinorUnits,
      priorMinorUnits,
      absoluteMinorUnits: null,
      ratio: null,
      incomplete: true,
    };
  }

  const absoluteMinorUnits = currentMinorUnits - priorMinorUnits;
  return {
    metric,
    currentMinorUnits,
    priorMinorUnits,
    absoluteMinorUnits,
    // Undefined against a zero base — an infinite percentage change is not a
    // useful thing to show.
    ratio: safeRatio(absoluteMinorUnits, priorMinorUnits),
    incomplete: false,
  };
}

// --- Planned vs observed allocation ---------------------------------------

export interface AllocationComparisonRow {
  readonly label: string;
  readonly plannedMinorUnits: number | null;
  readonly observedMinorUnits: number | null;
  readonly plannedRatio: number | null;
  readonly observedRatio: number | null;
}

/**
 * Compares intended investment allocation against what is actually held.
 *
 * Both sides are reported as absolute amounts and as shares, and a line
 * present on only one side keeps a null on the other rather than a zero:
 * planning to buy something you do not yet hold, and holding something you
 * never planned, are different situations and should not look identical.
 */
export function comparePlannedAllocation(
  planned: ReadonlyArray<{ label: string; amountMinorUnits: number }>,
  observed: ReadonlyArray<{ label: string; valueMinorUnits: number }>,
): readonly AllocationComparisonRow[] {
  const plannedTotal = sumMinorUnits(planned.map((line) => line.amountMinorUnits));
  const observedTotal = sumMinorUnits(observed.map((line) => line.valueMinorUnits));

  const labels = new Set([
    ...planned.map((line) => line.label),
    ...observed.map((line) => line.label),
  ]);

  return [...labels]
    .map((label) => {
      const plannedLine = planned.find((line) => line.label === label);
      const observedLine = observed.find((line) => line.label === label);

      return {
        label,
        plannedMinorUnits: plannedLine?.amountMinorUnits ?? null,
        observedMinorUnits: observedLine?.valueMinorUnits ?? null,
        plannedRatio:
          plannedLine === undefined ? null : safeRatio(plannedLine.amountMinorUnits, plannedTotal),
        observedRatio:
          observedLine === undefined ? null : safeRatio(observedLine.valueMinorUnits, observedTotal),
      };
    })
    .sort((a, b) => (b.observedMinorUnits ?? 0) - (a.observedMinorUnits ?? 0));
}

/** Convenience: the period month a range's end falls in. */
export function endingPeriodMonth(range: DateRange): string {
  return periodMonthOf(new Date(range.end.getTime() - 1));
}
