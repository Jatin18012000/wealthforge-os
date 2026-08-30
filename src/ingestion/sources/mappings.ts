/**
 * THE central mapping registry for every import source.
 *
 * All column aliases, section labels, derived-row markers, and source quirks
 * live here and nowhere else. Scattering them through parsers is what makes
 * an ingestion engine impossible to audit — when a source changes its export
 * format, this file is the only place that needs to change, and the
 * financial engine never learns that any of it exists.
 *
 * Every entry cites the reference file that justifies it
 * (docs/REFERENCE_DOCUMENT_REGISTER.md).
 */

// ---------------------------------------------------------------------------
// SOURCE MAPPING — the sources this engine knows how to read
// ---------------------------------------------------------------------------

export type SourceId =
  | "budget-workbook"
  | "zerodha-holdings"
  | "generic-holdings-table";

export interface SourceDescriptor {
  readonly id: SourceId;
  readonly label: string;
  readonly kind: "budget_workbook" | "portfolio_snapshot";
  /** Reference file in the register that documents this layout. */
  readonly reference: string;
}

export const SOURCES: Readonly<Record<SourceId, SourceDescriptor>> = {
  "budget-workbook": {
    id: "budget-workbook",
    label: "Recurring personal budget workbook",
    kind: "budget_workbook",
    reference: "R-01",
  },
  "zerodha-holdings": {
    id: "zerodha-holdings",
    label: "Zerodha holdings statement",
    kind: "portfolio_snapshot",
    reference: "R-02",
  },
  "generic-holdings-table": {
    id: "generic-holdings-table",
    label: "Generic holdings table (header in row 1)",
    kind: "portfolio_snapshot",
    reference: "synthetic / manual exports",
  },
};

// ---------------------------------------------------------------------------
// FIELD NORMALIZATION — shared text handling
// ---------------------------------------------------------------------------

/** Lowercased, punctuation-stripped, whitespace-collapsed. */
export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// BUDGET WORKBOOK (R-01)
// ---------------------------------------------------------------------------

/** Section headers that mark the start of a labelled column block. */
export const BUDGET_SECTION_LABELS = {
  income: ["income"],
  expenses: ["expenses", "expense"],
  investments: ["investments", "investment s"],
} as const;

/** Optional per-row attribute columns, found by header text. */
export const BUDGET_ATTRIBUTE_COLUMNS = {
  frequency: ["frequency", "freq"],
  emiEndDate: ["emi end date", "emi end", "end date"],
} as const;

/**
 * Labels marking a DERIVED row — a subtotal or computed leftover that
 * restates line items already counted.
 *
 * Excluding these is not cosmetic: in the reference workbook the totals row,
 * the "Investment" available figure, the investments sum, and "Left over
 * cash" are all formulas over rows above them. Counting any of them as a
 * line item double-counts the whole month
 * (docs/REFERENCE_DOCUMENT_REGISTER.md, R-01).
 */
export const BUDGET_DERIVED_ROW_LABELS: readonly string[] = [
  "total",
  "totals",
  "grand total",
  "investment", // the "=income total - expense total" availability figure
  "left cash",
  "left over cash",
  "left over cash for the month",
  "leftover cash",
  "balance",
];

export function isDerivedBudgetLabel(label: string): boolean {
  return BUDGET_DERIVED_ROW_LABELS.includes(normalizeText(label));
}

/**
 * Rows whose label names an EMI.
 *
 * The reference workbook keeps EMIs inside the Expenses column, so category
 * cannot come from position alone. Detection is by label OR by the presence
 * of an EMI end date — the latter catches "Apple Watch", a genuine no-cost
 * EMI whose label contains no such word (R-01, and the Apple Watch goal in
 * 02_REQUIREMENTS.md).
 *
 * Separating EMI from ordinary expense changes no arithmetic — `retained`
 * subtracts both — but it is what makes EMI burden, payer split, and the
 * Liabilities screen possible.
 */
