# 08 — Data Trust Model

## Trust states

| State        | Meaning                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| Extracted    | Machine-extracted from a source file; not yet validated                         |
| Needs Review | Failed a validation check, or ambiguous during ingestion; requires human review |
| Validated    | Passed deterministic validation checks (see below)                              |
| Verified     | Explicitly confirmed/trusted by the user                                        |
| Rejected     | Excluded from trusted calculations; retained for audit, never deleted           |
| Superseded   | Replaced by a later authoritative version via a Revision; original retained     |

Headline calculations (net worth, portfolio value, budget totals, goal
progress) include only `Validated` and `Verified` records. Records in other
states remain visible in Data Center and drill-downs, clearly marked, but
are excluded from totals until they reach `Validated`/`Verified` or are
`Rejected`.

## Validation checks (examples — extended per-ingestion in M3)

- Numeric fields parse as numbers; non-numeric content in a numeric cell →
  `Needs Review`, not silently coerced to zero.
- Dates parse to valid calendar dates within a sane range; malformed EMI
  dates → `Needs Review`.
- Duplicate detection: a sheet/record identical to one already stored (same
  file hash + sheet content) is `Unchanged`, not re-inserted.
- Sign/magnitude sanity: negative values in fields that are structurally
  non-negative (e.g. quantities), or values orders of magnitude outside
  recent history for that field → `Needs Review`, flagged, never auto-
  "corrected".

## Provenance

Every imported record stores, at minimum: source file, file hash, worksheet
name, relevant row/field reference, import timestamp, revision/version
pointer, current trust state, and whether a manual override currently
applies. The system must be able to answer "where did this number come
from" for any headline figure, down to this level, wherever the figure is
derived from imported data (`03_INFORMATION_ARCHITECTURE.md` "drillable
headline numbers").

## Manual overrides interact with trust, not bypass it

A manual adjustment does not change the underlying source record's trust
state — it layers a new effective value on top. The UI shows: source value →
manual adjustment → resulting current value. The source value remains
queryable even after an override is applied.

Built in M8: `manual_adjustment` rows layered onto source values by
`src/data/loaders.ts`, so an override recomputes every downstream figure
while leaving the source row untouched. Withdrawing an override restores
the source exactly. See `docs/features/manual-controls.md`.

## Revisions vs. trust state

A Revision and a trust-state change are different things: a Revision
captures a _value_ changing over time (e.g. a corrected August figure); a
trust-state change captures _confidence_ in a value changing (e.g.
`Extracted` → `Validated` after checks pass, or `Needs Review` → `Rejected`
after a human determines a row was garbage). Both are logged as
`audit_event`s.
