import { describe, expect, it } from "vitest";
import { buildGroundingPayload, explainReport } from "../../src/ai/analyst";
import type { AiProvider } from "../../src/ai/types";
import type { Report } from "../../src/views/reportView";

const SAMPLE_REPORT: Report = {
  generatedAt: new Date("2026-08-30T00:00:00Z"),
  asOf: new Date("2026-08-08T00:00:00Z"),
  periodMonth: "2026-08",
  sections: [
    {
      title: "Portfolio",
      lines: [
        { kind: "fact", text: "Portfolio is valued at ₹86,106" },
        {
          kind: "inference",
          text: "SILVERETF-E makes up 31.8% of the priced portfolio — concentrated",
        },
        {
          kind: "recommendation",
          text: "Review whether the concentration in SILVERETF-E still matches your intended allocation",
        },
      ],
    },
    {
      title: "Goals",
      lines: [{ kind: "fact", text: "Emergency fund: ₹0 of ₹3,00,000 (0%)" }],
    },
  ],
};

function fakeProvider(response: string): AiProvider {
  return { name: "fake", generate: async () => ({ kind: "ok", value: response }) };
}

describe("buildGroundingPayload", () => {
  it("includes every line from every section, labeled by kind", () => {
    const payload = buildGroundingPayload(SAMPLE_REPORT);
    expect(payload).toContain("[FACT] Portfolio is valued at ₹86,106");
    expect(payload).toContain("[INFERENCE] SILVERETF-E makes up 31.8%");
    expect(payload).toContain("[RECOMMENDATION] Review whether");
    expect(payload).toContain("Emergency fund");
  });

  it("carries the as-of date and period", () => {
    expect(buildGroundingPayload(SAMPLE_REPORT)).toContain("2026-08-08");
    expect(buildGroundingPayload(SAMPLE_REPORT)).toContain("2026-08");
  });
});

describe("explainReport", () => {
  it("returns the response when it is fully grounded", async () => {
    const provider = fakeProvider(
      "FACT: Your portfolio is worth ₹86,106. RECOMMENDATION: Consider reviewing the SILVERETF-E concentration.",
    );
    const result = await explainReport(provider, SAMPLE_REPORT);
    expect(result.kind).toBe("ok");
  });

  it("rejects and never shows a response that fabricates a figure", async () => {
    const provider = fakeProvider(
      "FACT: Your portfolio is worth ₹5,00,000 — a great result!",
    );
    const result = await explainReport(provider, SAMPLE_REPORT);
    expect(result.kind).toBe("insufficient-data");
    if (result.kind === "insufficient-data") {
      expect(result.reasons.join()).toContain("500000");
    }
  });

  it("reports AI unavailable when the provider itself fails, without throwing", async () => {
    const failingProvider: AiProvider = {
      name: "fake",
      generate: async () => ({
        kind: "insufficient-data",
        reasons: ["connection refused"],
      }),
    };
    const result = await explainReport(failingProvider, SAMPLE_REPORT);
    expect(result.kind).toBe("insufficient-data");
    if (result.kind === "insufficient-data") {
      expect(result.reasons.join()).toContain("AI unavailable");
    }
  });

  it("names the provider that answered, in a grounded result", async () => {
    const provider = fakeProvider("Your finances look stable this period.");
    const result = await explainReport(provider, SAMPLE_REPORT);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value.providerName).toBe("fake");
  });
});
