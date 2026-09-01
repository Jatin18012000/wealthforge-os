# 25 — Command Center 2.0 Spec (v1.1, IM-08)

## What changed

A full reorganization of `src/app/page.tsx` into the exact section order
the v1.1 directive specifies. No new calculation, no new view model, and
no widget removed — every card built across IM-01 through IM-07 is still
on the page; this milestone only changes *where*.

## Section order (laptop-first, iPad-responsive)

1. **WealthForge Daily Brief** (new placement, IM-07's feature) — a
   compact card with a "Generate daily brief" button and, once generated,
   the grounded response inline. Triggered by a new
   `explainDailyBriefFromHomeAction` (`src/app/ai-analyst/actions.ts`)
   that redirects to `/?brief=<id>` instead of `/ai-analyst?brief=<id>` —
   otherwise byte-for-byte the same `runGroundedExplanation` pipeline the
   AI Analyst screen's own Daily Brief button already uses. The AI
   Analyst screen keeps its own copy of the button too; nothing was
   removed from it.
2. **Tiles** — Net worth, Cash, Portfolio, Liabilities (unchanged from
   v1.0).
3. **Net worth trajectory & money flow** — IM-02's Net Worth Trajectory
   and Monthly Money Flow.
4. **Portfolio X-Ray & risk** — IM-03's Portfolio X-Ray, paired with
   Concentration Heatmap and Drawdown Monitor as "risk."
5. **Plan vs reality & adherence** — the v1.0 "This month" budget summary
   card (kept verbatim — this is what the existing "derives left over
   cash from the month's own components" E2E test asserts, so its exact
   text was preserved rather than rebuilt), a **new** "Plan vs reality"
   card exposing `CommandCenterView.budget.planVsReality`
   (`comparePlanVsActual`, M4/M7 — already computed everywhere else the
   Budget screen needed it, simply never rendered on the Command Center
   before), IM-03's Planned vs Actual Allocation, and IM-03's Investment
   Plan Adherence.
6. **Goal radar & EMI freedom** — the v1.0 "Goals in priority order" card
   (kept verbatim), IM-04's Goal Funding Radar, Debt Freedom Meter, and
   EMI Release Timeline.
7. **Wealth waterfall & financial health** — IM-02's Net Worth Waterfall
   and IM-05's Financial Health Score.
8. **What needs attention & data health** — the v1.0 "Needs attention"
   alerts card (kept verbatim, now always rendered with an `EmptyState`
   rather than being omitted when there are no alerts, so the section
   pairing is stable) and IM-05's Data Health.
9. **More intelligence** — everything else built in IM-02 through IM-06
   that the directive's specified order does not name explicitly: Savings
   & Investment Rate Trend, Portfolio Growth Decomposition, Contribution
   vs Return, Portfolio Performance, Portfolio vs Benchmark, Goal
   Collision Detector, Emergency Fund Runway, Goal Trade-Off Simulator,
   What's Changed, Financial Anomaly Detector, Historical Coverage.
10. **Scenario engine** — IM-06's SIP Increase Simulator, Debt Prepayment
    Simulator, Wealth Projection, and Financial Independence Projection
    (unchanged placement and content from IM-06 — this section was
    already last on the page and stays last).

## What did not change

- **No view model changed.** Every `get*IntelligenceView`/
  `getScenarioEngineView`/`getCommandCenterView` call in `page.tsx` is
  identical to before this milestone; only the JSX order was rearranged.
- **No widget's inner markup or figures changed**, with one exception: the
  "Needs attention" card is now always rendered (with `EmptyState` when
  there are no alerts) instead of being conditionally omitted, so its
  pairing with "Data health" in section 8 is always present. This does
  not change what the card shows when there are alerts.
- **`src/ai/*` is untouched** (same as IM-07) — the Daily Brief triggered
  from the Command Center goes through the exact same
  `explainReport`/`checkGrounding` pipeline.

## Responsiveness

Reuses the same `grid grid--halves` / `grid grid--tiles` CSS classes and
`Card` component every other screen already uses — no new design system,
no new breakpoints. The existing E2E accessibility check ("does not
scroll horizontally at iPad width, on any screen") already covers `/` in
its `SCREENS` array and continues to pass unchanged.

## Testing

- `tests/e2e/dashboard.spec.ts`:
  - "shows the Command Center 2.0 primary section order" — asserts all
    eight primary section `h2`s are present and appear in strictly
    increasing vertical position on the page (via `boundingBox().y`),
    which is the actual, literal test of "this is the order the directive
    specified," not just "these headings exist somewhere."
  - "shows every widget from IM-02–IM-05 somewhere on the redesigned
    Command Center" — a full regression check that nothing was dropped
    during the reorganization.
  - "generates the Daily Brief from the top of the redesigned Command
    Center" — clicks the new button, confirms the same AI-unavailable
    outcome the AI Analyst screen's own Daily Brief button already
    reaches in this sandbox (no reachable Ollama).
  - The four old per-milestone section tests ("shows the wealth
    intelligence section", "shows the investment intelligence section",
    "shows the goal & liability intelligence section", "shows the
    behavioral & data intelligence section") were retired: the h2
    headings they asserted (`Wealth intelligence`, `Investment
    intelligence`, etc.) no longer exist as literal section titles under
    the new structure. Every widget those tests checked is still verified
    by the two new tests above.
  - All pre-existing Command Center tests ("shows the headline figures",
    "surfaces a position change that no transaction explains", "derives
    left over cash from the month's own components") pass unchanged —
    their exact target text was preserved verbatim during the reorder.
