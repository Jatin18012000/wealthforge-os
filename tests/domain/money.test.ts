import { describe, expect, it } from "vitest";
import {
  bpsToRatio,
  multiplyMinorUnits,
  roundHalfToEven,
  rupeesToMinorUnits,
  safeRatio,
  sumMinorUnits,
} from "../../src/domain";

describe("money primitives", () => {
  it("rounds halves to even, so ties do not bias in one direction", () => {
    expect(roundHalfToEven(0.5)).toBe(0);
    expect(roundHalfToEven(1.5)).toBe(2);
    expect(roundHalfToEven(2.5)).toBe(2);
    expect(roundHalfToEven(3.5)).toBe(4);
    // -0.5 sits between -1 and 0; the even neighbour is 0.
    expect(roundHalfToEven(-0.5)).toBe(0);
    expect(roundHalfToEven(-1.5)).toBe(-2);
    expect(roundHalfToEven(-2.5)).toBe(-2);
  });

  it("does not mistake float noise for a genuine tie", () => {
    // 0.49999999999999994 is the largest double below 0.5 and rounds up
    // under a naive Math.round.
    expect(roundHalfToEven(0.49999999999999994)).toBe(0);
  });

  it("converts rupees to paise without float drift", () => {
    expect(rupeesToMinorUnits(8100.35)).toBe(810_035);
    expect(rupeesToMinorUnits(0.1 + 0.2)).toBe(30);
    expect(rupeesToMinorUnits(19_500)).toBe(1_950_000);
  });

  it("refuses to sum non-integer minor units rather than silently truncating", () => {
    expect(() => sumMinorUnits([100, 200.5])).toThrow(/safe integers/);
    expect(sumMinorUnits([100, 200, 300])).toBe(600);
    expect(sumMinorUnits([])).toBe(0);
  });

  it("rounds a price-times-quantity product exactly once", () => {
    // 123.456 units at ₹45.67 = ₹5638.23552 → 563823.552 paise → 563824.
    expect(multiplyMinorUnits(4567, 123.456)).toBe(563_824);
  });

  it("returns null rather than Infinity or NaN for a zero denominator", () => {
    expect(safeRatio(100, 0)).toBeNull();
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(50, 200)).toBe(0.25);
  });

  it("converts basis points to ratios", () => {
    expect(bpsToRatio(10_000)).toBe(1);
    expect(bpsToRatio(850)).toBe(0.085);
  });

  it("keeps a long chain of additions exact, unlike float rupees", () => {
    // A year of ₹0.10 additions. In float rupees this drifts; in paise it can't.
    const paise = Array.from({ length: 365 }, () => 10);
    expect(sumMinorUnits(paise)).toBe(3650);
  });
});
