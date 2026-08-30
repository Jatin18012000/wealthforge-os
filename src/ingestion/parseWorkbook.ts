import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { classifySheetKind } from "./sheetClassifier";
import type { RawCell, RawRow, RawSheet, RawWorkbook } from "./types";

/**
 * Reads EVERY worksheet in the workbook — never a subset, never only the
 * newest sheet (docs/09_INGESTION_ARCHITECTURE.md, "What ingestion never
 * does"). Formula cells contribute only their cached evaluated result;
 * no formula or macro content is ever executed.
 */
export async function parseWorkbookFile(
  filePath: string,
  fileName: string,
  fileHash: string,
  defaultYear: number,
): Promise<RawWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return parseWorkbookInstance(workbook, fileName, fileHash, defaultYear);
}

export function parseWorkbookInstance(
  workbook: ExcelJS.Workbook,
  fileName: string,
  fileHash: string,
  defaultYear: number,
): RawWorkbook {
  const sheets: RawSheet[] = [];

  workbook.eachSheet((worksheet) => {
    sheets.push(parseWorksheet(worksheet, defaultYear));
  });

  return { fileName, fileHash, sheets };
}

function parseWorksheet(worksheet: ExcelJS.Worksheet, defaultYear: number): RawSheet {
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  const headerColumns: Array<{ header: string; colNumber: number }> = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = String(readCellValue(cell) ?? "").trim();
    if (header.length === 0) return;
    headers.push(header);
    headerColumns.push({ header, colNumber });
  });

  const rows: RawRow[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const cells: Record<string, RawCell> = {};
    let hasAnyValue = false;

    for (const { header, colNumber } of headerColumns) {
      const cell = row.getCell(colNumber);
      const value = readCellValue(cell);
      if (value !== null && String(value).trim() !== "") hasAnyValue = true;
      cells[header] = { value, ref: cell.address };
    }

    // Blank rows are skipped rather than flagged: an empty spacer row in a
    // spreadsheet carries no financial claim, so there is nothing to review.
    // A row with SOME values and some blanks is kept and validated per-field
    // (docs/18_FAILURE_MODES.md "blank/text value in a numeric cell").
    if (!hasAnyValue) return;

    rows.push({ rowNumber, cells });
  });

  return {
    name: worksheet.name,
    kind: classifySheetKind(worksheet.name, defaultYear),
    headers,
    rows,
  };
}

/**
 * Normalizes an exceljs cell value to a plain scalar.
 *
 * Formula cells yield their cached `result` only — the formula string is
 * never evaluated or interpreted. An error result (e.g. `#REF!`) yields the
 * error token as a string so downstream validation flags it for review
 * rather than silently treating the cell as empty.
 */
export function readCellValue(cell: ExcelJS.Cell): RawCell["value"] {
  const value: unknown = cell.value;

  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value;

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Formula cell: use the cached evaluated result, never the formula.
    if ("result" in obj) {
      const result = obj.result;
      if (result === null || result === undefined) return null;
      if (
        typeof result === "string" ||
        typeof result === "number" ||
        typeof result === "boolean"
      ) {
        return result;
      }
      if (result instanceof Date) return result;
      if (typeof result === "object" && "error" in (result as Record<string, unknown>)) {
        return String((result as Record<string, unknown>).error);
      }
      return null;
    }

    // Error cell, e.g. { error: '#DIV/0!' }
    if ("error" in obj) return String(obj.error);

    // Rich text: concatenate the visible text runs.
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>)
        .map((run) => run.text ?? "")
        .join("");
    }

    // Hyperlink cell: the display text is what a human sees.
    if ("text" in obj) return String(obj.text);
  }

  return null;
}

/** SHA-256 of the file's bytes, for whole-file repeat-upload detection. */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
