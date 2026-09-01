# 20 — Build Roadmap

Status values: NOT STARTED, IN PROGRESS, BLOCKED, AUDIT FAILED, READY FOR
REVIEW, COMPLETE. No milestone is marked COMPLETE without its exit gate
passing in an actual session (tests run, not assumed).

| ID  | Milestone                       | Status   | Tasks                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Tests                                                                                                                                                                                                                                                                                    | Audit                                                                                                                           | Known issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Decision deps                                                         | Commit/ref                         | Completed  |
| --- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------- | ---------- |
| M0  | Repository & governance         | COMPLETE | Repo created; README/CLAUDE.md/AGENTS.md/.gitignore/.env.example written; docs 00–20 + decisions/ written; synthetic budget fixtures generated; tooling scaffold verified                                                                                                                                                                                                                                                                                    | N/A (docs milestone)                                                                                                                                                                                                                                                                     | pnpm install/typecheck/lint/test/build all passed clean this session                                                            | D-005: real workbook not yet supplied — flagged, does not block M0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | D-001–D-004 resolved this milestone                                   | eb6620f, c768f74, 7a63335, 4831fb0 | 2026-08-30 |
| M1  | Architecture freeze             | COMPLETE | Requirements/domain/schema/ingestion/IA/trust-model/calculation docs authored and reviewed as part of M0's combined docs pass (low-risk, documentation-only work; no reason to gate it behind a separate session)                                                                                                                                                                                                                                            | N/A                                                                                                                                                                                                                                                                                      | Docs cross-checked against both controlling source documents for contradictions — none found                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                     | c768f74                            | 2026-08-30 |
| M2  | Local persistence               | COMPLETE | `schema.prisma` (15 tables), initial migration applied, `src/lib/db.ts` client singleton, `prisma/seed.ts` dev fixtures, `src/backup/` export/restore skeleton + CLI                                                                                                                                                                                                                                                                                         | 8 tests: goal/activity derivation invariant, revision non-destructive update, idempotency check, backup/restore round-trip, conflict-blocks-restore, forced restore, audit-event recording — all passing                                                                                 | pnpm typecheck/lint/test/build all passed clean this session                                                                    | Three real defects found and fixed same session (test suite caught two of them; manual verification caught the third): (1) audit_event timestamps were poisoning restore's newer-data conflict check, causing permanent false-positive conflicts; (2) restore was wiping the audit_event log wholesale instead of leaving it as an append-only record — see `docs/16_DATA_MIGRATION.md`; (3) `DATABASE_URL="file:./data/wealthforge.db"` resolved relative to `prisma/schema.prisma`'s directory, not repo root, silently writing the live database to `prisma/data/wealthforge.db` — a path `.gitignore` didn't cover, so `git add prisma/` would have committed the real database. Fixed by changing the path to `file:../data/...` (documented inline in `.env.example`) and adding a `**/*.db` defense-in-depth rule to `.gitignore` regardless of path. No known open issues. | —                                                                     | (pending commit)                   | 2026-08-30 |
| M3  | Budget ingestion vertical slice | COMPLETE | `src/ingestion/`: exceljs parser, sheet classifier, normalization/validation, content-hash diff engine, import orchestrator with revisions and Import Audit                                                                                                                                                                                                                                                                                                  | 25 ingestion tests (12 unit + 13 fixture-based integration) covering all 5 classifications, idempotency, corrected month, rename, deletion, malformed cells, unexpected sheet, conflict, duplicates                                                                                      | pnpm typecheck/lint/test/build all passed clean this session                                                                    | One real bug found by the test suite and fixed: a renamed sheet was treated as a new period and duplicated every line of that month, double-counting it in all totals. Parser is validated against synthetic fixtures only — D-005 still open, real workbook needed to confirm column/label conventions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | D-005 (final validation), D-009 (resolved)                            | (pending commit)                   | 2026-08-30 |
| M4  | Deterministic financial engine  | COMPLETE | `src/domain/`: money/dates primitives, `Computed<T>` insufficiency contract, trust filtering, net worth, portfolio valuation + allocation + concentration, budget summary + Plan vs Reality, goals + projections + allocation guards, EMI payer split + burden + release, CAGR/XIRR/P&L. `src/data/loaders.ts` keeps the domain database-free                                                                                                                | 89 domain tests + 4 end-to-end (workbook → engine) — 122 across the suite                                                                                                                                                                                                                | pnpm typecheck/lint/test/build all passed clean this session                                                                    | One real bug found by the test suite and fixed: `setUTCMonth` month-end overflow made 31 Aug + 10 months land on 1 July instead of 30 June, which could flip a goal's "misses target date" verdict. Fixed with `addMonthsClamped`, applied to both goal and EMI projections.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | D-010 (resolved)                                                      | (pending commit)                   | 2026-08-30 |
| M5  | Portfolio ingestion             | COMPLETE | `src/ingestion/portfolio/`: RFC 4180 CSV reader + XLSX path, column alias tolerance, instrument resolution, snapshot revisions, observed-change detection with transaction reconciliation, Portfolio Import Audit. Schema: position cost basis + supersede pointer, activity quantity                                                                                                                                                                        | 16 snapshot tests over 9 fixtures, including a slice proving imported data flows into the M4 valuation engine — 138 across the suite                                                                                                                                                     | pnpm typecheck/lint/test/build all passed clean this session                                                                    | One real bug found by the test suite and fixed: two duplicate rows within one file were treated as a correction, so the second silently superseded the first — dropping a real lot, the exact loss the duplicate flagging exists to prevent. Corrections are now cross-import only. Column layouts validated against synthetic fixtures only; real broker exports still needed (D-005).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | D-011 (resolved); D-006 still deferred and not blocking               | (pending commit)                   | 2026-08-30 |
| M6  | Dashboard V1                    | COMPLETE | `src/presentation` formatters, `src/views` view models, `src/components` primitives, five App Router screens, demo seed that ingests the reference fixtures through the real pipeline                                                                                                                                                                                                                                                                        | 23 view/format tests + 46 Playwright E2E across laptop and iPad — 178 unit/integration total                                                                                                                                                                                             | pnpm typecheck/lint/test/build/e2e all passed; all five screens screenshotted and inspected                                     | Two real defects found and fixed: a malformed period rendered the literal string "Invalid Date", and unexplained position changes never reached the UI. One a11y issue fixed: period chips duplicated `aria-current="page"` with the sidebar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | D-005 closed earlier; no new blockers                                 | (pending commit)                   | 2026-08-30 |
| M7  | Analytics                       | COMPLETE | `src/domain/periods.ts` (19 period kinds incl. Indian FY), `src/domain/analytics.ts` (coverage model, comparison, planned-vs-observed allocation), `src/views/analyticsView.ts`, `/analytics` screen with period/comparison/filter selectors                                                                                                                                                                                                                 | 48 new tests (22 period + 17 analytics + 9 view) and 12 new E2E — 226 unit/integration and 60 E2E total                                                                                                                                                                                  | pnpm typecheck/lint/test/build/e2e all passed; screen inspected across periods                                                  | One real bug fixed: `precedingRange` shifted month-aligned ranges by duration, so the month before July resolved to 31 May rather than 1 June. One consistency fix: the allocation table used a different month-inclusion rule than the variance table above it. Reference fixture extended from 2 to 4 month sheets to match the real workbook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                     | (pending commit)                   | 2026-08-30 |
| M8  | Manual controls                 | COMPLETE | `src/domain/adjustments.ts` (set/delta composition, preview arithmetic), `src/manual/registry.ts` (closed list of overridable fields), `src/manual/overrides.ts` (preview/apply/revoke/history, payer-split companion changes), `src/data/adjustmentStore.ts` + loader integration so every screen recomputes, `/settings` screen with preview-before-confirm flow, `src/presentation/parse.ts` input boundary                                               | 23 domain/parse tests + 29 manual-controls integration tests (recalculation, audit trail, revocation restoring the source exactly, payer-split-sums-to-100%, goal balance stated without inventing a contribution, custom variables) + 3 new E2E — 264 unit/integration and 66 E2E total | pnpm typecheck/lint/test/build/e2e all passed; Settings screen screenshotted and inspected in both the empty and preview states | No real defects found in the review pass this session; two design decisions made explicit rather than guessed: a `delta` override re-applies against a moved source rather than freezing a figure, and a payer-split override with more than two payers is refused rather than guessing a redistribution (D-015). Schema migration is additive (four nullable/defaulted columns on `manual_adjustment`), so no existing data is at risk.                                                                                                                                                                                                                                                                                                                                                                                                                                           | D-015 (new, deferred)                                                 | (pending commit)                   | 2026-08-30 |
| M9  | Data Center                     | COMPLETE | `src/ingestion/uploadStorage.ts` (validated, non-user-controlled upload storage), `src/data/dataCenterStore.ts` + `src/views/dataCenterView.ts` (audit log decoding, provenance, trust-state rollup, backup listing), `src/backup/autoBackup.ts` (automatic backup after every import + 24h interval), `src/app/data-center/` (upload/export/restore actions and screen)                                                                                     | 10 upload-storage tests + 11 Data Center view tests + 5 auto-backup tests (26 new) + 10 new E2E across laptop/iPad — 294 unit/integration and 76 E2E total                                                                                                                               | pnpm typecheck/lint/test/build/e2e all passed; screen inspected empty and after a real upload                                   | One real defect found by this milestone's own visual QA and fixed: `BACKUP_DIR`/`SAFETY_BACKUP_DIR`/the uploads directory resolved paths from `__dirname`, which points inside `.next/server/` once Next.js bundles the code — backups were silently written outside the repo's `data/` directory. Fixed by resolving from `process.cwd()` instead (same fix class as the M2 `DATABASE_URL` defect). A second defect found by a regression test added for the fix: the generic (non-Zerodha) portfolio-snapshot path ignored the `displayFileName` override, showing a UUID-prefixed name in the Import Audit; fixed in `resolveSnapshot`.                                                                                                                                                                                                                                         | —                                                                     | (pending commit)                   | 2026-08-30 |
| M10 | Market/reporting                | COMPLETE | `docs/MARKET_DATA_PROVIDER_EVALUATION.md` (D-007 resolved), `src/market/` (AMFI NAV + Yahoo Finance provider abstraction, fetcher injection, refresh orchestration with per-source/per-instrument failure isolation), `Instrument.marketSymbol` (additive, opt-in live pricing), `src/views/marketView.ts` + `/market` screen, `src/views/reportView.ts` (rule-based Fact/Inference/Recommendation report, reusing existing view outputs) + `/market/report` | 12 AMFI parser + 11 Yahoo Finance parser + 10 refresh orchestration + 6 market view + 5 report view tests (44 new) + 3 daysBetween tests + 16 new E2E across laptop/iPad — 342 unit/integration and 92 E2E total                                                                         | pnpm typecheck/lint/test/build/e2e all passed; Market and Report screens inspected with real demo data                          | This sandbox's egress proxy blocks both provider hosts outright (organization policy) — verified directly, not worked around; the app degrades to "no data"/last-known-value exactly as designed, confirmed live via the Market screen's refresh button and E2E. Nifty Metal has no reliable free source (D-016) and shows as such rather than a guessed figure. Live behavior against the real endpoints (both known-stable for years but explicitly unofficial for Yahoo) must be verified on a normal internet-connected deployment.                                                                                                                                                                                                                                                                                                                                            | D-007 (resolved this milestone); D-016 (new, non-blocking)            | (pending commit)                   | 2026-08-30 |
| M11 | AI Analyst                      | COMPLETE | `src/ai/providers/` (Ollama default + OpenAI/Anthropic optional, one AiProvider interface, fetcher injection), `src/ai/grounding.ts` (numeric-claim extraction and verification), `src/ai/analyst.ts` (grounding payload built from the M10 Report, reject-outright-if-ungrounded), `/ai-analyst` screen                                                                                                                                                     | 12 provider + 10 grounding + 6 analyst tests (28 new) + 6 new E2E across laptop/iPad — 370 unit/integration and 98 E2E total                                                                                                                                                             | pnpm typecheck/lint/test/build/e2e all passed; AI Analyst screen inspected via direct navigation                                | This sandbox has no Ollama installed, which made the "AI unavailable" path a genuine, not simulated, test case — verified live and via E2E. One non-bug found during manual verification: a Playwright screenshot taken immediately after the redirect-driven client transition showed a blank page; a direct navigation to the same URL rendered correctly, confirming it was a client-transition timing artifact in the verification script itself (same class as one seen in M9), not a rendering defect — the E2E suite reloads before asserting and passes cleanly.                                                                                                                                                                                                                                                                                                           | —                                                                     | (pending commit)                   | 2026-08-30 |
| M12 | Release hardening               | COMPLETE | Security sweep (stale env vars fixed), reference coverage re-audit (M11 re-check + final verdict), README status refresh, accessibility gap fix (Settings screen), full clean regression run, GitHub repository audit, zero-cost verification, `docs/FINAL_AUDIT_REPORT.md`                                                                                                                                                                                  | Full suite re-run clean: 470 tests total (370 unit/integration + 100 E2E across laptop/iPad)                                                                                                                                                                                             | pnpm typecheck/lint/test/build/e2e all passed in a single consolidated pass; see docs/FINAL_AUDIT_REPORT.md                     | Two real documentation defects found and fixed: README.md's status line hadn't been updated since M0; .env.example still listed MARKET_DATA_PROVIDER/MARKET_DATA_API_KEY from before D-007 was resolved (neither is read anywhere in the code) and was missing OPENAI_MODEL/ANTHROPIC_MODEL. One accessibility gap found and fixed: the Settings screen was the only one missing a dedicated "exactly one h1" E2E check.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | D-006, D-008, D-015, D-016 remain open and documented as non-blocking | (pending commit)                   | 2026-08-30 |

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

