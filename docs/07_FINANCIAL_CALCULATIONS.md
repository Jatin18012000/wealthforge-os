# 07 — Financial Calculations

All formulas below live exclusively in `src/domain/` (M4). No UI component,
API route, or AI prompt computes these independently.

**Implemented** (M4): `money.ts`, `dates.ts`, `result.ts`, `trust.ts`,
`netWorth.ts`, `portfolio.ts`, `budget.ts`, `goals.ts`, `liabilities.ts`,
`returns.ts`. The layer is framework-free and database-free — an ESLint rule
blocks React/Next/AI imports, and database rows reach it only through
`src/data/loaders.ts`, which maps rows to plain data and performs no
arithmetic.

## The `Computed<T>` contract

Every calculation that can fail for lack of data returns
`Computed<T> = { kind: "ok", value } | { kind: "insufficient-data", reasons }`.
There is deliberately no default, estimate, or assume-zero path anywhere in
the engine. Callers must handle the insufficient case explicitly, which is
what makes "Insufficient data" reach the UI instead of a fabricated figure.

Totals additionally report an `exclusions` list — every record left out and
why — so a number is never quietly smaller than the user expects.

## Net worth

```
net_worth = Σ(trusted asset values) − Σ(trusted liability outstanding balances)
```
"Trusted" = trust state `Validated` or `Verified`. Assets: cash + portfolio
value + EPF balance + any other tracked asset. Liabilities: outstanding loan
balances as of the same as-of date used for assets.

## Portfolio valuation

```
position_value(instrument, as_of) = quantity(instrument, as_of) × price(instrument, as_of_or_before)
```
Never uses a price dated after `as_of`. If no price exists at or before
`as_of`, the instrument's value is reported as `insufficient-data`, not zero
and not the nearest-future price.

## P&L

Computed only when cost-basis/transaction history is sufficient to establish
an acquisition cost for the position being evaluated. Otherwise:
`insufficient-data`. Corporate actions (splits/bonuses/mergers) are explicit
user-entered records; a bare quantity change between two snapshots is never
treated as an implicit buy/sell for P&L purposes.

## Savings rate / investment rate / monthly surplus

```
monthly_surplus   = take_home_income − total_expenses (for the month)
savings_rate      = (take_home_income − total_expenses) / take_home_income
investment_rate   = total_investment_contributions / take_home_income
```
All three use the effective (current, post-revision, post-manual-adjustment)
value of income/expense/investment for the month.

## Budget vs Actual / Plan vs Reality

```
variance_absolute   = actual − planned
variance_percentage = (actual − planned) / planned      (undefined/flagged if planned = 0)
```
"Planned" comes from `plan_record`; "actual" comes from `activity` /
confirmed data for the same period and category. A period lacking confirmed
activity data is flagged as incomplete, not treated as zero actual.

## Asset allocation & concentration

```
allocation_pct(class) = Σ(trusted value in class) / Σ(trusted total portfolio value)
concentration(instrument) = trusted value(instrument) / Σ(trusted total portfolio value)
```
A configurable concentration threshold (Settings) flags single-instrument
over-exposure for the AI Analyst and dashboard alerts to surface — the
threshold itself is not hardcoded into the formula.

## EMI burden & release

```
emi_burden(payer) = Σ(payer's share of EMI, per liability_payer_split) / payer's take_home_income
```
Release schedule uses the liability's remaining tenure and confirmed EMI
`activity` records, not an assumed straight-line schedule if actual payments
deviate.

## Goal progress

```
current_amount(goal) = Σ(contribution activity) − Σ(withdrawal activity)     [never a stored field]
remaining_amount(goal) = target_amount − current_amount(goal)
```
Goal progress distinguishes:
- **allocated cash** — cash earmarked to the goal but not yet invested,
- **invested assets** — the goal's share of actual holdings, where a goal is
  funded through investment rather than a cash bucket,
- **projection** — a forward estimate under stated assumptions, always
  labeled as a projection, never merged into the current-amount figure.

## CAGR / XIRR

Minimum data requirements, as promised in M1 and now fixed in code
(`src/domain/returns.ts`):

**CAGR** requires a starting value greater than zero (there is no base to
compound from otherwise), a non-negative ending value, an end date after the
start date, and a window of at least **90 days** (`MIN_ANNUALIZATION_DAYS`).
The 90-day floor exists because annualizing a very short window amplifies
ordinary noise into an absurd headline — a 2% move over four days annualizes
past 500%. That figure is arithmetically correct and financially
meaningless, so the engine refuses it.

**XIRR** requires at least two dated cash flows, at least one negative and
one positive (without money moving both ways there is no rate to solve for),
a span of at least 90 days, and actual convergence. Newton-Raphson runs
first, with bisection over −99.99%…1000% as a fallback when Newton wanders
on irregular flow patterns. If neither converges, the result is
`insufficient-data` — never a nearby rate, never a simple return relabelled
as an XIRR.

**P&L** is computed only against a recorded cost basis. A position whose
acquisition cost was never captured returns `insufficient-data`; inferring
a cost from a later price would manufacture a gain or loss that no
transaction supports.

## Rounding & currency handling

- All monetary values are stored and computed as integer minor units (paise).
  No floating-point arithmetic on money. `sumMinorUnits` throws on a
  non-integer input rather than truncating it silently.
- Rounding is round-half-to-even, applied once per derived figure — never
  accumulated by rounding intermediates. Half-to-even rather than half-up
  because half-up biases every tie in the same direction, which compounds
  across a year of records.
- Where a rounded split must reconstitute a whole (an EMI divided among
  payers), the final share absorbs the remainder so the parts sum back to
  exactly the total.

## Month arithmetic

`addMonthsClamped` (`src/domain/dates.ts`) clamps the day to the target
month's last day. The naive `setUTCMonth(m + n)` overflows: 31 August plus
10 months yields 1 July rather than 30 June, and that single day is enough
to flip a goal projection from "meets the target date" to "misses it". This
was a live defect caught by the M4 test suite, not a hypothetical.
