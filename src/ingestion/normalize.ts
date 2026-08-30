import { createHash } from "node:crypto";
import { matchMonthSheet } from "./sheetClassifier";
import type {
  ExtractedRow,
  ExtractedSheet,
  ExtractedWorkbook,
  PlanCategory,
  RawSheet,
  RawWorkbook,
  TrustState,
} from "./types";

/**
 * Accepted header spellings per logical column. Tolerant of the variations
 * a hand-maintained workbook accumulates, but explicitly enumerated — an
 * unrecognized header is reported as a sheet issue, never guessed at.
 */
const COLUMN_ALIASES = {
  category: ["category", "type", "head"],
  label: ["label", "item", "description", "particulars", "name"],
  amount: ["amount", "value", "amount (inr)", "amount inr", "amount(inr)", "₹"],
  frequency: ["frequency", "freq"],
  date: ["date", "due date", "emi date"],
} as const;

const CATEGORY_ALIASES: Record<string, PlanCategory> = {
  income: "income",
  salary: "income",
  earnings: "income",
  expense: "expense",
  expenses: "expense",
  spend: "expense",
  investment: "investment",
  investments: "investment",
  savings: "investment",
  sip: "investment",
  emi: "emi",
  loan: "emi",
  "loan emi": "emi",
};

export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCategory(raw: string): PlanCategory | null {
  const key = normalizeLabel(raw);
  return CATEGORY_ALIASES[key] ?? null;
}

export interface AmountParseResult {
  /** Integer paise, or null when the cell could not be parsed as an amount. */
  minorUnits: number | null;
  issue: string | null;
}

/**
 * Parses a cell into integer minor units (paise).
 *
 * Never coerces an unparseable cell to zero — a cell reading "TBD" yields
 * `null` plus an issue, so the row lands in `needs_review` rather than
 * silently contributing ₹0 to a budget total
 * (docs/18_FAILURE_MODES.md, "blank/text value in a numeric cell").
 */
export function parseAmountToMinorUnits(value: unknown): AmountParseResult {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { minorUnits: null, issue: "amount is empty" };
  }

  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    // Strip currency symbols, thousands separators, and surrounding spaces.
    const cleaned = value.replace(/[₹$,\s]/g, "");
    if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) {
      return { minorUnits: null, issue: `amount is not numeric: "${value}"` };
    }
    numeric = Number(cleaned);
  } else {
    return { minorUnits: null, issue: `amount is not numeric: "${String(value)}"` };
  }

  if (!Number.isFinite(numeric)) {
    return { minorUnits: null, issue: `amount is not a finite number: "${String(value)}"` };
  }

  // Rupees to paise. Math.round absorbs binary-float representation error
  // (e.g. 8100.35 * 100 === 810034.9999...) — values in this domain are far
  // inside the range where this is exact.
  return { minorUnits: Math.round(numeric * 100), issue: null };
}

/** True when the value parses to a real calendar date. */
export function isParseableDate(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (trimmed === "") return false;

  // Explicitly reject out-of-range day/month before trusting Date parsing,
  // which is lenient enough to roll "32/13/2026" into a valid date on some
  // inputs — a malformed EMI date must be flagged, not silently corrected.
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(trimmed);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    // Ambiguous D/M vs M/D: accept only if SOME reading is a valid calendar date.
    const validAsDMY = first >= 1 && first <= 31 && second >= 1 && second <= 12;
    const validAsMDY = first >= 1 && first <= 12 && second >= 1 && second <= 31;
    return validAsDMY || validAsMDY;
  }

  return !Number.isNaN(new Date(trimmed).getTime());
}

function findColumn(headers: string[], aliases: readonly string[]): string | null {
  for (const header of headers) {
    if (aliases.includes(header.trim().toLowerCase())) return header;
  }
  return null;
}

/**
 * Content hash over a sheet's financial content: ordered cell values keyed
 * by header. Deliberately excludes row numbers and A1 cell references, so
 * inserting a blank spacer row — which shifts every reference below it but
 * changes no financial claim — is correctly seen as UNCHANGED.
 */
