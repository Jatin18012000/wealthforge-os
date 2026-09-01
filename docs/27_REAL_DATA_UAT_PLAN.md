# 27 — Real-Data User Acceptance Testing (UAT) Plan

## Purpose

This document defines how the repository owner validates WealthForge OS
against their own real financial data, on their own laptop, after cloning
the repository from GitHub. It is a **plan**, not a report — every result
in the companion validation matrix (`docs/29_REAL_DATA_VALIDATION_MATRIX.md`)
is left for the owner to fill in by actually running the application.
Nothing in this document, or in the matrix, claims a test has passed
until the owner has performed it themselves.

This phase does **not** modify the frozen v1.0 financial engine, does
**not** implement D-017, does **not** start v1.2 planning, and does
**not** add any feature. Its only output is documentation plus, if the
owner's real-data testing surfaces a genuine defect, a stop-and-report
back to this conversation — never a silent fix.

## Non-negotiable constraints carried into this phase

Per root `CLAUDE.md`, `.claude/CONSTITUTION.md`, and every prior
milestone's own rules, WealthForge must remain, and this UAT plan must
validate that it remains:

- **Local-first** — the source of truth is the local SQLite file
  (`data/wealthforge.db`), never a cloud database.
- **Free of mandatory cost** — no step in this plan requires a paid
  service, API key, or subscription. AI defaults to local Ollama (or is
  skipped entirely); market data uses AMFI's and Yahoo Finance's free,
  unauthenticated endpoints.
- **Laptop-first, iPad-secondary** — every screen is validated at a
  laptop viewport first, then re-checked at iPad width.
- **Locally stored** — all owner financial data stays inside the local
  `data/` directory on the owner's machine.
- **Automatically backed up** — `ensureAutomaticBackup` (once per 24h,
  and unconditionally after every workbook import) must be observed to
  actually write a file.
- **Manually import/export capable** — the Data Center's upload flow and
  the `pnpm backup:export`/`pnpm backup:restore` CLI must both work
  against real data.
- **Provenance-preserving** — every imported record must remain traceable
  to the file and sheet/row it came from.
- **Trust-aware** — every trust state transition (extracted → needs_review
  → validated/verified, or rejected) must behave as documented, not just
  on demo fixtures.
- **Historically persistent** — re-importing a workbook must never erase
  a prior month's history; the M3 revision model must hold on real data
  too.

## Absolute rule: real financial data never enters Git

- The owner works from their own local clone. All real budget workbooks,
  portfolio statements, and the resulting `data/wealthforge.db` and
  `data/backups/*.json` stay **outside** version control.
- `.gitignore` already excludes `data/*.db`, `data/*.db-journal/-wal/-shm`,
  `data/uploads/`, `data/backups/`, and (defense-in-depth) `**/*.db`
  anywhere in the tree. Before starting, the owner should run
  `git status` after any import to confirm nothing under `data/` shows as
  a trackable change — see `docs/28_OWNER_DEPLOYMENT_CHECKLIST.md` step
  for the exact check.
- **Never commit, paste, upload, or share** the contents of a real budget
  workbook or portfolio statement into this conversation, a GitHub issue,
  a commit message, or a screenshot that leaves the owner's machine. If a
  screenshot is needed to report a defect, redact all real balances,
  account numbers, and names first.
- If the owner ever sees a real figure appear in a git diff, `git status`,
  or a file under source control, treat it as a stop-the-line security
  defect (`docs/13_SECURITY_PRIVACY.md`) — report it here rather than
  attempting a self-fix.

## Test data hygiene

Two options for real-data UAT, either is acceptable:

1. **Actual real data**, understanding it never leaves the owner's laptop
   and is never committed (recommended for a true acceptance test).
2. **A realistic but fabricated copy** shaped like the owner's real
   workbook/statements (same columns, sheet names, categories) with
   invented numbers — useful for a dry run before risking real data, or
   if the owner prefers not to load real balances into a pre-release
   build at all.

Either way, the same 32-area matrix applies unchanged.

## The 32 UAT areas

Each area below states what "pass" means. The owner performs the action
and records the actual outcome in `docs/29_REAL_DATA_VALIDATION_MATRIX.md`.

