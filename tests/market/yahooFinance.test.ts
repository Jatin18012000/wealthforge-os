import { describe, expect, it } from "vitest";
import { expectOk } from "../../src/domain";
import {
  fetchYahooQuote,
  parseYahooChartResponse,
} from "../../src/market/providers/yahooFinance";
import type { Fetcher } from "../../src/market/types";

/** Recorded/representative shape of a real response, not a live call. */
function sampleResponse(
  overrides: Partial<{ price: number; time: number; currency: string }> = {},
) {
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: overrides.price ?? 24500.35,
            regularMarketTime: overrides.time ?? 1756540200,
            currency: overrides.currency ?? "INR",
          },
        },
      ],
      error: null,
    },
  });
}

describe("Yahoo Finance chart response parsing", () => {
  it("extracts price, date and currency from a well-formed response", () => {
    const quote = expectOk(parseYahooChartResponse(sampleResponse()));
    expect(quote.priceMinorUnits).toBe(2450035);
    expect(quote.currency).toBe("INR");
    expect(quote.asOfDate.getTime()).toBe(1756540200 * 1000);
  });

  it("rounds the price to integer paise using banker's rounding", () => {
    const quote = expectOk(parseYahooChartResponse(sampleResponse({ price: 100.005 })));
    // 100.005 * 100 = 10000.5 -> banker's rounding to even -> 10000
    expect(quote.priceMinorUnits).toBe(10000);
  });

  it("defaults currency to INR when the field is missing", () => {
    const withoutCurrency = JSON.stringify({
      chart: {
        result: [{ meta: { regularMarketPrice: 100, regularMarketTime: 1756540200 } }],
      },
    });
    expect(expectOk(parseYahooChartResponse(withoutCurrency)).currency).toBe("INR");
  });

  it("refuses invalid JSON rather than throwing", () => {
    expect(parseYahooChartResponse("not json").kind).toBe("insufficient-data");
  });

  it("refuses a response carrying an explicit error", () => {
    const errorResponse = JSON.stringify({
      chart: { result: null, error: { code: "Not Found" } },
    });
    expect(parseYahooChartResponse(errorResponse).kind).toBe("insufficient-data");
  });

  it("refuses a response with no result data", () => {
    expect(parseYahooChartResponse(JSON.stringify({ chart: { result: [] } })).kind).toBe(
      "insufficient-data",
    );
  });

  it("refuses a response missing the price field", () => {
    const noPrice = JSON.stringify({
      chart: { result: [{ meta: { regularMarketTime: 1756540200 } }] },
    });
    expect(parseYahooChartResponse(noPrice).kind).toBe("insufficient-data");
  });

  it("refuses a response whose price field is a string, rather than coercing it", () => {
    const stringPrice = JSON.stringify({
      chart: {
        result: [
          { meta: { regularMarketPrice: "24500.35", regularMarketTime: 1756540200 } },
        ],
      },
    });
    expect(parseYahooChartResponse(stringPrice).kind).toBe("insufficient-data");
  });

  describe("fetchYahooQuote", () => {
    it("returns a quote on a successful fetch", async () => {
      const okFetcher: Fetcher = async () => ({
        ok: true,
        status: 200,
        text: async () => sampleResponse(),
      });
      const result = await fetchYahooQuote("^NSEI", okFetcher);
      expect(result.kind).toBe("ok");
    });

    it("reports insufficient-data on a network failure rather than throwing", async () => {
      const failingFetcher: Fetcher = async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      };
      const result = await fetchYahooQuote("^NSEI", failingFetcher);
      expect(result.kind).toBe("insufficient-data");
    });

    it("reports insufficient-data on a non-200 response, naming the symbol", async () => {
      const blockedFetcher: Fetcher = async () => ({
        ok: false,
        status: 429,
        text: async () => "",
      });
      const result = await fetchYahooQuote("^NSEI", blockedFetcher);
      expect(result.kind).toBe("insufficient-data");
      if (result.kind === "insufficient-data") {
        expect(result.reasons.join()).toContain("^NSEI");
      }
    });
  });
});
