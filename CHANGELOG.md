# Changelog

All notable changes to WEALTHFORGE OS are recorded here. This project
does not follow a fixed release cadence; entries are grouped by release
tag.

## [1.0.0] — 2026-08-31

First stable release. Engineering complete, UI testing complete, financial
engine frozen. Full milestone-by-milestone history predates this file and
lives in [`docs/20_BUILD_ROADMAP.md`](docs/20_BUILD_ROADMAP.md); this entry
summarizes what shipped in it.

### Added

- Eleven screens: Command Center, Budget, Portfolio, Goals, Liabilities,
  Insurance, Analytics, Data Center, Settings, Market, AI Analyst.
- Full budget-workbook ingestion with revision history and diff engine
  (NEW/MODIFIED/UNCHANGED/DELETED_RENAMED/CONFLICT).
- Portfolio snapshot ingestion (equities, ETFs, gold/silver, mutual funds)
  with cost-basis tracking and unexplained-change detection
  (snapshot ≠ activity).
- Deterministic financial engine: net worth, budget summary, Plan vs
  Reality, goal progress/projection, liability EMI/payer-split/release,
  portfolio valuation/allocation/concentration, CAGR/XIRR.
- Goal funding flow: "allocate leftover cash to a goal" on the Budget
  screen, gated on what genuinely remains after earlier allocations in
  the period.
- Manual-adjustment model (Source → Adjustment → Result → Reason →
  History) covering budget, portfolio quantities/cost-basis, goals,
  liabilities, and insurance fields — no silent overwrite, ever.
- Data Center: import audit, provenance, trust-state model, revision
  history, full audit log, automatic and manual backup/restore with
  conflict detection.
- Market data: free AMFI NAV file + Yahoo Finance refresh, with manual
  entry as the documented fallback for any index, equity, ETF, or mutual
  fund with no automatic price.
- AI Analyst: provider-abstracted (Ollama default, OpenAI/Anthropic
  optional and key-gated), grounded against the engine's own computed
  figures, rejects any response stating a number not in that data.
- Analytics: every documented period, activity-kind and asset-class
  filters (composable), true custom-vs-custom period comparison.

### Fixed (post-M12 remediation, "Round 2")

- Insurance screen was entirely missing despite being a required
  Level-2 information-architecture screen — built.
- Insurance premium/cover figures the requirements doc never states are
  now nullable and render "Not recorded" rather than a fabricated ₹0.
- The documented "allocate leftover cash to a goal" flow had no UI path
  at all — built.
- Manual price/NAV entry existed only for one index with no free source;
  extended to every held equity, ETF, and mutual fund with no automatic
  price.
- Analytics' asset-class filter and custom-vs-custom period comparison
  existed in the domain layer but had no UI control — wired up.
- A Settings-screen regression from the insurance nullability fix leaked
  the literal string "null" into a premium's label when unrecorded —
  found during UI testing, fixed, regression test added.
- Added a regression test proving a credit-card purchase (expense) and
  its bill payment (liability settlement) are never double-counted.
- Fixed a real bug where the Zerodha holdings reconciliation check
  declared a centralized column registry but never actually consulted it.
- Fixed Settings' manual-override group ordering to match its declared
  order rather than incidental insertion order.

### Known limitations (non-blocking)

- Analytics instrument, source/provider, and metric filters are not
  built.
- Data Center's backup list has no pagination or retention policy.
- No Groww statement support exists (no real fixture was ever available).
- Brokerage/Zerodha live API integration, desktop packaging, and
  >2-payer liability-split override remain deferred
  (`docs/19_OPEN_DECISIONS.md`).

See [`docs/RELEASE_NOTES_v1.0.0.md`](docs/RELEASE_NOTES_v1.0.0.md) for the
full release-facing summary.
