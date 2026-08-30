import { describe, expect, it } from "vitest";
import { checkGrounding, extractNumericClaims } from "../../src/ai/grounding";

describe("numeric claim extraction", () => {
  it("extracts a rupee amount", () => {
    expect(extractNumericClaims("Net worth is ₹86,106 today.")).toContain("86106");
  });

  it("extracts a percentage", () => {
    expect(extractNumericClaims("Concentration is 31.8% of the portfolio.")).toContain(
      "31.8%",
    );
  });

  it("extracts a bare number with thousands separators", () => {
    expect(extractNumericClaims("Target is 3,00,000.")).toContain("300000");
  });

  it("extracts a large bare number without separators", () => {
    expect(extractNumericClaims("The fund NAV moved to 456789 basis points.")).toContain(
      "456789",
    );
  });

  it("ignores small ordinary numbers that are not financial figures", () => {
    // "the 1st of 3 goals" should not register any numeric claim at all.
    expect(extractNumericClaims("This is the 1st of 3 goals shown.")).toEqual([]);
  });
});

describe("grounding check", () => {
  const payload = `
Portfolio:
- [FACT] Portfolio is valued at ₹86,106
- [INFERENCE] SILVERETF-E makes up 31.8% of the priced portfolio — concentrated
Goals:
- [FACT] Emergency fund: ₹0 of ₹3,00,000 (0%)
`;

  it("accepts a response that only restates figures from the payload", () => {
    const response =
      "FACT: Your portfolio is worth ₹86,106. INFERENCE: SILVERETF-E is 31.8% of it.";
    const result = checkGrounding(response, payload);
    expect(result.grounded).toBe(true);
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("rejects a response that invents a figure not in the payload", () => {
    const response = "FACT: Your portfolio is worth ₹1,20,000 today.";
    const result = checkGrounding(response, payload);
    expect(result.grounded).toBe(false);
    expect(result.unsupportedClaims).toContain("120000");
  });

  it("rejects a response with a fabricated percentage", () => {
    const response = "INFERENCE: SILVERETF-E is 45% of your portfolio, which is high.";
    const result = checkGrounding(response, payload);
    expect(result.grounded).toBe(false);
    expect(result.unsupportedClaims).toContain("45%");
  });

  it("accepts a response restating the emergency fund target", () => {
    const response = "Your emergency fund target is ₹3,00,000 and you have ₹0 so far.";
    expect(checkGrounding(response, payload).grounded).toBe(true);
  });

  it("accepts a response with no numeric claims at all", () => {
    const response = "Your finances look generally stable this period.";
    expect(checkGrounding(response, payload).grounded).toBe(true);
  });
});
