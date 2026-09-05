# 32 — v1.2 Product Direction (owner decisions, 2026-09-05)

Twenty scope decisions taken by the account owner in one session, after a
full read-only scan of the live database. This document is the authority on
*what v1.2 is and is not*; each entry records what was asked, what was
decided, and what it costs or unlocks — so a later session does not
re-litigate a settled question or guess at an unsettled one.

Two of these close long-standing open decisions: **D-014** (mutual funds
held outside Zerodha) and **D-015** (payer splits with more than two
payers). Both are updated in `docs/19_OPEN_DECISIONS.md`.

---

## 0. State of the live database at the time of these decisions

Recorded because it is the reason this direction matters, and because it
corrects an assumption carried through several prior sessions.

`data/wealthforge.db` contains **no real financial data**. Every record
traces to `prisma/demo-seed.ts` or the anonymized test fixtures:

- All three `source_document` rows are the reference fixtures
  (`budget-reference-layout.xlsx`, `zerodha-holdings-2026-08-03.xlsx`,
  `zerodha-holdings-2026-08-08.xlsx`).
- All six goals, the sole liability ("Home Loan / LAP"), all three insurance
  policies and both app settings are verbatim from the demo seed.
- Checked across **all 242 backups** spanning the project's full history:
  the only filenames ever imported are those fixtures plus
  `equity-v1-base.csv`. No real workbook has ever been ingested.

It also carries residue from E2E runs made before E2E was isolated onto its
own database (`.env.test`, added 2026-09-05): 14 manual overrides all
reading *"checked against the bank statement"* (the Settings E2E test's own
string), 38 AI daily-brief events, 14 market refreshes, and an Emergency
Fund balance inflated by four ₹1 test top-ups.

**Consequence:** every widget currently describes a fictional person.
Importing real data is a prerequisite to the milestones below being worth
building, not a follow-up to them.

---

## 1. The twenty decisions

### Scope that will be built

| # | Question | Decision |
|---|---|---|
| 2 | Credit cards | **Full card tracking** — new model: billing cycle, statement and due dates, billed vs unbilled, utilisation, linked card EMIs |
| 4 | EPF / PF | **Manual balance**, updated occasionally, freshness-badged |
| 5 | Mutual funds | **Platform CSV import** (Groww/Coin), same adapter pattern as Zerodha holdings |
| 6 | EMI payments | **Derived from budget workbook EMI rows** — an imported EMI row is evidence the payment occurred |
| 7 | SIPs and trades | **Tradebook / transaction import** — broker tradebook plus MF transaction statement |
| 8 | Due dates | **Full cash-flow calendar** — due dates on recurring outflows, "due in the next 7 days" tile |
| 11 | Protection gap | **Yes**, against an owner-stated target term cover |
| 14 | EMI payer split | **Fixed rupee amounts**, three payers (see §2) |
| 15 | Tax | **Full estimate** — regime, deductions, liability, effective rate |
| 16 | Capital gains | **Realised and unrealised**, with holding periods; feeds the tax estimate |
| 17 | FI projection | **Full personal profile** — age, target FI age, dependents, retirement expenses |
| 18 | Asset allocation | **Target allocation with rebalancing suggestions**, drift-threshold triggered |
| 19 | Drawdown monitor | **A single owner-set percentage** threshold |

### Scope explicitly declined

Recorded so these are not "helpfully" built later. Each was offered and
turned down.

| # | Question | Decision |
|---|---|---|
| 1 | Bank accounts | **One combined cash figure.** No `Account` model, no per-account balances, no statement reconciliation |
| 3 | Salary structure | **Stays in the workbook.** No CTC/appraisal/bonus model |
| 9 | Non-salary income | **Ordinary workbook rows.** No separate irregular-income concept |
| 10 | Insurance premiums | **Cover-only.** Policies record what you're covered for, not what it costs |
| 12 | Goal target dates | **Only where they genuinely exist.** Undated goals stay honestly undated |
| 13 | Surplus allocation | **Manual.** The app never proposes a split |
| 20 | Update rhythm | **Monthly, at month close.** Staleness thresholds in weeks, not days |

---

## 2. Decisions with immediate design consequence

### §2.1 — Home loan payer split (closes D-015)

The demo data models the loan as `You 35% / Family 65%`. **Reality: three
payers — the owner, his father, and his brother — and the owner pays a fixed
₹10,000 per month** against an EMI of roughly ₹28,416.

