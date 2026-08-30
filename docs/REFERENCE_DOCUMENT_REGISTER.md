# Reference Document Register

Every source file supplied as reference material, what it actually contains,
and what it changes about the implementation. Compiled by inspecting each
file directly with `scripts/inspect-source-file.mjs` (read-only; no supplied
file was modified).

**Privacy:** this register records *structure*, not personal financial data.
Amounts are cited only where they corroborate a figure already recorded in
`02_REQUIREMENTS.md` from the controlling specification. The broker account's
client ID is redacted throughout as `<CLIENT_ID>`. No real figures or
identifiers are committed to fixtures — see
`tests/fixtures/reference/README.md`.

**Document hierarchy** (per the user's instruction): Level 1 user-confirmed
requirements → Level 2 Final Dashboard Specification → Level 3 PRD/Master
Brief → Level 4 these reference files → Level 5 engineering judgement. A
lower level never silently overrides a higher one; where these files
*clarify* something the specification left open, that is recorded as a
resolved decision in `19_OPEN_DECISIONS.md`.

---

## R-01 · Budget_file_for_2026.xlsx (two byte-different copies)

| | |
|---|---|
| **Type** | Recurring personal budget workbook — the primary Plan source |
| **Copies** | Two supplied. SHA-256 `52e53efe…` and `3dab70f4…`; both 17,700 bytes |
| **Sheets** | `May`, `June`, `July`, `August`, `Core expenses` |
| **Purpose** | Month-by-month income, expenses, EMIs and planned investments |

### Structure actually found

The workbook is **not** a flat `Category / Label / Amount` table. Each month
sheet is a **two-block layout with paired label+amount columns**, and the
column positions **shift between sheets**:

| Sheet | Banner | Header row | Income cols | Expense cols | Frequency | EMI end date | Totals row |
|---|---|---|---|---|---|---|---|
| May | r2 | r3 | E / F | G / H | — | I | r16 |
| June | r4 | r5 | D / E | F / G | — | H | r20 |
| July | r4 | r5 | D / E | F / G | H | I | r20 |
| August | r4 | r5 | D / E | F / G | H | I | r20 |

Columns A–C (A–D in May) are empty padding. Below the income/expense block
sits an **Investments block** with its own label+amount pair, and below that
a derived leftover figure.

August, fully mapped:

```
r4          "Monthly budget" banner
r5          Income | (amt) | Expenses | (amt) | Frequency | EMI end date
r6–r19      line items — income in D/E, expenses in F/G
r20  total  =SUM(E6:E19)               =SUM(G6:G19)
r25         "Investments" banner
r26         "Investment"  =E20-G20                ← DERIVED, not a line item
r27–r33     planned investments (label in E, amount in F)
r34         =SUM(F27:F33) → 19,500                ← DERIVED
r37         "Left over cash for the month"  =F26-F34   ← DERIVED
```

### Financial rules this file establishes

1. **EMI is an expense.** The home, phone, tablet and watch EMIs all sit in
   the Expenses column. This *resolves D-010*: the user's own model is
   `retained = income − expenses (EMI included)`.
2. **"Investment" available = income total − expense total** (`=E20-G20`).
   This is exactly the engine's `retainedMinorUnits`.
3. **"Left over cash for the month" = available − invested** (`=F26-F34`).
   This is exactly the engine's `unallocatedMinorUnits`.
4. **Corroborates the documented baseline**: August planned investments total
   **₹19,500** and Home EMI is **₹10,000** — both matching
   `02_REQUIREMENTS.md` exactly, independently confirming those figures.
5. **Carry-over income**: rows named "Previous month left" / "Previous month
   leftover salary" appear as *income*. Last month's leftover becomes this
   month's income.
6. **Named investment lines map onto real holdings**: the workbook's gold,
   silver and index-ETF lines correspond to the matching `-E` suffixed ETF
   holdings in R-02 — the Plan-to-Position link the dashboard needs.
7. `Core expenses` is a reference sheet: recurring EMI amounts, end dates,
   and **payer-split notes in free text** — a note of the form "<amount> paid
   by <relative> every month" against two of the EMI lines.

### Implementation impact — CRITICAL

- The M3 parser assumed a header in row 1 and a `Category` column. Against
  this file it finds neither and extracts **nothing usable**. A dedicated
  adapter is required (`src/ingestion/sources/budgetWorkbook.ts`).
- **Derived rows must be excluded or every total double-counts**: `total`
  (r20), `Investment` (r26), the investments `SUM` (r34), and `Left over
  cash` (r37) are all formula cells that restate line items already counted.
- Category comes from **column position under a section header**, not from a
  cell value.
- Column positions must be **detected per sheet**, not hardcoded.

### Conflict with other documents

None material. The file *clarifies* the surplus definition the specification
left ambiguous (D-010) and corroborates the baseline figures.

### The two copies are content-identical

Cell-by-cell comparison across all five sheets: **zero differences**. The
files differ only in bytes (Excel rewrites internal metadata on save). This
is a real-world validation of the M3 decision to key idempotency on
**content hash rather than file bytes** — a byte-hash design would have
misreported this as a change to every sheet.

---

## R-02 · Zerodha holdings statements (three snapshots)

| | |
|---|---|
| **Type** | Broker holdings statement — the primary Position source |
| **Files** | Three statements, as on 2026-08-03, 2026-08-08 and 2026-08-12. Filenames are omitted here because one embeds the account's client ID. |
| **Sheets** | `Equity`, `Mutual Funds`, `Combined` |
| **Holdings** | ~20 equity/ETF lines; the Mutual Funds sheet is present but empty |

### Structure actually found

Not a plain table. Each sheet carries a **preamble** before the data:

```
r7    Client ID | <CLIENT_ID>
r11   "Equity Holdings Statement as on 2026-08-03"    ← as-of date IS in the file
r13   "Summary"
r15   Invested Value   | <amount, 4 dp>
r16   Present Value    | <amount, 2 dp>
r17   Unrealized P&L   | <amount, 4 dp>
r18   Unrealized P&L Pct. | <percentage, 4 dp>
r23   Symbol | ISIN | Sector | Quantity Available | Quantity Discrepant |
      Quantity Long Term | Quantity Pledged (Margin) | Quantity Pledged (Loan) |
      Average Price | Previous Closing Price | Unrealized P&L | Unrealized P&L Pct.
r24+  data
```

Column **A is empty**; data begins at column B. The header row differs per
sheet (Equity r23, Mutual Funds r22, Combined r23) and the Combined sheet
inserts an extra `Instrument Type` column, shifting every column right.

### Fields identified

| Field | Meaning | Maps to |
|---|---|---|
| `Symbol` | Trading symbol; ETFs carry a `-E` suffix | `instrument.display_name` / alias |
| `ISIN` | Stable global identifier | **`instrument.identifier`** — canonical identity |
| `Sector` | Sector, or literally `ETF` for ETFs | asset-class derivation |
| `Quantity Available` | Free quantity held | `position_snapshot.quantity` |
| `Quantity Discrepant` | Broker-flagged discrepancy | raw context; non-zero must be flagged |
| `Quantity Long Term` | Subset held > 1 year | raw context (tax lots) |
| `Quantity Pledged (Margin)` / `(Loan)` | Pledged quantity | raw context; non-zero changes total-holding semantics |
| `Average Price` | Per-unit acquisition cost | `position_snapshot.cost_basis` (× quantity) |
| `Previous Closing Price` | Dated price | `valuation.price_minor_units` |
| `Unrealized P&L` / `Pct.` | Broker-computed P&L | independent cross-check of the engine |

### Financial rules this file establishes

1. **ISIN is the right instrument identity.** One holding in the statements
   trades under a symbol the company adopted after a rebrand, while its ISIN
   is unchanged. Keying on symbol would fragment that instrument's history
   across the rename; ISIN would not.
2. **Asset class is derivable, not a required input.** `Sector = "ETF"`
   marks ETFs; ISINs beginning `INF` are funds/ETFs while `INE` are
   equities. Both signals are present in the file.
3. **The as-of date is in the file** ("…as on 2026-08-03") — this revisits
   D-011: the date can be extracted and cross-checked rather than trusted
   blindly from the caller.
4. **Summary totals give a free reconciliation check**: Σ(quantity ×
   average price) must equal `Invested Value`, and Σ(quantity × previous
   closing) must equal `Present Value`.
5. The price column is `Previous Closing Price` — explicitly *not* live.
   Freshness labelling matters (`18_FAILURE_MODES.md`, "stale price").

### Real observed changes across the three snapshots

Two ETF holdings increased in quantity between the 3rd and 8th August
statements, and their average prices moved at the same time — the signature
of a genuine purchase rather than a data correction. Quantities held flat
between the 8th and the 12th. (Exact quantities and prices are the user's
own position data and are deliberately not recorded here.)

These are genuine position changes with no transaction records in the
system, exercising the M5 observed-change path against real data rather
than a synthetic fixture.

### Implementation impact — CRITICAL

- The M5 snapshot parser assumed a header in row 1. Against this file it
  reads the `Client ID` preamble row as headers and extracts **nothing**. A
  dedicated adapter is required (`src/ingestion/sources/zerodhaHoldings.ts`).
- **`Combined` duplicates `Equity` + `Mutual Funds`.** Ingesting all three
  sheets would double-count the entire portfolio. Exactly one path must be
  taken.
- Header-row and column offsets must be **detected**, not hardcoded.

### Open question this file raises

`Quantity Available` is zero-pledged in all three snapshots, so whether the
total holding is `Available` alone or `Available + Pledged` **cannot be
determined from this data**. Recorded as **D-013**; the adapter uses
`Available` and flags any non-zero pledged quantity for review rather than
guessing.

---

## R-03 · Cross-document relationships

```
Budget workbook: named gold / silver / index-ETF lines   (Plan)
        ↕ same instruments
Zerodha statement: the matching -E suffixed ETF holdings (Position)
        ↕
Budget "Home emi" + Core expenses payer notes            (Liability + payer split)
```

The budget states *intent to invest* ₹19,500/month across named funds; the
Zerodha statements show *what is actually held*. Linking them is what makes
Plan vs Reality (`11_ANALYTICS_SPEC.md`) work on real data. The link is by
name today and is imprecise for the three mutual funds, which are held
outside Zerodha and appear in no supplied statement — recorded as **D-014**.

---

## R-04 · Documents referenced but NOT supplied

The controlling specification cites a *Financial OS V3 PRD* and *Master
Brief*, and the specification itself notes some earlier files "have expired
from the current file workspace". Those were not provided and are **not**
claimed as read. Everything in this register comes from the five files
actually supplied plus the two specification documents. Groww mutual-fund
statements are likewise not present — see D-014.
