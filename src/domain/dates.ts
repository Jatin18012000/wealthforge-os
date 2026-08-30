/**
 * Calendar arithmetic. Kept in one place because month-boundary handling is
 * a classic source of off-by-one-month financial errors.
 */

/**
 * Adds whole months, clamping the day to the target month's last day.
 *
 * The naive `setUTCMonth(m + n)` overflows: 31 August plus 10 months becomes
 * 1 July rather than 30 June, because 31 June does not exist and JavaScript
 * silently rolls forward. That extra day crosses a month boundary, which is
 * enough to flip a goal projection from "meets the target date" to "misses
 * it" — so the day is clamped instead.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
  const lastDayOfTargetMonth = daysInMonth(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth(),
  );

  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(day, lastDayOfTargetMonth),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Number of days in a given UTC month. `month` is 0-indexed. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
