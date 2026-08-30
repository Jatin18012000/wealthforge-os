# Market Data Provider Evaluation (D-007)

Resolves `docs/19_OPEN_DECISIONS.md` D-007. Evaluated against the project's
zero-cost mandate (`CLAUDE.md` "Cost Philosophy") and the local-first
requirement that core features work without any network access at all.

## Method

This sandboxed build environment's own egress proxy was used as the first
real test of "does this app survive when a market-data host is
unreachable" — not a metaphor. Attempting to reach the two leading
candidates directly:

```
curl https://www.amfiindia.com/spreadsheet/NAVAll.txt
curl https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI
```

both returned `connect_rejected` from the proxy (organization policy —
neither host is on this environment's allowlist). That is the expected,
designed-for outcome for a local-first app: market data is an optional
enhancement layered on top of a system that must be fully useful from
local/manual data alone (`CLAUDE.md`, "Local-first"). It also means this
milestone cannot live-verify these providers from inside this sandbox —
documented honestly below rather than claiming a test that did not happen.
Anyone running WEALTHFORGE OS on a normal internet-connected machine (the
actual deployment target — a personal laptop/iPad, per
`15_DEPLOYMENT_ARCHITECTURE.md`) has no such restriction.

## Candidates

### 1. AMFI (Association of Mutual Funds in India) — `NAVAll.txt`

| | |
|---|---|
| Data available | Daily NAV for every registered mutual fund scheme in India |
| Indian-market coverage | Complete — AMFI is the official industry body; every AMC reports here |
| Index coverage | None |
| Equity coverage | None |
| ETF coverage | Only ETFs structured as mutual fund schemes (most Indian ETFs are) |
| MF/NAV coverage | Complete, authoritative |
| Historical coverage | Current file is a daily snapshot only; historical NAV needs a daily archive job (the app builds this itself over time by fetching once a day and writing a `Valuation` row per scheme, per day) |
| Intraday | Not applicable — NAV is computed once per business day |
| Rate limits | None documented; it is a static published file, not a rate-limited API |
| Cost | **Free.** Published by AMFI as a public service to investors |
| Authentication | **None** |
| Licensing | Public data, explicitly published for investor and industry use; no restrictive terms found for read/personal use |
| Reliability | High — this is the file every Indian MF platform (including paid ones) ultimately sources from |
| Risks | Plain-text format could change; no SLA/uptime guarantee since it is a free public service, not a paid API |
| Suitability | **Primary source for mutual fund NAVs.** Nothing else is this authoritative and this free. |

### 2. Yahoo Finance unofficial chart endpoint (`query1.finance.yahoo.com`)

| | |
|---|---|
| Data available | OHLC quotes, historical daily/intraday bars, for tickers Yahoo indexes |
| Indian-market coverage | NSE-listed equities/ETFs (`.NS` suffix) and BSE-listed (`.BO` suffix); broad but not exhaustive for micro-cap/illiquid names |
| Index coverage | Nifty 50 (`^NSEI`), Nifty Bank (`^NSEBANK`), Sensex (`^BSESN`); Nifty Metal is **not reliably available** on this endpoint under a stable symbol |
| Equity coverage | Most NSE/BSE-listed stocks |
| ETF coverage | Most India-listed ETFs |
| MF/NAV coverage | Poor/inconsistent for Indian mutual funds — AMFI is used instead |
| Historical coverage | Good — years of daily bars via the `range`/`interval` query params |
| Intraday | Available at coarse intervals (subject to unofficial/undocumented limits) |
| Rate limits | Undocumented; informally known to tolerate light personal use but can throttle or block an IP under sustained/high-frequency polling |
| Cost | **Free**, no API key |
| Authentication | **None** |
| Licensing | **This is the central risk.** This is not a published public API — it is Yahoo Finance's internal web-app endpoint, reverse-engineered by the community (the basis of the popular `yfinance` Python library). Yahoo's terms of service do not grant a license for programmatic/automated use of this endpoint; it can be withdrawn, rate-limited, or blocked without notice, and heavy or commercial use is against Yahoo's terms. |
| Reliability | Historically stable for years, but explicitly **not guaranteed** — this is the "service that silently becomes paid/unavailable" risk `CLAUDE.md` warns against |
| Risks | ToS ambiguity for automated use; can break without warning; Nifty Metal has no reliable symbol here |
| Suitability | **Optional, best-effort secondary source** for index levels and individual equity/ETF prices — never a required dependency, always with a manual fallback, and used at a conservative polling interval (see below) |

### 3. NSE India's own website JSON endpoints (`www.nseindia.com/api/...`)

Considered and **rejected as a dependency**, documented for completeness:
unofficial, requires a warmed browser-like session (cookies from an initial
page load) to avoid being blocked, is aggressively bot-protected, and NSE's
own terms restrict automated/commercial redistribution of this data more
explicitly than Yahoo's. Higher operational fragility than Yahoo for no
material coverage gain over the combination above. Not used.

### 4. Manual / local entry (existing M8 manual controls)

| | |
|---|---|
| Cost | Free — already built |
| Coverage | Anything — the user types in what they know |
| Reliability | As reliable as the user keeps it current |
| Suitability | **The permanent fallback.** Every price/NAV the market-data layer would fetch is stored in the same `Valuation` table a manual entry already writes to (`docs/06_DATABASE_SCHEMA.md`) — so a stale or unreachable provider degrades to exactly what the app already does when no market-data layer exists at all: the last known or manually entered value, with its age shown, never invented. |

## Decision

**No single free provider covers everything, so — per this directive's own
instruction — a provider abstraction with multiple free sources is used,
with manual entry as the permanent fallback underneath both:**

- **AMFI `NAVAll.txt`** — primary and only source for mutual fund NAVs.
  Official, free, unauthenticated, no rate limit, high reliability.
- **Yahoo Finance's unofficial chart endpoint** — optional, best-effort
  source for index levels (Nifty 50, Nifty Bank, Sensex) and individual
  equity/ETF prices. Explicitly documented as unofficial with no SLA;
  never required for the app to function; polled at a conservative
  interval (default once per day, configurable) rather than aggressively,
  to stay well inside informal tolerance and reduce the chance of being
  blocked.
- **Nifty Metal**: no reliable free symbol was found on either source.
  Tracked as a documented gap (`19_OPEN_DECISIONS.md` D-016) rather than
  guessed at with an unverified symbol — a wrong number here would be
  exactly the "market data becomes financial history" failure this
  directive prohibits. Falls back to manual entry only.
- **Manual entry** underlies both: every fetched value is a `Valuation`
  row with `source` naming the provider and `fetchedAt` recording when it
  was fetched — identical in shape to a manually entered one, so the
  engine, freshness display, and staleness rules need no special case for
  "where did this number come from."

This keeps WEALTHFORGE OS at **₹0 mandatory cost**: nothing above requires
a credit card, an API key, or a paid tier, and the optional provider can
disappear entirely without breaking the app — it just means prices age
until either it recovers or the user enters one by hand.

## What "no credit card required" was checked against

- AMFI: publishes a plain static file with no signup at all.
- Yahoo's endpoint: no signup, no key, used anonymously by the `yfinance`
  ecosystem for years without payment — but see the licensing caveat
  above; this is knowingly accepted as an *optional* dependency, never a
  required one, exactly per this directive's fallback hierarchy
  (LOCAL → FREE OPEN SOURCE → FREE PUBLIC API → OPTIONAL EXTERNAL SERVICE
  → never required paid service).
