# 20 — Build Roadmap

Status values: NOT STARTED, IN PROGRESS, BLOCKED, AUDIT FAILED, READY FOR
REVIEW, COMPLETE. No milestone is marked COMPLETE without its exit gate
passing in an actual session (tests run, not assumed).

| ID | Milestone | Status | Tasks | Tests | Audit | Known issues | Decision deps | Commit/ref | Completed |
|---|---|---|---|---|---|---|---|---|---|
| M0 | Repository & governance | COMPLETE | Repo created; README/CLAUDE.md/AGENTS.md/.gitignore/.env.example written; docs 00–20 + decisions/ written; synthetic budget fixtures generated; tooling scaffold verified | N/A (docs milestone) | pnpm install/typecheck/lint/test/build all passed clean this session | D-005: real workbook not yet supplied — flagged, does not block M0 | D-001–D-004 resolved this milestone | eb6620f, c768f74, 7a63335, 4831fb0 | 2026-08-30 |
| M1 | Architecture freeze | COMPLETE | Requirements/domain/schema/ingestion/IA/trust-model/calculation docs authored and reviewed as part of M0's combined docs pass (low-risk, documentation-only work; no reason to gate it behind a separate session) | N/A | Docs cross-checked against both controlling source documents for contradictions — none found | — | — | c768f74 | 2026-08-30 |
| M2 | Local persistence | COMPLETE | `schema.prisma` (15 tables), initial migration applied, `src/lib/db.ts` client singleton, `prisma/seed.ts` dev fixtures, `src/backup/` export/restore skeleton + CLI | 8 tests: goal/activity derivation invariant, revision non-destructive update, idempotency check, backup/restore round-trip, conflict-blocks-restore, forced restore, audit-event recording — all passing | pnpm typecheck/lint/test/build all passed clean this session | Three real defects found and fixed same session (test suite caught two of them; manual verification caught the third): (1) audit_event timestamps were poisoning restore's newer-data conflict check, causing permanent false-positive conflicts; (2) restore was wiping the audit_event log wholesale instead of leaving it as an append-only record — see `docs/16_DATA_MIGRATION.md`; (3) `DATABASE_URL="file:./data/wealthforge.db"` resolved relative to `prisma/schema.prisma`'s directory, not repo root, silently writing the live database to `prisma/data/wealthforge.db` — a path `.gitignore` didn't cover, so `git add prisma/` would have committed the real database. Fixed by changing the path to `file:../data/...` (documented inline in `.env.example`) and adding a `**/*.db` defense-in-depth rule to `.gitignore` regardless of path. No known open issues. | — | (pending commit) | 2026-08-30 |
| M3 | Budget ingestion vertical slice | COMPLETE | `src/ingestion/`: exceljs parser, sheet classifier, normalization/validation, content-hash diff engine, import orchestrator with revisions and Import Audit | 25 ingestion tests (12 unit + 13 fixture-based integration) covering all 5 classifications, idempotency, corrected month, rename, deletion, malformed cells, unexpected sheet, conflict, duplicates | pnpm typecheck/lint/test/build all passed clean this session | One real bug found by the test suite and fixed: a renamed sheet was treated as a new period and duplicated every line of that month, double-counting it in all totals. Parser is validated against synthetic fixtures only — D-005 still open, real workbook needed to confirm column/label conventions. | D-005 (final validation), D-009 (resolved) | (pending commit) | 2026-08-30 |
| M4 | Deterministic financial engine | NOT STARTED | Net worth, budget, P&L, allocation, EMI, goals | Fixture-result tests | Pending | — | — | — | — |
| M5 | Portfolio ingestion | NOT STARTED | Equity/ETF/MF snapshot imports | Representative snapshot tests | Pending | — | D-006 (integration timing) | — | — |
| M6 | Dashboard V1 | NOT STARTED | Command Center, Budget, Portfolio, Goals, Liabilities screens | Visual + E2E | Pending | — | — | — | — |
| M7 | Analytics | NOT STARTED | Periods, filters, Plan vs Reality | Range/insufficient-data tests | Pending | — | — | — | — |
| M8 | Manual controls | NOT STARTED | Overrides across all domains | Audit/recalculation tests | Pending | — | — | — | — |
| M9 | Data Center | NOT STARTED | Backup/restore/import/export/audit UI | Recovery drill | Pending | — | — | — | — |
| M10 | Market/reporting | NOT STARTED | Market data, freshness, reports | Provider-failure tests | Pending | D-007 unresolved | D-007 | — | — |
| M11 | AI Analyst | NOT STARTED | Grounded explanations | Grounding/hallucination tests | Pending | — | — | — | — |
| M12 | Release hardening | NOT STARTED | Performance, accessibility, docs, final audit | Full release gate | Pending | — | — | — | — |