Two consequences:

1. **Three payers makes D-015 live.** `checkPayerSplitTotal` /
   `planPayerSplitChange` currently *refuse* an override when a liability
   has three or more payers, because no single companion change is
   correct. That refusal was acceptable while no real liability had more
   than two payers. One now does.
2. **A fixed amount is not a share.** `LiabilityPayerSplit.shareBps` stores
   basis points. ₹10,000 of ₹28,416 is 3,519 bps *today*, but the owner's
   contribution is fixed: if the EMI changes (floating-rate reset, or a
   part-prepayment), his ₹10,000 stays ₹10,000 and the other two payers
   absorb the difference. Storing it as bps would silently inflate his
   share the moment the EMI moved.

**Decision:** payer splits gain a fixed-amount mode alongside the existing
proportional mode. A liability may mix them: fixed amounts are taken first,
and the remainder is attributed to the proportional payers. The 3+ payer
refusal is replaced by a "record all shares together" form, as D-015
anticipated.

### §2.2 — EMI payments from workbook rows

Chosen over both a manual monthly confirmation and auto-generation from a
due date. Auto-generation was explicitly rejected as it would assert a
payment the owner never confirmed, violating the project's rule against
inventing facts.

**Design problem this creates:** an EMI budget row carries a label, not a
liability id. Mapping "which EMI row pays which liability" needs an
explicit, owner-visible link — not a fuzzy string match that silently
mis-attributes a payment. Resolve this before implementing.

### §2.3 — Dependency chain for the tax work

Not independent, and must be built in order:

```
Q7 tradebook import  →  Q16 capital gains  →  Q15 tax estimate
(exact dated cash    (cost basis + holding  (realised gains are
 flows and costs)     periods per lot)       an input to liability)
```

Building the tax estimate first would mean estimating gains from balances,
which the engine cannot honestly do — 1 of 13 current position snapshots
already lacks a cost basis.

### §2.4 — Maintenance debt accepted knowingly

The **full tax estimate (Q15) requires annual review** after each Union
Budget. Rates, slabs, and exemption limits change; an unmaintained tax
module goes quietly wrong rather than loudly failing. This is the only
decision in this set that carries a recurring upkeep obligation, and it was
accepted with that stated.

### §2.5 — An orphaned setting

`salary_increment_split` (50% investments / 30% priority goal / 20%
lifestyle) exists in `app_setting`, but Q3 declined a salary model — so
nothing will ever consume it. Either wire it to a manual "I got a raise of
₹X" action, or remove it. Currently decorative.

---

## 3. Values still required from the owner

None of these can be inferred; each blocks the milestone beside it.

| Value needed | Blocks |
|---|---|
| Target term cover amount | M13 (protection gap) |
| Age, target FI age, dependents, expected retirement expenses | M13 (FI projection) |
| Target allocation percentages, and drift threshold | M13 (rebalancing) |
| Drawdown alert percentage | M13 (drawdown monitor) |
| Tax regime — old or new | M20 (tax estimate) |
| MF platform — Groww or Coin (export layouts differ) | M17 (MF import) |
| Whether the father/brother split of the remaining ~₹18,416 matters | M14 (payer split) |

---

## 4. Recommended milestone sequence

Dependency-ordered. Each milestone ends with a summary and stops for
approval, per root `CLAUDE.md`.

**M12.5 — Real data onboarding.** Reset the database, import the real
budget workbook and holdings. Prerequisite to everything below being
meaningful (see §0).

| Milestone | Content | Depends on |
|---|---|---|
| **M13** | Profile and thresholds (Q17, Q18, Q19, Q11) | owner values (§3) |
| **M14** | Payer split — fixed amounts, 3 payers (Q14) | — |
| **M15** | EMI payments from workbook (Q6) | §2.2 mapping resolved |
| **M16** | Cards and cash-flow calendar (Q2, Q8) | — |
| **M17** | Mutual funds and EPF (Q5, Q4) | platform choice |
| **M18** | Tradebook / transaction import (Q7) | — |
| **M19** | Capital gains (Q16) | M18 |
| **M20** | Tax estimate (Q15) | M19 |

M13 is deliberately first: it is the cheapest work in the set and it makes
four already-built widgets (FI projection, planned-vs-observed allocation,
drawdown monitor, insurance) stop running on unstated assumptions.
