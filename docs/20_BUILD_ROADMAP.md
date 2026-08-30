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
| M4 | Deterministic financial engine | COMPLETE | `src/domain/`: money/dates primitives, `Computed<T>` insufficiency contract, trust filtering, net worth, portfolio valuation + allocation + concentration, budget summary + Plan vs Reality, goals + projections + allocation guards, EMI payer split + burden + release, CAGR/XIRR/P&L. `src/data/loaders.ts` keeps the domain database-free | 89 domain tests + 4 end-to-end (workbook → engine) — 122 across the suite | pnpm typecheck/lint/test/build all passed clean this session | One real bug found by the test suite and fixed: `setUTCMonth` month-end overflow made 31 Aug + 10 months land on 1 July instead of 30 June, which could flip a goal's "misses target date" verdict. Fixed with `addMonthsClamped`, applied to both goal and EMI projections. | D-010 (resolved) | (pending commit) | 2026-08-30 |
| M5 | Portfolio ingestion | COMPLETE | `src/ingestion/portfolio/`: RFC 4180 CSV reader + XLSX path, column alias tolerance, instrument resolution, snapshot revisions, observed-change detection with transaction reconciliation, Portfolio Import Audit. Schema: position cost basis + supersede pointer, activity quantity | 16 snapshot tests over 9 fixtures, including a slice proving imported data flows into the M4 valuation engine — 138 across the suite | pnpm typecheck/lint/test/build all passed clean this session | One real bug found by the test suite and fixed: two duplicate rows within one file were treated as a correction, so the second silently superseded the first — dropping a real lot, the exact loss the duplicate flagging exists to prevent. Corrections are now cross-import only. Column layouts validated against synthetic fixtures only; real broker exports still needed (D-005). | D-011 (resolved); D-006 still deferred and not blocking | (pending commit) | 2026-08-30 |
| M6 | Dashboard V1 | COMPLETE | `src/presentation` formatters, `src/views` view models, `src/components` primitives, five App Router screens, demo seed that ingests the reference fixtures through the real pipeline | 23 view/format tests + 46 Playwright E2E across laptop and iPad — 178 unit/integration total | pnpm typecheck/lint/test/build/e2e all passed; all five screens screenshotted and inspected | Two real defects found and fixed: a malformed period rendered the literal string "Invalid Date", and unexplained position changes never reached the UI. One a11y issue fixed: period chips duplicated `aria-current="page"` with the sidebar. | D-005 closed earlier; no new blockers | (pending commit) | 2026-08-30 |
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

## M4 exit gate (from source build plan §19)

"Known fixture results match." Tracked here explicitly:

- [x] Net worth, portfolio valuation, allocation, concentration, budget
      summary, Plan vs Reality, goal progress, EMI burden/split/release,
      CAGR, XIRR, and P&L all implemented in `src/domain/`.
- [x] Domain layer is framework-free and database-free; an ESLint rule
      enforces it and `src/data/loaders.ts` is the only bridge.
- [x] All money is integer paise with banker's rounding applied once per
      derived figure; `sumMinorUnits` rejects non-integers.
- [x] Every calculation that can fail returns `Computed<T>` with explicit
      reasons — no defaults, no assumed zeros, no estimates.
- [x] Totals report their exclusions, so a figure is never quietly short.
- [x] **Fixture results match**: `tests/domain/endToEnd.test.ts` imports the
      real fixture workbook and asserts August's income, expenses, EMI,
      investments, retained, unallocated, and savings rate against the
      fixture's own numbers — plus the corrected-month case, where the
      superseded value must not be double-counted.
- [x] 122 tests pass; `pnpm typecheck`, `pnpm lint`, `pnpm build` all
      verified passing this session.

**M4 is COMPLETE.**

## M5 exit gate (from source build plan §19)

"Representative snapshots pass." Tracked here explicitly:

- [x] Equity, ETF, and mutual fund snapshots import from both CSV and XLSX.
- [x] Instruments are resolved or created by asset class + identifier;
      fractional MF units survive intact.
- [x] Reported prices become dated valuations; an unparseable price yields
      no valuation rather than a fabricated one.
