# 05 — Domain Model

Core entities. This is the conceptual model; `06_DATABASE_SCHEMA.md` is its
physical implementation in SQLite/Prisma. Every entity that represents an
imported or user-entered financial fact carries provenance and a trust state
(`08_DATA_TRUST_MODEL.md`).

## Entities

- **Source / Document** — an uploaded file (workbook) or a manual-entry
  session. Fields: file name, file hash, uploaded-at, type.
- **Sheet Snapshot** — one worksheet as scanned during one import: sheet
  name, source document, raw extracted cell data, classification
  (NEW/MODIFIED/UNCHANGED/DELETED-RENAMED/CONFLICT) relative to the previous
  import.
- **Plan Record** — a budgeted/intended value for a period: month, category
  (income/expense/investment/EMI), label (normalized + original), amount,
  source, revision chain.
- **Position Snapshot** — a dated holding: instrument, quantity/units, as-of
  date, source, trust state. Covers stocks, ETFs, MF units, gold/silver,
  EPF balance, cash.
- **Activity / Transaction** — a confirmed event: buy/sell, SIP execution,
  goal contribution/withdrawal, EMI payment, one-time income/expense. Always
  dated and sourced.
- **Liability** — a loan/EMI: principal, outstanding balance (dated),
  interest rate, tenure, EMI amount, payer split (who pays what share),
  projected release schedule.
- **Goal** — name, target amount, current amount (derived from contributions
  minus withdrawals), target date, priority rank, funding method(s),
  lifecycle state (Planned/In Progress/Achieved/On Hold/Cancelled),
  contribution/withdrawal transaction history.
- **Valuation** — a dated price/NAV for an instrument, with source and
  freshness metadata.
- **Insurance Policy** — type (health/term/other), insured party, cover
  amount, premium, provider, status.
- **Revision** — links an original record to a corrected value: original
  value, revised value, source of correction, timestamp, reason/status where
  available. Never deletes the original.
- **Manual Adjustment** — an explicit user override layered on a source
  value: source value, adjustment, resulting current value, timestamp,
  reason (optional).
- **Audit Event** — an immutable log entry for imports, revisions, manual
  overrides, rule changes (e.g. salary-split ratio), and restores.
- **Setting** — application configuration: salary-split ratio, thresholds,
  active data sources, feature toggles.

## Relationships (high level)

- A `Source/Document` produces one or more `Sheet Snapshot`s.
- A `Sheet Snapshot` produces zero or more `Plan Record`s (and may update
  existing ones via a `Revision`).
- A `Goal` accumulates `Activity` records (contributions/withdrawals) that
  determine its current amount; it never stores a hand-edited current-amount
  total that could drift from its transaction history.
- A `Liability` has a payer split that determines each payer's contribution
  to EMI `Activity` records.
- Every `Plan Record`, `Position Snapshot`, `Activity`, `Liability`, and
  `Insurance Policy` value that can be overridden has an optional chain of
  `Manual Adjustment`s and a trust state.

## Invariants

- A `Goal`'s current amount is always derivable by summing its contribution/
  withdrawal `Activity` records — it is never an independently mutable field.
- A `Revision` never deletes the record it revises.
- Net worth, portfolio value, and other headline aggregates only include
  records whose trust state is `Validated` or `Verified`
  (`08_DATA_TRUST_MODEL.md`).
- Every `Manual Adjustment` references the record and source value it
  adjusts; it cannot exist without them.
