# 18 — Failure Modes

Each row: the failure, and the required system behavior. All of these need a
corresponding test (`14_TESTING_STRATEGY.md`).

| Failure | Required behavior |
|---|---|
| Unexpected sheet in workbook | Classify as `unrecognized`, do not silently ignore or silently include in month-sheet processing; surface in Import Audit |
| Renamed month sheet | Attempt identity match by content shape; if ambiguous, classify `DELETED_RENAMED` and ask for confirmation rather than guessing |
| Corrected historical month | Create a Revision; never overwrite the original in place |
| Repeated identical upload | Every sheet classifies `UNCHANGED`; zero new/duplicate records |
| Blank/text value in a numeric cell | Field trust state → `Needs Review`; not coerced to zero or dropped silently |
| Malformed EMI date | Field trust state → `Needs Review`; liability calculations relying on it report `insufficient-data` until resolved |
| Unmatched ticker/instrument identifier | Record kept with `Needs Review`; excluded from valuation totals until resolved, not dropped |
| Delayed NAV | Use the most recent dated NAV at or before the as-of date; label the value's actual as-of date, never imply it's live |
| Stale price | Freshness indicator shown; value never presented as current if past a configurable staleness threshold |
| Quantity change without a matching transaction | Flagged as an unexplained position change for review; never auto-recorded as a buy/sell |
| Manual override present | Always shown alongside the source value it overrides, not hidden |
| Restore over newer data | Blocked pending explicit user confirmation; safety backup taken first |
| Local DB unavailable (file locked/corrupt) | App shows an explicit storage-error state; does not silently fall back to an in-memory or cloud store |
| Market data provider unavailable | Dashboard shows "no live data" / last-known-with-freshness; never fabricates a price |
| Optional AI provider unavailable | AI Analyst screen shows "AI unavailable"; every other screen remains fully functional |
| Gmail/SMTP unavailable | Optional report delivery fails visibly; core app unaffected |
| Negative/implausible input | Flagged per field-level validation; not silently clamped or accepted without review where structurally invalid |
| Insufficient data for CAGR/XIRR | Explicit `insufficient-data` result; never an approximated rate |
