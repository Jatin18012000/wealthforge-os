# 03 — Information Architecture

## Screens

| Screen         | Core content                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Command Center | Net worth, cash, portfolio, liabilities, surplus, goals, alerts, data freshness                              |
| Budget         | Current/historical months, income/expense/investment, EMI releases, Plan vs Reality                          |
| Portfolio      | Stocks/ETFs/MFs/metals/EPF, P&L, allocation, concentration                                                   |
| Goals          | Emergency fund, car, marriage, third floor, PS5, and user-created buckets                                    |
| Liabilities    | Balances, EMI, payer split, interest/tenure, projected releases                                              |
| Insurance      | Coverage, premiums, term-insurance gap/status — built (post-M12, R2-01)                                      |
| Analytics      | Universal periods, filters, comparisons, trends                                                              |
| Data Center    | Imports, revisions, provenance, trust states, audit log, backup/restore                                      |
| Settings       | Manual overrides, assumptions, thresholds, data sources — built (M8), see `docs/features/manual-controls.md` |
| AI Analyst     | Grounded explanations, risk/deviation analysis, recommendations                                              |

## Navigation model

Single global period selector (Analytics spec, `11_ANALYTICS_SPEC.md`)
applies across Command Center, Budget, Portfolio, and Analytics views so the
user is never comparing two screens that silently use different windows.

Every headline number that is derived from underlying records is drillable:
clicking it opens a detail view showing the contributing records and their
provenance/trust state, down to source file/sheet/field where applicable
(`08_DATA_TRUST_MODEL.md`).

## Cross-cutting UI states

- **Data freshness banner** — shown wherever market-derived or time-sensitive
  data is displayed; states the as-of time and source.
- **Insufficient data** — shown instead of a computed figure (e.g. CAGR/XIRR)
  when the underlying data doesn't support it, rather than omitting context
  silently.
- **Trust state indicator** — any record that is not `Validated`/`Verified`
  is visually distinguished wherever it contributes to a total.
- **Import Audit summary** — surfaced immediately after any workbook upload,
  not buried in a log.

Full screen-by-screen layout and component detail: `10_DASHBOARD_SPEC.md`
(built starting M6 — UI is deliberately not built before the data model and
engine are trustworthy, see `00_MASTER_PLAN.md`).
