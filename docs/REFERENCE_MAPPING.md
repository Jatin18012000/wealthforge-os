# Reference Mapping

Traceability from each reference structure through to the running software:

> **Reference → Requirement → Domain entity → Database field → Ingestion
> rule → Validation rule → Test fixture → Application feature**

Every row names real code and a real test. Where a row's feature is not yet
built, that is stated rather than implied.

---

## R-01 · Budget workbook (Plan)

| Reference structure | Requirement | Domain entity | Database field | Ingestion rule | Validation rule | Test fixture / test | Feature |
|---|---|---|---|---|---|---|---|
| Income label+amount pair under an "Income" header | Capture monthly income | `PlanRecordInput` (income) | `plan_record.category='income'`, `amount_minor_units` | `budgetWorkbook.ts` → `detectBudgetLayout` finds the header row; amount is the column right of the label | Amount must parse; negative flagged | `budget-reference-layout.xlsx` → "extracts line items from the side-by-side income and expense blocks" | Budget screen income |
| Expense label+amount pair under "Expenses" | Capture monthly expenses | `PlanRecordInput` (expense) | `plan_record.category='expense'` | same, expense block | as above | same test | Budget screen expenses |
| EMI rows sitting inside the Expenses column | Track EMI separately for burden and release | `PlanRecordInput` (emi), `Liability` | `plan_record.category='emi'` | `looksLikeEmiLabel` OR the row has an EMI end date | — | "classifies EMIs inside the expenses column…" | Liabilities screen, EMI burden |
| `EMI end date` column | Project EMI release | `LiabilityDetail.tenureMonths` | `liability.tenure_months` (M8 link pending) | Column found by header text; used today to classify EMIs | Date must parse or row is flagged | same test | EMI release projection |
| `Frequency` column (July onward) | Understand recurrence | raw context | `sheet_snapshot.raw_data_json` | Detected when present; absent in May without error | — | "handles a sheet whose columns sit at different positions" | Provenance drill-down |
| Investments block, label+amount | Planned investment allocation | `PlanRecordInput` (investment) | `plan_record.category='investment'` | Block located by its "Investments" banner below the totals row | as above | "reproduces the workbook's own derived figures…" | Plan vs Reality |
| `total` row (`=SUM(...)`) | Must NOT be imported | — | — | `isDerivedBudgetLabel` skips it | — | "excludes formula-derived subtotals…" | Prevents double-counting every total |
| `Investment` row (`=income−expense`) | Must NOT be imported; reproduce instead | `MonthlyBudget.retainedMinorUnits` | derived, never stored | skipped as derived | — | same test | Command Center surplus |
| `Left over cash for the month` | Must NOT be imported; reproduce instead | `MonthlyBudget.unallocatedMinorUnits` | derived, never stored | skipped as derived | — | same test | Cash available to allocate |
| `Previous month left` income row | Carry-over is ambiguous for rate denominators | `PlanRecordInput` (income) | `plan_record` | `isCarryoverLabel` records an issue | Flagged, not dropped (D-012) | "flags carry-over income…" | Savings-rate caveat |
| Column positions differing per sheet | Layout must not be hardcoded | — | — | positions detected per sheet | — | "handles a sheet whose columns sit at different positions" | Robust re-import |
| Two byte-different copies, identical content | Repeat upload is idempotent | — | `sheet_snapshot.content_hash` | content hash, not file bytes | — | "is idempotent across two byte-different copies…" | Import Audit "unchanged" |
| `Core expenses` sheet with payer notes | Payer split | `LiabilityPayerSplit` | `liability_payer_split.share_bps` | Retained as a reference sheet; free-text notes not parsed | — | fixture includes the sheet | **Not yet built — M8** |

## R-02 · Zerodha holdings statement (Position)

| Reference structure | Requirement | Domain entity | Database field | Ingestion rule | Validation rule | Test fixture / test | Feature |
|---|---|---|---|---|---|---|---|
| Preamble rows before the header | Read past it | — | — | `findHeaderRow` locates the row carrying Symbol+ISIN | — | "reads holdings past the preamble and blank leading column" | Portfolio import |
| `…Statement as on YYYY-MM-DD` | Date the snapshot | `PositionSnapshot.asOfDate` | `position_snapshot.as_of_date` | `findAsOnDate`; caller need not supply one | Mismatch with a supplied date **refuses the import** (D-011) | "takes the statement's own as-of date…", "refuses to import when the supplied date contradicts…" | Dated valuation |
| `ISIN` | Stable instrument identity | `Instrument` | `instrument.identifier` | ISIN preferred over symbol | — | "identifies instruments by ISIN…" | Survives ticker renames |
| `Symbol` | Human-facing name | `Instrument` | `instrument.display_name` | kept as display text | — | same test | Portfolio screen labels |
| `Sector` = "ETF" / ISIN `INF` prefix | Derive asset class | `PositionInput.assetClass` | `instrument.kind` | `deriveAssetClass`; gold/silver split out by symbol | — | "derives asset class from the statement…" | Allocation by asset class |
| `Quantity Available` | Holding quantity | `PositionSnapshot.quantity` | `position_snapshot.quantity` | primary quantity column | Non-numeric or negative → `needs_review` | "records cost basis and a dated price…" | Portfolio valuation |
| `Quantity Discrepant` | Broker disputes the holding | trust state | `position_snapshot.trust_state` | non-zero → `needs_review` | — | covered by the validation path | Excluded from totals |
| `Quantity Pledged (Margin)/(Loan)` | Total-holding semantics unknown | — | raw context | non-zero → flagged, not summed (D-013) | — | zero in all reference data | **Open — D-013** |
| `Average Price` (4 dp) | Cost basis | `ProfitAndLoss.costBasisMinorUnits` | `position_snapshot.cost_basis_minor_units` | full-precision rupees × quantity, **rounded once** | — | "reconciles line-item cost basis against the statement's own Invested Value" | P&L |
| `Previous Closing Price` | Dated price, not live | `Valuation` | `valuation.price_minor_units`, `as_of_date` | stored with the statement date | Unparseable → no valuation written | "records cost basis and a dated price…" | Freshness indicator |
| `Invested Value` summary | Reconciliation check | — | — | line items summed and compared | Drift beyond tolerance raises an issue | "reconciles line-item cost basis…" | Import Audit |
| `Combined` sheet | Must NOT be ingested | — | — | skipped by name | — | "skips the Combined sheet…" | Prevents double-counting the portfolio |
| Quantity change across statements | Observation, not a transaction | `ObservedPositionChange` | none written | reported and reconciled against recorded trades | Unreconciled → surfaced as an issue | "reports the real observed position changes between two statements" | Data Center review queue |
| `Unrealized P&L` | Independent cross-check | `ProfitAndLoss` | — | read but not trusted over our own computation | — | — | **Deferred — see coverage audit** |

## R-03 · Cross-source links

| Link | Status |
|---|---|
| The workbook's gold / silver / index-ETF investment lines ↔ the matching `-E` suffixed ETF holdings in the statement | Instruments exist on both sides; automatic linking **not yet built** — needed for Plan vs Reality on investments (M7) |
| Budget "Home emi" ↔ `Liability` + payer split from `Core expenses` notes | **Not yet built — M8** |
| The three mutual funds in the budget | Held outside Zerodha; no statement supplied — **D-014** |
