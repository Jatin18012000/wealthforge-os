# 11 — Analytics Spec

Status: **built (M7)** — `src/domain/periods.ts` (period resolution),
`src/domain/analytics.ts` (aggregation, coverage, comparison),
`src/views/analyticsView.ts`, and the `/analytics` screen.

## The governing rule: never pro-rate a month

Different data has different granularity, and pretending otherwise invents
figures:

- **Budget data is monthly.** A month contributes to a range only when the
  range *fully contains* it. A 15-day window touching August cannot take
  "half of August's salary" — that number appears in no source. Months the
  range merely clips are excluded and the exclusion is stated.
- **Activity is exactly dated**, so it sums precisely over any range.
- **Portfolio and net worth are point-in-time**, compared at the range's
  endpoints rather than summed.

Every result carries a `PeriodCoverage`: which months were counted, which
were only partly inside the range, and which had no data at all. A month
with no data is reported as *absent*, never as zero.

## Comparison basis

The default comparison is the equal-length period immediately before. For
month-aligned ranges the shift is by whole calendar months, because that is
what the comparison means — the month before July is June, even though
subtracting July's 31 days lands on 31 May. Ranges that are not month-aligned
shift by their exact duration, the only well-defined answer for them.
"Same period last year" is offered as an alternative basis.

A metric absent on either side yields nulls and is marked incomplete rather
than being treated as zero: the difference between "spent nothing" and "we
have no record" is exactly what a variance table must not blur.

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
