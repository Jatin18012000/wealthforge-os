import { describe, expect, it } from "vitest";
import {
  classifySheetKind,
  isParseableDate,
  matchMonthSheet,
  normalizeCategory,
  normalizeLabel,
  parseAmountToMinorUnits,
} from "../../src/ingestion";

describe("sheet classification", () => {
  it("resolves bare month names against the supplied default year", () => {
    expect(matchMonthSheet("August", 2026)).toEqual({
      periodMonth: "2026-08",
      yearFromSheetName: false,
    });
    expect(matchMonthSheet("May", 2026)?.periodMonth).toBe("2026-05");
  });

  it("prefers a year carried by the sheet name over the default", () => {
    expect(matchMonthSheet("Aug-26", 2030)).toEqual({
      periodMonth: "2026-08",
      yearFromSheetName: true,
    });
    expect(matchMonthSheet("August 2027", 2026)?.periodMonth).toBe("2027-08");
    expect(matchMonthSheet("2026-08", 2030)?.periodMonth).toBe("2026-08");
  });

  it("rejects a non-month sheet name", () => {
    expect(matchMonthSheet("Core expenses", 2026)).toBeNull();
    expect(matchMonthSheet("Random Notes", 2026)).toBeNull();
    expect(matchMonthSheet("2026-13", 2026)).toBeNull();
  });

  it("classifies month, reference, and unrecognized sheets distinctly", () => {
    expect(classifySheetKind("August", 2026)).toBe("month");
    expect(classifySheetKind("Core expenses", 2026)).toBe("reference");
    // An unknown sheet must never be quietly absorbed as reference data.
    expect(classifySheetKind("Random Notes", 2026)).toBe("unrecognized");
  });
});

describe("amount parsing", () => {
  it("converts rupees to integer paise", () => {
    expect(parseAmountToMinorUnits(8100).minorUnits).toBe(810_000);
    expect(parseAmountToMinorUnits("62,000").minorUnits).toBe(6_200_000);
    expect(parseAmountToMinorUnits("₹1,234.56").minorUnits).toBe(123_456);
  });

  it("absorbs binary-float representation error rather than truncating paise", () => {
    // 8100.35 * 100 is 810034.9999999999 in IEEE-754 doubles.
    expect(parseAmountToMinorUnits(8100.35).minorUnits).toBe(810_035);
  });

  it("never coerces an unparseable cell to zero", () => {
    const tbd = parseAmountToMinorUnits("TBD");
    expect(tbd.minorUnits).toBeNull();
    expect(tbd.issue).toContain("not numeric");

    const empty = parseAmountToMinorUnits(null);
    expect(empty.minorUnits).toBeNull();
    expect(empty.issue).toBe("amount is empty");
  });

  it("distinguishes a genuine zero from a missing value", () => {
    expect(parseAmountToMinorUnits(0).minorUnits).toBe(0);
    expect(parseAmountToMinorUnits("").minorUnits).toBeNull();
  });
});

describe("date validation", () => {
  it("accepts real calendar dates in either D/M or M/D reading", () => {
    expect(isParseableDate("05/08/2026")).toBe(true);
    expect(isParseableDate(new Date("2026-08-05"))).toBe(true);
    expect(isParseableDate("2026-08-05")).toBe(true);
  });

  it("rejects an impossible date instead of rolling it over", () => {
    expect(isParseableDate("32/13/2026")).toBe(false);
    expect(isParseableDate("not a date")).toBe(false);
    expect(isParseableDate("")).toBe(false);
  });
});

describe("label and category normalization", () => {
  it("normalizes labels while the raw text stays available separately", () => {
    expect(normalizeLabel("Salary (take-home)")).toBe("salary take home");
    expect(normalizeLabel("  SIP - Total  ")).toBe("sip total");
  });

  it("maps known category spellings and refuses unknown ones", () => {
    expect(normalizeCategory("Income")).toBe("income");
    expect(normalizeCategory("EMI")).toBe("emi");
    expect(normalizeCategory("Investments")).toBe("investment");
    expect(normalizeCategory("Mystery Column")).toBeNull();
  });
});
