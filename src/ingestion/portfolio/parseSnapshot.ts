import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { hashBuffer, readCellValue } from "../parseWorkbook";
import { parseCsv } from "./csv";
import { COLUMN_ALIASES, findColumn } from "./normalizeSnapshot";
import type { RawSnapshotFile, RawSnapshotRow } from "./types";

/**
 * How many leading rows to search for the real holdings header before
 * giving up — bounded for the same reason
 * `../sources/zerodhaHoldings.ts`'s `findHeaderRow` is bounded: a
 * preamble (personal details, a summary block, an "as on" title) is a
 * handful of rows, not hundreds, and an unbounded scan of a malformed
 * file would otherwise search the entire data section looking for a
 * header that was never there.
 */
const HEADER_SEARCH_LIMIT_ROWS = 50;

/**
 * Reads a holdings export into raw rows.
 *
 * Supports the two formats brokers and fund houses actually hand out: CSV
 * and XLSX. As with budget ingestion, only evaluated cell values are read —
 * no formula or macro content is ever executed.
 */
export async function parseSnapshotFile(filePath: string): Promise<RawSnapshotFile> {
  const buffer = await readFile(filePath);
  const fileHash = hashBuffer(buffer);
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();

  const grid =
    extension === ".csv" || extension === ".txt"
      ? parseCsv(buffer.toString("utf-8"))
      : await readXlsxGrid(filePath);

  return { fileName, fileHash, ...toHeadersAndRows(grid) };
}

async function readXlsxGrid(filePath: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (worksheet === undefined) return [];

  const grid: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const value = readCellValue(cell);
      cells.push(value === null ? "" : value instanceof Date ? value.toISOString() : String(value));
    });
    grid.push(cells);
  });

  return grid;
}

/**
 * Locates the real holdings header among a generic export's leading rows.
 *
 * Broker and fund-house exports are not always a plain table starting at
 * row 1 — a real mutual-fund statement observed in the wild opens with a
 * personal-details block, a holdings summary, and an "AS ON <date>" title
 * before the actual column header. This mirrors
 * `../sources/zerodhaHoldings.ts`'s `findHeaderRow`: scan down (bounded)
 * for the first row that looks like a real header, rather than assuming
 * row 1.
 *
 * "Looks like a real header" is defined the same way `extractSnapshot`
 * already defines "usable": a name-or-identifier column AND a quantity
 * column, both matched against the existing canonical `COLUMN_ALIASES` —
 * never a new, separate alias list, and never a guess at column meaning
 * beyond what the normalization layer already recognizes. Returns `null`
 * when no such row is found within the search bound, so callers can fall
 * back to the pre-existing row-1 behavior and its existing "no
 * recognizable column" failure messages.
 */
export function findHeaderRowIndex(grid: readonly string[][]): number | null {
  const limit = Math.min(grid.length, HEADER_SEARCH_LIMIT_ROWS);
  for (let i = 0; i < limit; i += 1) {
    const candidate = (grid[i] ?? []).map((cell) => cell.trim());
    const hasIdentity =
      findColumn(candidate, COLUMN_ALIASES.identifier) !== null ||
      findColumn(candidate, COLUMN_ALIASES.name) !== null;
    const hasQuantity = findColumn(candidate, COLUMN_ALIASES.quantity) !== null;
    if (hasIdentity && hasQuantity) return i;
  }
  return null;
}

function toHeadersAndRows(grid: readonly string[][]): {
  headers: string[];
  rows: RawSnapshotRow[];
} {
  const headerIndex = findHeaderRowIndex(grid) ?? 0;
  const headerRow = grid[headerIndex];
  if (headerRow === undefined) return { headers: [], rows: [] };

  const headers = headerRow.map((header) => header.trim());
  const rows: RawSnapshotRow[] = [];

  for (let i = headerIndex + 1; i < grid.length; i += 1) {
    const values = grid[i] as string[];
    const cells: Record<string, string> = {};
    let hasValue = false;

    headers.forEach((header, columnIndex) => {
      if (header === "") return;
      const value = (values[columnIndex] ?? "").trim();
      if (value !== "") hasValue = true;
      cells[header] = value;
    });

    // Blank separator rows carry no financial claim, so there is nothing to
    // review — they are skipped rather than flagged.
    if (!hasValue) continue;

    // +1 to convert the 0-indexed grid position into a 1-indexed file line
    // number — independent of where the header row itself landed.
    rows.push({ rowNumber: i + 1, cells });
  }

  return { headers, rows };
}