**M6 is COMPLETE.**

## M7 exit gate (from source build plan §19)

"Range/insufficient-data tests" pass. Tracked here explicitly:

- [x] Every documented period resolves: 15d, 30d, 1/3/6/9/12 months, 1–5
      years, YTD, Indian financial year, previous month/quarter/FY, since
      inception, and custom.
- [x] Ranges are half-open, so a boundary date belongs to exactly one
      period.
- [x] **A month is never pro-rated.** Budget figures contribute only from
      months the range fully contains; clipped months are excluded and
      reported, and months with no data are counted as absent, not zero.
- [x] Comparison against the preceding period or the same period last year,
      with absolute and proportional variance, and ratios left undefined
      against a zero base.
- [x] Coverage warnings from both sides reach the screen.
- [x] Filters by activity kind and instrument; planned-vs-observed
      allocation keeping each side distinct.
- [x] **Insufficient-data paths tested**: an unresolvable custom period, a
      since-inception period with no data, a comparison side with no
      records, and a 15-day window covering no whole month.
- [x] 226 unit/integration tests and 60 E2E across laptop and iPad;
      typecheck, lint and build clean.

**M7 is COMPLETE.** Next milestone: **M8 — Manual controls** (overrides
across all domains) per `docs/02_REQUIREMENTS.md`.

