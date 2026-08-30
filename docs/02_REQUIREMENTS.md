# 02 — Requirements

This is the requirements source of truth for implementation. Baselines here
come directly from the two controlling documents (30 Aug 2026). If a later
workbook or user decision supersedes a value here, record the change as a
dated entry in `docs/decisions/` and update this file in the same commit —
never edit history silently.

## Current financial baseline (as of August 2026)

| Area | Baseline / rule |
|---|---|
| Age | 26 |
| Monthly investment baseline | ₹19,500 |
| Employee PF | ₹2,838 (included within the ₹19,500 investment figure) |
| Employer PF | ₹2,838 (employer-side, tracked separately) |
| Liquid cash baseline | ₹27,000 |
| Home/LAP outstanding | ~₹23.73 lakh estimated as of Aug 2026 |
| Household EMI | ~₹28,416 |
| User's home-loan contribution | ₹10,000/month from Jul/Aug 2026; father and brother cover the balance |
| Personal health insurance | ₹2.5 lakh cover |
| Family health insurance | Aditya Birla One NXT; ₹10 lakh cover per family member |
| Term insurance | Planned by end of 2026 (not yet in force) |
| Car | ₹10–13 lakh on-road affordability ceiling; aspirational target Kia Seltos with sunroof configuration; latest target date December 2027 |
| Marriage | ₹8–10 lakh total; father ₹2.5L + brother ₹2.5L; user expected ₹3–5L |
| Third-floor construction | Active goal; ~₹10 lakh estimate; two 55-gaj 2-BHK rental units; expected gross rent ₹15,000–18,000 per unit per month |
| PS5 | Active manual goal |
| Apple Watch | Achieved goal (₹25,000, 9-month no-cost EMI); retained in historical goal records; EMI remains a cash-flow item until the EMI term completes |
| Family contingency fund | Secondary support only — never counted as the primary emergency fund |

## Goal priority order (fixed unless explicitly changed by the user)

1. Emergency fund
2. Car
3. Marriage
4. Third-floor construction

## Salary dynamics

- The salary/take-home figure entered in the monthly budget workbook (or
  manual override) is the single source of truth for salary. All dependent
  calculations recompute when it changes.
- Incremental take-home salary increases default to: 50% investments / 30%
  current top-priority goal / 20% lifestyle. This ratio must be configurable
  in Settings and manually overridable per increment.

## Manual override requirement — every one of these must be editable

Salary/take-home, individual SIPs and total investment, employee/employer PF,
emergency-fund contributions, all goals (target/current/contributions/
withdrawals), EMIs (amount/end date/payer split), cash, stock/ETF quantities
and cost basis corrections, MF units/NAV corrections, gold/silver holdings,
insurance policies, car assumptions, one-time income, one-time expenses, and
any custom user-defined financial variable.

## Budget ingestion requirement

The recurring budget is a multi-sheet Excel workbook (month-wise sheets plus
reference sheets such as "Core expenses"). See `09_INGESTION_ARCHITECTURE.md`
for the full ingestion contract. Every upload re-reads the entire workbook —
never only the newest or changed sheet — and produces an Import Audit.

## Analytics requirement

Universal period selector: 15 days, 30 days, 1 month, 3, 6, 9, 12 months, 1–5
years, and Custom, with optional YTD/Financial Year/previous-period presets.
Must support period comparison (absolute and percentage variance), Plan vs
Reality, planned vs observed allocation, and filtering by asset class,
instrument, source/provider, activity, and metric. See
`11_ANALYTICS_SPEC.md`.

## Market data requirement

Track Nifty 50, Sensex, Nifty Bank, and Nifty Metal, plus the user's tracked
instruments where a data source supports it. Always show data freshness;
never present stale data as live; never fabricate a missing price. No
automatic trade execution under any circumstance.

## AI requirement

The AI layer explains, summarizes, identifies patterns/anomalies/
concentration/stale data, and suggests actions — grounded strictly in
already-computed trusted domain output. It must never invent a balance,
price, NAV, transaction, or coverage figure, and must say so explicitly when
data is insufficient. See `12_AI_ANALYST_SPEC.md`.

## Backup requirement

Both automatic backup and manual full export/import/restore. A restore must
never silently destroy data that is newer than the backup being restored — a
conflict must be surfaced to the user, and a safety backup must be taken
before any restore proceeds. See `16_DATA_MIGRATION.md`.

## Out of scope for v1

See `01_PRODUCT_VISION.md` "Non-goals" and `00_MASTER_PLAN.md` "Non-goals".
