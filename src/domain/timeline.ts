/**
 * Unified Wealth Timeline (v1.1.1 F6).
 *
 * A chronological, cross-entity view of what has already been recorded —
 * never a new calculation. Every entry here is a direct restatement of one
 * existing row (a plan line, a confirmed activity, or an observed position),
 * carrying its own trust state forward rather than inventing a combined one.
 * The three buckets mirror the distinction the rest of this codebase already
 * draws everywhere else:
 *
 * - PLAN: a `PlanRecord` — what a budget workbook stated for a month. Only a
 *   month is known, never a day, so a plan entry's `date` is null and its
 *   `periodMonth` carries the real granularity instead of a fabricated day.
 * - CONFIRMED ACTIVITY: an `Activity` — a transaction that actually
 *   happened on a specific date (buy/sell/SIP/goal contribution or
 *   withdrawal/EMI payment/one-off income or expense).
 * - OBSERVED: a `PositionSnapshot` — a holding as reported at a date, not a
 *   transaction (the snapshot-vs-activity distinction from
 *   `docs/07_FINANCIAL_CALCULATIONS.md` applies here exactly as it does
 *   everywhere else in this codebase).
 */

export type TimelineBucket = "plan" | "confirmed_activity" | "observed";

export interface TimelineEntry {
  readonly id: string;
  readonly bucket: TimelineBucket;
  /** Always set — the instant used to sort this entry into the timeline. */
  readonly sortDate: Date;
  /** Set only for entries with day-level precision (activity, snapshot). */
  readonly date: Date | null;
  /** Set only for entries with month-level precision (plan records). */
  readonly periodMonth: string | null;
  readonly label: string;
  readonly amountMinorUnits: number | null;
  readonly trustState: string;
}

export interface PlanRecordTimelineInput {
  readonly id: string;
  readonly periodMonth: string; // "YYYY-MM"
  readonly category: string; // income | expense | investment | emi
  readonly labelNormalized: string;
  readonly amountMinorUnits: number | null;
  readonly trustState: string;
}

export interface ActivityTimelineInput {
  readonly id: string;
  readonly kind: string; // buy | sell | sip | goal_contribution | goal_withdrawal | emi_payment | one_time_income | one_time_expense
  readonly occurredOn: Date;
  readonly amountMinorUnits: number;
  /** The instrument/goal/liability name this activity concerns, resolved by the caller. */
  readonly subjectLabel: string;
  readonly trustState: string;
}

export interface PositionSnapshotTimelineInput {
  readonly id: string;
  readonly asOfDate: Date;
  readonly instrumentLabel: string;
  readonly quantity: number;
  readonly unit: string;
  readonly trustState: string;
}

const PLAN_CATEGORY_LABELS: Record<string, string> = {
  income: "Planned income",
  expense: "Planned expense",
  investment: "Planned investment",
  emi: "Planned EMI",
};

const ACTIVITY_KIND_LABELS: Record<string, string> = {
  buy: "Bought",
  sell: "Sold",
  sip: "SIP",
  goal_contribution: "Goal contribution",
  goal_withdrawal: "Goal withdrawal",
  emi_payment: "EMI payment",
  one_time_income: "One-time income",
  one_time_expense: "One-time expense",
};

/** First of the month — an anchor for ordering, not a claim about a specific day. */
function monthStart(periodMonth: string): Date {
  return new Date(`${periodMonth}-01T00:00:00Z`);
}

export function planRecordToTimelineEntry(row: PlanRecordTimelineInput): TimelineEntry {
  return {
    id: `plan:${row.id}`,
    bucket: "plan",
    sortDate: monthStart(row.periodMonth),
    date: null,
    periodMonth: row.periodMonth,
    label: `${PLAN_CATEGORY_LABELS[row.category] ?? row.category}: ${row.labelNormalized}`,
    amountMinorUnits: row.amountMinorUnits,
    trustState: row.trustState,
  };
}

export function activityToTimelineEntry(row: ActivityTimelineInput): TimelineEntry {
  const kindLabel = ACTIVITY_KIND_LABELS[row.kind] ?? row.kind;
  return {
    id: `activity:${row.id}`,
    bucket: "confirmed_activity",
    sortDate: row.occurredOn,
    date: row.occurredOn,
    periodMonth: null,
    label: `${kindLabel} — ${row.subjectLabel}`,
    amountMinorUnits: row.amountMinorUnits,
    trustState: row.trustState,
  };
}

export function positionSnapshotToTimelineEntry(
  row: PositionSnapshotTimelineInput,
): TimelineEntry {
  return {
    id: `snapshot:${row.id}`,
    bucket: "observed",
    sortDate: row.asOfDate,
    date: row.asOfDate,
    periodMonth: null,
    label: `${row.instrumentLabel} — ${row.quantity} ${row.unit} observed`,
    amountMinorUnits: null,
    trustState: row.trustState,
  };
}

/**
 * Merges the three sources into one chronological feed, most recent first.
 * A tie on `sortDate` breaks by bucket (an activity or observation that
 * actually happened outranks a plan anchored to the same calendar point)
 * and then by id, so ordering is deterministic across runs rather than
 * depending on each source array's own incoming order.
 */
export function buildWealthTimeline(entries: readonly TimelineEntry[]): TimelineEntry[] {
  const bucketRank: Record<TimelineBucket, number> = {
    confirmed_activity: 0,
    observed: 1,
    plan: 2,
  };

  return [...entries].sort((a, b) => {
    const dateDiff = b.sortDate.getTime() - a.sortDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    const bucketDiff = bucketRank[a.bucket] - bucketRank[b.bucket];
    if (bucketDiff !== 0) return bucketDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
