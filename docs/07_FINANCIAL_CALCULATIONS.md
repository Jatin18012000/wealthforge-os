# 07 — Financial Calculations

All formulas below live exclusively in `src/domain/` (M4). No UI component,
API route, or AI prompt computes these independently.

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

Computed only when there are at least two dated cash-flow/valuation points
sufficient to solve the calculation meaningfully (implementation must define
and document the minimum data requirement precisely in M4, e.g. minimum
history length and minimum number of cash flows for XIRR convergence). If the
requirement is not met, the engine returns `insufficient-data` — it never
approximates using an assumed rate or a shorter/incompatible period.

## Rounding & currency handling

- All monetary values are stored and computed as integer minor units (paise)
  or exact decimal types. No floating-point arithmetic on money.
- Rounding to display units (rupees) happens only at the presentation layer,
  using consistent round-half-to-even, applied once per displayed figure —
  never accumulated by rounding intermediate values.