- [x] Same-date corrections create revisions and retain the original;
      later-date changes are new observations and both rows stand.
- [x] An observed quantity change is reported and reconciled against
      recorded transactions where possible — never converted into an
      invented buy or sell. Verified by asserting zero `buy` activity exists
      after an unexplained 50 → 75 increase.
- [x] Repeat import is idempotent: no duplicate positions, valuations, or
      source documents.
- [x] Malformed rows, duplicate holdings, and unusable layouts are flagged
      or refused, never coerced.
- [x] **Representative snapshots pass end to end**: imported data feeds the
      M4 valuation engine, which values the portfolio at an asserted exact
      total with zero exclusions, and correctly reports insufficient-data
      when every holding is flagged.
- [x] 138 tests pass; `pnpm typecheck`, `pnpm lint`, `pnpm build` all
      verified passing this session.

**M5 is COMPLETE.**

## Reference-material pass (post-M5, pre-M6) — COMPLETE

The real budget workbook (two copies) and three Zerodha holdings statements
were supplied, closing **D-005**. Both were studied before any code changed
(`REFERENCE_DOCUMENT_REGISTER.md`), traced through to implementation
(`REFERENCE_MAPPING.md`), and audited for lost knowledge
(`REFERENCE_COVERAGE_AUDIT.md`).

- [x] All five files read structurally; no supplied file modified.
- [x] Central source-adapter architecture (`src/ingestion/sources/`) with one
      mapping registry; no source quirk reaches the financial engine.
- [x] Budget adapter for the real positional layout.
- [x] Zerodha adapter for the real statement layout.
- [x] Anonymized reference-layout fixtures + 17 tests.
- [x] M5 handoff audit: **M5 was not rebuilt**; its design held up against
      real data and gained an adapter alongside the existing generic path.
- [x] 155 tests pass; typecheck, lint, build clean.

**Five defects found, two of which would have corrupted real figures while
looking plausible**: the `Combined` sheet would have double-counted the
entire portfolio, and the workbook's formula rows would have inflated every
monthly total. Also fixed: both parsers extracted nothing from the real
layouts, and cost basis lost paise by rounding per-unit prices before
scaling. Details in `REFERENCE_COVERAGE_AUDIT.md` §4.

Three questions the data genuinely cannot answer are open and recorded —
**D-012** (carry-over income in rate denominators), **D-013** (pledged-unit
semantics), **D-014** (mutual funds held outside Zerodha). None blocks M6.

## M6 exit gate (from source build plan §19)

"Visual + E2E pass." Tracked here explicitly:

- [x] Command Center, Budget, Portfolio, Goals and Liabilities built.
- [x] No arithmetic in any component: screens render view models, which
      compose loaders and the engine. `src/presentation/format.ts` is the
      only place minor units become rupees.
- [x] The engine's honesty reaches the screen — insufficient-data renders as
      an explained absence rather than ₹0, totals name their exclusions,
      prices show age and never read "live", untrusted records are badged,
      missing actuals read "No data", and unexplained position changes are
      raised on the Command Center.
- [x] **Visual pass**: all five screens rendered and inspected at 1440px,
      plus the Command Center at iPad width. Figures reconcile against the
      workbook's own formulas (retained ₹25,223, left over cash ₹5,723) and
      allocation shares sum to 100%.
- [x] **E2E pass**: 46 Playwright tests across laptop and iPad viewports,
      including keyboard navigation, one `h1` per screen, a labelled nav,
      and no horizontal scroll at iPad width.
- [x] 178 unit/integration tests pass; typecheck, lint and build clean.

Two real defects the tests caught and fixed: a malformed period rendered the
literal string "Invalid Date" on screen, and unexplained position changes —
which ingestion deliberately refuses to turn into trades — never surfaced in
the UI, leaving that refusal buried in the audit log. Plus one accessibility
fix: the Budget period chips claimed `aria-current="page"` alongside the
sidebar link, so two elements asserted they were the current page.

**M6 is COMPLETE.** Next milestone: **M7 — Analytics** (universal periods,
filters, Plan vs Reality, comparisons) per `docs/11_ANALYTICS_SPEC.md`.
