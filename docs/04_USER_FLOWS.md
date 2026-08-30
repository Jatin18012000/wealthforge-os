# 04 — Key User Flows

## Flow: Upload the recurring budget workbook

1. User uploads the workbook from Data Center or Budget screen.
2. System hashes the file, scans every worksheet.
3. Each sheet is classified against stored history: NEW / MODIFIED /
   UNCHANGED / DELETED-RENAMED / CONFLICT.
4. Data is normalized (labels mapped, original source text preserved) and
   validated (see `09_INGESTION_ARCHITECTURE.md` for validation rules).
5. Modified sheets create revision records; nothing already stored is
   overwritten in place.
6. Affected analytics/derived figures are recalculated.
7. An Import Audit is shown: e.g. "5 scanned → 1 new → 1 modified → 3
   unchanged → 0 conflicts", with drill-down into what changed.
8. Re-uploading the identical workbook produces zero new/modified records
   (idempotent).

## Flow: Correct a historical month

1. A later workbook contains a corrected figure for an already-imported
   month (e.g. August 2026).
2. System detects the sheet as MODIFIED, not NEW.
3. The original August value is retained; the corrected value is stored as a
   new revision of that record, referencing the original.
4. The user can view both the original and the current/effective value, with
   source, timestamp, and reason/status where available.
5. Dependent analytics recompute using the current effective value, while
   historical point-in-time queries can still reconstruct what was known at
   an earlier time.

## Flow: Allocate leftover cash to a goal

1. At month end, the Budget screen shows unallocated surplus cash (e.g.
   ₹1,000).
2. User selects a goal (e.g. PS5) and an amount to allocate.
3. System records a goal contribution transaction: unallocated cash
   decreases by the amount, the goal's current balance increases by the same
   amount, in one atomic operation.
4. Emergency fund balance is never reduced by this kind of allocation flow
   except via an explicit, clearly-labeled emergency-fund withdrawal action.
5. Goal progress and projections recalculate immediately.

## Flow: Manually override a value

1. User opens the relevant Settings/screen field (e.g. current SIP amount).
2. User enters the new value and, where the field is derived from an import,
   the system shows source value + proposed manual adjustment = resulting
   current value before confirming.
3. On confirm, an explicit adjustment record is created; the original
   imported value is retained and remains visible/queryable.
4. Downstream calculations that depend on the field recompute using the
   current effective value.

## Flow: Compare two periods

1. User picks a period and a comparison target (default: matching prior
   period, e.g. "this quarter vs previous quarter"; or a custom second
   period).
2. System computes absolute and percentage variance across the metrics in
   scope, using only trusted data.
3. Any period with incomplete data coverage is explicitly flagged in the
   comparison output rather than silently shown as zero or omitted.

## Flow: Restore from backup

1. User initiates restore from Data Center.
2. System takes a safety backup of the current state first, automatically.
3. System compares the backup's data timestamps against current data.
4. If the backup would overwrite data newer than itself, the conflict is
   surfaced to the user for an explicit decision — restore never silently
   destroys newer data.
5. On confirmed restore, an audit event records what was restored and when.
