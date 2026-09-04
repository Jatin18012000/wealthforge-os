import { describe, expect, it } from "vitest";
import {
  OVERALL_SAVINGS_RATE_MILESTONE_RATIO,
  computeOverallSavingsRate,
} from "../../src/domain/savingsRate";

describe("computeOverallSavingsRate", () => {
  it("sums investment, emergency fund, and leftover cash contributions over income", () => {
    const result = computeOverallSavingsRate({
      incomeMinorUnits: 100_00,
      netInvestmentContributionMinorUnits: 15_00,
      netEmergencyFundContributionMinorUnits: 5_00,
      leftoverCashMinorUnits: 5_00,
    });
    expect(result).toEqual({ kind: "ok", value: 0.25 });
  });

  it("matches the owner's own worked example (25 of 100 saved)", () => {
    const result = computeOverallSavingsRate({
      incomeMinorUnits: 100,
      netInvestmentContributionMinorUnits: 25,
      netEmergencyFundContributionMinorUnits: 0,
      leftoverCashMinorUnits: 0,
    });
    expect(result).toEqual({ kind: "ok", value: 0.25 });
    expect(OVERALL_SAVINGS_RATE_MILESTONE_RATIO).toBe(0.25);
  });

  it("reports insufficient data when income is zero, rather than dividing by zero", () => {
    const result = computeOverallSavingsRate({
      incomeMinorUnits: 0,
      netInvestmentContributionMinorUnits: 100,
      netEmergencyFundContributionMinorUnits: 0,
      leftoverCashMinorUnits: 0,
    });
    expect(result.kind).toBe("insufficient-data");
  });

  it("reports insufficient data when income is negative", () => {
    const result = computeOverallSavingsRate({
      incomeMinorUnits: -100,
      netInvestmentContributionMinorUnits: 0,
      netEmergencyFundContributionMinorUnits: 0,
      leftoverCashMinorUnits: 0,
    });
    expect(result.kind).toBe("insufficient-data");
  });

  it("allows a negative numerator (net sells exceeding contributions) to report a negative rate", () => {
    const result = computeOverallSavingsRate({
      incomeMinorUnits: 100,
      netInvestmentContributionMinorUnits: -50,
      netEmergencyFundContributionMinorUnits: 0,
      leftoverCashMinorUnits: 0,
    });
    expect(result).toEqual({ kind: "ok", value: -0.5 });
  });
});