1. **Clean clone** — `git clone` succeeds; the working tree matches
   `origin/claude/wealthforge-os-foundation-5rfjdn` (or `main`, once
   merged) with no missing files.
2. **Dependency installation** — `pnpm install` completes with no error,
   using only the packages already pinned in `pnpm-lock.yaml` (no network
   access to an unexpected registry, no paid package).
3. **Environment initialization** — `cp .env.example .env` produces a
   working configuration with zero required edits for core operation;
   `DATABASE_URL` resolves to `data/wealthforge.db` at the repo root, not
   `prisma/data/`.
4. **Database migration** — `pnpm prisma:generate` then a fresh-database
   migration (`prisma migrate deploy` for a clean laptop setup, or
   `pnpm db:reset` if starting over) creates every table in
   `prisma/schema.prisma` with no error.
5. **Database initialization** — after migration, the database file
   exists at `data/wealthforge.db`, is writable, and contains zero rows
   (a truly empty starting state) unless the owner explicitly seeds demo
   data first.
6. **Application start** — `pnpm dev` starts a local server (default
   `http://localhost:3000`) with no error in the terminal, and the
   Command Center loads in a browser.
7. **Backup directory creation** — `data/backups/` is created
   automatically on first backup (manual or automatic) if it does not
   already exist; no manual `mkdir` is required.
8. **Manual backup** — `pnpm backup:export` writes a timestamped JSON
   file under `data/backups/` containing the current database's data.
9. **Automatic backup** — after 24 hours since the last automatic backup
   (or on the very first Data Center page load, since no prior run
   exists), visiting the Data Center screen triggers
   `ensureAutomaticBackup` and a new file appears under `data/backups/`.
   (To test this sooner than 24h, the owner can lower
   `autoBackupIntervalHours` via the Settings screen's override flow, or
   simply rely on "no prior backup" firing immediately on first visit.)
10. **Restore verification** — `pnpm backup:restore -- <path> [--force]`
    restores a previously exported backup; a safety backup of the
    pre-restore state is written first; restoring without `--force` onto
    a database with conflicting data is refused with a clear conflict
    message, not a silent overwrite.
11. **Budget workbook import** — uploading the owner's real (or
    realistic-fabricated) budget workbook via the Data Center produces an
    Import Audit showing sheets classified as NEW/MODIFIED/UNCHANGED, and
    line items appear correctly categorized on the Budget screen.
12. **Portfolio CSV/XLSX import** — uploading a real portfolio snapshot
    (equities/ETFs/gold/silver/mutual funds, whichever the owner actually
    holds) produces holdings on the Portfolio screen with correct
    quantities, prices, and asset classes; anything the parser could not
    resolve appears in the exclusions list, never silently dropped.
13. **Historical month retention** — after importing a second, later
    month's workbook, the first month's data is still visible (via
    Analytics' period selector or the Command Center's trajectory
    widgets) — nothing is overwritten by a later import.
14. **Duplicate import behavior** — re-uploading the exact same workbook
    a second time classifies every sheet as UNCHANGED (by content hash)
    and does not create duplicate line items or a duplicate revision.
15. **Correction/revision behavior** — editing a value in the source
    workbook and re-uploading it creates a new revision for the changed
    sheet/line, with the prior value still visible in revision history —
    never a silent in-place overwrite.
16. **Position snapshot behavior** — importing two portfolio snapshots
    across different dates shows both as distinct dated observations; a
    quantity change between them is recorded as an "unexplained position
    change" (surfaced on the Command Center and in Financial Anomaly
    Detector) rather than silently assumed to be a buy or sell.