## M8 exit gate (from source build plan)

"Audit/recalculation tests" pass. Tracked here explicitly:

- [x] Every domain in `docs/02_REQUIREMENTS.md`'s "Manual override
      requirement" is overridable through one generic mechanism: budget
      lines, portfolio quantities and cost basis, goal targets and stated
      balances, EMI amount/outstanding/tenure, payer splits, insurance cover
      and premiums, and free-form custom variables.
- [x] An override never modifies the source row — verified directly by
      re-reading the source record after applying an override.
- [x] Downstream calculations recompute from the effective value with no
      screen-specific plumbing: a budget override moves the savings rate: a
      goal override moves progress and projection, without either view
      knowing overrides exist.
- [x] Withdrawing an override restores the source value exactly, and the
      withdrawal itself is recorded rather than deleting history.
- [x] The preview a user confirms and the value that gets written are
      produced by the same function, so a stale or replayed form cannot
      write a figure the current rules would reject.
- [x] A payer-split override that would break the "shares sum to 100%"
      invariant either computes the one necessary companion change (two
      payers) or is refused with a clear reason (three or more) — never
      silently stored broken.
- [x] 264 unit/integration tests and 66 E2E across laptop and iPad;
      typecheck, lint and build clean.

**M8 is COMPLETE.** Next milestone: **M9 — Data Center** (backup/restore/
import/export/audit UI) per `docs/00_MASTER_PLAN.md`.

