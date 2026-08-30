import { describe, expect, it } from "vitest";
import {
  computeCagr,
  computeProfitAndLoss,
  computeXirr,
  expectOk,
  MIN_ANNUALIZATION_DAYS,
  netPresentValue,
} from "../../src/domain";

describe("CAGR", () => {
  it("annualizes growth over a multi-year period", () => {
    // ₹1,00,000 to ₹1,21,000 over exactly two 365-day years → 10% a year.
    const cagr = expectOk(
      computeCagr({
        beginValueMinorUnits: 10_000_000,
        endValueMinorUnits: 12_100_000,
        beginDate: new Date("2024-08-30T00:00:00Z"),
        endDate: new Date("2026-08-30T00:00:00Z"),
      }),
    );
    expect(cagr).toBeCloseTo(0.1, 3);
  });

  it("refuses to annualize a window shorter than the documented minimum", () => {
    // A 2% move over four days annualizes past 500% — arithmetically true,
    // financially meaningless.
    const result = computeCagr({
      beginValueMinorUnits: 10_000_000,
      endValueMinorUnits: 10_200_000,
      beginDate: new Date("2026-08-26T00:00:00Z"),
      endDate: new Date("2026-08-30T00:00:00Z"),
    });

    expect(result.kind).toBe("insufficient-data");
    if (result.kind === "insufficient-data") {
      expect(result.reasons[0]).toContain(String(MIN_ANNUALIZATION_DAYS));
    }
  });

  it("refuses a non-positive starting value rather than dividing by zero", () => {
    expect(
      computeCagr({
        beginValueMinorUnits: 0,
        endValueMinorUnits: 10_000_000,
        beginDate: new Date("2024-08-30T00:00:00Z"),
        endDate: new Date("2026-08-30T00:00:00Z"),
      }).kind,
    ).toBe("insufficient-data");
  });

  it("refuses an end date that precedes the start date", () => {
    expect(
      computeCagr({
        beginValueMinorUnits: 10_000_000,
        endValueMinorUnits: 12_000_000,
        beginDate: new Date("2026-08-30T00:00:00Z"),
        endDate: new Date("2024-08-30T00:00:00Z"),
      }).kind,
    ).toBe("insufficient-data");
  });

  it("reports a real loss rather than refusing", () => {
    const cagr = expectOk(
      computeCagr({
        beginValueMinorUnits: 10_000_000,
        endValueMinorUnits: 8_100_000,
        beginDate: new Date("2024-08-30T00:00:00Z"),
        endDate: new Date("2026-08-30T00:00:00Z"),
      }),
    );
    expect(cagr).toBeCloseTo(-0.1, 3);
  });
});

describe("XIRR", () => {
  it("solves a simple one-in one-out flow", () => {
    // ₹1,00,000 out, ₹1,10,000 back exactly one year later → ~10%.
    const xirr = expectOk(
      computeXirr([
        { amountMinorUnits: -10_000_000, date: new Date("2025-08-30T00:00:00Z") },
        { amountMinorUnits: 11_000_000, date: new Date("2026-08-30T00:00:00Z") },
      ]),
    );
    expect(xirr).toBeCloseTo(0.1, 4);
  });

  it("solves irregular multi-flow SIP-style contributions", () => {
    const flows = [
      { amountMinorUnits: -1_950_000, date: new Date("2025-01-15T00:00:00Z") },
      { amountMinorUnits: -1_950_000, date: new Date("2025-04-15T00:00:00Z") },
      { amountMinorUnits: -1_950_000, date: new Date("2025-08-15T00:00:00Z") },
      { amountMinorUnits: -1_950_000, date: new Date("2026-01-15T00:00:00Z") },
      { amountMinorUnits: 8_500_000, date: new Date("2026-08-30T00:00:00Z") },
    ];

    const xirr = expectOk(computeXirr(flows));
    // Verify by definition: NPV at the solved rate must be ~zero.
    expect(netPresentValue(flows, xirr, new Date("2025-01-15T00:00:00Z"))).toBeCloseTo(0, 4);
  });

  it("solves a losing investment to a negative rate", () => {
    const xirr = expectOk(
      computeXirr([
        { amountMinorUnits: -10_000_000, date: new Date("2025-08-30T00:00:00Z") },
        { amountMinorUnits: 7_000_000, date: new Date("2026-08-30T00:00:00Z") },
      ]),
    );
    expect(xirr).toBeCloseTo(-0.3, 4);
  });

  it("refuses flows that only move one way", () => {
    const result = computeXirr([
      { amountMinorUnits: -10_000_000, date: new Date("2025-08-30T00:00:00Z") },
      { amountMinorUnits: -10_000_000, date: new Date("2026-08-30T00:00:00Z") },
    ]);

    expect(result.kind).toBe("insufficient-data");
    if (result.kind === "insufficient-data") {
      expect(result.reasons[0]).toContain("negative and a positive");
    }
  });

  it("refuses a single cash flow", () => {
    expect(
      computeXirr([{ amountMinorUnits: -10_000_000, date: new Date("2025-08-30T00:00:00Z") }]).kind,
    ).toBe("insufficient-data");
  });

  it("refuses to annualize flows spanning less than the documented minimum", () => {
    expect(
      computeXirr([
        { amountMinorUnits: -10_000_000, date: new Date("2026-08-01T00:00:00Z") },
        { amountMinorUnits: 10_200_000, date: new Date("2026-08-30T00:00:00Z") },
      ]).kind,
    ).toBe("insufficient-data");
  });

  it("refuses when no rate exists in a plausible range", () => {
    // A near-total loss implying a rate below -99.99%.
    const result = computeXirr([
      { amountMinorUnits: -10_000_000, date: new Date("2025-08-30T00:00:00Z") },
      { amountMinorUnits: 1, date: new Date("2026-08-30T00:00:00Z") },
    ]);
    if (result.kind === "ok") {
      // If it does converge, the answer must still be a real root.
      expect(result.value).toBeLessThan(-0.99);
    } else {
      expect(result.reasons[0]).toContain("plausible range");
    }
  });
});

describe("profit and loss", () => {
  it("computes gain against a known cost basis", () => {
    const pnl = expectOk(computeProfitAndLoss(10_000_000, 12_500_000));
    expect(pnl.absoluteMinorUnits).toBe(2_500_000);
    expect(pnl.ratio).toBeCloseTo(0.25, 10);
  });

  it("refuses when no cost basis was ever recorded", () => {
    // Inferring cost from a later price would manufacture a gain that no
    // transaction supports.
    const result = computeProfitAndLoss(null, 12_500_000);
    expect(result.kind).toBe("insufficient-data");
    if (result.kind === "insufficient-data") {
      expect(result.reasons[0]).toContain("no recorded cost basis");
    }
  });

  it("refuses a zero or negative cost basis", () => {
    expect(computeProfitAndLoss(0, 12_500_000).kind).toBe("insufficient-data");
    expect(computeProfitAndLoss(-100, 12_500_000).kind).toBe("insufficient-data");
  });

  it("reports a loss plainly", () => {
    const pnl = expectOk(computeProfitAndLoss(10_000_000, 8_000_000));
    expect(pnl.absoluteMinorUnits).toBe(-2_000_000);
    expect(pnl.ratio).toBeCloseTo(-0.2, 10);
  });
});
