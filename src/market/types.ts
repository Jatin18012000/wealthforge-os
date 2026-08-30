/**
 * The market-data layer's shared vocabulary.
 *
 * Everything here produces a `Computed<T>` (never throws for an ordinary
 * "couldn't fetch" or "couldn't parse") — a market data provider being
 * unreachable is an expected, everyday condition for a local-first app,
 * not an exceptional one, per docs/18_FAILURE_MODES.md.
 */

/**
 * The network boundary, injectable so every parser and refresh routine is
 * testable with recorded fixture text and never makes a real HTTP call
 * from the test suite (docs/14_TESTING_STRATEGY.md, "market
 * freshness/missing-data tests" — deterministic, no live-network flake).
 */
export interface Fetcher {
  (url: string): Promise<FetchResponse>;
}

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** The production fetcher: the real global fetch, used nowhere in tests. */
export const realFetcher: Fetcher = (url) => fetch(url);

export interface FetchedQuote {
  readonly priceMinorUnits: number;
  readonly asOfDate: Date;
  readonly currency: string;
}

export interface ProviderOutcome<TIdentity> {
  readonly identity: TIdentity;
  readonly result:
    | { readonly kind: "ok"; readonly value: FetchedQuote }
    | { readonly kind: "failed"; readonly reason: string };
}
