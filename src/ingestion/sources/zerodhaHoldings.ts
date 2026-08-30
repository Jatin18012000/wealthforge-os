import ExcelJS from "exceljs";
import { roundHalfToEven } from "../../domain/money";
import { parseAmountToMinorUnits } from "../normalize";
import { readCellValue } from "../parseWorkbook";
import type { ExtractedPosition, ExtractedSnapshot } from "../portfolio/types";
import type { TrustState } from "../types";
import {
  ZERODHA_AS_ON_PATTERN,
  ZERODHA_COLUMNS,
  ZERODHA_SHEETS,
  deriveAssetClass,
  normalizeText,
} from "./mappings";

/**
 * Adapter for the Zerodha holdings statement's REAL layout
 * (docs/REFERENCE_DOCUMENT_REGISTER.md, R-02).
 *
 * The statement is not a plain table. Each sheet opens with a preamble
 * (client ID, an "…as on YYYY-MM-DD" title, and a summary block), column A
 * is empty, and the header row sits around row 22–23 at a position that
 * differs per sheet. The `Combined` sheet restates `Equity` + `Mutual Funds`,
 * so ingesting all three would double-count the entire portfolio.
 */

export interface ZerodhaSheetResult {
  readonly sheetName: string;
  /** The statement's own as-of date, read from its title row. */
  readonly asOn: Date | null;
  readonly positions: ExtractedPosition[];
  readonly issues: string[];
  /** Summary totals from the preamble, for reconciliation. */
  readonly investedValueMinorUnits: number | null;
  readonly presentValueMinorUnits: number | null;
}

function cellString(worksheet: ExcelJS.Worksheet, row: number, col: number): string {
  const value = readCellValue(worksheet.getRow(row).getCell(col));
  return value === null ? "" : String(value).trim();
}

/** True when this workbook looks like a Zerodha holdings statement. */
export function detectZerodhaStatement(workbook: ExcelJS.Workbook): boolean {
  for (const worksheet of workbook.worksheets) {
    if (findAsOnDate(worksheet) !== null) return true;
  }
  return false;
}

/** Reads the "…Holdings Statement as on YYYY-MM-DD" title from the preamble. */
export function findAsOnDate(worksheet: ExcelJS.Worksheet): Date | null {
  for (let row = 1; row <= Math.min(worksheet.rowCount, 25); row += 1) {
    for (let col = 1; col <= Math.min(worksheet.columnCount, 6); col += 1) {
      const match = ZERODHA_AS_ON_PATTERN.exec(cellString(worksheet, row, col));
      if (match?.[1]) return new Date(`${match[1]}T00:00:00Z`);
    }
  }
  return null;
}

interface HeaderLocation {
  readonly rowNumber: number;
  readonly columns: Map<string, number>;
}

/**
 * Locates the data header row by looking for the row that carries both a
 * "Symbol" and an "ISIN" column. Detected rather than hardcoded, because the
 * row differs between the Equity, Mutual Funds, and Combined sheets.
 */
function findHeaderRow(worksheet: ExcelJS.Worksheet): HeaderLocation | null {
  for (let row = 1; row <= Math.min(worksheet.rowCount, 40); row += 1) {
    const columns = new Map<string, number>();
    for (let col = 1; col <= worksheet.columnCount; col += 1) {
      const text = normalizeText(cellString(worksheet, row, col));
      if (text !== "") columns.set(text, col);
    }
    if (columns.has("symbol") && columns.has("isin")) {
      return { rowNumber: row, columns };
    }
  }
  return null;
}

function columnFor(
  header: HeaderLocation,
  aliases: readonly string[],
): number | null {
  for (const alias of aliases) {
    const col = header.columns.get(normalizeText(alias));
    if (col !== undefined) return col;
  }
  return null;
}

