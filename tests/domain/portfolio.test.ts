import { describe, expect, it } from "vitest";
import {
  allocationByAssetClass,
  computeNetWorth,
  concentrationByInstrument,
  expectOk,
  findPriceAsOf,
  flagConcentration,
  valuePortfolio,
  valuePosition,
  type PositionInput,
  type ValuationInput,
} from "../../src/domain";

const AS_OF = new Date("2026-08-31T00:00:00Z");

const position = (overrides: Partial<PositionInput> = {}): PositionInput => ({
  id: "p1",
  instrumentId: "i1",
  instrumentLabel: "Nifty 50 ETF",
  assetClass: "etf",
  quantity: 100,
  asOfDate: new Date("2026-08-30T00:00:00Z"),
  trustState: "validated",
  ...overrides,
});

const valuations: ValuationInput[] = [
  { instrumentId: "i1", asOfDate: new Date("2026-08-01T00:00:00Z"), priceMinorUnits: 20_000 },
  { instrumentId: "i1", asOfDate: new Date("2026-08-28T00:00:00Z"), priceMinorUnits: 25_000 },
  // Dated AFTER the as-of date — must never be used.
  { instrumentId: "i1", asOfDate: new Date("2026-09-15T00:00:00Z"), priceMinorUnits: 99_000 },
];

describe("dated price lookup", () => {
  it("uses the latest price at or before the as-of date", () => {
    const price = findPriceAsOf(valuations, "i1", AS_OF);
    expect(price?.priceMinorUnits).toBe(25_000);
  });

  it("never reaches forward for a price after the as-of date", () => {
    // Valuing 5 August must not borrow the 28 August price.
    const price = findPriceAsOf(valuations, "i1", new Date("2026-08-05T00:00:00Z"));
    expect(price?.priceMinorUnits).toBe(20_000);
  });

  it("returns null when every price postdates the as-of date", () => {
    expect(findPriceAsOf(valuations, "i1", new Date("2026-07-01T00:00:00Z"))).toBeNull();
  });
});

describe("position valuation", () => {
  it("values a position at the dated price and reports the price's age", () => {
    const valued = expectOk(valuePosition(position(), valuations, AS_OF));

    expect(valued.valueMinorUnits).toBe(100 * 25_000);
    expect(valued.priceAsOf).toEqual(new Date("2026-08-28T00:00:00Z"));
    // Freshness must be visible — a 3-day-old price is never implied to be live.
    expect(valued.priceAgeDays).toBe(3);
  });

  it("refuses to value an untrusted position", () => {
    const result = valuePosition(position({ trustState: "needs_review" }), valuations, AS_OF);
    expect(result.kind).toBe("insufficient-data");
  });

  it("returns insufficient-data, never zero, when no price exists", () => {
    const result = valuePosition(position({ instrumentId: "unknown" }), valuations, AS_OF);
    expect(result.kind).toBe("insufficient-data");
    if (result.kind === "insufficient-data") {
      expect(result.reasons[0]).toContain("no price");
    }
  });

  it("refuses a position dated after the as-of date", () => {
    const future = position({ asOfDate: new Date("2026-09-30T00:00:00Z") });
    expect(valuePosition(future, valuations, AS_OF).kind).toBe("insufficient-data");
  });
});

describe("portfolio valuation", () => {
  it("excludes unpriced holdings from the total and names them", () => {
    const positions = [
      position(),
      position({ id: "p2", instrumentId: "i2", instrumentLabel: "Unlisted Co" }),
    ];

    const portfolio = expectOk(valuePortfolio(positions, valuations, AS_OF));

    // The total covers only what could actually be valued...
    expect(portfolio.totalMinorUnits).toBe(100 * 25_000);
    expect(portfolio.positions).toHaveLength(1);
    // ...and the unpriced holding is surfaced, not silently worth zero.
    expect(portfolio.exclusions).toHaveLength(1);
    expect(portfolio.exclusions[0]?.label).toBe("Unlisted Co");
  });

  it("returns insufficient-data when nothing can be valued", () => {
    const result = valuePortfolio([position({ instrumentId: "nope" })], valuations, AS_OF);
    expect(result.kind).toBe("insufficient-data");
  });
});

