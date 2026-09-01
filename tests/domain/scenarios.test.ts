import { describe, expect, it } from "vitest";
import {
  monthsUntilTarget,
  projectFutureValue,
  simulateDebtPrepayment,
} from "../../src/domain/scenarios";

describe("projectFutureValue", () => {
  it("with zero growth, is exactly opening plus the sum of contributions", () => {
    const result = projectFutureValue({
      openingMinorUnits: 0,
      monthlyContributionMinorUnits: 1_000,
      annualGrowthRatio: 0,
      months: 12,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value).toBe(12_000);
  });

  it("doubles a lump sum over a year at a 100%/year equivalent monthly-compounded rate", () => {
    const result = projectFutureValue({
      openingMinorUnits: 50_000,
      monthlyContributionMinorUnits: 0,
      annualGrowthRatio: 1.0,
      months: 12,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value).toBe(100_000);
  });

  it("refuses a non-positive horizon rather than returning the opening balance", () => {
    const result = projectFutureValue({
      openingMinorUnits: 1_000,
      monthlyContributionMinorUnits: 0,
      annualGrowthRatio: 0.1,
      months: 0,
    });
    expect(result.kind).toBe("insufficient-data");
  });

  it("refuses a growth ratio of -100% or below", () => {
    const result = projectFutureValue({
      openingMinorUnits: 1_000,
      monthlyContributionMinorUnits: 0,
      annualGrowthRatio: -1,
      months: 12,
    });
    expect(result.kind).toBe("insufficient-data");
  });

  it("a higher growth rate always projects a higher future value, all else equal", () => {
    const lower = projectFutureValue({
      openingMinorUnits: 100_000,
      monthlyContributionMinorUnits: 5_000,
      annualGrowthRatio: 0.05,
      months: 60,
    });
    const higher = projectFutureValue({
      openingMinorUnits: 100_000,
      monthlyContributionMinorUnits: 5_000,
      annualGrowthRatio: 0.15,
      months: 60,
    });
    expect(lower.kind).toBe("ok");
    expect(higher.kind).toBe("ok");
    if (lower.kind === "ok" && higher.kind === "ok") {
      expect(higher.value).toBeGreaterThan(lower.value);
    }
  });
});

describe("monthsUntilTarget", () => {
  it("returns 0 when the opening balance already meets the target", () => {
    const result = monthsUntilTarget(100_000, 1_000, 0.1, 50_000);
    expect(result).toEqual({ kind: "ok", value: 0 });
  });

  it("finds a finite number of months for a reachable target", () => {
    const result = monthsUntilTarget(0, 10_000, 0.1, 500_000, 600);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value).toBeGreaterThan(0);
      expect(result.value).toBeLessThan(600);
    }
  });

  it("reports insufficient data rather than searching forever when the target is never reached", () => {
    const result = monthsUntilTarget(0, 0, 0, 100_000, 24);
    expect(result.kind).toBe("insufficient-data");
  });

  it("refuses a non-positive target", () => {
    const result = monthsUntilTarget(1_000, 100, 0.1, 0);
    expect(result.kind).toBe("insufficient-data");
  });
});

describe("simulateDebtPrepayment", () => {
  it("amortizes to exactly zero in the number of months the standard EMI formula implies", () => {
    const principal = 120_000;
    const annualRateBps = 1_200; // 12%/year -> 1%/month exactly
    const monthlyRate = 0.01;
    const n = 12;
    // Standard EMI formula, computed independently of the function under test.
    const growth = Math.pow(1 + monthlyRate, n);
    const emi = Math.round((principal * monthlyRate * growth) / (growth - 1));

    const result = simulateDebtPrepayment(principal, annualRateBps, emi);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.monthsToPayoff).toBe(12);
      expect(result.value.totalInterestMinorUnits).toBeGreaterThan(0);
    }
  });

  it("prepaying more than the EMI shortens the payoff and reduces total interest", () => {
    const principal = 120_000;
    const annualRateBps = 1_200;
    const baseline = simulateDebtPrepayment(principal, annualRateBps, 10_600);
    const withExtra = simulateDebtPrepayment(principal, annualRateBps, 12_000);
    expect(baseline.kind).toBe("ok");
    expect(withExtra.kind).toBe("ok");
    if (baseline.kind === "ok" && withExtra.kind === "ok") {
      expect(withExtra.value.monthsToPayoff).toBeLessThan(baseline.value.monthsToPayoff);
      expect(withExtra.value.totalInterestMinorUnits).toBeLessThan(baseline.value.totalInterestMinorUnits);
    }
  });

  it("refuses a payment that does not cover the first month's interest, rather than looping forever", () => {
    const result = simulateDebtPrepayment(1_000_000, 1_200, 5_000); // 1%/month interest on 1,000,000 = 10,000 > 5,000
    expect(result.kind).toBe("insufficient-data");
  });

  it("refuses a non-positive outstanding balance", () => {
    const result = simulateDebtPrepayment(0, 1_200, 10_000);
    expect(result.kind).toBe("insufficient-data");
  });
});
