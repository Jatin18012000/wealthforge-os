import { describe, expect, it } from "vitest";
import {
  EMERGENCY_FUND_TARGET_MONTHS,
  computeEmergencyFundRunwayMonths,
  computeEmergencyFundTargetMinorUnits,
  validateEmergencyFundTopUp,
} from "../../src/domain/emergencyFund";

describe("computeEmergencyFundTargetMinorUnits", () => {
  it("is 6x the monthly essential spend", () => {
    expect(EMERGENCY_FUND_TARGET_MONTHS).toBe(6);
    expect(computeEmergencyFundTargetMinorUnits(50_000)).toBe(300_000);
  });

  it("rounds a fractional result to the nearest minor unit", () => {
    expect(computeEmergencyFundTargetMinorUnits(33_333)).toBe(Math.round(33_333 * 6));
  });

  it("is zero when essential spend is zero", () => {
    expect(computeEmergencyFundTargetMinorUnits(0)).toBe(0);
  });
});

describe("computeEmergencyFundRunwayMonths", () => {
  it("divides current balance by monthly essential spend", () => {
    const result = computeEmergencyFundRunwayMonths(300_000, 50_000);
    expect(result).toEqual({ kind: "ok", value: 6 });
  });

  it("reports insufficient data when essential spend is zero, rather than dividing by zero", () => {
    const result = computeEmergencyFundRunwayMonths(300_000, 0);
    expect(result.kind).toBe("insufficient-data");
  });

  it("reports insufficient data when essential spend is negative", () => {
    const result = computeEmergencyFundRunwayMonths(300_000, -100);
    expect(result.kind).toBe("insufficient-data");
  });

  it("reports zero months of runway for a zero balance against real spending, not insufficient data", () => {
    const result = computeEmergencyFundRunwayMonths(0, 50_000);
    expect(result).toEqual({ kind: "ok", value: 0 });
  });
});

describe("validateEmergencyFundTopUp", () => {
  it("allows a positive amount", () => {
    expect(validateEmergencyFundTopUp(1_00_000)).toEqual({ allowed: true, reason: null });
  });

  it("rejects zero", () => {
    const result = validateEmergencyFundTopUp(0);
    expect(result.allowed).toBe(false);
  });

  it("rejects a negative amount", () => {
    const result = validateEmergencyFundTopUp(-1);
    expect(result.allowed).toBe(false);
  });

  it("rejects NaN/Infinity rather than accepting them", () => {
    expect(validateEmergencyFundTopUp(Number.NaN).allowed).toBe(false);
    expect(validateEmergencyFundTopUp(Number.POSITIVE_INFINITY).allowed).toBe(false);
  });

  it("has no upper cap — unlike canAllocateToGoal, an arbitrarily large top-up is allowed", () => {
    expect(validateEmergencyFundTopUp(1_000_000_000).allowed).toBe(true);
  });
});
