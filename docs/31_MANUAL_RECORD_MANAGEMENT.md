# 31 — Manual Record Management (Goals, Liabilities, Insurance)

Resolves D-018 (`docs/19_OPEN_DECISIONS.md`). This is a v1.1.1 follow-up:
a general, future-proof way to register a new Goal, Liability/EMI, or
Insurance Policy by hand, and to close or delete one, without waiting on
a workbook/snapshot import.

## Why

Through v1.1.1, Goals/Liabilities/Insurance entered the system almost
entirely through import, with one narrow exception (the Emergency Fund
goal). The account owner asked for a general capability: register a new
purchase-on-EMI (a phone, a card) or a new savings goal from the app
itself, the moment it exists in real life — plus a way to remove a record
added by mistake, or close one that has run its course.

## Where it lives

- **Creation, closing, deletion** — all in the **Data Center**
  (`/data-center`), in three "Register a new ___" cards and one "Manage
  records" card with three sub-tables (Goals, Liabilities, Insurance).
  Data Center was chosen because it is already the screen for anything
  that adds new records to the system (imports), so a manually-typed
  record follows the same mental model as an imported one.
- **Ongoing payments/contributions** — stay on each record's own screen:
  a goal's contribution quick-add is on `/goals`, a liability's EMI
  payment quick-add is on `/liabilities`, matching where the Emergency
  Fund top-up already lived.

## Goals

`createGoalAction` (`src/app/data-center/actions.ts`) takes a name, a
type (`emergency_fund | car | marriage | third_floor | custom`), a target
amount, and an optional target date. A second Emergency Fund goal is
refused — the intelligence layer's ambiguity guard
(`buildEmergencyFundRunway`) assumes there is at most one. The goal
starts `lifecycleState: "planned"` and immediately appears on `/goals`
with its own top-up form (`topUpGoalAction`, generalized from
`topUpEmergencyFundAction`).

`closeGoalAction` sets `lifecycleState: "cancelled"` — the same state an
imported, abandoned goal would carry. `deleteGoalAction` hard-deletes,
but only when `Activity` (contribution/withdrawal) count is zero;
otherwise it refuses and points at Close.

## Liabilities / EMIs

`createLiabilityAction` takes a name, a type (`home_loan | other`), the
**total price**, the **amount paid upfront** (optional, default 0), a
start date, an end date, and an **annual interest rate** — asked for
explicitly every time (D-018 §1), never defaulted silently to 0%, though
0% is an accepted, valid answer for a genuinely no-cost EMI.

From these inputs:

- `principal = totalPrice − amountPaidUpfront` (must be positive — an
  upfront payment covering the full price has nothing left to finance).
- `tenureMonths = computeTenureMonthsBetween(startDate, endDate)` — the
  whole calendar-month difference, clamped to a minimum of 1.
- `emiAmountMinorUnits = computeEmiAmount(principal, interestRateBps, tenureMonths)`
  — the standard reducing-balance amortization formula
  `EMI = P·r·(1+r)^n / ((1+r)^n − 1)`, with monthly rate `r` derived from
  the annual rate, and a flat `principal / tenureMonths` fallback at
  `r = 0` (the formula's own division-by-zero limit case).

Both `computeTenureMonthsBetween` and `computeEmiAmount` live in
`src/domain/liabilities.ts`, framework-free and unit-tested
(`tests/domain/liabilities.test.ts`).

The new liability appears on `/liabilities` immediately, with a payer
split, a projected release schedule, and its own uncapped payment
quick-add (`recordEmiPaymentAction`, `src/app/liabilities/actions.ts`) —
the same pattern as a goal's contribution quick-add.

`closeLiabilityAction` sets the new `Liability.closedAt` timestamp
(schema migration `20260905020527_liability_closed_at`). A closed
liability is excluded from `loadLiabilities` (`src/data/loaders.ts`) and
therefore from every downstream calculation — outstanding balance,
total EMI, payer burden — the same way a cancelled goal is excluded from
`activeGoalsByPriority`. Its row and full payment history remain visible,
unfiltered, in the Data Center's "Manage records" table.
`deleteLiabilityAction` hard-deletes only when there are zero recorded
`emi_payment` Activities; otherwise it refuses and points at Close.

## Insurance policies

`createInsurancePolicyAction` takes a type
(`health_personal | health_family | term | other`), the insured party,
the provider, and optional cover amount / premium / premium frequency /
effective-from date. It starts `status: "planned"`.
`closeInsurancePolicyAction` sets `status: "cancelled"`.
`deleteInsurancePolicyAction` always hard-deletes — `InsurancePolicy` has
no linked `Activity` ledger in this schema, so there is no payment
history a delete could discard.

## What was deliberately not built

- No edit-in-place for a created record's terms (rename, re-price, change
  tenure). Correcting a mistake before any activity exists is a delete
  and re-create; correcting one after activity exists would need its own
  revision-tracked "amend" flow, which is out of scope for this pass —
  not asked for, and not obviously safe to build without more thought
  about what happens to already-recorded payments against the old terms.
- No bulk import of manually-typed records — one form, one record, the
  same way the rest of the app treats a single financial fact.

## Verification

Full regression run after this change: `tsc --noEmit` (clean),
`eslint .` (clean), `vitest run` (54 files / 560 tests passing),
`next build` (clean, all 15 routes compile). No new domain formulas
shipped without unit tests — see `computeTenureMonthsBetween` and
`computeEmiAmount` in `tests/domain/liabilities.test.ts`.

End-to-end (Playwright) coverage for the new Data Center forms and
close/delete flows was not added in this pass — recommended as the next
milestone if broader UI regression coverage of this feature is wanted.