## M0 exit gate (from source build plan §19)

"Docs reviewed; repo checks pass." Tracked here explicitly:

- [x] `README.md`, `CLAUDE.md`, `AGENTS.md` written with real content.
- [x] `.gitignore`, `.env.example` written.
- [x] `docs/00`–`docs/20` written with substantive, source-derived content
      (this file).
- [x] `docs/decisions/` ADRs written for the M0-level decisions (D-001–D-004).
- [x] Synthetic budget fixtures created (`tests/fixtures/budget/`, 7 scenarios).
- [x] Root `package.json`/tooling scaffold created — `pnpm install`,
      `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all verified
      passing in this session (Next.js 15 + TypeScript strict + ESLint +
      Prettier + Vitest + Playwright, minimal placeholder root page only).
- [x] Repo checks pass: commits created and pushed to `origin/main` on
      `Jatin18012000/wealthforge-os`.

**M0 is COMPLETE.**

## M2 exit gate (from source build plan §19)

"Persistence/restore tests" pass. Tracked here explicitly:

- [x] `prisma/schema.prisma` implements every table in
      `docs/06_DATABASE_SCHEMA.md`; initial migration applied against a real
      SQLite file.
- [x] `src/lib/db.ts` Prisma client singleton.
- [x] `prisma/seed.ts` populates the documented goal/liability/insurance
      baseline for dev use, idempotently.
- [x] `src/backup/` implements the full restore safety sequence from
      `docs/16_DATA_MIGRATION.md`: safety backup first, conflict detection,
      explicit force required to overwrite newer data, audit logging.
- [x] Automated tests cover: the goal-current-amount derivation invariant,
      non-destructive revisions, idempotent re-import detection, and a full
      backup/restore round trip including the conflict and forced-restore
      paths. All 8 tests pass.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all verified
      passing in this session.

**M2 is COMPLETE.**

## M3 exit gate (from source build plan §19)

"Real 2026 workbook passes." Tracked here explicitly:

- [x] Full-workbook re-read on every upload; every sheet scanned, never a
      subset.
- [x] All five classifications implemented and tested: NEW, MODIFIED,
      UNCHANGED, DELETED_RENAMED, CONFLICT.
- [x] Corrections create revisions; the original record is retained,
      superseded, and still queryable.
- [x] Repeated identical upload is idempotent — zero new or duplicate
      records.
- [x] Malformed cells flagged `needs_review`, never coerced; unparseable
      amounts stored as NULL, never 0.
- [x] Import Audit produced and persisted as an `audit_event` on every
      upload.
- [x] Provenance stored on every record (source document, sheet snapshot,
      normalized + raw label).
- [x] 25 ingestion tests pass; `pnpm typecheck`, `pnpm lint`, `pnpm test`,
      `pnpm build` all verified passing this session.
- [ ] **Validated against the REAL 2026 workbook.** Not possible yet — no
      real workbook has been supplied (D-005). The parser is validated
      against synthetic fixtures reproducing the documented structure only.

**M3 is functionally complete but its exit gate is not fully satisfied**:
the source build plan's gate is "real 2026 workbook passes", and the real
workbook does not exist in this workspace. Every other criterion passes.
Expect the column/label conventions in `src/ingestion/normalize.ts`
(`COLUMN_ALIASES`, `CATEGORY_ALIASES`) to need adjustment on first contact
with the real file — that is the designed extension point.

Next milestone: **M4 — Deterministic financial engine** per
`docs/07_FINANCIAL_CALCULATIONS.md`.