17. **Activity reconciliation behavior** — manually recording a real
    `buy`/`sip`/`sell`/`emi_payment`/`goal_contribution` activity (where
    the owner has one) causes the relevant widgets (Investment Plan
    Adherence, Portfolio Performance's XIRR, Goal Funding Radar) to
    reflect it; where no such activity has ever been recorded, those
    widgets correctly show insufficient-data rather than a fabricated
    figure.
18. **Goals** — the owner's real goals (or a realistic set) can be
    created/edited, show correct progress against actual contributions,
    and their priority order is respected everywhere goals are ranked
    (Command Center, Goal Funding Radar, Goal Trade-Off Simulator).
19. **Liabilities** — the owner's real liabilities (loans/EMIs) show
    correct outstanding balance, EMI amount, payer split, and a debt-free
    projection consistent with the actual loan tenure.
20. **Insurance** — real policies (if any) show recorded premium/cover
    figures, or "Not recorded" rather than a fabricated ₹0 where a figure
    was never entered.
21. **Analytics** — every documented period (this month, last month,
    quarter-to-date, year-to-date, custom range, etc.) resolves against
    real data, with activity-kind and asset-class filters working
    correctly and a genuinely custom-vs-custom comparison producing
    sensible variances.
22. **Market data** — a live refresh (AMFI NAV / Yahoo Finance) succeeds
    for the owner's real held instruments where a free source exists, and
    correctly falls back to "no data"/manual entry for anything with no
    free source (e.g. an index covered only by D-016's manual-entry path).
23. **Investment Intelligence** — all nine IM-03 widgets (Portfolio X-Ray,
    Planned vs Actual Allocation, Growth Decomposition, Contribution vs
    Return, Portfolio Performance, Concentration Heatmap, Drawdown
    Monitor, Portfolio vs Benchmark, Investment Plan Adherence) render
    against real portfolio data, each either showing a real figure or a
    stated insufficient-data reason.
24. **AI Analyst** — with Ollama installed and reachable locally (or
    skipped, since it is optional), the AI Analyst produces a grounded
    explanation of real data with no fabricated figure; with no provider
    reachable, it degrades to "AI unavailable" without breaking any other
    screen.
25. **Command Center** — the full Command Center 2.0 layout (Daily Brief,
    tiles, and every section from `docs/25_COMMAND_CENTER_V2_SPEC.md`)
    renders correctly against real data end to end.
26. **Data Center** — the import audit log, provenance viewer, trust-state
    summary, revision history, and backup/restore controls all reflect
    the owner's real import history accurately.
27. **Manual adjustments** — overriding a real figure via Settings
    (Source → Adjustment → Result → Reason → History) correctly changes
    downstream totals, is fully reversible, and is never silent.
28. **Trust states** — real imported records correctly start at
    `extracted`/`needs_review` as appropriate and move to
    `validated`/`verified` (or `rejected`) exactly as the trust model
    documents, with untrusted records correctly excluded from totals.
29. **Provenance** — for any real figure on any screen, the owner can
    trace it back (via the Data Center's provenance view) to the specific
    file, sheet, and row it came from.
30. **Insufficient-data states** — for whatever real data the owner does
    not have (e.g. no essential/discretionary expense split for
    Emergency Fund Runway per D-017, or no confirmed activity for a
    snapshot-only asset), the corresponding widget correctly shows
    insufficient-data with a stated reason rather than a guessed number.
31. **Laptop viewport** — every screen above is checked at a standard
    laptop width (e.g. 1280–1440px) for correct layout, no horizontal
    scroll, and full readability.
32. **iPad viewport** — every screen above is re-checked at iPad width
    (the existing Playwright `ipad` project's viewport, or a real iPad/
    iPad-width browser window) for the same.

## What happens if a defect is found

Per the owner's explicit instruction: **stop and report**, do not
silently redesign. Specifically:

1. Record the exact area (1–32), the expected result, and the actual
   result in `docs/29_REAL_DATA_VALIDATION_MATRIX.md`.
2. Bring it back to this conversation with enough detail to reproduce
   (screenshot with real data redacted, exact steps, exact error text).
3. Wait for a decision on whether it is a genuine deployment-blocking
   defect (fixed as its own scoped change) versus expected behavior
   (e.g. an insufficient-data state that is correct given the owner's
   actual data completeness) before any code changes are made.

## Explicit non-goals of this phase

- Not a performance benchmark.
- Not a security penetration test (see `docs/13_SECURITY_PRIVACY.md`/
  `SECURITY_RULES.md` for that scope, already covered at M12).
- Not an invitation to add new widgets, change the financial engine, or
  begin D-017 — those are explicitly deferred until after this UAT
  completes, per the owner's instruction.
