import { parseAmountToMinorUnits } from "../normalize";
import { matchMonthSheet } from "../sheetClassifier";
import type { ExtractedRow, ExtractedSheet, PlanCategory, RawCell, RawGridRow, RawSheet, TrustState } from "../types";
import {
  BUDGET_ATTRIBUTE_COLUMNS,
  BUDGET_SECTION_LABELS,
  isCarryoverLabel,
  isDerivedBudgetLabel,
  looksLikeEmiLabel,
  normalizeText,
} from "./mappings";

/**
 * Adapter for the recurring budget workbook's REAL layout
 * (docs/REFERENCE_DOCUMENT_REGISTER.md, R-01).
 *
 * The sheet is not a flat table. Income and Expenses sit in side-by-side
 * label+amount column pairs under section headers, the column positions
 * shift between sheets, a separate Investments block sits below, and several
 * rows are formula-derived subtotals that restate the lines above them.
 *
 * Everything source-specific about that layout is confined to this file and
 * `mappings.ts`; what comes out is the same canonical `ExtractedRow` the
 * rest of the engine already consumes.
 */

interface ColumnBlock {
  readonly labelColumn: number;
  readonly amountColumn: number;
}

export interface BudgetLayout {
  readonly headerRowNumber: number;
  readonly income: ColumnBlock;
  readonly expenses: ColumnBlock;
  readonly frequencyColumn: number | null;
  readonly emiEndDateColumn: number | null;
  /** Present when the sheet carries a planned-investments block. */
  readonly investments: ColumnBlock | null;
  readonly investmentsBannerRow: number | null;
}

function cellText(cell: RawCell | undefined): string {
  if (cell === undefined || cell.value === null) return "";
  return String(cell.value).trim();
}

function findColumnByLabels(
  row: RawGridRow,
  labels: readonly string[],
): number | null {
  for (const [colNumber, cell] of row.cells) {
    if (labels.includes(normalizeText(cellText(cell)))) return colNumber;
  }
  return null;
}

/**
 * Detects the side-by-side layout by finding the row carrying both an
 * "Income" and an "Expenses" section header. Positions are always detected,
 * never hardcoded — they differ between May and the later sheets.
 */
export function detectBudgetLayout(sheet: RawSheet): BudgetLayout | null {
  for (const row of sheet.grid) {
    const incomeColumn = findColumnByLabels(row, BUDGET_SECTION_LABELS.income);
    const expensesColumn = findColumnByLabels(row, BUDGET_SECTION_LABELS.expenses);
    if (incomeColumn === null || expensesColumn === null) continue;

    const investments = findInvestmentsBlock(sheet, row.rowNumber);

    return {
      headerRowNumber: row.rowNumber,
      // The amount always sits immediately right of its label.
      income: { labelColumn: incomeColumn, amountColumn: incomeColumn + 1 },
      expenses: { labelColumn: expensesColumn, amountColumn: expensesColumn + 1 },
      frequencyColumn: findColumnByLabels(row, BUDGET_ATTRIBUTE_COLUMNS.frequency),
      emiEndDateColumn: findColumnByLabels(row, BUDGET_ATTRIBUTE_COLUMNS.emiEndDate),
      investments: investments?.block ?? null,
      investmentsBannerRow: investments?.bannerRow ?? null,
    };
  }
  return null;
}

function findInvestmentsBlock(
  sheet: RawSheet,
  afterRow: number,
): { block: ColumnBlock; bannerRow: number } | null {
  for (const row of sheet.grid) {
    if (row.rowNumber <= afterRow) continue;
    const column = findColumnByLabels(row, BUDGET_SECTION_LABELS.investments);
    if (column === null) continue;
    return {
      block: { labelColumn: column, amountColumn: column + 1 },
      bannerRow: row.rowNumber,
    };
  }
  return null;
}

interface BlockExtraction {
  readonly rows: ExtractedRow[];
  readonly issues: string[];
}

