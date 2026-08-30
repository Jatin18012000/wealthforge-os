# 09 — Ingestion Architecture

## Scope

The recurring budget workbook: a multi-sheet Excel file with month-wise
sheets (the current 2026 workbook, per the controlling documents, contains
May, June, July, August, and a "Core expenses" reference sheet — see
`19_OPEN_DECISIONS.md` for the fact that no actual workbook file was present
in this build workspace, so the fixture in `tests/fixtures/` is a
representative synthetic reconstruction of this structure, not the real
file).

## Pipeline (every upload, no exceptions)

1. **Hash & store** the uploaded file as a `source_document`; compute a file
   hash to make whole-file idempotency detectable up front.
2. **Scan every worksheet** — never only the newest or a "changed" sheet.
3. **Classify each sheet** as `month` or `reference`/`unrecognized`, by name
   pattern and, where ambiguous, content shape (per
   `18_FAILURE_MODES.md` "unexpected sheet").
4. **Extract** income, expense, investment, and EMI fields per sheet
   according to the workbook's label conventions, preserving the original
   label text alongside a normalized label.
5. **Diff against stored history**: for each sheet, compare extracted content
   (not just sheet name) against the most recent stored version of a sheet
   with a matching identity. Classify as:
   - `NEW` — no prior sheet with this identity exists.
   - `MODIFIED` — content differs from the stored version.
   - `UNCHANGED` — content is identical to the stored version.
   - `DELETED_RENAMED` — a previously-seen sheet identity is absent from this
     upload (flagged for user confirmation of delete vs. rename, since a pure
     name change without a stable key can't be distinguished automatically
     with certainty).
   - `CONFLICT` — content differs from the stored version in a way that
     doesn't cleanly resolve to a single new revision (e.g. two contradictory
     values with no way to tell which is authoritative from the file alone).
6. **Never overwrite** — `MODIFIED` sheets produce `Revision` records against
   the affected `plan_record`s; nothing already stored is mutated in place.
7. **Validate** each extracted field (`08_DATA_TRUST_MODEL.md` validation
   checks) and assign an initial trust state.
8. **Recalculate** analytics/derived figures that depend on the affected
   period(s).
9. **Produce an Import Audit**: total sheets scanned, and counts per
   classification, surfaced to the user (not only logged) — e.g. "5 scanned
   → 1 new → 1 modified → 3 unchanged → 0 conflicts".
10. **Store provenance** on every extracted record: source file, hash, sheet
    name, field reference, import timestamp, revision pointer.

## Implementation notes (M3)

Implemented in `src/ingestion/`: `parseWorkbook.ts` (exceljs read),
`sheetClassifier.ts` (month/reference/unrecognized), `normalize.ts`
(label/category normalization, amount and date validation), `diff.ts`
(classification against history), `importWorkbook.ts` (persistence,
revisions, Import Audit). Parsing, normalization, and diffing are pure
functions over plain data — only `importWorkbook.ts` touches the database.

Decisions made while implementing, each chosen to avoid guessing at money:

- **Period attribution.** Bare month sheet names ("August") carry no year,
  so `importBudgetWorkbook` takes a required `defaultYear`. A sheet name
  that carries its own year ("Aug-26", "2026-08") overrides it. The year is
  never inferred from the file or the clock (see `19_OPEN_DECISIONS.md`,
  D-009).
- **Reference sheets produce no plan records.** A reference sheet such as
  "Core expenses" carries no period; attributing its rows to a budget month
  would be inventing data. Its content is still hashed, diffed, and retained
  in full for provenance.
- **Content hashing excludes row numbers and cell references.** Inserting a
  blank spacer row shifts every reference below it without changing any
  financial claim, so such an edit is correctly `UNCHANGED`.
- **Unparseable amounts store NULL, never 0.** "No extractable value" and
  "zero rupees" are different claims. The `plan_record.amountMinorUnits`
  column is nullable for exactly this reason.
- **Reconciliation is keyed on the period, not on sheet novelty.** A renamed
  sheet is a *new sheet* covering an *existing period*; an earlier version
  skipped reconciliation for new sheets and duplicated every line of the
  renamed month, double-counting it in every total. Caught by
  `tests/ingestion/importWorkbook.test.ts`.
- **CONFLICT writes nothing.** A sheet asserting two different amounts for
  the same line has no authoritative reading, so no record from it is
  persisted — the sheet is retained and surfaced for a human instead. Other
  sheets in the same file still import normally.
- **Exact duplicate rows are flagged, not resolved.** Two identical rows
  could be a copy-paste slip (collapsing is right) or two genuine lines
  (keeping both is right). The file cannot distinguish them, so both copies
  are flagged `needs_review` — excluded from totals, retained in full.
- **A line that disappears from a sheet is flagged, never deleted.** It is
  marked `needs_review` with a revision recording the disappearance, so a
  human decides whether the removal was intentional.

## Idempotency

Re-uploading a byte-identical workbook must result in every sheet classified
`UNCHANGED` and zero new/duplicate records. Re-uploading a workbook where
only one sheet changed must affect only that sheet's records — every other
sheet's data must show `UNCHANGED` and remain untouched. This is tested
directly (`14_TESTING_STRATEGY.md`).

## Sheet identity

A sheet's "identity" for diffing purposes is sheet name plus a content-shape
signature (header row structure), not sheet position in the workbook —
reordering sheets in the workbook must not be misread as delete+add.

## Library choice

`exceljs` (Node/TypeScript, actively maintained, supports the cell-level
detail needed for row/field-level provenance) — see
`docs/decisions/0003-ingestion-library.md`.

## What ingestion never does

- Never processes a subset of worksheets.
- Never silently overwrites a previously stored value.
- Never guesses past a malformed cell — malformed values are flagged
  `Needs Review`, not coerced.
- Never executes any formula or macro content from the workbook; only
  evaluated cell values are read.
