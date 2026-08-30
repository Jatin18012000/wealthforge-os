import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { hashBuffer, readCellValue } from "../parseWorkbook";
import { parseCsv } from "./csv";
import type { RawSnapshotFile, RawSnapshotRow } from "./types";

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

function toHeadersAndRows(grid: readonly string[][]): {
  headers: string[];
  rows: RawSnapshotRow[];
} {
  const headerRow = grid[0];
  if (headerRow === undefined) return { headers: [], rows: [] };

  const headers = headerRow.map((header) => header.trim());
  const rows: RawSnapshotRow[] = [];

  for (let i = 1; i < grid.length; i += 1) {
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

    // +1 because the header occupies the first line of the file.
    rows.push({ rowNumber: i + 1, cells });
  }

  return { headers, rows };
}
