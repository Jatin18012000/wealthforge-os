# UI Testing Phase

Declares the transition from engineering to UI/visual QA, per the
post-M12 "FINAL ENGINEERING CLOSURE → UI TESTING PHASE" directive.
Engineering closure conditions are recorded in
`docs/ENGINEERING_CLOSURE_REPORT.md`; this document governs what happens
next.

## Financial engine freeze

As of this document, the following are **frozen** — treated as correct and
not to be modified except to fix a defect UI testing itself surfaces:

- `src/domain/**` — all calculation, valuation, goal, liability, period,
  and comparison logic.
- `src/manual/**` — the adjustment/override model (Source → Adjustment →
  Result → Reason → History).
- Ingestion semantics in `src/ingestion/**` — diff kinds, trust-state
  assignment, snapshot-vs-activity distinction, revision/supersede
  behavior.
- The Prisma schema's shape and meaning (columns may still gain additive,
  nullable fields if a genuine UI-testing-driven defect requires one, per
  the unfreeze procedure below, but no calculation semantics change).

**UI work from this point must only consume existing domain/view-model
outputs.** No new financial calculation may be added to a React component,
a server action, or the AI layer. A screen that needs a number the engine
does not yet expose is a signal to extend the relevant `src/views/*.ts`
composition (which calls the existing domain functions) — never to compute
it inline in the page.

### Unfreeze procedure

If UI testing (Phases 11–15) finds a genuine financial-engine defect
(wrong number, wrong trust-state handling, a double-count, a fabricated
value):

1. Temporarily unfreeze only the specific file(s) involved.
2. Fix the defect with a test that reproduces it first (red, then green).
3. Run the full regression (`tsc --noEmit`, `eslint .`, `vitest run`,
   `next build`, `playwright test` against a freshly reseeded demo DB).
4. Re-freeze — record what was fixed and why in
   `docs/ENGINEERING_CLOSURE_REPORT.md`'s "Known risks" section or a new
   dated addendum, so the freeze's history stays auditable.

A cosmetic UI change (spacing, wording, a missing empty state) never
requires unfreezing anything — it stays entirely in `src/app/**` and
`src/components/**`.

## Scope of UI testing (Phases 11–15)

Per the directive: every supported screen (Command Center, Budget,
Portfolio, Goals, Liabilities, Insurance, Analytics, Market, Data Center,
Settings, AI Analyst) on laptop (primary, 1440×900) and iPad (secondary,
the Playwright `ipad` project's viewport) plus smaller widths — layout,
spacing, typography, hierarchy, navigation, tables, charts, cards, forms,
dialogs, buttons, scrolling/overflow, breakpoints, and the following nine
data states per screen where applicable:

1. Healthy (complete, trusted data)
2. Empty (nothing imported/recorded yet)
3. Partial (some months/records missing)
4. Missing (a referenced entity absent)
5. Stale (data older than the freshness threshold)
6. Untrusted (`extracted`/`needs_review` records)
7. Conflicting (an import conflict, a revision)
8. Manual-override (a value with an active adjustment)
9. Error (a fetch/provider failure)

NULL/UNKNOWN/INSUFFICIENT DATA/UNTRUSTED must never render as a misleading
₹0 in any of the nine states — this is the single most important visual
invariant to check, since it is the one a screenshot alone will not catch
if the reviewer isn't looking for it specifically.

Deliverables: `docs/UI_TEST_MATRIX.md` (`| Screen | Desktop | iPad | Empty
| Partial | Error | Trust | Interaction | Accessibility | Status |`),
defects classified P0–P3, and — once P0=P1=0 —
`docs/UI_TESTING_FINAL_REPORT.md`.

## What UI testing is not

No new features, no trading, no paid APIs, no cloud infrastructure, no
architecture redesign, no rewritten calculations, no speculative
dashboards, no microservices, no unnecessary dependencies. Only fix,
verify, test, document, and polish what already exists.

## Status

**Engineering phase: COMPLETE.** UI testing phase: not yet started —
`docs/UI_TEST_MATRIX.md` and `docs/UI_TESTING_FINAL_REPORT.md` do not yet
exist. This is the next recommended milestone.
