# 14 — Testing Strategy

## Tooling

- **Vitest** — unit, domain, and integration tests.
- **Playwright** — E2E and UI tests, from M6 onward.
- Tests are written alongside the feature they cover, in the same change —
  never batched into a later "add tests" pass (`CLAUDE.md` §9).

## Required test classes

- Unit tests (domain formulas, per `07_FINANCIAL_CALCULATIONS.md`).
- Property/invariant tests (e.g. a goal's current amount always equals the
  sum of its contribution/withdrawal activity, for any generated sequence).
- Integration tests: import → normalize → validate → persist → calculate →
  render, exercised end-to-end against fixtures.
- Golden workbook fixtures (`tests/fixtures/`).
- Historical revision tests (corrected-month scenario).
- Idempotent repeated-import tests (identical re-upload → zero new records).
- Sheet rename/delete tests.
- Backup/restore equivalence tests (state before backup == state after
  restore, for an unmodified round trip).
- Market freshness/missing-data tests.
- Goal reconciliation tests (allocation never double-counts cash).
- EMI payer-split tests.
- AI grounding tests (every numeric claim in an AI response traces to the
  grounding payload; a response is rejected/flagged if not).

## Continuous audit system

Run after every meaningful coding increment, per `CLAUDE.md` §10:

| Layer | Required check |
|---|---|
| Code | Typecheck, lint, formatting, dead-code scan |
| Domain | Formula unit tests and invariants |
| Data | Constraints, duplicates, provenance, revision tests |
| Ingestion | Real workbook fixture + malformed + modified-history fixtures |
| Regression | Relevant prior suite |
| UI | Visual/responsive checks |
| Security | No secrets, safe local file/import handling |
| Performance | Import/render performance checks |
| Accessibility | Keyboard, labels, semantics, contrast |
| Documentation | Specs/decisions/known gaps current |
| Release | Full suite + smoke + restore + acceptance tests |

## Audit checklist — financial features

Arithmetic, rounding, date/month boundaries, duplicate records, missing/null/
zero/negative/unusually-large values, currency handling, historical
revisions, source provenance, manual overrides, reconciliation, double
counting, stale prices, missing NAV, changed quantities without a
transaction, EMI end dates, payer splits, goal balances, portfolio
valuation.

## Audit checklist — ingestion

Repeated upload, modified workbook, corrected historical month, renamed
sheet, deleted sheet, new sheet, unexpected sheet, malformed cells,
malformed dates, formula cells, blank rows, duplicate rows, column changes.

## Fixtures

`tests/fixtures/budget/` holds a synthetic 2026-style workbook (May, June,
July, August, Core expenses sheets) plus modified/malformed/renamed/deleted
variants for the ingestion test classes above. See `19_OPEN_DECISIONS.md`
for why these are synthetic rather than the real workbook.

## Definition of Done gate

No feature, increment, or milestone is marked complete without this
section's relevant checks having actually been run in the session that
claims completion (`CLAUDE.md` §14, source build plan §32 "No fake
completion").
