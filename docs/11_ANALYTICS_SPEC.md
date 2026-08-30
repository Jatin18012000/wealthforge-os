# 11 — Analytics Spec

Status: implemented in M7, built on top of the M4 engine and M5 portfolio
ingestion.

## Periods

15 days, 30 days, 1 month, 3 months, 6 months, 9 months, 12 months, 1 year,
2 years, 3 years, 4 years, 5 years, Custom. Where data permits: YTD,
Financial Year, Previous Month, Previous Quarter, Previous Financial Year,
Since Inception.

One global period selector drives Command Center, Budget, Portfolio, and
Analytics consistently — see `03_INFORMATION_ARCHITECTURE.md`.

## Comparison

- Default comparison target: the immediately preceding period of the same
  length (e.g. this quarter vs previous quarter).
- Custom comparison: any two arbitrary periods (e.g. August 2026 vs February
  2027, June 2026 vs June 2027, last 3 months vs the 3 months before that).
- Output: absolute variance and percentage variance per metric.

## Filters

Asset class, instrument, source/provider, activity kind, and metric. Filters
compose (e.g. "equity instruments from Zerodha only, SIP activity only").

## Plan vs Reality

Compares `plan_record` (intended) against `activity`/confirmed data
(actual) for the same period and category, per `07_FINANCIAL_CALCULATIONS.md`.
Also supports planned allocation vs. observed/actual allocation across asset
classes.

## Data-coverage warnings

Any period or comparison where one side has incomplete data (a month not yet
ingested, an instrument with no valuation in range) is explicitly labeled as
having incomplete coverage. The system never silently treats missing data as
zero, and never blends a fully-covered period with a partially-covered one
without saying so in the output.

## Acceptance

"Any supported period can be compared, with a coverage warning where
applicable" (source doc, acceptance criteria) — tested directly in M7 with
fixtures that include an intentionally incomplete period.
