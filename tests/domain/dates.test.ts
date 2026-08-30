import { describe, expect, it } from "vitest";
import { addMonthsClamped, daysInMonth } from "../../src/domain";

describe("month arithmetic", () => {
  it("clamps to the last day when the target month is shorter", () => {
    // The bug this guards: setUTCMonth would roll 31 Aug + 10 months to 1 July.
    expect(addMonthsClamped(new Date("2026-08-31T00:00:00Z"), 10).toISOString()).toBe(
      "2027-06-30T00:00:00.000Z",
    );
    expect(addMonthsClamped(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("handles February in a leap year", () => {
    expect(addMonthsClamped(new Date("2028-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("leaves a day that exists in the target month alone", () => {
    expect(addMonthsClamped(new Date("2026-08-15T00:00:00Z"), 3).toISOString()).toBe(
      "2026-11-15T00:00:00.000Z",
    );
  });

  it("crosses year boundaries correctly", () => {
    expect(addMonthsClamped(new Date("2026-11-30T00:00:00Z"), 14).toISOString()).toBe(
      "2028-01-30T00:00:00.000Z",
    );
  });

  it("handles a zero and a negative offset", () => {
    expect(addMonthsClamped(new Date("2026-08-31T00:00:00Z"), 0).toISOString()).toBe(
      "2026-08-31T00:00:00.000Z",
    );
    expect(addMonthsClamped(new Date("2026-03-31T00:00:00Z"), -1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("knows month lengths including leap Februaries", () => {
    expect(daysInMonth(2026, 1)).toBe(28); // Feb 2026
    expect(daysInMonth(2028, 1)).toBe(29); // Feb 2028, a leap year
    expect(daysInMonth(2026, 5)).toBe(30); // June
    expect(daysInMonth(2026, 7)).toBe(31); // August
  });
});
