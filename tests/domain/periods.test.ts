import { describe, expect, it } from "vitest";
import {
  PERIOD_OPTIONS,
  expectOk,
  financialYearLabel,
  financialYearStart,
  isPeriodKey,
  monthsInRange,
  isMonthAligned,
  precedingRange,
  periodLabel,
  rangeContains,
  rangeDurationDays,
  resolvePeriod,
  sameRangePriorYear,
  type PeriodKey,
} from "../../src/domain";

const ANCHOR = new Date("2026-08-31T00:00:00Z");
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe("period resolution", () => {
  it("resolves every offered period without throwing", () => {
    for (const option of PERIOD_OPTIONS) {
      const result = resolvePeriod(option.key, {
        anchor: ANCHOR,
        custom: { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-03-01T00:00:00Z") },
        inceptionDate: new Date("2026-05-01T00:00:00Z"),
      });
      expect(result.kind).toBe("ok");
    }
  });

  it("resolves rolling day windows", () => {
    const range = expectOk(resolvePeriod("15d", { anchor: ANCHOR }));
    expect(iso(range.start)).toBe("2026-08-16");
    expect(rangeDurationDays(range)).toBe(15);
  });

  it("resolves rolling month windows with clamped month arithmetic", () => {
    // 31 August minus 6 months is 28 February, not 3 March.
    const range = expectOk(resolvePeriod("6m", { anchor: ANCHOR }));
    expect(iso(range.start)).toBe("2026-02-28");
  });

  it("treats 1y and 12m as the same span", () => {
    const year = expectOk(resolvePeriod("1y", { anchor: ANCHOR }));
    const months = expectOk(resolvePeriod("12m", { anchor: ANCHOR }));
    expect(iso(year.start)).toBe(iso(months.start));
  });

  it("resolves year-to-date from 1 January", () => {
    const range = expectOk(resolvePeriod("ytd", { anchor: ANCHOR }));
    expect(iso(range.start)).toBe("2026-01-01");
  });

  it("resolves the Indian financial year from 1 April", () => {
    const range = expectOk(resolvePeriod("fy", { anchor: ANCHOR }));
    expect(iso(range.start)).toBe("2026-04-01");

    // A January date belongs to the financial year that began the prior April.
    const january = new Date("2027-01-15T00:00:00Z");
    expect(iso(financialYearStart(january))).toBe("2026-04-01");
    expect(financialYearLabel(january)).toBe("FY 2026–27");
  });

  it("resolves the previous whole calendar month", () => {
    const range = expectOk(resolvePeriod("previous-month", { anchor: ANCHOR }));
    expect(iso(range.start)).toBe("2026-07-01");
    expect(iso(range.end)).toBe("2026-08-01");
  });

  it("resolves the previous whole calendar quarter", () => {
    const range = expectOk(resolvePeriod("previous-quarter", { anchor: ANCHOR }));
    // August sits in Jul–Sep, so the previous quarter is Apr–Jun.
    expect(iso(range.start)).toBe("2026-04-01");
    expect(iso(range.end)).toBe("2026-07-01");
  });

  it("resolves the previous financial year", () => {
    const range = expectOk(resolvePeriod("previous-fy", { anchor: ANCHOR }));
    expect(iso(range.start)).toBe("2025-04-01");
    expect(iso(range.end)).toBe("2026-04-01");
  });

  it("refuses since-inception when nothing has been recorded", () => {
    const result = resolvePeriod("since-inception", { anchor: ANCHOR, inceptionDate: null });
    expect(result.kind).toBe("insufficient-data");
  });

  it("refuses a custom period without dates, or with an inverted range", () => {
    expect(resolvePeriod("custom", { anchor: ANCHOR }).kind).toBe("insufficient-data");
    expect(
      resolvePeriod("custom", {
        anchor: ANCHOR,
        custom: { start: new Date("2026-06-01T00:00:00Z"), end: new Date("2026-05-01T00:00:00Z") },
      }).kind,
    ).toBe("insufficient-data");
  });

  it("labels and validates period keys", () => {
    expect(isPeriodKey("3m")).toBe(true);
    expect(isPeriodKey("nonsense")).toBe(false);
    expect(periodLabel("previous-fy" as PeriodKey)).toBe("Previous financial year");
  });
});

describe("comparison ranges", () => {
  it("shifts a month-aligned range back by whole calendar months", () => {
    const range = expectOk(resolvePeriod("previous-month", { anchor: ANCHOR }));
    const prior = precedingRange(range);

    // The month before July is June. Subtracting July's 31 days would land
    // on 31 May, which is not what "the previous month" means.
    expect(iso(prior.start)).toBe("2026-06-01");
    expect(iso(prior.end)).toBe("2026-07-01");
    // The two windows abut exactly — no gap, no overlap.
    expect(prior.end.getTime()).toBe(range.start.getTime());
  });

  it("shifts a quarter back by three whole months", () => {
    const range = expectOk(resolvePeriod("previous-quarter", { anchor: ANCHOR }));
    const prior = precedingRange(range);
    expect(iso(prior.start)).toBe("2026-01-01");
    expect(iso(prior.end)).toBe("2026-04-01");
  });

  it("shifts a non-month-aligned range back by its exact duration", () => {
    // A 15-day window has no calendar-month meaning, so duration is the only
    // well-defined answer.
    const range = expectOk(resolvePeriod("15d", { anchor: ANCHOR }));
    const prior = precedingRange(range);

    expect(rangeDurationDays(prior)).toBe(15);
    expect(iso(prior.end)).toBe("2026-08-16");
    expect(iso(prior.start)).toBe("2026-08-01");
  });

  it("derives the same span one year earlier", () => {
    const range = expectOk(resolvePeriod("previous-month", { anchor: ANCHOR }));
    const prior = sameRangePriorYear(range);
    expect(iso(prior.start)).toBe("2025-07-01");
    expect(iso(prior.end)).toBe("2025-08-01");
  });
});

describe("month alignment", () => {
  it("recognizes a month-aligned range", () => {
    expect(
      isMonthAligned({
        start: new Date("2026-06-01T00:00:00Z"),
        end: new Date("2026-09-01T00:00:00Z"),
      }),
    ).toBe(true);
    expect(
      isMonthAligned({
        start: new Date("2026-06-15T00:00:00Z"),
        end: new Date("2026-09-01T00:00:00Z"),
      }),
    ).toBe(false);
  });
});

describe("range membership", () => {
  it("is half-open, so a boundary date belongs to exactly one period", () => {
    const july = expectOk(resolvePeriod("previous-month", { anchor: ANCHOR }));

    expect(rangeContains(july, new Date("2026-07-01T00:00:00Z"))).toBe(true);
    // 1 August is the end boundary: it belongs to August, not July.
    expect(rangeContains(july, new Date("2026-08-01T00:00:00Z"))).toBe(false);
    expect(rangeContains(july, new Date("2026-06-30T23:59:59Z"))).toBe(false);
  });
});

describe("month coverage of a range", () => {
  it("counts a whole calendar month as fully covered", () => {
    const range = expectOk(resolvePeriod("previous-month", { anchor: ANCHOR }));
    const coverage = monthsInRange(range);

    expect(coverage.fullyCovered).toEqual(["2026-07"]);
    expect(coverage.partiallyCovered).toEqual([]);
  });

  it("marks a month the range only touches as partial", () => {
    // A 15-day window cannot contain any whole month.
    const range = expectOk(resolvePeriod("15d", { anchor: ANCHOR }));
    const coverage = monthsInRange(range);

    expect(coverage.fullyCovered).toEqual([]);
    expect(coverage.partiallyCovered).toEqual(["2026-08"]);
  });

  it("separates whole months from the partial ones at each end", () => {
    const range = {
      start: new Date("2026-05-15T00:00:00Z"),
      end: new Date("2026-08-10T00:00:00Z"),
    };
    const coverage = monthsInRange(range);

    // June and July are wholly inside; May and August are clipped.
    expect(coverage.fullyCovered).toEqual(["2026-06", "2026-07"]);
    expect(coverage.partiallyCovered).toEqual(["2026-05", "2026-08"]);
  });

  it("covers whole months exactly when the range is month-aligned", () => {
    const range = {
      start: new Date("2026-06-01T00:00:00Z"),
      end: new Date("2026-09-01T00:00:00Z"),
    };
    const coverage = monthsInRange(range);

    expect(coverage.fullyCovered).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(coverage.partiallyCovered).toEqual([]);
  });
});
