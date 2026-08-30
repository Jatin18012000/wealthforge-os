# 06 — Database Schema

Storage: SQLite, accessed via Prisma (`docs/decisions/0001-local-persistence.md`).
Schema is frozen for M2 at the shape below; changes after M2 go through a
Prisma migration plus an ADR if the change is structural.

This is the initial schema design (M1 freeze target for M2 implementation).
Field lists are representative of the required data, not exhaustive DDL —
exact column types/constraints are finalized when `schema.prisma` is written
in M2.

## Tables

**source_document**
`id, file_name, file_hash (unique), uploaded_at, kind (budget_workbook |
portfolio_snapshot | manual), raw_blob_path`

**sheet_snapshot**
`id, source_document_id, sheet_name, sheet_kind (month | reference |
unrecognized), classification (new | modified | unchanged | deleted_renamed |
conflict), raw_data_json, imported_at`

**plan_record**
`id, period_month, category (income | expense | investment | emi), label_raw,
label_normalized, amount_minor_units, currency, source_document_id,
sheet_snapshot_id, trust_state, superseded_by_id (nullable, self-reference),
created_at`

**position_snapshot**
`id, instrument_id, as_of_date, quantity, unit, source_document_id,
trust_state, created_at`

**instrument**
`id, kind (equity | etf | mutual_fund | gold | silver | epf | cash),
identifier (ticker/ISIN/scheme code where applicable), display_name`

**valuation**
`id, instrument_id, as_of_date, price_minor_units, currency, source,
fetched_at`

**activity**
`id, kind (buy | sell | sip | goal_contribution | goal_withdrawal |
emi_payment | one_time_income | one_time_expense), instrument_id (nullable),
goal_id (nullable), liability_id (nullable), amount_minor_units, occurred_on,
source_document_id (nullable), trust_state, created_at`

**liability**
`id, name, kind (home_loan | other), principal_minor_units,
outstanding_minor_units, outstanding_as_of, interest_rate_bps, tenure_months,
emi_amount_minor_units, created_at`

**liability_payer_split**
`id, liability_id, payer_name, share_bps, effective_from`

**goal**
`id, name, kind (emergency_fund | car | marriage | third_floor | custom),
target_amount_minor_units, target_date (nullable), priority_rank,
lifecycle_state (planned | in_progress | achieved | on_hold | cancelled),
created_at`
*(current_amount is derived from `activity` rows referencing the goal, never
stored as an independently editable column.)*

**insurance_policy**
`id, kind (health_personal | health_family | term | other), insured_party,
cover_amount_minor_units, premium_minor_units, premium_frequency, provider,
status, effective_from`

**revision**
`id, entity_type, entity_id, original_value_json, revised_value_json, source,
reason (nullable), created_at`

**manual_adjustment**
`id, entity_type, entity_id, source_value_json, adjustment_json,
resulting_value_json, reason (nullable), created_at`

**audit_event**
`id, kind (import | revision | manual_override | rule_change | backup |
restore), payload_json, created_at`

**app_setting**
`id, key (unique), value_json, updated_at`

## Indexing notes (M2)

- Unique index on `source_document.file_hash` to make repeated uploads
  detectable/idempotent at the file level, in addition to sheet-level
  content diffing.
- Index `plan_record(period_month, category)` and
  `position_snapshot(instrument_id, as_of_date)` for the query patterns
  Analytics needs.
- `activity(goal_id, occurred_on)` for goal balance derivation and history.

## Historical query support

Because revisions never delete originals, "what did we believe about period
X at time T" is answered by querying `plan_record`/`revision` rows created at
or before T; "what do we currently believe" is answered by following each
record's `superseded_by_id` chain to its current head.
