# Changelog

All notable changes to WEALTHFORGE OS are recorded here. This project
does not follow a fixed release cadence; entries are grouped by release
tag.

## [1.1.1] — 2026-09-02

Bounded polish release — "Command Center Personalization & Insight
Polish." Not a new milestone program; a small set of additive,
low-risk capabilities on top of the audited v1.1.0 intelligence layer.
Full detail in
[`docs/30_V1_1_1_COMMAND_CENTER_POLISH.md`](docs/30_V1_1_1_COMMAND_CENTER_POLISH.md).

### Added

- **Prioritized "What Needs Attention"** (`src/views/attentionView.ts`):
  a unified Critical/Important/Watch panel aggregating existing
  Financial Anomaly Detector, concentration, plan-adherence, goal
  collision, liability, and staleness findings — no new financial fact,
  no new threshold.
- **`InsightMeta`** (`src/components/Primitives.tsx`): a freshness badge
  ("As of ... — data is N days old") plus an expandable "How is this
  calculated?" note, surfacing each `Insight<T>`'s existing `asOf` and
  `calculationBasis` on 8 major Command Center widgets.

### Unchanged

- The frozen v1.0.0 financial engine and all of `src/ai/*` — untouched.
- No new dependency, environment variable, or database migration.

### Verified

- 457 unit tests (452 + 5 new), 136 E2E tests (132 + 2×2 new, laptop +
  iPad), `tsc`/`eslint`/`next build` all clean.

## [1.1.0] — 2026-09-01

"Personal Investment Master" intelligence layer, built as eight staged
milestones (IM-01 through IM-08) on top of the frozen v1.0.0 financial
engine. Every widget composes an existing `src/domain/`/`src/views/`
calculation — none introduces a second calculation path for a number the
engine already produces. Full per-milestone history in
[`docs/20_BUILD_ROADMAP.md`](docs/20_BUILD_ROADMAP.md) and
[`docs/21_INTELLIGENCE_MASTER_PLAN.md`](docs/21_INTELLIGENCE_MASTER_PLAN.md);
per-widget detail in
[`docs/22_INTELLIGENCE_WIDGET_CATALOG.md`](docs/22_INTELLIGENCE_WIDGET_CATALOG.md).

### Added

- **IM-01 Intelligence Foundation** — `src/domain/insight.ts`: the
  `Insight<T>` contract (metric, computed result, as-of date, coverage,
  trust, provenance, calculation basis) every widget below returns, plus
  `buildDecomposition` and `buildScenarioResult`/`ScenarioResult<T>`.
- **IM-02 Wealth Intelligence** — Net Worth Trajectory, Assets vs
  Liabilities, Net Worth Waterfall, Monthly Money Flow, Savings Rate
  Trend, Investment Rate Trend.
- **IM-03 Investment Intelligence** — Portfolio X-Ray, Planned vs Actual
  Allocation, Portfolio Growth Decomposition, Contribution vs Return,
  Portfolio Performance (P&L/CAGR/XIRR), Concentration Heatmap, Drawdown
  Monitor, Portfolio vs Benchmark, Investment Plan Adherence.
- **IM-04 Goal & Liability Intelligence** — Goal Funding Radar, Goal
  Collision Detector, Emergency Fund Runway (always insufficient-data
  today; see D-017), Debt Freedom Meter, EMI Release Timeline, Goal
  Trade-Off Simulator.
- **IM-05 Behavioral & Data Intelligence** — What's Changed, Financial
  Anomaly Detector, Financial Health Score (a disclosed data/process
  score, not a financial-adequacy judgment), Data Health, Historical
  Coverage.
- **IM-06 Scenario Engine** — `src/domain/scenarios.ts`
  (`projectFutureValue`, `monthsUntilTarget`, `simulateDebtPrepayment`);
  SIP Increase Simulator, Debt Prepayment Simulator, Wealth Projection,
  Financial Independence Projection — every growth assumption is an
  *observed* CAGR since inception, never an invented market return.
- **IM-07 AI Intelligence** — WealthForge Daily Brief
  (`src/views/dailyBriefView.ts`), a second `Report` fed through the
  unchanged M11 `explainReport`/`checkGrounding` pipeline; surfaced as a
  second "Generate daily brief" action on the AI Analyst screen.
- **IM-08 Command Center 2.0** — `src/app/page.tsx` reorganized into the
  directive's specified section order (Daily Brief → tiles → net worth
  & money flow → portfolio X-Ray & risk → plan vs reality & adherence →
  goal radar & EMI freedom → wealth waterfall & financial health → what
  needs attention & data health → more intelligence → scenario engine);
  no widget removed, only reordered; adds a "Plan vs reality" card
  exposing the pre-existing `comparePlanVsActual` on the Command Center
  for the first time.
- `docs/21_INTELLIGENCE_MASTER_PLAN.md`, `docs/22_INTELLIGENCE_WIDGET_CATALOG.md`,
  `docs/23_SCENARIO_ENGINE.md`, `docs/24_DAILY_BRIEF_SPEC.md`,
  `docs/25_COMMAND_CENTER_V2_SPEC.md`, `docs/V1.1_RELEASE_NOTES.md`.

### Unchanged

- The v1.0.0 financial engine (`src/domain/`) is frozen — every new
  metric is a composition, never a second calculation path.
- `src/ai/*` (provider abstraction, grounding, verification) is byte-for-
  byte unchanged from M11; the Daily Brief is just a second `Report`
  shape fed through the same pipeline.
- Zero-cost posture: no new runtime dependency was added across
  IM-01–IM-08 (`package.json`'s `dependencies` remain `@prisma/client`,
  `exceljs`, `next`, `react`, `react-dom`); no new environment variable is
  required.

### Verified

- 452 unit tests, 132 Playwright E2E tests (laptop + iPad viewports)
  passing on a freshly reseeded demo database; `tsc --noEmit`, `eslint .`,
  and `next build` all clean.

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
