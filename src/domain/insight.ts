import type { PeriodCoverage } from "./analytics";
import type { Computed } from "./result";
import { isTrusted } from "./trust";

/**
 * Intelligence-layer foundation (v1.1, IM-01, `docs/21_INTELLIGENCE_MASTER_PLAN.md`).
 *
 * This file adds no new calculations. It is the shared contract every
 * intelligence widget's view-model wraps an *existing* domain result in —
 * "historical comparison" is `comparePeriods`/`PeriodComparison`
 * (`analytics.ts`, unchanged), "coverage metadata" is the existing
 * `PeriodCoverage`, reused directly rather than duplicated. What is new
 * here is purely structural: how a widget states what it computed, as of
 * when, over how much of the requested range, from how trustworthy inputs,
 * traceable to which records, and why — not the arithmetic itself.
 */

// --- Severity ---------------------------------------------------------

/**
 * How urgently a widget's finding deserves the viewer's attention.
 * Never derived from a fabricated threshold — a widget that assigns a
 * severity must be able to say which existing domain output it read to
 * decide (e.g. `flagConcentration`'s threshold, a goal's protected flag).
 */
export type InsightSeverity = "info" | "notice" | "caution" | "critical";

// --- Provenance ---------------------------------------------------------

/** The entity kinds a headline figure can trace back to, per docs/08_DATA_TRUST_MODEL.md. */
export type ProvenanceKind =
  | "plan_record"
  | "activity"
  | "position_snapshot"
  | "valuation"
  | "goal"
  | "liability"
  | "insurance_policy"
  | "manual_adjustment"
  | "source_document";

export interface ProvenanceRef {
  readonly kind: ProvenanceKind;
  readonly id: string;
  /** Optional human-readable label for a drill-down link, e.g. "August 2026 · Salary". */
  readonly label?: string;
}

// --- Trust propagation ---------------------------------------------------

/**
 * A widget's aggregate trust reading over every record that contributed to
 * it. `"mixed"` is deliberately distinct from `"validated"` — a total built
 * from some untrusted records is a different claim than one built entirely
 * from trusted ones, even though both currently render (untrusted
 * *contributors* are excluded from the underlying total per
 * `docs/08_DATA_TRUST_MODEL.md`; "mixed" here means the *set of records a
 * widget drew from* included both, e.g. one trusted valuation and one
 * needs_review manual note attached to the same insight).
 */
export type AggregateTrust = "validated" | "verified" | "mixed" | "untrusted";

export function aggregateTrust(trustStates: readonly string[]): AggregateTrust | null {
  if (trustStates.length === 0) return null;
  const trustedCount = trustStates.filter(isTrusted).length;
  if (trustedCount === 0) return "untrusted";
  if (trustedCount < trustStates.length) return "mixed";
  return trustStates.every((state) => state === "verified") ? "verified" : "validated";
}

// --- Metric definitions ---------------------------------------------------

export type MetricUnit = "money" | "ratio" | "count" | "days" | "months";

export interface MetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly unit: MetricUnit;
  readonly description: string;
}

// --- The widget view-model contract ---------------------------------------

/**
 * What every intelligence widget's view-model returns. `result` must
 * always be produced by calling an existing `src/domain/*` function (or a
 * documented, obviously-correct composition of two such calls) — this type
 * carries no arithmetic of its own.
 */
export interface Insight<T> {
  readonly metric: MetricDefinition;
  readonly result: Computed<T>;
  readonly asOf: Date;
  /** Null when the metric has no meaningful range (e.g. a point-in-time balance). */
  readonly coverage: PeriodCoverage | null;
  /** Null when trust does not apply (e.g. a purely structural/scenario value). */
  readonly trust: AggregateTrust | null;
  readonly provenance: readonly ProvenanceRef[];
  /** Human-readable statement of what was computed and from what, e.g. "Sum of trusted expense lines for August 2026". */
  readonly calculationBasis: string;
  readonly severity: InsightSeverity | null;
}