export function looksLikeEmiLabel(label: string): boolean {
  return /\bemi\b/.test(normalizeText(label));
}

/**
 * Income lines that carry last month's leftover forward.
 *
 * Recorded distinctly because it is genuinely ambiguous whether this should
 * count as income for a savings-rate denominator, or is a transfer between
 * periods that would inflate it (D-012).
 */
export const BUDGET_CARRYOVER_LABELS: readonly string[] = [
  "previous month left",
  "previous month leftover salary",
  "previous month leftover",
  "last month left",
];

export function isCarryoverLabel(label: string): boolean {
  return BUDGET_CARRYOVER_LABELS.includes(normalizeText(label));
}

// ---------------------------------------------------------------------------
// ZERODHA HOLDINGS (R-02)
// ---------------------------------------------------------------------------

export const ZERODHA_SHEETS = {
  /** Sheets to ingest. */
  ingest: ["equity", "mutual funds"],
  /**
   * `Combined` restates Equity + Mutual Funds. Ingesting it alongside them
   * double-counts the entire portfolio, so it is skipped by name (R-02).
   */
  skip: ["combined"],
} as const;

export const ZERODHA_COLUMNS = {
  symbol: ["symbol"],
  isin: ["isin"],
  sector: ["sector"],
  instrumentType: ["instrument type"],
  quantityAvailable: ["quantity available"],
  quantityDiscrepant: ["quantity discrepant"],
  quantityLongTerm: ["quantity long term"],
  quantityPledgedMargin: ["quantity pledged (margin)"],
  quantityPledgedLoan: ["quantity pledged (loan)"],
  averagePrice: ["average price"],
  closingPrice: ["previous closing price", "closing price"],
  unrealizedPnl: ["unrealized p&l"],
  unrealizedPnlPct: ["unrealized p&l pct.", "unrealize p&l pct."],
} as const;

/** Matches the statement's own as-of date, e.g. "…Statement as on 2026-08-03". */
export const ZERODHA_AS_ON_PATTERN = /as on\s+(\d{4}-\d{2}-\d{2})/i;

/** Summary labels in the statement preamble, used for reconciliation. */
export const ZERODHA_SUMMARY_LABELS = {
  investedValue: ["invested value"],
  presentValue: ["present value"],
  unrealizedPnl: ["unrealized p&l"],
} as const;

/**
 * Derives asset class from the statement itself.
 *
 * Two independent signals are present, so it need not be supplied by the
 * caller: `Sector` reads literally "ETF" for exchange-traded funds, and
 * Indian ISINs beginning `INF` denote funds/ETFs while `INE` denotes
 * equities. Gold and silver ETFs are further distinguished by symbol so the
 * allocation view can separate metals from equity ETFs (R-02).
 */
export function deriveAssetClass(
  symbol: string,
  isin: string,
  sector: string,
): "equity" | "etf" | "mutual_fund" | "gold" | "silver" {
  const normalizedSymbol = normalizeText(symbol);
  const isEtfBySector = normalizeText(sector) === "etf";
  const isFundByIsin = isin.toUpperCase().startsWith("INF");

  if (isEtfBySector || isFundByIsin) {
    if (normalizedSymbol.includes("gold")) return "gold";
    if (normalizedSymbol.includes("silver")) return "silver";
    return isEtfBySector ? "etf" : "mutual_fund";
  }
  return "equity";
}

// ---------------------------------------------------------------------------
// VALIDATION RULES — thresholds shared across sources
// ---------------------------------------------------------------------------

export const VALIDATION_RULES = {
  /** A quantity below this is treated as a data error, not a short position. */
  minQuantity: 0,
  /** Budget line amounts are structurally non-negative. */
  minBudgetAmountMinorUnits: 0,
  /**
   * Tolerance when reconciling a statement's own summary totals against the
   * sum of its line items. Statements round their summary figures, so an
   * exact match is not expected; a larger gap means rows were missed.
   */
  summaryReconciliationToleranceMinorUnits: 100,
} as const;