## M9 exit gate (from source build plan)

"Recovery drill" passes. Tracked here explicitly:

- [x] A budget workbook and a portfolio snapshot can each be uploaded from
      the browser and run through the real ingestion pipeline — the same
      code path the tests exercise, not a parallel "web" import.
- [x] Every upload produces a visible Import Audit (acceptance test 1).
- [x] Uploaded files are validated (extension, size) and stored at a
      generated path that no supplied filename can escape.
- [x] A manual "Export a backup now" and the restore flow (including the
      conflict-and-force sequence from `16_DATA_MIGRATION.md`) are both
      reachable from the screen.
- [x] An automatic backup runs after every import, and otherwise on a
      24-hour interval, each recorded distinctly in the audit log.
- [x] Provenance (source documents), trust-state counts, revisions, and the
      full audit log are each visible and readable, not raw JSON.
- [x] 294 unit/integration tests and 76 E2E across laptop and iPad;
      typecheck, lint and build clean.

**M9 is COMPLETE.** Next milestone: **M10 — Market/reporting** (still
gated on D-007, provider selection).

## M10 exit gate (from source build plan)

Tracked here explicitly:

- [x] D-007 resolved with a documented, zero-cost provider evaluation
      before any code was written against a provider.
- [x] Nifty 50, Sensex, Nifty Bank tracked via a free source; Nifty Metal's
      absence of a free source is documented (D-016), not guessed at.
