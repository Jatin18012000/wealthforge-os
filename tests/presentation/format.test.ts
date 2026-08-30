import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatMoneyExact,
  formatMoneySigned,
  formatPeriodMonth,
  formatPriceAge,
  formatQuantity,
  formatRatio,
  formatRatioSigned,
  formatTrustState,
} from "../../src/presentation/format";

describe("money formatting", () => {
  it("uses Indian digit grouping", () => {
    // Lakh grouping, not thousands: 22,59,894 rather than 2,259,894.
    expect(formatMoney(2_259_894_00)).toContain("22,59,894");
    expect(formatMoney(100_000_00)).toContain("1,00,000");
  });

  it("rounds to whole rupees once, at display time", () => {
    expect(formatMoney(12_345_67)).toContain("12,346");
    expect(formatMoney(12_345_49)).toContain("12,345");
  });

  it("keeps paise when the exact amount matters", () => {
    expect(formatMoneyExact(1_623_289)).toContain("16,232.89");
  });

  it("marks direction on signed amounts", () => {
    expect(formatMoneySigned(500_00).startsWith("+")).toBe(true);
    expect(formatMoneySigned(-500_00).startsWith("−")).toBe(true);
    expect(formatMoneySigned(0).startsWith("+")).toBe(false);
  });

  it("formats a genuine zero as zero, not as absent", () => {
    expect(formatMoney(0)).toContain("0");
  });
});

describe("ratio formatting", () => {
  it("renders a ratio as a percentage", () => {
    expect(formatRatio(0.375)).toBe("37.5%");
    expect(formatRatio(1)).toBe("100.0%");
  });

  it("marks direction on signed ratios", () => {
    expect(formatRatioSigned(0.166)).toBe("+16.6%");
    expect(formatRatioSigned(-0.181)).toBe("−18.1%");
  });
});

describe("quantity formatting", () => {
  it("keeps fractional units, which mutual funds have", () => {
    expect(formatQuantity(1250.456)).toContain("1,250.456");
  });

  it("does not render a quantity as currency", () => {
    expect(formatQuantity(115)).not.toContain("₹");
  });
});

describe("freshness wording", () => {
  it("never claims a price is live", () => {
    // The app reads dated closing prices; implying otherwise is the
    // misrepresentation docs/18_FAILURE_MODES.md warns about.
    expect(formatPriceAge(0)).toBe("same day");
    expect(formatPriceAge(0)).not.toContain("live");
    expect(formatPriceAge(1)).toBe("1 day old");
    expect(formatPriceAge(12)).toBe("12 days old");
  });
});

describe("period and trust labels", () => {
  it("renders a period as a readable month", () => {
    expect(formatPeriodMonth("2026-08")).toBe("August 2026");
    expect(formatPeriodMonth("2026-05")).toBe("May 2026");
  });

  it("passes through an unparseable period rather than inventing one", () => {
    expect(formatPeriodMonth("not-a-period")).toBe("not-a-period");
  });

  it("labels trust states in plain words", () => {
    expect(formatTrustState("needs_review")).toBe("Needs review");
    expect(formatTrustState("superseded")).toBe("Superseded");
  });
});
