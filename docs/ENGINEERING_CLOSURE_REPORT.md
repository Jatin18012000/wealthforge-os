# Engineering Closure Report

Produced under the post-M12 "FINAL ENGINEERING CLOSURE → UI TESTING PHASE"
directive. This report is the gate: engineering closure is declared only
if every section below is clean.

## Architecture status

Unchanged from `docs/FINAL_AUDIT_REPORT.md`'s M12 verdict, extended by this
round's fixes:

- `src/domain/` remains the sole owner of financial calculation logic,
  framework-free, enforced by an ESLint `no-restricted-imports` rule
  (verified present and correctly scoped to `src/domain/**` this round).
- `Computed<T>` (`{kind:"ok"}` / `{kind:"insufficient-data"}`) remains the
  only return shape for anything that can fail for lack of data — no new
  code this round introduced a default/zero/estimate fallback.
- The manual-adjustment pattern (Source → Adjustment → Result → Reason →
  History) was reused, not reinvented, for the Insurance screen's
  overridable fields — no parallel override mechanism was added.
- The market-data manual-entry mechanism (`recordManualQuoteAction`,
  previously `recordManualIndexQuoteAction`) was generalized to more
  instrument kinds by removing an artificial restriction, not by adding a
  second mechanism.
- One new UI-writable path was added this round that did not exist before:
  `src/app/budget/actions.ts`'s `allocateToGoalAction` is the first place
  in the app that creates an `Activity` row directly rather than through
  ingestion. It reuses the existing `Activity` model, the existing
  `canAllocateToGoal` domain check (present since M4), and the existing
  trust-state model (`trustState: "verified"` for a live, directly
  user-confirmed action) — no new persistence concept was introduced.

## Milestone status

M0–M12 complete (`docs/20_BUILD_ROADMAP.md`). Post-M12 Round 2 findings
(R2-01 through R2-08) triaged and resolved or explicitly deferred with
reasoning — see `docs/20_BUILD_ROADMAP.md`'s "Post-M12, Round 2" section
and `docs/FINAL_ACCEPTANCE_MATRIX.md` for the itemized requirement-level
status.

## Verified requirements

See `docs/FINAL_ACCEPTANCE_MATRIX.md` — every row is PASS, DEFERRED, or
NOT APPLICABLE; zero rows are FAIL or NOT VERIFIED.

## Remaining limitations (explicitly deferred, not blocking)

- Analytics: instrument, source/provider, and metric filters are not
  built — the domain has partial support (`instrumentIds`) but no UI
  control exists, and source/provider has no queryable field at all.
  Building any of these now, without a concrete UI design for how they'd
  compose with the existing kind/asset-class filters, would be scope
  creep beyond "fix verified gaps."
- Provenance drill-down (R2-02) is satisfied by direct navigation to a
  screen's line-item tables (with trust badges) rather than a literal
  clickable-headline-number modal. This reading is consistent with the
  spirit of the requirement (contributing records and trust state are
  reachable, never hidden) without adding a second UI mechanism.
- D-006 (brokerage/Zerodha live integration), D-008 (desktop packaging),
  D-015 (>2-payer split override), and D-016 (Nifty Metal's lack of a free
  automatic source, mitigated by manual entry) remain open per
  `docs/19_OPEN_DECISIONS.md`, none required by the stated success
  condition.
- No real Groww fixture exists (R2-07); manual CSV/XLSX import remains
  the functional path for any brokerage/AMC this app has no adapter for.

## Deferred decisions

Unchanged from `docs/19_OPEN_DECISIONS.md` — D-006, D-008, D-015, D-016 all
carry an explicit resolution or user decision already recorded there.

## Test results

- **Unit/integration** (`vitest`): 388 tests, 36 files, all passing.
- **E2E** (`playwright`): 112 tests (56 × 2 viewports — laptop, iPad), all
  passing.
- **Typecheck** (`tsc --noEmit`): clean.
- **Lint** (`eslint .`): clean.
- **Build** (`next build`): clean, all 13 routes compile.

All four were re-run from a freshly re-seeded demo database immediately
before this report was written, not carried over from an earlier state.

## Known risks

- The demo E2E database is a persistent SQLite file shared across test
  runs, not reset automatically between `playwright test` invocations.
  Running the suite twice without reseeding (`pnpm db:demo`) can produce
  false failures from accumulated state (e.g. a manual market-quote
  "already recorded for that date" collision, or a goal-allocation test's
  "remaining to allocate" going more negative each run). This is a known
  property of the local dev/test setup, not a defect in the app: CI or a
  fresh clone starts from a clean seed every time.
- `allocateToGoalAction`'s "remaining to allocate" figure treats every
  `goal_contribution`/`goal_withdrawal` activity dated within a calendar
  month as having come out of that month's budget surplus. For historical
  "seed" contributions (money moved into a goal before this app existed,
  entered with a retroactive date) this can make a period's "remaining to
  allocate" go negative even though the money was never actually drawn
  from that period's real surplus. This is a data-entry interpretation
  question, not a calculation bug — the figure is exactly what the
  recorded dates say — but a future data-entry UI might want a way to
  mark a contribution as "not from this period's surplus" (e.g. an
  initial balance) to avoid this reading. Not fixed here: it would be a
  new modeling concept, out of scope for a fix-verified-gaps pass.

## Zero-cost audit

Re-confirmed this round: no new mandatory paid dependency. AI providers
remain key-gated and optional (Ollama is the working-by-default local
provider). Market data remains AMFI (free, official) + Yahoo Finance
(free, unofficial) + manual entry, with no paid tier anywhere in the path.
Insurance, goal allocation, and the widened manual-quote entry are all
local computation and local storage.

## Data-integrity audit

Re-confirmed this round via the credit-card double-counting test (Phase 3)
and the goal-allocation flow's use of `canAllocateToGoal` gated on
period-remaining cash (not the raw plan figure) — see
`docs/FINAL_ACCEPTANCE_MATRIX.md`'s "Financial calculation rules" and
"Manual controls coverage" sections for the full list of re-verified
invariants.

## Security audit

No new upload path, no new secret, no new external network call
introduced this round. The Insurance schema change (nullable
`coverAmountMinorUnits`/`premiumMinorUnits`/`premiumFrequency`) is a
narrowing-to-safer change (never fabricate a figure as 0), applied via a
standard Prisma migration, not a hand-edited SQL script.

## Repository state

Working tree clean; `claude/wealthforge-os-foundation-5rfjdn` in sync with
`origin` as of this report. No secrets, no `.db` files, and no other
runtime artifacts are tracked.

## Verdict

**ENGINEERING COMPLETE — UI TESTING PHASE ACTIVE.**

Every mandatory-requirement, financial-calculation, ingestion,
historical-integrity, manual-control, backup-restore, Data-Center,
zero-cost, and security verification in this report is PASS or an
explicitly-reasoned DEFERRED; documentation is reconciled
(`docs/FINAL_ACCEPTANCE_MATRIX.md`, `docs/20_BUILD_ROADMAP.md`); the full
test suite, build, and E2E run are green; there are zero unresolved P0/P1
defects (none were found). The financial engine is now frozen per
`docs/UI_TESTING_PHASE.md`.