export function computeContentHash(sheet: RawSheet): string {
  const canonical = {
    headers: sheet.headers.map((h) => h.trim().toLowerCase()),
    rows: sheet.rows.map((row) =>
      sheet.headers.map((header) => {
        const cell = row.cells[header];
        const value = cell?.value ?? null;
        return value instanceof Date ? value.toISOString() : value;
      }),
    ),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function extractSheet(sheet: RawSheet, defaultYear: number): ExtractedSheet {
  const contentHash = computeContentHash(sheet);
  const sheetIssues: string[] = [];

  if (sheet.kind !== "month") {
    // Reference and unrecognized sheets are scanned, hashed, and retained
    // in full, but produce no period-attributed plan records.
    if (sheet.kind === "unrecognized") {
      sheetIssues.push(
        `Sheet "${sheet.name}" matches neither a month nor a known reference sheet; its content was retained but not imported as budget data.`,
      );
    }
    return { name: sheet.name, kind: sheet.kind, headers: sheet.headers, rows: [], sheetIssues, contentHash };
  }

  const match = matchMonthSheet(sheet.name, defaultYear);
  /* c8 ignore next -- kind === "month" guarantees a match; belt-and-braces */
  if (!match) {
    sheetIssues.push(`Sheet "${sheet.name}" was classified as a month sheet but could not be resolved to a period.`);
    return { name: sheet.name, kind: sheet.kind, headers: sheet.headers, rows: [], sheetIssues, contentHash };
  }

  const categoryColumn = findColumn(sheet.headers, COLUMN_ALIASES.category);
  const labelColumn = findColumn(sheet.headers, COLUMN_ALIASES.label);
  const amountColumn = findColumn(sheet.headers, COLUMN_ALIASES.amount);
  const dateColumn = findColumn(sheet.headers, COLUMN_ALIASES.date);

  if (!categoryColumn) sheetIssues.push(`Month sheet "${sheet.name}" has no recognizable Category column.`);
  if (!labelColumn) sheetIssues.push(`Month sheet "${sheet.name}" has no recognizable Label column.`);
  if (!amountColumn) sheetIssues.push(`Month sheet "${sheet.name}" has no recognizable Amount column.`);

  if (!categoryColumn || !labelColumn || !amountColumn) {
    return { name: sheet.name, kind: sheet.kind, headers: sheet.headers, rows: [], sheetIssues, contentHash };
  }

  const rows: ExtractedRow[] = [];

  for (const rawRow of sheet.rows) {
    const validationIssues: string[] = [];

    const categoryRaw = String(rawRow.cells[categoryColumn]?.value ?? "").trim();
    const labelRaw = String(rawRow.cells[labelColumn]?.value ?? "").trim();
    const amountCell = rawRow.cells[amountColumn];

    const category = normalizeCategory(categoryRaw);
    if (category === null) {
      validationIssues.push(
        categoryRaw === ""
          ? "category is empty"
          : `unrecognized category: "${categoryRaw}"`,
      );
    }
    if (labelRaw === "") validationIssues.push("label is empty");

    const { minorUnits, issue: amountIssue } = parseAmountToMinorUnits(amountCell?.value);
    if (amountIssue) validationIssues.push(amountIssue);
    if (minorUnits !== null && minorUnits < 0) {
      // Budget lines are structurally non-negative; a negative belongs in
      // review, not silently flipped or accepted (docs/08 sign sanity).
      validationIssues.push(`negative amount: ${minorUnits / 100}`);
    }

    if (dateColumn) {
      const dateValue = rawRow.cells[dateColumn]?.value;
      const hasDate = dateValue !== null && dateValue !== undefined && String(dateValue).trim() !== "";
      if (hasDate && !isParseableDate(dateValue)) {
        validationIssues.push(`malformed date: "${String(dateValue)}"`);
      }
    }

    const trustState: TrustState = validationIssues.length === 0 ? "validated" : "needs_review";

    rows.push({
      periodMonth: match.periodMonth,
      // A row whose category didn't resolve is retained for review under
      // "expense" as a structural placeholder; its needs_review trust state
      // keeps it out of every headline total until a human resolves it.
      category: category ?? "expense",
      labelRaw,
      labelNormalized: normalizeLabel(labelRaw),
      amountMinorUnits: minorUnits,
      trustState,
      validationIssues,
      rowNumber: rawRow.rowNumber,
      amountCellRef: amountCell?.ref ?? "",
    });
  }

  flagExactDuplicateRows(rows);

  return { name: sheet.name, kind: sheet.kind, headers: sheet.headers, rows, sheetIssues, contentHash };
}

/**
 * Flags rows that are exact duplicates of each other (same category, label,
 * AND amount) within one sheet.
 *
 * Neither available guess is safe: collapsing them silently discards a real
 * line if the workbook genuinely has two ₹500 "Misc" entries, while keeping
 * both silently double-counts if it was a copy-paste slip. Since the file
 * alone cannot distinguish the two, every copy is flagged `needs_review` —
 * excluded from totals, retained in full, and surfaced for a human to
 * resolve (docs/14_TESTING_STRATEGY.md ingestion checklist, "duplicate rows").
 */
function flagExactDuplicateRows(rows: ExtractedRow[]): void {
  const groups = new Map<string, ExtractedRow[]>();

  for (const row of rows) {
    const key = `${row.category}::${row.labelNormalized}::${String(row.amountMinorUnits)}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const lines = group.map((row) => row.rowNumber).join(", ");
    for (const row of group) {
      row.validationIssues.push(
        `exact duplicate row: "${row.labelRaw}" appears ${group.length} times with the same amount (rows ${lines}); cannot tell a data-entry duplicate from two genuine lines`,
      );
      row.trustState = "needs_review";
    }
  }
}

export function extractWorkbook(workbook: RawWorkbook, defaultYear: number): ExtractedWorkbook {
  return {
    fileName: workbook.fileName,
    fileHash: workbook.fileHash,
    sheets: workbook.sheets.map((sheet) => extractSheet(sheet, defaultYear)),
  };
}
