/**
 * Centralized market-data source mapping — the same architectural rule
 * `src/ingestion/sources/mappings.ts` follows for import column aliases:
 * one file names every symbol/endpoint, so nothing scatters a provider
 * detail across the codebase.
 *
 * See docs/MARKET_DATA_PROVIDER_EVALUATION.md (D-007) for why these two
 * sources and not others.
 */

export const AMFI_NAV_URL = "https://www.amfiindia.com/spreadsheet/NAVAll.txt";

/** Yahoo Finance's unofficial chart endpoint — see the provider evaluation for the licensing caveat. */
export function yahooChartUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
}

export interface TrackedIndex {
  readonly code: string;
  readonly label: string;
  /** null when D-016 applies: no reliable free symbol was found. */
  readonly yahooSymbol: string | null;
}

export const TRACKED_INDICES: readonly TrackedIndex[] = [
  { code: "NIFTY50", label: "Nifty 50", yahooSymbol: "^NSEI" },
  { code: "SENSEX", label: "Sensex", yahooSymbol: "^BSESN" },
  { code: "NIFTY_BANK", label: "Nifty Bank", yahooSymbol: "^NSEBANK" },
  // D-016: no reliable free source found for Nifty Metal. Left trackable
  // (it appears everywhere else an index does) so the gap is visible on
  // the Market screen rather than the index simply not existing.
  { code: "NIFTY_METAL", label: "Nifty Metal", yahooSymbol: null },
];

/** A price older than this is shown as stale rather than current (docs/18_FAILURE_MODES.md). */
export const STALENESS_THRESHOLD_DAYS = 3;

/** Below this, a fetched quote is refused as implausible rather than stored — see refresh.ts. */
export const MIN_PLAUSIBLE_PRICE_MINOR_UNITS = 1;