function extractBlock(
  sheet: RawSheet,
  layout: BudgetLayout,
  block: ColumnBlock,
  periodMonth: string,
  resolveCategory: (label: string, hasEmiEndDate: boolean) => PlanCategory,
  fromRow: number,
  toRow: number | null,
): BlockExtraction {
  const rows: ExtractedRow[] = [];
  const issues: string[] = [];

  for (const gridRow of sheet.grid) {
    if (gridRow.rowNumber <= fromRow) continue;
    if (toRow !== null && gridRow.rowNumber >= toRow) continue;

    const labelCell = gridRow.cells.get(block.labelColumn);
    const amountCell = gridRow.cells.get(block.amountColumn);

    const labelRaw = cellText(labelCell);
    if (labelRaw === "") continue; // structural padding, or an unlabelled subtotal

    // A subtotal or computed leftover restates rows already counted; importing
    // it as a line item double-counts the month (R-01).
    if (isDerivedBudgetLabel(labelRaw)) continue;

    if (amountCell === undefined) continue;

    const validationIssues: string[] = [];
    const { minorUnits, issue } = parseAmountToMinorUnits(amountCell.value);
    if (issue) validationIssues.push(issue);
    if (minorUnits !== null && minorUnits < 0) {
      validationIssues.push(`negative amount: ${minorUnits / 100}`);
    }

    // A formula under a label we do not recognize as derived might be a
    // legitimate line item (the user typing "=2000+500") or an unanticipated
    // subtotal. It is imported but flagged, never silently trusted or dropped.
    if (amountCell.isFormula === true) {
      validationIssues.push(
        "amount is a formula; confirm it is a line item and not a subtotal",
      );
      issues.push(
        `Sheet "${sheet.name}" row ${gridRow.rowNumber}: "${labelRaw}" has a formula amount and was flagged for review.`,
      );
    }

    const emiEndDateCell =
      layout.emiEndDateColumn === null ? undefined : gridRow.cells.get(layout.emiEndDateColumn);
    const hasEmiEndDate = cellText(emiEndDateCell) !== "";

    const trustState: TrustState = validationIssues.length === 0 ? "validated" : "needs_review";

    rows.push({
      periodMonth,
      category: resolveCategory(labelRaw, hasEmiEndDate),
      labelRaw,
      labelNormalized: normalizeText(labelRaw),
      amountMinorUnits: minorUnits,
      trustState,
      validationIssues,
      rowNumber: gridRow.rowNumber,
      amountCellRef: amountCell.ref,
    });
  }

  return { rows, issues };
}

/**
 * Extracts one month sheet in the reference layout.
 * Returns null when the sheet does not use this layout, so the caller can
 * fall back to the generic tabular parser.
 */
export function extractBudgetSheet(
  sheet: RawSheet,
  defaultYear: number,
  contentHash: string,
): ExtractedSheet | null {
  const layout = detectBudgetLayout(sheet);
  if (layout === null) return null;

  const match = matchMonthSheet(sheet.name, defaultYear);
  if (match === null) return null;

  const sheetIssues: string[] = [];
  const periodMonth = match.periodMonth;

  // The income/expense block runs from the header row down to the
  // investments banner, if there is one.
  const blockEnd = layout.investmentsBannerRow;

  const income = extractBlock(
    sheet,
    layout,
    layout.income,
    periodMonth,
    () => "income",
    layout.headerRowNumber,
    blockEnd,
  );

  const expenses = extractBlock(
    sheet,
    layout,
    layout.expenses,
    periodMonth,
    // EMIs live inside the Expenses column in this workbook, so category is
    // resolved by label or by the presence of an EMI end date — the latter
    // catches genuine EMIs whose label says nothing about it (R-01).
    (label, hasEmiEndDate) => (looksLikeEmiLabel(label) || hasEmiEndDate ? "emi" : "expense"),
    layout.headerRowNumber,
    blockEnd,
  );

  const investments =
    layout.investments === null || layout.investmentsBannerRow === null
      ? { rows: [], issues: [] }
      : extractBlock(
          sheet,
          layout,
          layout.investments,
          periodMonth,
          () => "investment",
          layout.investmentsBannerRow,
          null,
        );

  sheetIssues.push(...income.issues, ...expenses.issues, ...investments.issues);

  // Carry-over income is genuinely ambiguous for rate denominators, so it is
  // flagged rather than silently counted or dropped (D-012).
  for (const row of income.rows) {
    if (isCarryoverLabel(row.labelRaw)) {
      sheetIssues.push(
        `Sheet "${sheet.name}": "${row.labelRaw}" carries the previous month's leftover forward as income; counted as income, see D-012.`,
      );
    }
  }

  return {
    name: sheet.name,
    kind: sheet.kind,
    headers: sheet.headers,
    rows: [...income.rows, ...expenses.rows, ...investments.rows],
    sheetIssues,
    contentHash,
  };
}