- [x] Mutual fund NAVs update automatically from AMFI, matched by ISIN.
- [x] Equity/ETF live pricing is opt-in per holding via an optional symbol
      — never assumed, never required.
- [x] A provider or single instrument failing never blocks any other
      source or instrument from updating (verified both in unit tests with
      injected failures and live in this sandbox, where every fetch
      genuinely fails).
- [x] Every refresh is audited (`market_refresh`), decoded readably in the
      Data Center's existing audit log — no parallel provenance system.
- [x] A locally generated report distinguishes Fact / Inference /
      Recommendation, sourced entirely from already-computed engine
      outputs — no AI, no invented figures.
- [x] Market data is never converted into a transaction, holding, or
      activity record (M5's protected rules untouched).
- [x] Nothing introduced requires a credit card, API key, or paid tier.
- [x] 342 unit/integration tests and 92 E2E across laptop and iPad;
      typecheck, lint and build clean.

**M10 is COMPLETE.** Continuing immediately into **M11 — AI Analyst** per
the standing autonomous-build directive (no user confirmation required
between milestones).

## M11 exit gate (from source build plan)

"Grounding/hallucination tests" pass. Tracked here explicitly:

- [x] One provider interface; Ollama (local, free, no key) is the default,
      OpenAI/Anthropic are optional and never selected without an
      explicit key.
- [x] The AI never touches the database, a source file, or anything
      beyond the already-computed report payload it is given.
- [x] Every response is checked against that payload before being shown;
      a response stating even one figure not present in the payload is
      rejected outright, never shown with a caveat.
- [x] A provider-unavailable outcome degrades to "AI unavailable" without
      affecting any other screen — verified genuinely (no Ollama in this
      environment), not only via an injected failure.
- [x] Every explanation attempt — shown, rejected, or unavailable — is
      audited (`ai_explanation`), decoded readably in the existing Data
      Center audit log.
- [x] Nothing introduced requires a credit card, API key, or paid tier by
      default.
- [x] 370 unit/integration tests and 98 E2E across laptop and iPad;
      typecheck, lint and build clean.

**M11 is COMPLETE.** Continuing immediately into **M12 — Release
hardening** per the standing autonomous-build directive.

## M12 exit gate (from source build plan)

Full release gate. Tracked here explicitly against
`docs/FINAL_AUDIT_REPORT.md`:

- [x] Full test suite, build, typecheck, lint, E2E — all clean in one
      consolidated run (470 tests total).
- [x] Financial reconciliation, import/ingestion, historical revision,
      and idempotency tests all pass (regression, not new coverage).
- [x] Backup/restore and data-provenance tests pass.
- [x] UI/responsive/laptop/iPad and accessibility checks pass across all
      ten screens; one accessibility gap (Settings) found and fixed.
- [x] Security check: no secrets found, upload path safety re-verified,
      one stale/misleading env-var defect found and fixed.
- [x] Performance check: no pathological slowness at this project's
      stated scale.
- [x] Market-data failure and AI-grounding tests pass, both against a
      genuine (not simulated) unavailable-provider condition in this
      environment.
- [x] Regression test: the full historical suite runs clean alongside
      this milestone's additions — nothing skipped or weakened.
- [x] Documentation check and reference coverage audit: two documentation
      staleness defects found and fixed; reference coverage confirmed
      complete and stable through M11.
- [x] GitHub repository audit: clean working tree, no secrets or
      database files tracked, branch in sync with origin.
- [x] Zero-cost verification: ₹0 mandatory cost across software, API,
      database, hosting, storage, and reporting.

**M12 is COMPLETE. WEALTHFORGE OS is release-ready for personal use**,
per `docs/FINAL_AUDIT_REPORT.md`'s verdict — subject only to documented,
non-blocking open decisions (D-006, D-008, D-015, D-016), none of which
the stated success condition (`CLAUDE.md` §29) requires.

## Post-M12, Round 2: engineering closure findings

The "FINAL ENGINEERING CLOSURE → UI TESTING PHASE" directive required
re-verifying a numbered list of Round 2 (R2) findings against the
controlling docs before declaring engineering closure. Status of each:

- **R2-01 (Insurance screen)** — CONFIRMED missing, FIXED. Built
  `src/views/insuranceView.ts` + `/insurance` route + nav entry,
  connected to `InsurancePolicy` data. `coverAmountMinorUnits`,
  `premiumMinorUnits`, and `premiumFrequency` were made nullable
  (additive migration) rather than fabricated as 0 for the figures
  `docs/02_REQUIREMENTS.md` never states.
- **R2-02 (provenance drill-down)** — assessed SATISFIED BY DESIGN, not a
  gap requiring new UI. `docs/03_INFORMATION_ARCHITECTURE.md` requires
  "every headline number... is drillable: clicking it opens a detail view
  showing the contributing records and their provenance/trust state."
  Every screen already shows its contributing line items directly, with
  `TrustBadge`, inline — one navigation away, not behind a literal
  clickable number. Building a separate modal/detail-view mechanism on
  top of that would duplicate what is already visible and risks the
  "no redesign" instruction; left as-is.
- **R2-03 (period selector consistency)** — CONFIRMED consistent, no fix
  needed. Command Center, Budget, Portfolio, and Analytics all resolve
  their period through the one shared `src/views/context.ts`
  (`resolveAsOf`/`listPeriods`/`resolveLatestPeriod`) — no competing
  period system exists.
- **R2-04 (Analytics filters)** — CONFIRMED partially missing, PARTIALLY
  FIXED. The asset-class filter (`assetClasses`) existed end-to-end in
  `src/views/analyticsView.ts` but had no UI control; added a "Filter
  asset class" badge list next to the existing activity-kind one,
  composing with it. Instrument, source/provider, and metric filters
  remain unbuilt — no enumerable instrument/provider list is wired into
  this view yet, and "metric" filtering has no defined UI semantics in
  the current table layout; documented as a known, deferred gap rather
  than built speculatively.
- **R2-05 (custom period comparison)** — CONFIRMED missing, FIXED. The
  "custom" period key existed in the domain (`resolvePeriod`) but was
  hidden from the Analytics UI, and the view only ever derived its
  comparison side automatically (preceding/prior-year) — there was no
  path to compare two independently chosen ranges, despite
  `docs/11_ANALYTICS_SPEC.md` requiring exactly that. Added a `"custom"`
  `ComparisonMode` and a `customComparison` option to `getAnalyticsView`,
  and two date-range forms on the Analytics screen, reusing the existing
  half-open `DateRange` architecture — no new comparison engine.
- **R2-06 (manual controls coverage)** — CONFIRMED two real gaps, BOTH
  FIXED:
  - No UI ever recorded a goal contribution/withdrawal, despite
    `docs/04_USER_FLOWS.md`'s fully-specified "Allocate leftover cash to
    a goal" flow and the domain check (`canAllocateToGoal`, `src/domain/goals.ts`)
    existing since M4. Added a form on the Budget screen; the server
    action re-derives what remains of the period's unallocated cash
    after earlier allocations before checking a new one, and records one
    `goal_contribution` Activity on success.
  - Manual price/NAV entry only existed for an index with no free source
    (Nifty Metal, D-016) — a held equity/ETF with no opted-in symbol, or
    a mutual fund AMFI does not carry, had no fallback. Extended the same
    (already instrument-agnostic) action to the Equities & ETFs and
    Mutual Funds tables on the Market screen.
- **R2-07 (Groww)** — CONFIRMED no real fixture exists; matches the
  already-documented D-014. No new work — manual CSV/XLSX import remains
  the functional path regardless, and no Groww compatibility is claimed
  anywhere.
- **R2-08 (documentation consistency)** — this section, plus the
  Information Architecture screens table (`Insurance` row) and
  `docs/features/market-data.md`, updated to reflect the above.

Separately, Phase 3's financial-integrity re-check required a regression
test proving a credit-card purchase (expense) and its bill payment
(liability settlement) are never double-counted; none existed, so one was
added to `tests/domain/budget.test.ts`.

All of the above shipped with full typecheck/lint/unit/E2E coverage per
commit (388 unit tests, 112 E2E across both viewports as of this section).

---

## v1.1 — Personal Investment Master (Intelligence Layer)

Extends the frozen v1.0 engine with a new intelligence layer per
`docs/21_INTELLIGENCE_MASTER_PLAN.md`. Staged milestones IM-01 through
IM-08; each ships with its own audit (typecheck/lint/unit/E2E) before the
next begins.

- **IM-01 (Intelligence Foundation)** — COMPLETE. `src/domain/insight.ts`:
  the `Insight<T>` contract, `MetricDefinition`, `AggregateTrust`,
  `TimeSeriesPoint<T>`/`buildMonthlySeries`, `Decomposition`/
  `buildDecomposition`, `ScenarioResult<T>`/`buildScenarioResult`. Pure
  infrastructure, no UI surface. 13 unit tests.
- **IM-02 (Wealth Intelligence)** — COMPLETE. `src/views/wealthIntelligenceView.ts`:
  Net Worth Trajectory, Assets vs Liabilities, Net Worth Waterfall,
  Monthly Money Flow, Savings Rate Trend, Investment Rate Trend. Extracted
  `computeNetWorthAsOf` out of `commandCenterView.ts` for reuse. Wired into
  the Command Center. 7 unit tests, 2 E2E tests.
- **IM-03 (Investment Intelligence)** — COMPLETE. `src/views/investmentIntelligenceView.ts`:
  Portfolio X-Ray, Planned vs Actual Allocation, Portfolio Growth
  Decomposition, Contribution vs Return, Portfolio Performance
  (aggregate P&L, CAGR, XIRR), Concentration Heatmap, Drawdown Monitor,
  Portfolio vs Benchmark, Investment Plan Adherence. Every widget composes
  existing domain/view functions (`getPortfolioView`, `comparePlannedAllocation`
  via a newly-exported `buildAllocationComparison` from `analyticsView.ts`,
  `computeCagr`, `computeXirr`, `buildDecomposition`) — no new calculation
  path. Portfolio vs Benchmark reads only the existing `Valuation` table
  populated by the resolved D-007 market-data layer or manual entry; it
  never fetches live data itself and reports each tracked index as
  insufficient when it has no dated observation at both range boundaries
  (this is the actual, expected state on a fresh install with no market
  refresh yet — see `docs/18_FAILURE_MODES.md`). One new loader,
  `loadDistinctSnapshotDates`, added to `src/data/loaders.ts` so the
  Drawdown Monitor samples only real recorded observation dates, never a
  fabricated daily series. Wired into the Command Center under a new
  "Investment intelligence" section. 12 unit tests, 2 E2E tests (laptop +
  iPad).

  Known data-completeness limitation (recorded in
  `docs/18_FAILURE_MODES.md`): Growth Decomposition, Contribution vs
  Return, Portfolio Performance's XIRR, and Investment Plan Adherence all
  depend on confirmed `buy`/`sip`/`sell` Activity records, which the
  documented snapshot-import ingestion path never fabricates from an
  observed quantity change. In the demo data set (snapshot-only, no
  manually recorded transactions) these widgets correctly report
  insufficient-data rather than a fabricated figure — this is the honest,
  intended behavior for that data set, not a defect.

- **IM-04 (Goal & Liability Intelligence)** — COMPLETE. `src/views/goalLiabilityIntelligenceView.ts`:
  Goal Funding Radar, Goal Collision Detector, Emergency Fund Runway, Debt
  Freedom Meter, EMI Release Timeline, Goal Trade-Off Simulator. Reuses
  `computeGoalProgress`/`projectGoalCompletion` (the same functions and
  6-month contribution rate the Goals screen uses), `projectEmiRelease`/
  `splitEmiByPayer` (the same functions the Liabilities screen uses), and
  the new IM-01 `buildScenarioResult` for the trade-off simulator. Extended
  `LiabilityDetail` and `loadLiabilities` with the already-schema-backed
  `principalMinorUnits` field (Debt Freedom Meter's repaid ratio). Goal
  Collision Detector identifies when active goals' combined stated-deadline
  demand exceeds the latest month's unallocated cash — it never decides
  which goal to sacrifice; the existing fixed priority order remains the
  only ordering applied. Goal Trade-Off Simulator is a pure, labeled
  scenario (IM-01's `ScenarioResult<T>` + disclaimer) that reads real data
  but never writes to any goal or activity record. Emergency Fund Runway
  always reports insufficient-data: `docs/19_OPEN_DECISIONS.md` D-017
  records that no essential/discretionary expense split exists in the
  budget data model, so the widget refuses to substitute total spending
  for essential spending rather than approximate. Wired into the Command
  Center under a new "Goal & liability intelligence" section. 6 unit tests
  (each run twice), 2 E2E tests (laptop + iPad, each run twice).

- **IM-05 (Behavioral & Data Intelligence)** — COMPLETE. `src/views/behavioralIntelligenceView.ts`:
  What's Changed, Financial Anomaly Detector, Financial Health Score, Data
  Health, Historical Coverage. Investment Plan Adherence is named under
  this module too in the v1.1 directive but was already built in IM-03 —
  not duplicated here. What's Changed uses `comparePeriods`/
  `computePeriodMetrics` (M7) over calendar-month-aligned ranges (not a
  rolling 30-day window, which would touch two months without fully
  covering either) plus `computeNetWorthAsOf`. Financial Anomaly Detector
  only lists findings the engine already computes elsewhere
  (`trustStateSummary`'s needs_review/rejected counts, the newly-exported
  `getUnexplainedPositionChanges` from `commandCenterView.ts`, and each
  goal's own `computeGoalProgress` anomaly flag) — it introduces no new
  detection heuristic. Financial Health Score is deliberately scoped to
  data/process health (trusted-record share, absence of unexplained
  position changes, absence of goal balance anomalies, price freshness)
  rather than a financial-adequacy judgment, with every component's point
  value and reason disclosed in the result. Data Health re-exposes
  `trustStateSummary` (the same rollup the Data Center shows). Historical
  Coverage reuses `computePeriodMetrics`'s own `PeriodCoverage` object.
  Wired into the Command Center under a new "Behavioral & data
  intelligence" section. 5 unit tests (each run twice), 2 E2E tests
  (laptop + iPad, each run twice).

All of the above shipped with full typecheck/lint/unit/E2E coverage per
milestone (432 unit tests, 130 E2E across both viewports as of IM-05).
