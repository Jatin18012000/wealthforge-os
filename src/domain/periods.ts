import { addMonthsClamped } from "./dates";
import { insufficient, ok, type Computed } from "./result";

/**
 * Period resolution for the universal time-range selector
 * (docs/11_ANALYTICS_SPEC.md).
 *
 * Every period is resolved to an explicit half-open range [start, end) so
 * that a day never lands in two adjacent periods at once — a transaction on
 * 1 August belongs to August, not to both July and August.
 */

export type PeriodKey =
  | "15d"
  | "30d"
  | "1m"
  | "3m"
  | "6m"
  | "9m"
  | "12m"
  | "1y"
  | "2y"
  | "3y"
  | "4y"
  | "5y"
  | "ytd"
  | "fy"
  | "previous-month"
  | "previous-quarter"
  | "previous-fy"
  | "since-inception"
  | "custom";

export interface DateRange {
  /** Inclusive. */
  readonly start: Date;
  /** Exclusive — see the half-open note above. */
  readonly end: Date;
}

export interface PeriodOption {
  readonly key: PeriodKey;
  readonly label: string;
  readonly group: "rolling" | "calendar" | "other";
}

/** Every period the selector offers, in display order. */
export const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { key: "15d", label: "15 days", group: "rolling" },
  { key: "30d", label: "30 days", group: "rolling" },
  { key: "1m", label: "1 month", group: "rolling" },
  { key: "3m", label: "3 months", group: "rolling" },
  { key: "6m", label: "6 months", group: "rolling" },
  { key: "9m", label: "9 months", group: "rolling" },
  { key: "12m", label: "12 months", group: "rolling" },
  { key: "1y", label: "1 year", group: "rolling" },
  { key: "2y", label: "2 years", group: "rolling" },
  { key: "3y", label: "3 years", group: "rolling" },
  { key: "4y", label: "4 years", group: "rolling" },
  { key: "5y", label: "5 years", group: "rolling" },
  { key: "ytd", label: "Year to date", group: "calendar" },
  { key: "fy", label: "Financial year", group: "calendar" },
  { key: "previous-month", label: "Previous month", group: "calendar" },
  { key: "previous-quarter", label: "Previous quarter", group: "calendar" },
  { key: "previous-fy", label: "Previous financial year", group: "calendar" },
  { key: "since-inception", label: "Since inception", group: "other" },
  { key: "custom", label: "Custom", group: "other" },
];

export function isPeriodKey(value: string): value is PeriodKey {
  return PERIOD_OPTIONS.some((option) => option.key === value);
}

export function periodLabel(key: PeriodKey): string {
  return PERIOD_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

const MS_PER_DAY = 86_400_000;

/** The Indian financial year runs 1 April to 31 March. */
const FY_START_MONTH = 3; // April, zero-indexed

export interface ResolveOptions {
  /** The "now" the period is measured against. */
  readonly anchor: Date;
  /** Required for `custom`. */
  readonly custom?: DateRange;
  /** Earliest date the data covers. Required for `since-inception`. */
  readonly inceptionDate?: Date | null;
}

/**
 * Resolves a period key to a concrete range.
 *
 * Returns insufficient-data rather than guessing when a period cannot be
 * resolved — `since-inception` with no data has no start, and `custom`
 * without dates has neither.
 */
export function resolvePeriod(
  key: PeriodKey,
  options: ResolveOptions,
): Computed<DateRange> {
  const { anchor } = options;

  switch (key) {
    case "15d":
      return ok({ start: shiftDays(anchor, -15), end: anchor });
    case "30d":
      return ok({ start: shiftDays(anchor, -30), end: anchor });
    case "1m":
      return ok({ start: addMonthsClamped(anchor, -1), end: anchor });
    case "3m":
      return ok({ start: addMonthsClamped(anchor, -3), end: anchor });
    case "6m":
      return ok({ start: addMonthsClamped(anchor, -6), end: anchor });
    case "9m":
      return ok({ start: addMonthsClamped(anchor, -9), end: anchor });
    case "12m":
      return ok({ start: addMonthsClamped(anchor, -12), end: anchor });
    case "1y":
      return ok({ start: addMonthsClamped(anchor, -12), end: anchor });
    case "2y":
      return ok({ start: addMonthsClamped(anchor, -24), end: anchor });
    case "3y":
      return ok({ start: addMonthsClamped(anchor, -36), end: anchor });
    case "4y":
      return ok({ start: addMonthsClamped(anchor, -48), end: anchor });
    case "5y":
      return ok({ start: addMonthsClamped(anchor, -60), end: anchor });

    case "ytd":
      return ok({
        start: new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1)),
        end: anchor,
      });

    case "fy":
      return ok({ start: financialYearStart(anchor), end: anchor });

    case "previous-month": {
      const firstOfThisMonth = new Date(
        Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1),
      );
      return ok({
        start: addMonthsClamped(firstOfThisMonth, -1),
        end: firstOfThisMonth,
      });
    }

    case "previous-quarter": {
      const quarterStartMonth = Math.floor(anchor.getUTCMonth() / 3) * 3;
      const thisQuarterStart = new Date(
        Date.UTC(anchor.getUTCFullYear(), quarterStartMonth, 1),
      );
      return ok({
        start: addMonthsClamped(thisQuarterStart, -3),
        end: thisQuarterStart,
      });
    }

    case "previous-fy": {
      const thisFyStart = financialYearStart(anchor);
      return ok({ start: addMonthsClamped(thisFyStart, -12), end: thisFyStart });
    }

    case "since-inception": {
      const inception = options.inceptionDate;
      if (inception === null || inception === undefined) {
        return insufficient(
          "no data has been recorded yet, so there is no inception date to measure from",
        );
      }
      return ok({ start: inception, end: anchor });
    }

    case "custom": {
      const custom = options.custom;
      if (custom === undefined) {
        return insufficient("a custom period needs an explicit start and end date");
      }
      if (custom.end.getTime() <= custom.start.getTime()) {
        return insufficient("the custom period's end date must be after its start date");
      }
      return ok(custom);
    }
  }
}

