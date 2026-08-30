import { describe, expect, it } from "vitest";
import { expectOk } from "../../src/domain";
import {
  entryValueString,
  parseCount,
  parseEntryValue,
  parsePercentAsBps,
  parseRupees,
} from "../../src/presentation/parse";

describe("input parsing", () => {
  it("turns rupees into integer paise", () => {
    expect(expectOk(parseRupees("12500"))).toBe(12_500_00);
    expect(expectOk(parseRupees("12500.75"))).toBe(12_500_75);
  });

  it("accepts what a copy-paste brings along", () => {
    expect(expectOk(parseRupees("₹ 1,25,000.50"))).toBe(1_25_000_50);
  });

  it("refuses more precision than the currency has, rather than rounding it away", () => {
    // Silently turning ₹100.005 into ₹100.00 would change a figure the user
    // typed without telling them.
    expect(parseRupees("100.005").kind).toBe("insufficient-data");
  });

  it("rejects text that is not a number", () => {
    expect(parseRupees("about twelve thousand").kind).toBe("insufficient-data");
    expect(parseRupees("").kind).toBe("insufficient-data");
  });

  it("requires a whole number for a count of months", () => {
    expect(parseCount("18.5").kind).toBe("insufficient-data");
    expect(expectOk(parseCount("18"))).toBe(18);
  });

  it("converts a percentage share to basis points", () => {
    expect(expectOk(parsePercentAsBps("62.5"))).toBe(6250);
    expect(expectOk(parsePercentAsBps("100"))).toBe(10_000);
  });

  it("round-trips a value through the entry box unchanged", () => {
    for (const [minorUnits, unit] of [
      [12_500_75, "money"],
      [6250, "bps"],
    ] as const) {
      expect(expectOk(parseEntryValue(entryValueString(minorUnits, unit), unit))).toBe(
        minorUnits,
      );
    }
  });
});
