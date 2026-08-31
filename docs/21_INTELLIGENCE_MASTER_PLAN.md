# 21 — Intelligence Master Plan (v1.1)

Governs the "Personal Investment Master" intelligence layer built on top of
the frozen v1.0 financial engine. This is an **extension**, not a
replacement: every widget below is a new composition over existing
`src/domain/` calculations and existing `src/views/` loaders — no widget
introduces a second calculation path for a number the engine already
produces.

## Source documents

The directive names a *Financial OS V3 PRD* and *Master Product &
Architecture Brief* as controlling. As recorded in
`docs/REFERENCE_DOCUMENT_REGISTER.md` (R-04) since M0, **neither document
has ever been supplied to this repository** — this remains true today; a
repo-wide search finds no trace of either beyond that one honest
non-claim. This plan is therefore built against the same controlling
documents every prior milestone used: `docs/01_PRODUCT_VISION.md` through
`docs/20_BUILD_ROADMAP.md`, the `docs/decisions/` ADRs, and this
directive's own explicit module list (IM-01 through IM-08), which is
detailed enough to serve as its own specification for what to build.

## Architecture (unchanged, extended)

```
DATABASE → DOMAIN ENGINE → ANALYTICS → VIEW MODEL → DASHBOARD WIDGET → AI EXPLANATION
```

- **New domain-layer infrastructure** (framework-free, `src/domain/`,
  subject to the same `no-restricted-imports` ESLint rule as everything
  else in that directory): `src/domain/insight.ts`. Provides the
  `Insight<T>` contract every widget's view-model returns, reusing
  `Computed<T>` (`result.ts`), `PeriodCoverage`/`DateRange`
  (`analytics.ts`/`periods.ts`), and `TrustState` (`trust.ts`) rather than
  inventing parallel versions of any of them.
- **No new calculation engine.** Every widget's number comes from calling
  an existing `src/domain/*` function (or a thin, obviously-correct
  composition of two of them, e.g. "this month's figure minus last
  month's figure" using the existing `comparePeriods`) — never a new
  independent formula for a number the engine already computes elsewhere.
- **View-model layer**: one file per widget group under `src/views/`,
  following the exact pattern already established by
  `budgetView.ts`/`analyticsView.ts` — loaders + domain calls, no
  arithmetic of its own beyond assembling `Insight<T>` wrappers.
  Server Components read these; no financial arithmetic in `.tsx` files.
- **AI layer** (IM-07): consumes an array of already-computed `Insight<T>`
  objects, exactly as `src/ai/grounding.ts` already consumes the M10
  rule-based `Report` — extended, not replaced.

## Staged delivery

Given the scope named in this directive (8 modules, dozens of widgets, a
scenario engine, an AI brief, and a dashboard redesign), this is executed
as a genuine multi-milestone program, each one inspected, implemented,
tested, audited, documented, committed, and pushed before the next
begins — exactly as the directive's own "INSPECT → IMPLEMENT → TEST →
AUDIT → FIX → RETEST → VISUAL QA → DOCUMENT → COMMIT → PUSH → CONTINUE"
loop requires. Milestone status is tracked at the bottom of this document
and updated as each one lands; this file is not rewritten from scratch
per milestone.

## Widget catalogue (full inventory; per-widget detail in `docs/22_INTELLIGENCE_WIDGET_CATALOG.md`)

| # | Module | Widget |
|---|---|---|
| 1 | IM-02 Wealth | Net Worth Trajectory |
| 2 | IM-02 Wealth | Assets vs Liabilities |
| 3 | IM-02 Wealth | Net Worth Waterfall |
| 4 | IM-02 Wealth | Monthly Money Flow |
| 5 | IM-02 Wealth | Savings Rate Trend |
| 6 | IM-02 Wealth | Investment Rate Trend |
| 7 | IM-03 Investment | Portfolio X-Ray |
| 8 | IM-03 Investment | Planned vs Actual Allocation |
| 9 | IM-03 Investment | Portfolio Growth Decomposition |
| 10 | IM-03 Investment | Contribution vs Return |
| 11 | IM-03 Investment | Portfolio Performance |
| 12 | IM-03 Investment | Concentration Heatmap |
| 13 | IM-03 Investment | Drawdown Monitor |
| 14 | IM-03 Investment | Portfolio vs Benchmark |
| 15 | IM-03 Investment | Investment Plan Adherence |
| 16 | IM-04 Goal/Liability | Goal Funding Radar |
| 17 | IM-04 Goal/Liability | Goal Collision Detector |
| 18 | IM-04 Goal/Liability | Emergency Fund Runway |
| 19 | IM-04 Goal/Liability | Debt Freedom Meter |
| 20 | IM-04 Goal/Liability | EMI Release Timeline |
| 21 | IM-04 Goal/Liability | Goal Trade-Off Simulator |
| 22 | IM-05 Behavioral | What's Changed |
| 23 | IM-05 Behavioral | Financial Anomaly Detector |
| 24 | IM-05 Behavioral | Financial Health Score |
| 25 | IM-05 Behavioral | Data Health |
| 26 | IM-05 Behavioral | Historical Coverage |
| 27 | IM-06 Scenario | SIP Increase Simulator |
| 28 | IM-06 Scenario | Debt Prepayment Simulator |
| 29 | IM-06 Scenario | Wealth Projection |
| 30 | IM-06 Scenario | Financial Independence Projection |
| 31 | IM-07 AI | WealthForge Daily Brief |

(Goal Trade-Off Simulator and Investment Plan Adherence are each named in
two modules in the directive — IM-04/IM-06 and IM-03/IM-05 respectively —
listed once each above; both memberships are honored in the catalogue.)

## Non-negotiable rules carried forward unchanged

Every rule in `CLAUDE.md`, `docs/07_FINANCIAL_CALCULATIONS.md`, and
`docs/08_DATA_TRUST_MODEL.md` still applies to every new widget without
exception: snapshot ≠ activity, no fabricated NAV/cost-basis/P&L/
transaction, missing data is never zero, historical data is retained,
trust state gates headline totals, provenance stays drillable. A widget
that cannot honor one of these for lack of data reports
`insufficient-data`, never a best guess.

## Milestone status

| Milestone | Status |
|---|---|
| IM-01 Intelligence Foundation | COMPLETE — `src/domain/insight.ts`, 13 unit tests, no UI surface (pure infrastructure) |
| IM-02 Wealth Intelligence | NOT STARTED |
| IM-03 Investment Intelligence | NOT STARTED |
| IM-04 Goal & Liability Intelligence | NOT STARTED |
| IM-05 Behavioral & Data Intelligence | NOT STARTED |
| IM-06 Scenario Engine | NOT STARTED |
| IM-07 AI Intelligence (Daily Brief) | NOT STARTED |
| IM-08 Command Center 2.0 | NOT STARTED |

Updated at the end of each milestone's commit.
