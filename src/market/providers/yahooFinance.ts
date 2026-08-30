import { insufficient, ok, roundHalfToEven, type Computed } from "../../domain";
import { yahooChartUrl } from "../registry";
import type { FetchedQuote, Fetcher } from "../types";

/**
 * Yahoo Finance's unofficial chart endpoint. Free, no key — but unofficial,
 * with no SLA and no license grant for automated use
 * (docs/MARKET_DATA_PROVIDER_EVALUATION.md). Used only as an optional,
 * conservatively-polled secondary source; never required.
 *
 * The response shape (abbreviated to what is actually read):
 *   { chart: { result: [{ meta: { regularMarketPrice, regularMarketTime,
 *     currency } }], error: null | {...} } }
 */

interface YahooChartMeta {
  readonly regularMarketPrice?: unknown;
  readonly regularMarketTime?: unknown;
  readonly currency?: unknown;
}

interface YahooChartResponse {
  readonly chart?: {
    readonly result?: readonly { readonly meta?: YahooChartMeta }[] | null;
    readonly error?: unknown;
  };
}

/**
 * Parses the JSON text into one quote. Deliberately strict about the
 * fields it trusts (`typeof` checks, not casts) — a shape this code has
 * never seen (Yahoo changing its unofficial response, per the documented
 * risk) must fail loudly as insufficient-data, never coerce into a
 * plausible-looking wrong number.
 */
export function parseYahooChartResponse(text: string): Computed<FetchedQuote> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return insufficient("Yahoo Finance's response was not valid JSON");
  }

  const response = parsed as YahooChartResponse;
  if (response.chart?.error != null) {
    return insufficient(
      `Yahoo Finance reported an error: ${JSON.stringify(response.chart.error)}`,
    );
  }

  const meta = response.chart?.result?.[0]?.meta;
  if (meta === undefined) {
    return insufficient("Yahoo Finance's response had no result data for this symbol");
  }

  if (
    typeof meta.regularMarketPrice !== "number" ||
    !Number.isFinite(meta.regularMarketPrice)
  ) {
    return insufficient("Yahoo Finance's response had no usable price");
  }
  if (
    typeof meta.regularMarketTime !== "number" ||
    !Number.isFinite(meta.regularMarketTime)
  ) {
    return insufficient("Yahoo Finance's response had no usable timestamp");
  }

  const currency =
    typeof meta.currency === "string" && meta.currency !== "" ? meta.currency : "INR";

  return ok({
    priceMinorUnits: roundHalfToEven(meta.regularMarketPrice * 100),
    asOfDate: new Date(meta.regularMarketTime * 1000),
    currency,
  });
}

export async function fetchYahooQuote(
  symbol: string,
  fetcher: Fetcher,
): Promise<Computed<FetchedQuote>> {
  let response;
  try {
    response = await fetcher(yahooChartUrl(symbol));
  } catch (err) {
    return insufficient(
      `could not reach Yahoo Finance for "${symbol}": ${err instanceof Error ? err.message : "unknown network error"}`,
    );
  }

  if (!response.ok) {
    return insufficient(`Yahoo Finance returned HTTP ${response.status} for "${symbol}"`);
  }

  return parseYahooChartResponse(await response.text());
}