/** 1 April of the financial year containing `date`. */
export function financialYearStart(date: Date): Date {
  const year =
    date.getUTCMonth() >= FY_START_MONTH
      ? date.getUTCFullYear()
      : date.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, FY_START_MONTH, 1));
}

/** "FY 2026–27" for the financial year containing `date`. */
export function financialYearLabel(date: Date): string {
  const start = financialYearStart(date).getUTCFullYear();
  return `FY ${start}–${String((start + 1) % 100).padStart(2, "0")}`;
}

/** True when a range starts and ends exactly on month boundaries. */
export function isMonthAligned(range: DateRange): boolean {
  return isFirstOfMonthUtc(range.start) && isFirstOfMonthUtc(range.end);
}

function isFirstOfMonthUtc(date: Date): boolean {
  return (
    date.getUTCDate() === 1 &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * The comparable period immediately before this one — the default
 * comparison target ("compare selected period with appropriate preceding
 * period", docs/11).
 *
 * Month-aligned ranges shift back by whole calendar months, because that is
 * what the comparison means: the month before July is June, even though
 * subtracting July's 31 days would land on 31 May. Ranges that are not
 * month-aligned (a 15-day window, an arbitrary custom range) shift back by
 * their exact duration, which is the only well-defined answer for them.
 */
export function precedingRange(range: DateRange): DateRange {
  if (isMonthAligned(range)) {
    const months = monthsBetween(range.start, range.end);
    return {
      start: addMonthsClamped(range.start, -months),
      end: range.start,
    };
  }

  const durationMs = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - durationMs),
    end: range.start,
  };
}

/** Whole months from `start` to `end`, both assumed month-aligned. */
function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth())
  );
}

/** The same span one calendar year earlier. */
export function sameRangePriorYear(range: DateRange): DateRange {
  return {
    start: addMonthsClamped(range.start, -12),
    end: addMonthsClamped(range.end, -12),
  };
}

export function rangeContains(range: DateRange, date: Date): boolean {
  const time = date.getTime();
  return time >= range.start.getTime() && time < range.end.getTime();
}

export function rangeDurationDays(range: DateRange): number {
  return Math.round((range.end.getTime() - range.start.getTime()) / MS_PER_DAY);
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** "YYYY-MM" for a date. */
export function periodMonthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface MonthCoverage {
  /** Months whose entire calendar span sits inside the range. */
  readonly fullyCovered: readonly string[];
  /**
   * Months the range touches but does not fully contain.
   *
   * Budget data is monthly-granular, so these cannot contribute to a range
   * total without pro-rating — which would invent figures the source never
   * stated. They are reported instead.
   */
  readonly partiallyCovered: readonly string[];
}

/**
 * Splits the calendar months a range touches into fully and partially
 * covered.
 *
 * This distinction is the heart of honest range analytics: a 15-day window
 * touches a month without containing it, and a salary cannot be
 * meaningfully halved to fit.
 */
export function monthsInRange(range: DateRange): MonthCoverage {
  const fullyCovered: string[] = [];
  const partiallyCovered: string[] = [];

  let cursor = new Date(
    Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1),
  );

  while (cursor.getTime() < range.end.getTime()) {
    const monthStart = cursor;
    const monthEnd = addMonthsClamped(monthStart, 1);

    const startsInside = monthStart.getTime() >= range.start.getTime();
    const endsInside = monthEnd.getTime() <= range.end.getTime();

    if (startsInside && endsInside) {
      fullyCovered.push(periodMonthOf(monthStart));
    } else {
      partiallyCovered.push(periodMonthOf(monthStart));
    }

    cursor = monthEnd;
  }

  return { fullyCovered, partiallyCovered };
}
