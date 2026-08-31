# UI Test Matrix

Phase 11–15 of the post-M12 "FINAL ENGINEERING CLOSURE → UI TESTING PHASE"
directive. Method: full-page screenshots of all 11 screens at both
Playwright viewports (laptop 1440×900, iPad 834×1194) against the real
demo database, reviewed directly; automated checks for horizontal overflow
and exactly-one-`<h1>`-plus-labelled-nav on every screen at both
viewports; manual review of every screen's rendering of the nine
documented data states where that state is actually reachable in the demo
data.

Status legend: **PASS** (verified, no defect), **FAIL** (defect found and
fixed this pass — see "Defects found and fixed" below), **N/A** (state not
reachable/applicable on this screen).

| Screen | Desktop | iPad | Empty | Partial | Error | Trust | Interaction | Accessibility | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Command Center | PASS | PASS | N/A (demo always seeded) | PASS (unexplained-quantity-change alerts render) | N/A | PASS (trust-derived alerts) | PASS (Open budget/goals links) | PASS | PASS |
| Budget | PASS | PASS | N/A | PASS ("No data" not "0" for uncovered Plan vs Reality) | N/A | PASS (TrustBadge per line) | PASS (period switch, goal-allocation form) | PASS | PASS |
| Portfolio | PASS | PASS | N/A | PASS | N/A | N/A (no untrusted holdings in demo) | PASS | PASS | PASS |
| Goals | PASS | PASS | N/A | PASS ("Insufficient data" for projections with no contribution history) | N/A | PASS (protected-goal badge) | N/A (read-only screen) | PASS | PASS |
| Liabilities | PASS | PASS | N/A | N/A | N/A | N/A | N/A (read-only screen) | PASS | PASS |
| Insurance | PASS | PASS | N/A (demo always seeded) | PASS ("Not recorded" for null premium/cover, never ₹0) | N/A | N/A (no manual override applied in demo) | N/A (read-only screen; overrides via Settings) | PASS | PASS |
| Analytics | PASS | PASS | N/A | PASS (data-coverage warnings render, "No data" badges) | N/A | N/A | PASS (period/compare/filter links, both custom-range forms) | PASS | PASS |
| Data Center | PASS | PASS | N/A | N/A | N/A | PASS (trust-state counts table) | PASS (upload forms, backup export) | PASS | PASS — see "Known limitations" |
| Settings | **FAIL → FIXED** | PASS | N/A | PASS | N/A | N/A | PASS (preview-before-confirm flow) | PASS | PASS after fix |
| Market | PASS | PASS | PASS ("No mutual fund holdings recorded yet") | PASS ("No data" for unfetched indices) | PASS ("no free source found (D-016)" badge) | N/A | PASS (manual-entry forms for indices, equities/ETFs, mutual funds) | PASS | PASS |
| AI Analyst | PASS | PASS | PASS (no response yet) | N/A | PASS ("AI unavailable" — no local provider reachable in this sandbox) | N/A | PASS | PASS | PASS |

## Defects found and fixed this pass

1. **P1 — Settings screen leaked the literal string "null" into an
   insurance premium override's label.** `src/manual/overrides.ts`
   composed the label as `` `${insuredParty} · ${provider} · ${premiumFrequency}` ``;
   since this session's own R2-01 fix made `premiumFrequency` nullable
   (to avoid fabricating a frequency that was never recorded), a policy
   with no recorded premium rendered a label ending in "· null" — a raw
   programming null leaking into user-facing text, which is exactly the
   failure mode this project's "never fabricate/never leak insufficient
   data as something else" principle exists to prevent. **Fixed**: the
   label omits the frequency segment entirely when it is null. Regression
   test added: `tests/manual/overrides.test.ts` ("never leaks the literal
   string \"null\"...").

2. **P3 — Budget screen's goal-allocation form gave no indication that
   an allocation would be refused when "Remaining to allocate" is zero or
   negative** (a real, reachable state in the demo data — historical goal
   contributions dated within August already exceed the period's planned
   surplus). The form was fully interactive with no visual cue, so a user
   would only learn the allocation failed after submitting and being
   redirected to an error banner above the fold. **Fixed**: a caution
   note now appears directly above the form whenever the remaining
   figure is at or below zero, explaining why an allocation will be
   refused.

No P0 defects found. No other P1/P2 defects found.

## Known limitations (not defects — documented, not fixed this pass)

- **Data Center's backup list has no pagination, filtering, or retention
  policy.** In this environment the list already has 50+ rows because
  `backupAfterImport` fires (correctly, per spec) on every import, and
  this session's demo database was reseeded many times during
  development/testing. In real single-user usage the growth rate is far
  slower (one entry per actual import + one per elapsed backup interval),
  but the list will still grow unbounded over months/years of use with
  no way to manage it from the UI. This is a genuine future scale
  concern, not a correctness defect — nothing is lost or mis-displayed,
  the page is just long. Classified **P2/P3**, deferred: adding
  pagination or a retention policy is new feature work, not a fix to a
  verified gap, and is better done as its own scoped milestone with an
  explicit design for what "old backups" should mean (delete? archive?
  keep N most recent?).

## Nine data states — cross-screen invariant check

The single most important visual invariant (NULL/UNKNOWN/INSUFFICIENT
DATA/UNTRUSTED never rendering as a misleading ₹0) was checked
specifically on every screen where it is reachable in the demo data:

- Budget's Plan vs Reality: renders "No data" badges, not ₹0, for
  every category with no confirmed activity — confirmed visually.
- Analytics' comparison tables: same "No data" treatment, plus explicit
  "Data coverage" caution banners naming which months are excluded and
  why — confirmed visually.
- Goals: a goal with genuinely zero contributions (Marriage,
  Third-floor construction) correctly shows "₹0" (a real recorded zero,
  not an absence) while its *projected completion* correctly shows
  "Insufficient data" (there is no contribution history to project
  from) — confirmed these are visually distinct, not both defaulting to
  the same placeholder.
- Insurance: a policy with no recorded premium/cover shows "Not
  recorded", never ₹0 — confirmed visually, and is what motivated this
  session's earlier decision to make those columns nullable rather than
  seed them as 0.
- Market: an index or holding never fetched shows "No data", never a
  stale ₹0 carried forward — confirmed visually.

## Verdict

All screens PASS at both viewports after the one P1 fix. Zero P0/P1
defects remain open. UI testing for this pass is complete; see
`docs/UI_TESTING_FINAL_REPORT.md`.