describe("allocation and concentration", () => {
  const mixed: PositionInput[] = [
    position({ id: "a", instrumentId: "i1", assetClass: "etf" }),
    position({ id: "b", instrumentId: "i2", instrumentLabel: "Gold", assetClass: "gold", quantity: 10 }),
  ];
  const mixedValuations: ValuationInput[] = [
    { instrumentId: "i1", asOfDate: new Date("2026-08-28T00:00:00Z"), priceMinorUnits: 25_000 },
    { instrumentId: "i2", asOfDate: new Date("2026-08-28T00:00:00Z"), priceMinorUnits: 750_000 },
  ];

  it("computes shares that sum to one", () => {
    const portfolio = expectOk(valuePortfolio(mixed, mixedValuations, AS_OF));
    const slices = expectOk(allocationByAssetClass(portfolio));

    const total = slices.reduce((sum, slice) => sum + slice.ratio, 0);
    expect(total).toBeCloseTo(1, 10);
    // Sorted largest first: gold at ₹75,000 outweighs the ETF at ₹25,000.
    expect(slices[0]?.key).toBe("gold");
    expect(slices[0]?.ratio).toBeCloseTo(0.75, 10);
  });

  it("flags only instruments above a caller-supplied threshold", () => {
    const portfolio = expectOk(valuePortfolio(mixed, mixedValuations, AS_OF));
    const slices = expectOk(concentrationByInstrument(portfolio));

    expect(flagConcentration(slices, 0.7).map((s) => s.key)).toEqual(["Gold"]);
    expect(flagConcentration(slices, 0.8)).toHaveLength(0);
  });

  it("refuses to break down a zero-valued portfolio into shares", () => {
    const zeroPositions = [position({ quantity: 0 })];
    const portfolio = expectOk(valuePortfolio(zeroPositions, valuations, AS_OF));
    expect(portfolio.totalMinorUnits).toBe(0);
    // 0/0 per slice is undefined, not "0% each".
    expect(allocationByAssetClass(portfolio).kind).toBe("insufficient-data");
  });
});

describe("net worth", () => {
  it("subtracts trusted liabilities from trusted assets", () => {
    const netWorth = expectOk(
      computeNetWorth(
        [
          { id: "a1", label: "Cash", kind: "cash", valueMinorUnits: 2_700_000, trustState: "validated" },
          { id: "a2", label: "Portfolio", kind: "portfolio", valueMinorUnits: 5_000_000, trustState: "verified" },
        ],
        [
          {
            id: "l1",
            name: "Home Loan",
            outstandingMinorUnits: 237_300_000,
            outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
            trustState: "validated",
          },
        ],
        AS_OF,
      ),
    );

    expect(netWorth.totalAssetsMinorUnits).toBe(7_700_000);
    expect(netWorth.totalLiabilitiesMinorUnits).toBe(237_300_000);
    expect(netWorth.netWorthMinorUnits).toBe(7_700_000 - 237_300_000);
  });

  it("excludes untrusted records and says why", () => {
    const netWorth = expectOk(
      computeNetWorth(
        [
          { id: "a1", label: "Cash", kind: "cash", valueMinorUnits: 2_700_000, trustState: "validated" },
          { id: "a2", label: "Guess", kind: "other", valueMinorUnits: 9_900_000, trustState: "needs_review" },
        ],
        [],
        AS_OF,
      ),
    );

    expect(netWorth.totalAssetsMinorUnits).toBe(2_700_000);
    expect(netWorth.exclusions).toHaveLength(1);
    expect(netWorth.exclusions[0]?.reason).toContain("human review");
  });

  it("excludes a liability balance dated after the as-of date", () => {
    const netWorth = expectOk(
      computeNetWorth(
        [{ id: "a1", label: "Cash", kind: "cash", valueMinorUnits: 100, trustState: "validated" }],
        [
          {
            id: "l1",
            name: "Future Loan",
            outstandingMinorUnits: 500,
            outstandingAsOf: new Date("2026-12-01T00:00:00Z"),
            trustState: "validated",
          },
        ],
        AS_OF,
      ),
    );

    // Carrying a December balance back to August would overstate past debt.
    expect(netWorth.totalLiabilitiesMinorUnits).toBe(0);
    expect(netWorth.exclusions[0]?.reason).toContain("dated after");
  });

  it("returns insufficient-data rather than a fabricated zero net worth", () => {
    const result = computeNetWorth([], [], AS_OF);
    expect(result.kind).toBe("insufficient-data");
  });
});
