# Reference Coverage Audit

Run after implementing the reference-driven source adapters. Confirms nothing
in the supplied material was lost, and states plainly what is deferred.

**Audit date:** 2026-08-30 · **Suite at audit:** 155 tests passing;
typecheck, lint and build clean.

Deferral classes, per the handoff instruction:
**A** = required before M6 · **B** = safe to defer to release hardening ·
**C** = requires a user decision.

---

## 1 · Every relevant reference document was read

| Document | Read | Method |
|---|---|---|
| Budget_file_for_2026.xlsx (copy 1) | Yes | `scripts/inspect-source-file.mjs`, all 5 sheets |
| Budget_file_for_2026.xlsx (copy 2) | Yes | Cell-by-cell diff against copy 1 |
| Zerodha holdings 2026-08-03 | Yes | All 3 sheets |
| Zerodha holdings 2026-08-08 | Yes | All 3 sheets |
| Zerodha holdings 2026-08-12 | Yes | All 3 sheets |

Not supplied, so **not** claimed as read: the Financial OS V3 PRD, the Master
Brief, and any Groww statement. See register R-04.

## 2 · Concept coverage

| Concept | Implemented | Location | Test coverage | Class |
|---|---|---|---|---|
| Side-by-side budget layout | Yes | `sources/budgetWorkbook.ts` | 7 tests | — |
| Per-sheet column detection | Yes | `detectBudgetLayout` | "columns at different positions" | — |
| Derived-row exclusion | Yes | `isDerivedBudgetLabel` + formula flag | "excludes formula-derived subtotals" | — |
| EMI classification inside expenses | Yes | `looksLikeEmiLabel` + EMI-date rule | "classifies EMIs…" | — |
| Investments block | Yes | `findInvestmentsBlock` | "reproduces the workbook's own derived figures" | — |
| Content-hash idempotency | Yes | `computeContentHash` | "idempotent across two byte-different copies" | — |
| Zerodha preamble/header detection | Yes | `sources/zerodhaHoldings.ts` | 9 tests | — |
| Statement-supplied as-of date | Yes | `findAsOnDate` + contradiction refusal | 2 tests | — |
| ISIN as instrument identity | Yes | `extractZerodhaSheet` | "identifies instruments by ISIN" | — |
| Asset-class derivation | Yes | `deriveAssetClass` | "derives asset class…" | — |
| Combined-sheet double-count guard | Yes | `ZERODHA_SHEETS.skip` | "skips the Combined sheet" | — |
| Cost basis at full precision | Yes | full-precision × quantity, rounded once | "reconciles… against Invested Value" | — |
| Summary reconciliation | Yes | `extractZerodhaStatement` | same test | — |
| Observed change ≠ transaction | Yes (M5) | `detectObservedChange` | "reports the real observed position changes" | — |
| Central mapping registry | Yes | `sources/mappings.ts` | exercised by all adapter tests | — |
| Raw source preservation | Partial | `sheet_snapshot.raw_data_json` | "…retained verbatim in the sheet snapshot's raw JSON" | **B** |
| Payer split from `Core expenses` notes | No | — | — | **B** (M8) |
| Budget-line ↔ instrument linking | No | — | — | **A-** (needed for M7, not M6) |
| Broker `Unrealized P&L` cross-check | No | read but unused | — | **B** |
| Pledged-quantity semantics | No | flagged only | — | **C** (D-013) |
| Carry-over income in rate denominators | Flagged | `isCarryoverLabel` | "flags carry-over income" | **C** (D-012) |
| Mutual funds held outside Zerodha | No source | — | — | **C** (D-014) |

## 3 · Conflicts found

| Conflict | Resolution |
|---|---|
| Specification implied a simple `Category/Label/Amount` budget table; the real workbook is a positional two-block layout | Reference file wins on *structure* (Level 4 informs implementation detail); the specification still governs *requirements*. Generic parser retained as a fallback so both work. |
| Specification's "surplus = income − total_expenses" left EMI's treatment open | The workbook's own formulas settle it: EMI sits in expenses. D-010 resolved; engine already matched. |
| M5 required an explicit `asOf`; Zerodha statements carry their own date | D-011 amended: the file's date is used when present, and a contradiction with a supplied date **refuses the import** rather than picking one. |

## 4 · Defects found and fixed during this pass

| Defect | Impact if shipped | Status |
|---|---|---|
| Budget parser produced nothing from the real workbook (expected header in row 1) | Every budget figure empty or wrong | Fixed — dedicated adapter |
| Snapshot parser produced nothing from the real statement (read the Client ID row as headers) | Portfolio permanently empty | Fixed — dedicated adapter |
| Cost basis rounded per-unit price to paise before scaling by quantity | Understated cost basis by 39 paise on one holding, 62 on another; broke reconciliation against the broker's own Invested Value, and would understate P&L on every position | Fixed — full precision, rounded once |
| `Combined` sheet would have been ingested alongside `Equity` | **Entire portfolio counted twice** | Fixed — skipped by name |
| Formula-derived rows would have been ingested as line items | **Every monthly total inflated** | Fixed — derived-row exclusion |

## 5 · Requirements deliberately not implemented

| Requirement | Why | Milestone | User approval needed |
|---|---|---|---|
| Payer split parsed from free-text notes | Free text ("1500 paid by sibling every month") is not a reliable machine source; manual entry in M8 is safer than parsing prose into a financial split | M8 | No |
| Broker P&L used as a cross-check assertion | Our P&L is computed from cost basis and dated price; asserting equality with the broker's figure needs its rounding convention confirmed first | M12 | No |
| Budget-line ↔ instrument linking | Needed for Plan vs Reality on investments, not for M6's screens | M7 | No |
| Pledged-quantity handling | Cannot be determined from data where every pledge is zero | — | **Yes — D-013** |
| Carry-over income treatment in rates | Genuinely ambiguous; currently counted as income and flagged | — | **Yes — D-012** |
| Non-Zerodha mutual fund holdings | No statement supplied | — | **Yes — D-014** |

## 6 · No reference knowledge lost

Each structure in the register maps to a row in `REFERENCE_MAPPING.md`, and
each mapped row names either implementing code plus a test, or an explicit
deferral above. The three open user decisions (D-012, D-013, D-014) are
recorded in `19_OPEN_DECISIONS.md` and none blocks M6.

## 7 · M5 handoff verdict

M5 was **not rebuilt**. Its snapshot-vs-activity distinction, revision
handling, duplicate policy, same-date correction, observed-change detection,
cost basis, activity quantity, provenance, and CSV/XLSX handling were all
checked against the reference statements and hold up — the two real ETF
purchases between the 3rd and 8th August statements exercise the
observed-change path exactly as designed. What M5 lacked was a *source
adapter for the real layout*, which has been added alongside the existing
generic path rather than replacing it. All 16 original M5 tests still pass.

## 8 · M10 re-check (market data)

Re-scanned all five reference reports and both controlling documents
before starting M10: none contain a market-data provider, index-tracking
methodology, or live-price schema — the reference material's scope was
budget/portfolio *ingestion layouts*, not market-data sourcing. D-007
(market data provider selection) is therefore resolved from Level 4/5
(source-doc requirements + engineering judgment via
`docs/MARKET_DATA_PROVIDER_EVALUATION.md`), not from a reference report —
there is nothing in the reference library that a market-data decision
could silently override. `Valuation.source`/`Valuation.fetchedAt`
(existing since M2's schema) already model exactly what a fetched price
needs; no reference-driven schema change was required for M10.
