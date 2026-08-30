# 17 — Acceptance Tests

These are the release-level acceptance criteria from the controlling
documents. Each must have a corresponding automated test (or, where
inherently manual, a documented verification step) before v1 is declared
release-ready (`docs/FINAL_AUDIT_REPORT.md` at M12).

1. Upload the recurring workbook and receive an Import Audit.
2. Historical months remain queryable after later corrections.
3. Corrections preserve prior versions (nothing is destructively overwritten).
4. Any supported analytics period can be compared with an explicit coverage
   warning where data is incomplete.
5. Manual goal allocation reconciles with cash (no double counting).
6. SIP changes recalculate projections.
7. Salary changes propagate through budget and planning calculations.
8. The emergency fund is visibly protected from ordinary goal spending.
9. Portfolio valuation uses dated prices/NAVs with a visible freshness
   indicator.
10. Net worth reconciles (assets − liabilities, trusted records only).
11. Headline numbers drill down to their provenance.
12. Automatic and manual backup/restore both work, including the restore
    safety sequence in `16_DATA_MIGRATION.md`.
13. The core app works fully without a hosted/cloud database.
14. The system makes no unsupported financial claims — `insufficient-data`
    is returned rather than a fabricated or approximated figure whenever the
    documented data requirement for a calculation isn't met.

## Status

Not yet testable — these depend on M2–M11 being implemented. Tracked
per-item in `20_BUILD_ROADMAP.md` as each relevant milestone lands.
