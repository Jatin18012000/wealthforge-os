# 20 — Build Roadmap

Status values: NOT STARTED, IN PROGRESS, BLOCKED, AUDIT FAILED, READY FOR
REVIEW, COMPLETE. No milestone is marked COMPLETE without its exit gate
passing in an actual session (tests run, not assumed).

| ID | Milestone | Status | Tasks | Tests | Audit | Known issues | Decision deps | Commit/ref | Completed |
|---|---|---|---|---|---|---|---|---|---|
| M0 | Repository & governance | COMPLETE | Repo created; README/CLAUDE.md/AGENTS.md/.gitignore/.env.example written; docs 00–20 + decisions/ written; synthetic budget fixtures generated; tooling scaffold verified | N/A (docs milestone) | pnpm install/typecheck/lint/test/build all passed clean this session | D-005: real workbook not yet supplied — flagged, does not block M0 | D-001–D-004 resolved this milestone | eb6620f, c768f74, 7a63335, 4831fb0 | 2026-08-30 |
| M1 | Architecture freeze | COMPLETE | Requirements/domain/schema/ingestion/IA/trust-model/calculation docs authored and reviewed as part of M0's combined docs pass (low-risk, documentation-only work; no reason to gate it behind a separate session) | N/A | Docs cross-checked against both controlling source documents for contradictions — none found | — | — | c768f74 | 2026-08-30 |
| M2 | Local persistence | COMPLETE | `schema.prisma` (15 tables), initial migration applied, `src/lib/db.ts` client singleton, `prisma/seed.ts` dev fixtures, `src/backup/` export/restore skeleton + CLI | 8 tests: goal/activity derivation invariant, revision non-destructive update, idempotency check, backup/restore round-trip, conflict-blocks-restore, forced restore, audit-event recording — all passing | pnpm typecheck/lint/test/build all passed clean this session | Three real defects found and fixed same session (test suite caught two of them; manual verification caught the third): (1) audit_event timestamps were poisoning restore's newer-data conflict check, causing permanent false-positive conflicts; (2) restore was wiping the audit_event log wholesale instead of leaving it as an append-only record — see `docs/16_DATA_MIGRATION.md`; (3) `DATABASE_URL="file:./data/wealthforge.db"` resolved relative to `prisma/schema.prisma`'s directory, not repo root, silently writing the live database to `prisma/data/wealthforge.db` — a path `.gitignore` didn't cover, so `git add prisma/` would have committed the real database. Fixed by changing the path to `file:../data/...` (documented inline in `.env.example`) and adding a `**/*.db` defense-in-depth rule to `.gitignore` regardless of path. No known open issues. | — | (pending commit) | 2026-08-30 |
| M3 | Budget ingestion vertical slice | NOT STARTED | Excel import, diff engine, revisions, Import Audit | Real workbook test (pending D-005), fixture tests | Pending | Blocked on real workbook for final validation (D-005) | D-005 | — | — |
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

**M2 is COMPLETE.** Next milestone: **M3 — Budget ingestion vertical
slice** (Excel import, diff engine, revisions, Import Audit) per
`docs/09_INGESTION_ARCHITECTURE.md`. Still blocked on D-005 (no real 2026
workbook supplied yet) for *final* validation, but not blocked for building
the pipeline itself against the synthetic fixtures in
`tests/fixtures/budget/`.
