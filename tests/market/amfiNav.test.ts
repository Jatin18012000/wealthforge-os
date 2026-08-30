import { describe, expect, it } from "vitest";
import { expectOk, insufficient, ok } from "../../src/domain";
import {
  fetchAmfiNav,
  indexAmfiNavByIsin,
  parseAmfiNavText,
} from "../../src/market/providers/amfiNav";
import type { Fetcher } from "../../src/market/types";

/**
 * A trimmed but structurally real sample of AMFI's NAVAll.txt shape:
 * category headers, blank lines, and data rows interleaved — recorded as
 * a fixture rather than fetched live (docs/14_TESTING_STRATEGY.md).
 */
const SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Debt Scheme - Overnight Fund)

100001;INF001A01234;INF001A01242;Sample Overnight Fund - Growth;1234.5678;29-Aug-2026
100002;-;INF001A01259;Sample Overnight Fund - IDCW;1050.1234;29-Aug-2026

Open Ended Schemes(Equity Scheme - Large Cap Fund)

100010;INF002B05678;-;Sample Flexi Cap Fund - Direct Growth;456.789;29-Aug-2026
`;

describe("AMFI NAV parsing", () => {
  it("extracts data rows and skips category headers and blank lines", () => {
    const rows = parseAmfiNavText(SAMPLE);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.schemeCode)).toEqual(["100001", "100002", "100010"]);
  });

  it("converts the NAV to integer paise using banker's rounding", () => {
    const rows = parseAmfiNavText(SAMPLE);
    expect(rows[0]?.navMinorUnits).toBe(123457); // 1234.5678 -> 1234.57 -> 123457 paise
  });

  it("parses the DD-Mon-YYYY date correctly", () => {
    const rows = parseAmfiNavText(SAMPLE);
    expect(rows[0]?.asOfDate.toISOString().slice(0, 10)).toBe("2026-08-29");
  });

  it("treats a dash as no ISIN rather than a literal identifier", () => {
    const rows = parseAmfiNavText(SAMPLE);
    expect(rows[1]?.isinGrowth).toBeNull();
    expect(rows[2]?.isinDivReinvestment).toBeNull();
  });

  it("ignores a row with an unparseable date rather than crashing", () => {
    const withBadDate = SAMPLE.replace("29-Aug-2026", "not-a-date");
    const rows = parseAmfiNavText(withBadDate);
    expect(rows.length).toBeLessThan(3);
  });

  it("ignores a row with a non-numeric or non-positive NAV", () => {
    const withZero = "100099;INF999;-;Zero Fund;0;29-Aug-2026\n";
    expect(parseAmfiNavText(withZero)).toHaveLength(0);
  });

  it("indexes rows by both the growth and dividend-reinvestment ISIN", () => {
    const rows = parseAmfiNavText(SAMPLE);
    const byIsin = indexAmfiNavByIsin(rows);
    expect(byIsin.get("INF001A01234")?.schemeCode).toBe("100001");
    expect(byIsin.get("INF001A01259")?.schemeCode).toBe("100002");
  });

  describe("fetchAmfiNav", () => {
    const okFetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () => SAMPLE,
    });

    it("returns parsed rows on a successful fetch", async () => {
      const result = await fetchAmfiNav(okFetcher);
      expect(expectOk(result)).toHaveLength(3);
    });

    it("reports insufficient-data on a network failure rather than throwing", async () => {
      const failingFetcher: Fetcher = async () => {
        throw new Error("ECONNREFUSED");
      };
      const result = await fetchAmfiNav(failingFetcher);
      expect(result.kind).toBe("insufficient-data");
    });

    it("reports insufficient-data on a non-200 response", async () => {
      const notFoundFetcher: Fetcher = async () => ({
        ok: false,
        status: 404,
        text: async () => "",
      });
      const result = await fetchAmfiNav(notFoundFetcher);
      expect(result.kind).toBe("insufficient-data");
    });

    it("reports insufficient-data when the response has no parseable rows", async () => {
      const emptyFetcher: Fetcher = async () => ({
        ok: true,
        status: 200,
        text: async () => "not the expected format at all",
      });
      const result = await fetchAmfiNav(emptyFetcher);
      expect(result.kind).toBe("insufficient-data");
    });
  });
});

// Sanity check that domain helpers imported above behave as expected in
// this file's own usage (guards against an accidental re-export drift).
describe("domain re-exports used here", () => {
  it("ok/insufficient/expectOk round-trip", () => {
    expect(expectOk(ok(5))).toBe(5);
    expect(insufficient("x").kind).toBe("insufficient-data");
  });
});
