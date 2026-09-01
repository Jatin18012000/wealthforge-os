# 29 — Real-Data Validation Matrix

Companion to `docs/27_REAL_DATA_UAT_PLAN.md` and
`docs/28_OWNER_DEPLOYMENT_CHECKLIST.md`. This is the literal record of
whether WealthForge OS actually works against the owner's real financial
data, on the owner's own laptop.

## Legend — read before filling this in

- **STATUS** starts at **`OWNER-VALIDATED`** for every row in this
  document as published. In this document, that literal string is a
  **placeholder meaning "pending — awaiting the owner's own test run,"
  not "already confirmed passing."** No test in this matrix has been
  executed against real data by anyone as of publication. Nothing here
  is a claim of success.
- As the owner actually performs each test, replace that row's STATUS
  with one of: **PASS**, **FAIL**, **PARTIAL**, **BLOCKED**, or
  **SKIPPED** (with a reason in NOTES for BLOCKED/SKIPPED).
- **ACTUAL RESULT** is left blank (`—`) for every row as published, per
  the explicit instruction not to fabricate it. Only the owner's own
  observation belongs in that column.
- **EVIDENCE** is where the owner records what they checked against —
  e.g. a screenshot (with real figures redacted before sharing anywhere),
  a terminal log excerpt, a specific screen and figure observed. Never
  paste raw real financial data into this file, since it is committed to
  git — see `docs/27_REAL_DATA_UAT_PLAN.md`'s "real financial data never
  enters Git" section.
- If a row turns up a genuine defect, do not edit application code to
  "make the row pass." Record FAIL with the exact observed behavior, and
  bring it back to the development conversation per the UAT plan's
  "what happens if a defect is found" section.

## The matrix

| # | TEST | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|---|---|
| 1 | Clean clone | `git clone` + checkout succeeds; working tree matches origin with no missing files | — | OWNER-VALIDATED | | |
| 2 | Dependency installation | `pnpm install` completes with no error, using only `pnpm-lock.yaml`'s pinned versions | — | OWNER-VALIDATED | | |
| 3 | Environment initialization | `cp .env.example .env` works with zero required edits; `DATABASE_URL` resolves to repo-root `data/wealthforge.db` | — | OWNER-VALIDATED | | |
| 4 | Database migration | `pnpm prisma:generate` + `npx prisma migrate deploy` create every table with no error | — | OWNER-VALIDATED | | |
| 5 | Database initialization | `data/wealthforge.db` exists, is writable, and is empty until seeded or imported into | — | OWNER-VALIDATED | | |
| 6 | Application start | `pnpm dev` starts with no error; Command Center loads at `localhost:3000` | — | OWNER-VALIDATED | | |
| 7 | Backup directory creation | `data/backups/` is created automatically on first backup, no manual `mkdir` needed | — | OWNER-VALIDATED | | |
| 8 | Manual backup | `pnpm backup:export` writes a timestamped JSON backup file under `data/backups/` | — | OWNER-VALIDATED | | |
| 9 | Automatic backup | Visiting Data Center after the interval has elapsed (or on first-ever visit) triggers a new automatic backup file | — | OWNER-VALIDATED | | |
| 10 | Restore verification | `pnpm backup:restore` restores cleanly with a matching snapshot; refuses a conflicting restore without `--force` and takes a safety backup first | — | OWNER-VALIDATED | | |
| 11 | Budget workbook import | Real workbook upload produces a correct Import Audit and correct Budget-screen line items | — | OWNER-VALIDATED | | |
| 12 | Portfolio CSV/XLSX import | Real portfolio snapshot upload produces correct holdings, quantities, prices, asset classes; unresolved rows appear as exclusions, not silently dropped | — | OWNER-VALIDATED | | |
| 13 | Historical month retention | Importing a second month's workbook does not erase or alter the first month's data | — | OWNER-VALIDATED | | |
| 14 | Duplicate import behavior | Re-uploading an unchanged workbook classifies every sheet UNCHANGED; no duplicate line items or revisions | — | OWNER-VALIDATED | | |
| 15 | Correction/revision behavior | Editing a value and re-uploading creates a new revision; prior value remains visible in history | — | OWNER-VALIDATED | | |
| 16 | Position snapshot behavior | Two dated portfolio snapshots show as distinct observations; an unexplained quantity change is flagged, never assumed to be a trade | — | OWNER-VALIDATED | | |
| 17 | Activity reconciliation behavior | Recording a real activity (`buy`/`sip`/`sell`/`emi_payment`/`goal_contribution`) correctly updates dependent widgets; absence of one correctly yields insufficient-data | — | OWNER-VALIDATED | | |
| 18 | Goals | Real goals can be created/edited; progress and priority order are correct everywhere they're shown | — | OWNER-VALIDATED | | |
| 19 | Liabilities | Real liabilities show correct outstanding balance, EMI, payer split, and debt-free projection | — | OWNER-VALIDATED | | |
| 20 | Insurance | Real policies show recorded figures, or "Not recorded" rather than a fabricated ₹0 | — | OWNER-VALIDATED | | |
| 21 | Analytics | Every documented period resolves correctly against real data; filters and custom-vs-custom comparison work | — | OWNER-VALIDATED | | |
| 22 | Market data | Live refresh succeeds for real held instruments with a free source; correctly falls back to manual entry / no-data otherwise | — | OWNER-VALIDATED | | |
| 23 | Investment Intelligence | All 9 IM-03 widgets render correctly against real portfolio data, each showing a real figure or a stated insufficient-data reason | — | OWNER-VALIDATED | | |
| 24 | AI Analyst | With Ollama reachable: grounded explanation with no fabricated figure. With none reachable: clean "AI unavailable" degradation | — | OWNER-VALIDATED | | |
| 25 | Command Center | Full Command Center 2.0 layout renders correctly end to end against real data | — | OWNER-VALIDATED | | |
| 26 | Data Center | Import audit, provenance, trust-state summary, revision history, backup/restore controls all reflect real import history accurately | — | OWNER-VALIDATED | | |
| 27 | Manual adjustments | Overriding a real figure via Settings correctly changes downstream totals and is fully reversible | — | OWNER-VALIDATED | | |
| 28 | Trust states | Real records move through `extracted`/`needs_review`/`validated`/`verified`/`rejected` exactly as documented; untrusted records excluded from totals | — | OWNER-VALIDATED | | |
| 29 | Provenance | Any real figure can be traced back to its source file/sheet/row via the Data Center | — | OWNER-VALIDATED | | |
| 30 | Insufficient-data states | Genuinely missing real data (e.g. no essential/discretionary split, no confirmed activity) correctly shows insufficient-data, never a guess | — | OWNER-VALIDATED | | |
| 31 | Laptop viewport | Every screen above renders correctly at laptop width (1280–1440px), no horizontal scroll | — | OWNER-VALIDATED | | |
| 32 | iPad viewport | Every screen above renders correctly at iPad width, no horizontal scroll | — | OWNER-VALIDATED | | |

## Sign-off

- [ ] All 32 rows updated with a real STATUS (not the `OWNER-VALIDATED`
  placeholder) by the owner.
- [ ] Any FAIL/PARTIAL/BLOCKED row has been reported back to the
  development conversation and a decision recorded on whether it is a
  genuine deployment-blocking defect.
- [ ] No real financial figures appear anywhere in this file, any commit,
  or any file under `data/` that git tracks.

**Owner sign-off date:** _____________
**Result:** ☐ Accepted for real-data use ☐ Accepted with known limitations (listed above) ☐ Not yet accepted
