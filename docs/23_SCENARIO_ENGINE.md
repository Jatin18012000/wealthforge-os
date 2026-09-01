# 23 — Scenario Engine (v1.1, IM-06)

Governs every "what if" widget in the intelligence layer: SIP Increase
Simulator, Debt Prepayment Simulator, Wealth Projection, Financial
Independence Projection (this module), plus Goal Trade-Off Simulator
(IM-04, cross-referenced here rather than duplicated).

## Non-negotiable rules

1. **Never mutate a real record.** A scenario reads trusted data and
   returns a computed result; it never writes to `Goal`, `Liability`,
   `Activity`, `PlanRecord`, or any other table. Verified by a test
   (`tests/views/scenarioEngineView.test.ts`) that diffs the liability row
   before and after running the Debt Prepayment Simulator.
2. **Every growth-rate assumption is observed, never invented.** Each
   simulator that compounds a rate over time (SIP Increase Simulator,
   Wealth Projection, Financial Independence Projection) derives that rate
   from `computeCagr` between the earliest recorded data (`inceptionDate`)
   and now — the portfolio's own CAGR for the SIP simulator, net worth's
   own CAGR for the wealth/FI projections. Where that CAGR cannot be
   computed (insufficient history, non-positive opening value, a span
   under `MIN_ANNUALIZATION_DAYS`), the whole widget reports
   `insufficient-data` rather than substituting an assumed market return.
   This is the same discipline `docs/07_FINANCIAL_CALCULATIONS.md` already
   requires of every other headline return figure in the app.
3. **Illustrative parameters are labeled as illustrative, not as a
   recommendation.** The SIP Increase Simulator's 0%/10%/25% increase
   points and the Debt Prepayment Simulator's ₹0/₹2,000/₹5,000 extra
   payments exist to demonstrate the mechanism — "here is what a larger
   contribution would do" — not to assert that the user should adopt any
   one of them. Every rendering of these widgets carries a note saying so.
4. **External methodological conventions are disclosed as assumptions,
   never presented as this system's own rule.** The Financial Independence
   Projection's FI target (25× annual expense, the widely-used "4% rule")
   is a well-known external convention, not a WealthForge-specific
   financial rule invented for this feature. It is stored in
   `ScenarioResult.assumptions` (`safeWithdrawalRateBps`,
   `fiTargetMinorUnits`) and stated in `calculationBasis` and the UI, per
   `CLAUDE.md`'s rule against inventing an undocumented financial
   threshold.
5. **Deterministic.** Every simulator is a pure function of its inputs —
   same trusted data and same assumptions always produce the same result.
   No randomness, no external service calls (the whole engine is
   zero-cost and local-first per `CLAUDE.md`'s Cost Philosophy).
6. **Assumptions are always retained alongside the result**
   (`ScenarioResult.assumptions`), and the standard disclaimer
   ("This is a projection based on the stated assumptions, not a guarantee
   of future results.", `SCENARIO_DISCLAIMER` in `src/domain/insight.ts`)
   is always attached and always rendered.
7. **`base`/`conservative`/`optimistic` bands are used only when a
   defensible source exists for the offset.** None of the IM-06 widgets
   populate `conservative`/`optimistic` today: there is exactly one
   observed growth rate per widget, and inventing an arbitrary percentage-
   point offset above/below it to manufacture a band would itself be an
   undisclosed invented number. `ScenarioResult` explicitly allows omitting
   these fields (not `null`) for exactly this reason. A future milestone
   may add them if a defensible basis is found (e.g. the spread already
   observed across the portfolio's own asset classes) — not before.

## Domain math (`src/domain/scenarios.ts`)

New, deterministic functions — nothing else in the engine already
computes a future value or amortizes a loan, so these are genuinely new
calculation paths, not duplicates of an existing one:

- **`projectFutureValue(input)`** — future value of a lump sum plus a
  level monthly contribution, compounded monthly at the effective monthly
  rate of a supplied annual growth ratio. Standard annuity-with-lump-sum
  formula. Refuses a non-positive horizon or a growth ratio ≤ −100%.
- **`monthsUntilTarget(...)`** — bounded month-by-month walk (default
  limit `PROJECTION_SEARCH_LIMIT_MONTHS` = 600) to find how many months
  until a compounding balance first reaches a target. Reports
  insufficient-data rather than returning a number past the search limit.
- **`simulateDebtPrepayment(...)`** — reducing-balance amortization at a
  fixed monthly payment (EMI plus any extra), bounded at
  `AMORTIZATION_SEARCH_LIMIT_MONTHS` = 1,200 months. Refuses when the
  payment does not even cover the first month's interest, rather than
  looping forever.

## View composition (`src/views/scenarioEngineView.ts`)

| Widget | Growth rate source | Contribution source | Assumptions disclosed |
|---|---|---|---|
| SIP Increase Simulator | Portfolio's own CAGR (inception → now) | Latest month's planned investment amount, scaled by illustrative %s | Current monthly SIP, observed CAGR |
| Debt Prepayment Simulator | n/a (deterministic amortization) | n/a | Illustrative extra-payment amounts |
| Wealth Projection | Net worth's own CAGR (inception → now) | Latest month's retained cash (income − expense − EMI) | Opening net worth, monthly retained cash, observed CAGR |
| Financial Independence Projection | Same as Wealth Projection | Same as Wealth Projection | Safe withdrawal rate (4%), FI target, annual expense, observed CAGR |

Each is wired into the Command Center's "Scenario engine" section
(`src/app/page.tsx`), rendered after "Behavioral & data intelligence".

## Testing

- `tests/domain/scenarios.test.ts` (13 tests): `projectFutureValue`
  (zero-growth exact sum, a clean-number doubling case, non-positive
  horizon, growth ≤ −100%, monotonic increase with growth rate),
  `monthsUntilTarget` (already-met target, reachable target, unreachable
  target within the search limit, non-positive target), and
  `simulateDebtPrepayment` (matches the standard EMI formula's own
  implied payoff month exactly, prepaying more shortens payoff and
  reduces interest, refuses a payment below first-month interest, refuses
  a non-positive balance).
- `tests/views/scenarioEngineView.test.ts` (5 tests): an empty-database
  case (every widget insufficient-data) and a real-fixture case covering
  all four widgets' `ok` paths, including the never-mutates-a-real-record
  check on the Debt Prepayment Simulator.
- `tests/e2e/dashboard.spec.ts`: verifies the "Scenario engine" section
  and all four widget headings render on the Command Center, and that the
  standard disclaimer text is present, on both laptop and iPad viewports.
