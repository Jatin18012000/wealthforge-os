import type { SheetKind } from "./types";

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_ABBREVIATIONS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/**
 * Sheet names that are reference material rather than a budget month.
 * Deliberately an explicit allowlist: a sheet whose purpose we don't
 * recognize must fall through to `unrecognized` and be surfaced in the
 * Import Audit, never quietly treated as reference data
 * (docs/18_FAILURE_MODES.md "unexpected sheet").
 */
const REFERENCE_SHEET_PATTERNS = [
  /core\s*expenses?/i,
  /reference/i,
  /assumptions?/i,
  /summary/i,
];

export interface MonthSheetMatch {
  /** ISO "YYYY-MM". */
  periodMonth: string;
  /** True when the sheet name itself carried a year (e.g. "Aug-26"). */
  yearFromSheetName: boolean;
}

/**
 * Resolves a worksheet name to a budget period.
 *
 * Bare month names ("August") carry no year, so the caller must supply
 * `defaultYear` — the import API requires it explicitly rather than
 * inferring one, so a workbook is never silently attributed to the wrong
 * year (see docs/19_OPEN_DECISIONS.md, D-009).
 */
export function matchMonthSheet(
  sheetName: string,
  defaultYear: number,
): MonthSheetMatch | null {
  const name = sheetName.trim().toLowerCase();

  // "2026-08" / "2026/08"
  const isoMatch = /^(\d{4})[-/](\d{1,2})$/.exec(name);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (month >= 1 && month <= 12) {
      return { periodMonth: formatPeriod(year, month), yearFromSheetName: true };
    }
    return null;
  }

  // "August", "Aug", optionally followed by a year: "August 2026", "Aug-26", "Aug 26"
  const nameMatch = /^([a-z]+)(?:[\s\-_/]*(\d{2}|\d{4}))?$/.exec(name);
  if (!nameMatch) return null;

  const monthWord = nameMatch[1] ?? "";
  const yearToken = nameMatch[2];

  let monthIndex = MONTH_NAMES.indexOf(monthWord as (typeof MONTH_NAMES)[number]);
  if (monthIndex === -1) {
    monthIndex = MONTH_ABBREVIATIONS.indexOf(
      monthWord as (typeof MONTH_ABBREVIATIONS)[number],
    );
  }
  if (monthIndex === -1) return null;

  if (yearToken === undefined) {
    return { periodMonth: formatPeriod(defaultYear, monthIndex + 1), yearFromSheetName: false };
  }

  // A two-digit year is interpreted in the 2000s — this app has no
  // pre-2000 financial history and never will.
  const year = yearToken.length === 2 ? 2000 + Number(yearToken) : Number(yearToken);
  return { periodMonth: formatPeriod(year, monthIndex + 1), yearFromSheetName: true };
}

export function classifySheetKind(sheetName: string, defaultYear: number): SheetKind {
  if (matchMonthSheet(sheetName, defaultYear) !== null) return "month";
  if (REFERENCE_SHEET_PATTERNS.some((pattern) => pattern.test(sheetName))) return "reference";
  return "unrecognized";
}

function formatPeriod(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}
