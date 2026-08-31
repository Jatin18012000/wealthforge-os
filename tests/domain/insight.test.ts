import { describe, expect, it } from "vitest";
import {
  aggregateTrust,
  buildDecomposition,
  buildInsight,
  buildMonthlySeries,
  buildScenarioResult,
  insufficient,
  ok,
  SCENARIO_DISCLAIMER,
  type MetricDefinition,
} from "../../src/domain";

const NET_WORTH_METRIC: MetricDefinition = {
  id: "net_worth",
  label: "Net Worth",
  unit: "money",
  description: "Trusted assets minus trusted liabilities.",
};

describe("aggregateTrust", () => {
  it("returns null for no records — trust does not apply to nothing", () => {
    expect(aggregateTrust([])).toBeNull();
  });

  it("returns untrusted when nothing contributing is trusted", () => {
    expect(aggregateTrust(["extracted", "needs_review"])).toBe("untrusted");
  });

  it("returns mixed when some but not all contributing records are trusted", () => {
    expect(aggregateTrust(["validated", "needs_review"])).toBe("mixed");
  });

  it("returns validated when all trusted records are validated (or a mix of validated/verified)", () => {
    expect(aggregateTrust(["validated", "validated"])).toBe("validated");
    expect(aggregateTrust(["validated", "verified"])).toBe("validated");
  });

  it("returns verified only when every contributing record is verified", () => {
    expect(aggregateTrust(["verified", "verified"])).toBe("verified");
  });
});

describe("buildInsight", () => {
  it("wraps an ok Computed result with full metadata, never computing anything itself", () => {
    const asOf = new Date("2026-08-08T00:00:00Z");
    const insight = buildInsight({
      metric: NET_WORTH_METRIC,
      result: ok(1_50_000_00),
      asOf,
      trustStates: ["validated", "verified"],
      provenance: [{ kind: "valuation", id: "v1", label: "Alpha Ltd" }],
      calculationBasis: "Sum of trusted asset valuations minus trusted liability balances.",
    });

    expect(insight.result).toEqual({ kind: "ok", value: 1_50_000_00 });
    expect(insight.trust).toBe("validated");
    expect(insight.provenance).toHaveLength(1);
    expect(insight.asOf).toBe(asOf);
    expect(insight.severity).toBeNull();
  });

  it("carries an insufficient-data result through unchanged, never substituting a value", () => {
    const insight = buildInsight({
      metric: NET_WORTH_METRIC,
      result: insufficient("no trusted valuation recorded"),
      asOf: new Date("2026-08-08T00:00:00Z"),
      calculationBasis: "Attempted sum of trusted valuations; none found.",
    });

    expect(insight.result.kind).toBe("insufficient-data");
    if (insight.result.kind === "insufficient-data") {
      expect(insight.result.reasons).toEqual(["no trusted valuation recorded"]);
    }
    expect(insight.trust).toBeNull();
    expect(insight.coverage).toBeNull();
  });
});

describe("buildMonthlySeries", () => {
  it("reports null, not zero, for a month with no data", () => {
    const series = buildMonthlySeries(["2026-06", "2026-07", "2026-08"], (month) =>
      month === "2026-07" ? null : 1000,
    );
    expect(series).toEqual([
      { periodMonth: "2026-06", value: 1000 },
      { periodMonth: "2026-07", value: null },
      { periodMonth: "2026-08", value: 1000 },
    ]);
  });
});

describe("buildDecomposition", () => {
  it("marks a waterfall complete when the steps exactly explain the delta", () => {
    const decomposition = buildDecomposition(100_000, 130_000, [
      { kind: "contribution", label: "SIP", amountMinorUnits: 20_000 },
      { kind: "appreciation", label: "Market gain", amountMinorUnits: 10_000 },
    ]);
    expect(decomposition.isComplete).toBe(true);
    expect(decomposition.unexplainedMinorUnits).toBeNull();
  });

  it("reports an unexplained remainder rather than distributing it across known steps", () => {
    const decomposition = buildDecomposition(100_000, 130_000, [
      { kind: "contribution", label: "SIP", amountMinorUnits: 20_000 },
    ]);
    expect(decomposition.isComplete).toBe(false);
    expect(decomposition.unexplainedMinorUnits).toBe(10_000);
  });

  it("never labels new contribution capital as appreciation", () => {
    const decomposition = buildDecomposition(0, 20_000, [
      { kind: "contribution", label: "First SIP", amountMinorUnits: 20_000 },
    ]);
    expect(decomposition.steps[0]?.kind).toBe("contribution");
    expect(decomposition.steps.some((s) => s.kind === "appreciation")).toBe(false);
  });
});

describe("buildScenarioResult", () => {
  it("always carries the disclaimer and retains the input assumptions", () => {
    const result = buildScenarioResult({ monthlyIncreasePct: 10, months: 12 }, 500_000);
    expect(result.disclaimer).toBe(SCENARIO_DISCLAIMER);
    expect(result.assumptions).toEqual({ monthlyIncreasePct: 10, months: 12 });
    expect(result.base).toBe(500_000);
    expect(result.conservative).toBeUndefined();
    expect(result.optimistic).toBeUndefined();
  });

  it("includes variant bands only when explicitly provided", () => {
    const result = buildScenarioResult({ rate: 8 }, 100, {
      conservative: 80,
      optimistic: 130,
    });
    expect(result.conservative).toBe(80);
    expect(result.optimistic).toBe(130);
  });
});
