# Market data & reporting (M10)

Resolves D-007 (`docs/MARKET_DATA_PROVIDER_EVALUATION.md`) and implements
tracking for Nifty 50, Sensex, Nifty Bank, and (best-effort) Nifty Metal,
optional live equity/ETF pricing, automatic mutual fund NAV updates, and a
locally generated report — all at ₹0 mandatory cost.

## No parallel valuation model

`src/market/` fetches prices; it never stores them anywhere but the
existing `Valuation` table (`docs/06_DATABASE_SCHEMA.md`). A fetched price
and a manually entered one are indistinguishable in shape — only
`source`/`fetchedAt` differ — so every screen that already reads
`Valuation` (portfolio value, net worth, freshness badges) needs no change
to benefit from this milestone, and a market-data outage degrades to
exactly what those screens already do with no live-price layer at all: the
last known value, with its age shown.

Indices are modelled the same way: `ensureIndexInstruments` bootstraps one
`Instrument` per tracked index (`kind: "index"`, never held, never
appearing in a position) purely so it has somewhere to store a priced
history.

## Provider abstraction

`src/market/providers/`:

- **`amfiNav.ts`** — parses AMFI's official `NAVAll.txt`. Matches a mutual
  fund holding by ISIN (`Instrument.identifier`) against either ISIN column
  the file carries. One fetch prices every mutual fund holding.
- **`yahooFinance.ts`** — parses Yahoo Finance's unofficial chart endpoint.
  Used for tracked indices (fixed symbols in `src/market/registry.ts`) and
  for any equity/ETF instrument that opts in with a `marketSymbol`
  (`Instrument.marketSymbol`, additive/nullable — see the M10 migration).
  An instrument without one is simply never fetched; this is a deliberate
  opt-in, not a gap, because there is no free, reliable ISIN→ticker mapping
  to guess from.

Both providers return `Computed<T>` — a network failure, a non-200
response, an unparseable body, or a response shaped differently than
expected all resolve to `insufficient-data` with a stated reason, never a
throw and never a fabricated number (docs/18_FAILURE_MODES.md, "market
data provider unavailable").

## Fetcher injection

Every fetch goes through an injectable `Fetcher` type
(`src/market/types.ts`). Production uses the real global `fetch`; the test
suite injects fixtures recorded from real response shapes and never makes
a live network call — this sandboxed build environment's own egress proxy
blocking both provider hosts outright (`connect_rejected`) is direct,
unplanned confirmation that the app must and does survive their absence.

## Refresh orchestration and failure isolation

`src/market/refresh.ts` runs each source independently
(`refreshAllMarketData`): one instrument's fetch failing never blocks the
others, and one source failing entirely (e.g. AMFI unreachable) never
blocks a different source (e.g. Yahoo for indices) from still updating.
Every run — success, partial failure, or total failure — writes one
`market_refresh` audit_event with per-source counts, decoded into a
readable sentence on the Data Center's audit log exactly like
import/backup/restore events already are.

A fetched price below `MIN_PLAUSIBLE_PRICE_MINOR_UNITS` is rejected rather
than stored — a defensive floor against a provider returning a malformed
zero/negative value that would otherwise silently corrupt a valuation.

## Never inventing a transaction from a price

Per the standing M5 rule this milestone does not touch: market data prices
a holding, it never explains a quantity change. `refreshInstrumentQuotes`
and `refreshMutualFundNavs` write only `Valuation` rows; nothing in this
milestone creates, infers, or reconciles an `Activity` row. A price moving
is not evidence of a purchase, sale, or transfer.

## The Market screen and report

`/market`: tracked indices with freshness badges (stale past
`STALENESS_THRESHOLD_DAYS`, default 3 days), a manual "Refresh market data
now" button, mutual fund count (auto-priced, nothing to configure), and a
symbol-assignment form per equity/ETF holding.

`/market/report`: a **rule-based**, not AI-generated, report assembling
already-computed view outputs (`src/views/reportView.ts` reuses
`getCommandCenterView` and `getMarketView` directly — no recalculation)
into Market/Portfolio/Goals/Risk sections, each line labeled **Fact**,
**Inference**, or **Recommendation** per the source directive's
distinction. This is deliberately the same "structured payload of
already-computed domain outputs" `docs/12_AI_ANALYST_SPEC.md` describes as
what the M11 AI layer will receive — this report is that payload made
directly readable, ahead of M11 adding a narrative layer on top of it.
Exporting is the browser's own print-to-PDF; no PDF library or mail
service was added.

## Manual entry for an index with no free source (D-016)

Closes the gap between rung 5 (a clearly marked unavailable state — already
built) and rung 4 (manual entry) of the fallback hierarchy: the Market
screen's "Manual entry" column, shown only for an index with
`hasFreeSource: false` (currently only Nifty Metal), lets a reading be
typed in and recorded via `recordManualQuoteAction`. It writes into
the same `Valuation` table an automatic fetch uses, tagged
`source: "manual"`, so the freshness/staleness display treats it exactly
like a fetched reading — no special case needed. A second entry for the
same date is refused rather than silently overwriting the first (the same
non-destructive rule every other source in this project follows).

Deliberately not routed through the M8 manual-adjustment machinery: that
system exists for a **source value plus an adjustment** with a resulting
value distinct from both: there is no automatically-fetched Nifty Metal
reading for a manual one to differ from, so this is the only value, not
an override of one.

## Manual entry for any held equity, ETF, or mutual fund (R2-06)

`recordManualQuoteAction` was always instrument-agnostic — it takes an
`instrumentId`, not an index code — so the same fallback the indices use
extends to any held instrument with no automatic price for a given date: a
held equity or ETF with no opted-in `marketSymbol` (or one that has a
symbol but for which a fetch failed), and a mutual fund AMFI's daily file
does not carry. The Market screen shows a "Manual entry" column on the
"Equities & ETFs" and "Mutual funds" tables identical in behavior to the
index one — same form, same `source: "manual"` tag, same non-destructive
same-date refusal. A manually entered price sits in the same `Valuation`
history as a fetched one; whichever has the latest `asOfDate` is what every
other screen's "latest price" reads, exactly as for indices.

## Zero-cost verification

| Dependency                   | Cost                               | Required?                                            |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------- |
| AMFI `NAVAll.txt`            | Free, no auth                      | No — mutual funds simply show no live NAV without it |
| Yahoo Finance chart endpoint | Free, no auth (unofficial, no SLA) | No — indices/equities show no live price without it  |
| Everything else              | Existing local stack               | —                                                    |

No credit card, API key, or paid tier is introduced. Nothing above can
"quietly become paid" — both are unauthenticated read endpoints with no
billing relationship to begin with.
