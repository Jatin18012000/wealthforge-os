# Release Notes — v1.0.0

**Release date:** 2026-08-31
**Status:** Final release. Engineering complete, UI testing complete,
financial engine frozen.

## What is included

WEALTHFORGE OS v1.0.0 is a complete, locally deployable personal financial
operating system: eleven working screens (Command Center, Budget,
Portfolio, Goals, Liabilities, Insurance, Analytics, Data Center,
Settings, Market, AI Analyst), a deterministic financial engine, full
ingestion for budget workbooks and portfolio snapshots, a manual-override
system for every financially significant field, automatic and manual
backup/restore, and a grounded, provider-abstracted AI Analyst.

## Major capabilities

- **Financial engine**: net worth, monthly budget summary and Plan vs
  Reality, goal progress and funding projection, liability EMI/payer
  split/release, portfolio valuation/allocation/concentration/P&L,
  CAGR/XIRR — all deterministic, all in `src/domain/`, all reporting
  "insufficient data" rather than a fabricated number when the trusted
  data doesn't support a figure.
- **Ingestion**: full budget-workbook re-read and diff on every upload
  (NEW/MODIFIED/UNCHANGED/DELETED_RENAMED/CONFLICT), with revision
  history; portfolio snapshot ingestion for equities, ETFs, gold/silver,
  and mutual funds, with cost-basis tracking and a strict
  snapshot-≠-activity rule (an observed quantity change is never invented
  as a trade).
- **Goal funding**: "allocate leftover cash to a goal" works end to end
  from the Budget screen, checked against what genuinely remains of the
  period's surplus after earlier allocations.
- **Manual controls**: every overridable field (budget lines, portfolio
  quantities/cost-basis, goal targets, liability terms, insurance
  cover/premium) follows Source → Adjustment → Result → Reason → History
  — nothing is ever silently overwritten.
- **Data Center**: import audit, provenance, trust-state classification,
  full audit log, and automatic + manual backup/restore with conflict
  detection (a restore refuses to silently overwrite newer data).
- **Market data**: free by default (AMFI's official NAV file, Yahoo
  Finance's free endpoint), with manual entry as the documented fallback
  for any index, equity, ETF, or mutual fund with no automatic price —
  nothing in the app requires a paid market-data subscription.
- **AI Analyst**: explains the engine's own already-computed figures,
  never a source of truth; grounded — any response stating a number not
  present in its data is rejected outright, not shown with a caveat.
  Defaults to a free local Ollama server; OpenAI/Anthropic are optional
  and key-gated.
- **Analytics**: every documented period (15 days through since-inception,
  plus a genuinely custom range), activity-kind and asset-class filters
  that compose, and true custom-vs-custom period comparison (any two
  arbitrary ranges, not just a derived preceding period).

## Testing status

As verified for this release, from a clean-clone install:

- **389 unit/integration tests** (`vitest`, 36 files) — all passing.
- **122 Playwright E2E tests** (61 unique tests × 2 viewports: laptop and
  iPad) — all passing.
- **511 automated tests total.**
- `tsc --noEmit`: clean. `eslint .`: clean. `next build`: clean, all 13
  routes compile.
- Full UI/visual QA pass across all 11 screens at both viewports: see
  [`docs/UI_TEST_MATRIX.md`](UI_TEST_MATRIX.md) and
  [`docs/UI_TESTING_FINAL_REPORT.md`](UI_TESTING_FINAL_REPORT.md). One P1
  and one P3 defect were found and fixed during that pass; zero remain
  open.

## Supported devices

Laptop (primary, 1440×900 tested) and iPad (secondary, tested at the
standard iPad viewport). Both are covered end-to-end by the automated
E2E suite, including layout, accessibility, and navigation checks on
every screen.

## Local-first architecture & zero-cost status

Everything runs on your own machine. SQLite is the database; the
filesystem is the storage; Ollama is the default AI provider (free,
local, no API key). No feature requires a cloud database, paid hosting,
paid API, paid authentication, paid storage, or paid email service. The
only optional network calls are a market-data refresh (free sources) or
a cloud AI provider you explicitly opt into with your own key.

## Known limitations (intentionally deferred — not release blockers)

- **Analytics instrument / provider / metric filters** are not built.
  The domain layer has partial plumbing for an instrument filter, but no
  UI control exists for it, and neither source/provider nor "metric"
  has a queryable field or a defined UI to filter by yet.
- **Data Center backup-retention enhancement**: the backup list has no
  pagination, filtering, or retention policy. It will grow long over
  sustained use with no impact on correctness — just screen length.
- **Groww statement support** was never built; no real fixture for it
  has ever existed in this project, so it is not claimed as supported.
  Manual CSV/XLSX import remains fully functional for any source without
  a dedicated adapter.
- **Brokerage/Zerodha live API integration** (D-006), **desktop
  packaging** (D-008), and **overriding a payer split with more than two
  payers** (D-015) remain open per
  [`docs/19_OPEN_DECISIONS.md`](19_OPEN_DECISIONS.md).

None of the above are release blockers: every mandatory requirement in
[`docs/FINAL_REQUIREMENTS_STATUS.md`](FINAL_REQUIREMENTS_STATUS.md) is
PASS, and each deferred item has a documented, non-fabricated fallback.
