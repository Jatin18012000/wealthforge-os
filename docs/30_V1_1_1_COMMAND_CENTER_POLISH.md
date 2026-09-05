# 30 — v1.1.1 Command Center Personalization & Insight Polish

**Codename:** Command Center Personalization & Insight Polish
**Scope:** a bounded polish release on top of the already-audited v1.1.0
intelligence layer (`docs/26_V1_1_INTELLIGENCE_AUDIT.md`). This is
**v1.1.1**, not v1.2 — no new milestone program, no financial-engine
change, no new roadmap work.

## Method

Per the directive, this began with repository inspection — reading the
actual source (`src/views/*`, `src/domain/insight.ts`,
`src/components/Primitives.tsx`, `src/app/page.tsx`,
`prisma/schema.prisma`) — before writing any code, to classify each
candidate feature (F1–F10) as **ALREADY EXISTS**, **PARTIALLY EXISTS**,
**MISSING**, or **NOT SAFE TO ADD NOW**.

## Classification

| # | Feature | Classification | Evidence |
|---|---|---|---|
| F1 | Prioritized "What Needs Attention" | **PARTIALLY EXISTS** | `src/domain/insight.ts` already defines a 4-tier `InsightSeverity` (`info`/`notice`/`caution`/`critical`), and several widgets already set `severity` (Goal Collision Detector, Financial Anomaly Detector) — but only 2 of the 4 tiers are ever used, and no aggregator combines findings across widgets into one unified, tiered panel. The pre-existing "Needs attention" card (`commandCenterView.ts`'s `DashboardAlert`) has only `caution`/`info`, not a CRITICAL/IMPORTANT/WATCH taxonomy. **Implemented this pass** — see below. |
| F2 | Widget drill-down (Net Worth → history/assets/liabilities/decomposition/records; Portfolio → allocation/holdings/contribution-vs-return/valuation history; Goals → trajectory/contributions/target/shortfall) | **PARTIALLY EXISTS** | The underlying data for every named drill-down already exists as its own widget on the Command Center (Net Worth Waterfall = change decomposition; Portfolio X-Ray = holdings; Contribution vs Return; Goal Funding Radar = trajectory/target/shortfall) — but there is no click-through/expand interaction linking a summary tile to its supporting detail; everything is already visible, just not navigably connected. **Deferred** — see "What was not built" below. |
| F3 | Data freshness / as-of display | **PARTIALLY EXISTS** | `FreshnessNote` (`src/components/Primitives.tsx`) and `Insight.asOf` already exist, but freshness was only rendered on the Portfolio screen's holdings table before this pass — not on the intelligence-layer widgets. **Implemented this pass** — see below. |
| F4 | Personal dashboard layout (show/hide, reorder, favorite, compact/expanded, reset) | **MISSING** | No preference storage or UI exists for widget visibility/order/layout density. `AppSetting` (a generic local key-value table, already used for `autoBackupIntervalHours`) could hold this without a schema change, but the UI (checkboxes/selects for every widget, a reset action) is a genuinely new, non-trivial feature. **Deferred** — see below. |
| F5 | Financial Focus Mode | **MISSING** | Depends on F4's infrastructure to filter which widgets render; nothing like it exists today. **Deferred** — see below. |
| F6 | Unified Wealth Timeline (OBSERVED / CONFIRMED ACTIVITY / PLAN) | **MISSING** | No chronological cross-entity event feed exists. Historical data to build one already does (plan records, activities, position snapshots, goal contributions, EMI payments) — this would be a new read-only composition, not a new calculation — but it is a genuinely new view file and UI, not a small addition. **Deferred** — see below. |
| F7 | "Why did my net worth change?" | **ALREADY EXISTS** | This is exactly what IM-02's Net Worth Waterfall already does (`wealthIntelligenceView.ts`, `buildDecomposition`): investment contributions, market movement, liability change, and an explicit `insufficient-data`/`unexplainedMinorUnits` state when the decomposition cannot fully account for the change. It is already on the Command Center under "Wealth waterfall & financial health." Nothing to build; F3/F10's additions (below) make its `calculationBasis` and freshness more visible. |
| F8 | Financial Milestones | **PARTIALLY EXISTS / NOT SAFE TO ADD NOW (for most sub-items)** | Goal completion and EMI-payoff completion are objectively derivable from already-computed fields (`GoalProgress.progressRatio` reaching 100%; `ReleaseSchedule.paymentsRemaining` reaching 0) with zero invented threshold. But "emergency fund threshold reached," "portfolio threshold reached," and "savings-rate milestone" all require picking a round-number or percentage threshold that **no existing document defines** — the same category of gap as D-017 (Emergency Fund Runway has no essential-expense definition to compute against in the first place, so an "emergency fund milestone" is doubly ungrounded today). Inventing such a threshold would violate the explicit "do not invent new financial facts" rule. **Deferred entirely this pass**, including the two safe sub-items, to keep this release's scope to the features actually built and tested below, rather than half-implementing F8. |
| F9 | Monthly Financial Review | **MISSING** | No user-triggered monthly review report exists distinct from the Daily Brief (IM-07). The `Report`/`ReportSection` infrastructure (`src/views/reportView.ts`) already used by the Daily Brief could be reused for this with no new calculation — but assembling and wiring a second report type, action, and screen surface is a non-trivial addition. **Deferred** — see below. |
| F10 | "How is this calculated?" | **PARTIALLY EXISTS** | Every `Insight<T>` already carries `calculationBasis` (`src/domain/insight.ts`), and two widgets (Net Worth Waterfall, Portfolio Growth Decomposition) already rendered it inline before this pass — but it was not surfaced consistently, and never alongside freshness. **Implemented this pass** — see below. |

## What was implemented this pass

Two genuinely missing/partially-existing, safe, additive capabilities,
fully built, tested, and audited:

### F1 — Prioritized "What Needs Attention"

**New file:** `src/views/attentionView.ts` — `buildAttentionPanel(input)`.

A pure aggregator, not a calculator. It takes the intelligence-layer view
objects the Command Center already fetches (`InvestmentIntelligenceView`,
`GoalLiabilityIntelligenceView`, `BehavioralIntelligenceView`, and
`CommandCenterView.portfolio.stalestPriceAgeDays`) and classifies
already-computed facts into three tiers plus a healthy fallback:

- **Critical** — `Financial Anomaly Detector` findings of kind
  `unexplained_position_change` or `goal_balance_anomaly` (real
  data-integrity breaks).
- **Important** — untrusted-records findings; Portfolio X-Ray exclusions;
  a concentration ratio past `flagConcentration`'s own threshold;
  Investment Plan Adherence rows under/over-invested; Goal Collision
  Detector shortfall > 0; a liability excluded from the debt-free
  projection; a goal whose own `missesTargetDate` flag is true.
- **Watch** — stale prices past the existing `STALE_AFTER_DAYS`
  threshold; Historical Coverage gaps; Emergency Fund Runway's own
  `insufficient-data` result (D-017).
- **Healthy** — the *absence* of anything in the three tiers above; never
  a separately computed "all good" claim.

Every item traces to a field an existing IM-03/IM-04/IM-05 view-model
already computed. No new threshold was invented; the 25% concentration
threshold and 7-day staleness threshold are the same pre-existing engine
constants every other v1.0/v1.1 screen already uses.

This replaces the old two-level (`caution`/`info`) "Needs attention" card
content on the Command Center with the tiered panel — the underlying
`DashboardAlert`-producing code in `commandCenterView.ts` is untouched
(frozen engine composition layer), it is simply no longer the sole source
rendered in that card; `getUnexplainedPositionChanges` (used by both the
old alerts and the Financial Anomaly Detector) is the single shared source
for the unreconciled-position-change finding, so nothing is duplicated.

### F3 + F10 — Freshness & "How is this calculated?"

**New component:** `InsightMeta` (`src/components/Primitives.tsx`).

Renders an `Insight<T>`'s own `asOf` and `calculationBasis` — fields that
already exist on every `Insight<T>` (`src/domain/insight.ts`, IM-01) —
as a compact freshness badge ("As of 31 Aug 2026 — data is 3 days old")
plus a collapsible "How is this calculated?" note. No new freshness
system, no new explanation text invented beyond what each widget already
states as its own `calculationBasis`; `now` is deliberately a caller-
supplied reference date (the Command Center's own `asOf`), never
`new Date()`, so server-rendered output stays deterministic between
requests.

Wired onto the eight major intelligence widgets that anchor the primary
Command Center sections (`docs/25_COMMAND_CENTER_V2_SPEC.md`'s sections
2–7): Net Worth Trajectory, Monthly Money Flow, Portfolio X-Ray, Goal
Funding Radar, Debt Freedom Meter, Net Worth Waterfall, Financial Health
Score, and Historical Coverage. Two of these (Net Worth Waterfall,
Portfolio Growth Decomposition's spiritual sibling) already rendered
`calculationBasis` as a raw paragraph before this pass; those were
converted to `InsightMeta` for consistency with freshness.

**Deliberately scoped, not exhaustive:** the remaining ~20 widgets under
"More intelligence" and "Scenario engine" already have `asOf`/
`calculationBasis` on their own `Insight`/`ScenarioResult` objects —
adding `InsightMeta` to them is mechanical (the same three-line pattern
repeated) and is a reasonable follow-up if wanted, not a defect in what
shipped here.

## What was not built this pass, and why

Per the directive's own instruction — "implement only genuinely missing
features that can be added without reopening the financial engine" and
"if a proposed feature requires a financial-engine change... stop and
report it" — the following were deliberately left out of this bounded
release rather than half-built:

- **F2 (drill-down)**, **F6 (unified timeline)**, **F9 (monthly
  review)**: each is architecturally safe (composition-only, no engine
  change) but is a genuinely new, multi-file view + UI surface in its own
  right, not a small addition on top of what already exists. Building
  any of them properly — with its own tests, E2E coverage on both
  viewports, empty/insufficient-data/stale states, and documentation —
  is a full feature slice comparable in size to a single v1.1 IM
  milestone, not a "polish" increment alongside F1/F3/F10 in the same
  pass.
- **F4 (dashboard personalization)** and **F5 (focus mode)**, which
  depends on F4: genuinely missing, safe in principle (local `AppSetting`
  storage, no cloud, no account system), but a real interaction design
  (show/hide, reorder, favorite, compact/expanded, reset) needs its own
  scoped implementation and testing pass, not to be rushed alongside
  everything else here.
- **F8 (milestones)**: the two safe sub-items (goal completion, EMI
  payoff completion) were left out this pass specifically to avoid
  shipping a half-feature — a "Financial Milestones" surface that only
  ever shows two of the six named milestone types would be more
  confusing than none at all, and the other four require an invented
  threshold this project's rules explicitly forbid inventing (the same
  category of gap as D-017).

None of these six required touching the frozen financial engine, and
none is reported as a blocked defect — they are simply out of this
bounded pass's scope, named explicitly so a future increment can pick
them up deliberately.

## Architecture

Unchanged: `DATABASE → DOMAIN ENGINE → ANALYTICS → VIEW MODEL → UI`.
`attentionView.ts` sits at the view-model layer, composing already-
fetched view-model outputs — it performs no database access of its own
and calls no `src/domain/*` function directly (everything it reads was
already computed by IM-03/IM-04/IM-05's own view models). `InsightMeta`
is a pure presentation component; it performs no calculation.

- **No authoritative financial arithmetic was added to React.** Every
  number `InsightMeta` and the attention panel display was already
  computed server-side.
- **AI is untouched** — `src/ai/*` was not touched in this pass.
- **Reused, not duplicated:** `Insight.asOf`/`calculationBasis`
  (IM-01), `AnomalyFinding` (IM-05), `flagConcentration`'s threshold and
  `STALE_AFTER_DAYS` (both pre-existing engine constants), and
  `GoalProjection.missesTargetDate` (existing domain field) are all read
  directly, never recomputed.

## Files created / modified

- **Created:** `src/views/attentionView.ts`,
  `tests/views/attentionView.test.ts`, `docs/30_V1_1_1_COMMAND_CENTER_POLISH.md`.
- **Modified:** `src/components/Primitives.tsx` (added `InsightMeta`),
  `src/app/page.tsx` (wired the attention panel into "Needs attention";
  added `InsightMeta` to 8 widgets), `tests/e2e/dashboard.spec.ts` (2 new
  tests, laptop + iPad).

## Testing

- **New unit tests:** 5, in `tests/views/attentionView.test.ts` — empty/
  insufficient inputs (healthy-except-D-017 case), critical tier
  (unexplained position change + goal balance anomaly), important tier
  (untrusted records, concentration breach, plan-adherence deviation,
  goal collision, excluded liability, behind-trajectory goal), and watch
  tier (stale prices, missing historical coverage, plus a negative case
  confirming fresh prices are not flagged stale).
- **New E2E tests:** 2 (× 2 viewports = 4 runs) — "shows the unified
  attention panel, prioritized into tiers" (asserts the Critical tier and
  the exact unreconciled-position-change wording actually render against
  demo data, not just that the card exists) and "surfaces freshness and a
  'how is this calculated?' explanation on major widgets" (asserts the
  "As of ..." badge and the calculation-basis text actually appear and
  expand on Portfolio X-Ray).
- **Total after this pass:** 457 unit tests (452 + 5), 136 E2E tests
  (132 + 2×2), all passing.
- **Full regression run, this pass:** `npx vitest run` — 457/457 passing.
  `npx tsc --noEmit` — clean. `npx eslint .` — clean (one
  `react/no-unescaped-entities` finding was caught and fixed during this
  pass, before commit). `npx next build` — clean. `npx playwright test`
  (fresh reseeded demo database) — 136/136 passing, laptop + iPad.
- **Regression check specifically for the "Needs attention" rewrite:**
  the pre-existing "surfaces a position change that no transaction
  explains" E2E test (asserting the literal phrase "changed with no
  recorded transaction") was verified to still pass — the new critical-
  tier item's title was deliberately worded
  ("Position changed with no recorded transaction") to preserve that
  exact substring rather than silently changing user-facing wording a
  test already depended on.

## Visual QA

Both new E2E tests run against both the `laptop` and `ipad` Playwright
projects and passed on both, confirming the attention panel's tier
sections and `InsightMeta`'s freshness badge + expandable note render
correctly (no overflow, no horizontal scroll) at both viewport widths —
consistent with every other v1.0/v1.1 screen's existing responsive
behavior, since both additions reuse the same `.card`, `.note`,
`.alert-list`, and `<details>` styling already defined for the rest of
the app.

## Zero-cost verification

No dependency was added. `package.json`'s `dependencies` are unchanged
from v1.1.0 (`@prisma/client`, `exceljs`, `next`, `react`, `react-dom`).
No new environment variable. No new database table or migration — the
attention panel and `InsightMeta` are both pure, stateless compositions
over data the schema already stores.

## Known limitations

- `InsightMeta` was applied to 8 of the ~29 widgets that carry an
  `Insight`/`ScenarioResult` (the ones anchoring the Command Center's
  primary sections); the rest do not yet show freshness/calculation-basis
  inline, though nothing prevents adding it — see "What was not built."
- The attention panel's Critical/Important/Watch classification is a
  fixed, documented mapping (see F1 above) — it does not learn or adapt,
  by design, since anything more would risk inventing a scoring system
  this project's rules do not sanction.

## Addendum — follow-up pass: F2, F4, F6, F8, F9

Everything above this line is the original bounded pass. In a follow-up
pass, F2, F4, F6, F9, and the two safe sub-items of F8 were implemented,
in that order (F4 first since F2/F5 build on its widget-id scheme).
F5 (Financial Focus Mode) was intentionally left out of this batch — see
below.

- **F4 — Dashboard personalization**: `src/domain/dashboardLayout.ts`
  (pure widget catalog + validation/resolution), persisted on `AppSetting`
  (`src/views/dashboardLayoutStore.ts`, no schema change), edited from a
  new "Dashboard layout" card on Settings, applied to Command Center
  rendering (`src/app/page.tsx` restructured into a widget-id → node map,
  ordered/filtered by `resolveVisibleDashboardWidgets`).
- **F2 — Widget drill-down**: the Net Worth, Portfolio, and Goals summary
  widgets link (in-page anchors, using the stable widget ids F4
  introduced) to the Command Center widget that already holds their
  decomposition/holdings/funding detail — no second calculation.
- **F6 — Unified Wealth Timeline**: new `/timeline` screen
  (`src/domain/timeline.ts` pure composition + `src/views/timelineView.ts`
  DB loader) merging plan records, activities, and position snapshots into
  one chronological, filterable feed. Plan entries keep month-level
  precision rather than fabricating a day.
- **F9 — Monthly Financial Review**: new `/monthly-review` screen
  (`src/views/monthlyReviewView.ts`), a second `Report`
  (`src/views/reportView.ts`'s Fact/Inference/Recommendation structure,
  already reused once for the Daily Brief) scoped to the most recently
  completed month, reusing Analytics' own month-over-month comparison and
  the Budget screen's own monthly summary/plan-vs-reality.
- **F8 — Financial Milestones**: `src/domain/milestones.ts` started with
  the two sub-items needing zero invented threshold (a goal reaching 100%
  funded; a liability's EMI schedule reaching zero payments remaining),
  surfaced in a new "Milestones" Command Center widget. The account owner
  then supplied the remaining thresholds in a later exchange: 6 months of
  essential spending for Emergency Fund (also resolving D-017), 25% of
  income for Overall Savings Rate, and a ₹10L → ₹25L → ₹50L → ₹1Cr chain
  for portfolio value. All five sub-items are now implemented — F8 is
  complete, with every threshold traceable to something the owner
  explicitly stated rather than one invented here.
- **F5 (Financial Focus Mode) was not built** in this batch. It depends
  on F4, which now exists, so it is unblocked — but it was not part of
  what was asked for and is left for a future pass rather than assumed.

Every item above was implemented with its own unit tests (domain-level,
pure-function tests plus DB-backed view tests) and Playwright E2E
coverage, with the full existing regression suite re-run clean after
each one (tsc, eslint, vitest, next build, Playwright) before moving to
the next.