function readSummaryValue(worksheet: ExcelJS.Worksheet, label: string): number | null {
  for (let row = 1; row <= Math.min(worksheet.rowCount, 25); row += 1) {
    for (let col = 1; col <= Math.min(worksheet.columnCount, 6); col += 1) {
      if (normalizeText(cellString(worksheet, row, col)) !== normalizeText(label)) continue;
      const { minorUnits } = parseAmountToMinorUnits(
        readCellValue(worksheet.getRow(row).getCell(col + 1)),
      );
      return minorUnits;
    }
  }
  return null;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function extractZerodhaSheet(worksheet: ExcelJS.Worksheet): ZerodhaSheetResult | null {
  const header = findHeaderRow(worksheet);
  if (header === null) return null;

  const issues: string[] = [];
  const positions: ExtractedPosition[] = [];

  const symbolCol = columnFor(header, ZERODHA_COLUMNS.symbol);
  const isinCol = columnFor(header, ZERODHA_COLUMNS.isin);
  const sectorCol = columnFor(header, ZERODHA_COLUMNS.sector);
  const quantityCol = columnFor(header, ZERODHA_COLUMNS.quantityAvailable);
  const discrepantCol = columnFor(header, ZERODHA_COLUMNS.quantityDiscrepant);
  const pledgedMarginCol = columnFor(header, ZERODHA_COLUMNS.quantityPledgedMargin);
  const pledgedLoanCol = columnFor(header, ZERODHA_COLUMNS.quantityPledgedLoan);
  const averagePriceCol = columnFor(header, ZERODHA_COLUMNS.averagePrice);
  const closingPriceCol = columnFor(header, ZERODHA_COLUMNS.closingPrice);

  if (symbolCol === null || isinCol === null || quantityCol === null) {
    issues.push(
      `Sheet "${worksheet.name}" is missing a Symbol, ISIN, or Quantity Available column.`,
    );
    return {
      sheetName: worksheet.name,
      asOn: findAsOnDate(worksheet),
      positions,
      issues,
      investedValueMinorUnits: null,
      presentValueMinorUnits: null,
    };
  }

  for (let row = header.rowNumber + 1; row <= worksheet.rowCount; row += 1) {
    const symbol = cellString(worksheet, row, symbolCol);
    const isin = cellString(worksheet, row, isinCol);
    if (symbol === "" && isin === "") continue;

    const validationIssues: string[] = [];
    const sector = sectorCol === null ? "" : cellString(worksheet, row, sectorCol);

    const quantity = parseNumber(cellString(worksheet, row, quantityCol));
    if (quantity === null) {
      validationIssues.push(`quantity is not numeric: "${cellString(worksheet, row, quantityCol)}"`);
    } else if (quantity < 0) {
      validationIssues.push(`negative quantity: ${quantity}`);
    }

    // A broker-flagged discrepancy means the broker itself disputes the
    // holding; it must not be silently trusted.
    const discrepant = discrepantCol === null ? 0 : (parseNumber(cellString(worksheet, row, discrepantCol)) ?? 0);
    if (discrepant !== 0) {
      validationIssues.push(`broker reports ${discrepant} discrepant units`);
    }

    // Whether the total holding is Available alone or Available + Pledged
    // cannot be determined from the reference statements, in which every
    // pledged quantity is zero. Rather than guess, a non-zero pledge is
    // flagged for review (D-013).
    const pledged =
      (pledgedMarginCol === null ? 0 : (parseNumber(cellString(worksheet, row, pledgedMarginCol)) ?? 0)) +
      (pledgedLoanCol === null ? 0 : (parseNumber(cellString(worksheet, row, pledgedLoanCol)) ?? 0));
    if (pledged !== 0) {
      validationIssues.push(
        `${pledged} units are pledged; whether pledged units are included in Quantity Available is unconfirmed (D-013)`,
      );
    }

    // The average price is reported to four decimal places because it is a
    // computed average. Rounding it to whole paise BEFORE multiplying by
    // quantity discards precision proportional to the holding size — tens of
    // paise on a mid-sized position, more on a large one — and makes the cost
    // basis disagree with the statement's own Invested Value. So full-precision
    // rupee figure is scaled by quantity and rounded exactly once, per
    // docs/07_FINANCIAL_CALCULATIONS.md ("never accumulated by rounding
    // intermediate values").
    const averagePriceRupees =
      averagePriceCol === null ? null : parseNumber(cellString(worksheet, row, averagePriceCol));
    const closingPrice =
      closingPriceCol === null ? null : parseAmountToMinorUnits(cellString(worksheet, row, closingPriceCol)).minorUnits;

    const trustState: TrustState = validationIssues.length === 0 ? "validated" : "needs_review";

    positions.push({
      // ISIN is the stable identity: trading symbols change when a company
      // rebrands — one holding in the reference statements does exactly that,
      // with its ISIN unchanged — and keying on symbol would fragment an
      // instrument's history across the rename (R-02).
      identifier: isin !== "" ? isin : symbol,
      displayName: symbol !== "" ? symbol : isin,
      assetClass: deriveAssetClass(symbol, isin, sector),
      unit: deriveAssetClass(symbol, isin, sector) === "equity" ? "shares" : "units",
      quantity,
      priceMinorUnits: closingPrice,
      costBasisMinorUnits:
        averagePriceRupees !== null && quantity !== null
          ? roundHalfToEven(averagePriceRupees * quantity * 100)
          : null,
      trustState,
      validationIssues,
      rowNumber: row,
    });
  }

  return {
    sheetName: worksheet.name,
    asOn: findAsOnDate(worksheet),
    positions,
    issues,
    investedValueMinorUnits: readSummaryValue(worksheet, "Invested Value"),
    presentValueMinorUnits: readSummaryValue(worksheet, "Present Value"),
  };
}

/**
 * Extracts every ingestible sheet of a Zerodha statement.
 *
 * `Combined` is skipped by name: it restates Equity + Mutual Funds, and
 * taking all three would double-count the whole portfolio (R-02).
 */
export async function extractZerodhaStatement(
  filePath: string,
  fileName: string,
  fileHash: string,
): Promise<ExtractedSnapshot | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  if (!detectZerodhaStatement(workbook)) return null;

  const positions: ExtractedPosition[] = [];
  const fileIssues: string[] = [];
  let asOf: Date | null = null;

  for (const worksheet of workbook.worksheets) {
    const sheetKey = normalizeText(worksheet.name);

    if ((ZERODHA_SHEETS.skip as readonly string[]).includes(sheetKey)) {
      fileIssues.push(
        `Sheet "${worksheet.name}" restates the other sheets and was skipped to avoid double-counting the portfolio.`,
      );
      continue;
    }
    if (!(ZERODHA_SHEETS.ingest as readonly string[]).includes(sheetKey)) {
      fileIssues.push(`Sheet "${worksheet.name}" is not a recognized holdings sheet and was skipped.`);
      continue;
    }

    const result = extractZerodhaSheet(worksheet);
    if (result === null) continue;

    if (result.asOn !== null) {
      if (asOf === null) asOf = result.asOn;
      else if (asOf.getTime() !== result.asOn.getTime()) {
        fileIssues.push(
          `Sheets disagree on the statement date (${asOf.toISOString().slice(0, 10)} vs ${result.asOn.toISOString().slice(0, 10)}).`,
        );
      }
    }

    positions.push(...result.positions);
    fileIssues.push(...result.issues);

    // The statement's own summary is a free reconciliation check: the line
    // items must add up to the total the broker printed.
    if (result.investedValueMinorUnits !== null && result.positions.length > 0) {
      const summed = result.positions.reduce(
        (total, position) => total + (position.costBasisMinorUnits ?? 0),
        0,
      );
      const drift = Math.abs(summed - result.investedValueMinorUnits);
      // Tolerance scales with holding count, since each line's cost basis is
      // rounded to paise before summing.
      if (drift > result.positions.length) {
        fileIssues.push(
          `Sheet "${worksheet.name}": line items total ${summed} paise but the statement's Invested Value is ${result.investedValueMinorUnits} paise; some rows may not have been read.`,
        );
      }
    }
  }

  if (asOf === null) {
    fileIssues.push("The statement carries no readable 'as on' date.");
  }

  return {
    fileName,
    fileHash,
    // Falls back to the epoch only if no date was found; the caller supplies
    // an explicit date in that case (see importPortfolioSnapshot).
    asOf: asOf ?? new Date(0),
    positions,
    fileIssues,
  };
}
