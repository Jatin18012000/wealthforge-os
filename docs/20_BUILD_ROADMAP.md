# 20 — Build Roadmap

Status values: NOT STARTED, IN PROGRESS, BLOCKED, AUDIT FAILED, READY FOR
REVIEW, COMPLETE. No milestone is marked COMPLETE without its exit gate
passing in an actual session (tests run, not assumed).

| ID | Milestone | Status | Tasks | Tests | Audit | Known issues | Decision deps | Commit/ref | Completed |
|---|---|---|---|---|---|---|---|---|---|
| M0 | Repository & governance | IN PROGRESS | Repo created; README/CLAUDE.md/AGENTS.md/.gitignore/.env.example written; docs 00–20 + decisions/ written; synthetic budget fixture pending | N/A (docs milestone) | Repo-check audit pending (see below) | D-005: real workbook not yet supplied | D-001–D-004 resolved this milestone | pending first commit | — |
| M1 | Architecture freeze | NOT STARTED | Confirm schema/domain/ingestion/IA docs (this milestone's content was authored alongside M0 for efficiency, since it's documentation-only and low-risk; formally reviewed/frozen at M1 kickoff) | N/A | Pending | — | — | — | — |
| M2 | Local persistence | NOT STARTED | `schema.prisma`, migrations, seed fixtures, backup skeleton | Persistence/restore tests | Pending | — | — | — | — |
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
- [ ] Synthetic budget fixture created (`tests/fixtures/budget/`).
- [ ] Root `package.json`/tooling scaffold created (typecheck/lint/test
      scripts runnable, even before application code exists).
- [ ] Repo checks pass: `git status` clean, initial commits pushed to
      `origin/main` on `Jatin18012000/wealthforge-os`.

M0 will be marked COMPLETE in this same session once the remaining items
above are done and verified — not before.