export function buildInsight<T>(params: {
  readonly metric: MetricDefinition;
  readonly result: Computed<T>;
  readonly asOf: Date;
  readonly coverage?: PeriodCoverage | null;
  readonly trustStates?: readonly string[];
  readonly provenance?: readonly ProvenanceRef[];
  readonly calculationBasis: string;
  readonly severity?: InsightSeverity | null;
}): Insight<T> {
  return {
    metric: params.metric,
    result: params.result,
    asOf: params.asOf,
    coverage: params.coverage ?? null,
    trust: params.trustStates !== undefined ? aggregateTrust(params.trustStates) : null,
    provenance: params.provenance ?? [],
    calculationBasis: params.calculationBasis,
    severity: params.severity ?? null,
  };
}

// --- Time-series aggregation ---------------------------------------------

/**
 * One point in a monthly series. `value: null` means no data exists for
 * that month — never fabricated as 0. Callers derive the month list from
 * the existing period infrastructure (`monthsInRange`, `resolvePeriod`),
 * not a new date system.
 */
export interface TimeSeriesPoint<T> {
  readonly periodMonth: string;
  readonly value: T | null;
}

export function buildMonthlySeries<T>(
  months: readonly string[],
  valueForMonth: (periodMonth: string) => T | null,
): readonly TimeSeriesPoint<T>[] {
  return months.map((periodMonth) => ({ periodMonth, value: valueForMonth(periodMonth) }));
}

// --- Driver decomposition (waterfall) --------------------------------------

/**
 * A named category of change between two points, e.g. for a Net Worth
 * Waterfall: opening balance, savings, market appreciation, withdrawals,
 * closing balance. `"contribution"` is new capital moved in (never
 * relabeled as `"appreciation"` — CLAUDE.md's "never label new investment
 * capital as investment profit").
 */
export type DecompositionStepKind =
  | "opening"
  | "contribution"
  | "appreciation"
  | "depreciation"
  | "distribution"
  | "withdrawal"
  | "liability_change"
  | "other"
  | "closing";

export interface DecompositionStep {
  readonly kind: DecompositionStepKind;
  readonly label: string;
  readonly amountMinorUnits: number;
}

export interface Decomposition {
  readonly steps: readonly DecompositionStep[];
  readonly openingMinorUnits: number;
  readonly closingMinorUnits: number;
  /** True only when the steps fully account for the opening-to-closing delta. */
  readonly isComplete: boolean;
  /**
   * The gap between what the steps explain and the real delta, when
   * incomplete. Never distributed across the known steps to force a
   * match — an unexplained remainder is reported as itself, not hidden
   * inside "other".
   */
  readonly unexplainedMinorUnits: number | null;
}

export function buildDecomposition(
  openingMinorUnits: number,
  closingMinorUnits: number,
  steps: readonly DecompositionStep[],
): Decomposition {
  const stepTotal = steps.reduce((sum, step) => sum + step.amountMinorUnits, 0);
  const actualDelta = closingMinorUnits - openingMinorUnits;
  const isComplete = stepTotal === actualDelta;
  return {
    steps,
    openingMinorUnits,
    closingMinorUnits,
    isComplete,
    unexplainedMinorUnits: isComplete ? null : actualDelta - stepTotal,
  };
}

// --- Scenario calculations ---------------------------------------------

/** Named inputs a scenario was run with — always retained alongside its result. */
export type ScenarioAssumptions = Readonly<Record<string, number | string>>;

export const SCENARIO_DISCLAIMER =
  "This is a projection based on the stated assumptions, not a guarantee of future results.";

/**
 * A scenario's output. Never mutates real financial records — a scenario
 * is computed and discarded, or shown, but never written back as if it
 * were observed fact. `conservative`/`optimistic` are omitted (not null)
 * when a scenario has no meaningful variant bands.
 */
export interface ScenarioResult<T> {
  readonly assumptions: ScenarioAssumptions;
  readonly base: T;
  readonly conservative?: T;
  readonly optimistic?: T;
  readonly disclaimer: string;
}

export function buildScenarioResult<T>(
  assumptions: ScenarioAssumptions,
  base: T,
  variants?: { readonly conservative?: T; readonly optimistic?: T },
): ScenarioResult<T> {
  return {
    assumptions,
    base,
    ...(variants?.conservative !== undefined ? { conservative: variants.conservative } : {}),
    ...(variants?.optimistic !== undefined ? { optimistic: variants.optimistic } : {}),
    disclaimer: SCENARIO_DISCLAIMER,
  };
}
