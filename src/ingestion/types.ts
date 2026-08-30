/**
 * Ingestion types. This module and its siblings are framework-free and
 * database-free up to `importWorkbook.ts` — parsing, normalization,
 * validation, and diffing are pure functions over plain data so they can be
 * unit-tested without a database.
 */

/** Trust states from docs/08_DATA_TRUST_MODEL.md. */
export type TrustState =
  | "extracted"
  | "needs_review"
  | "validated"
  | "verified"
  | "rejected"
  | "superseded";

/** Sheet classification against stored history (docs/09_INGESTION_ARCHITECTURE.md). */
export type SheetClassification =
  | "new"
  | "modified"
  | "unchanged"
  | "deleted_renamed"
  | "conflict";

export type SheetKind = "month" | "reference" | "unrecognized";

export type PlanCategory = "income" | "expense" | "investment" | "emi";

/** A single cell as read from the workbook, with its provenance reference. */
export interface RawCell {
  /** Evaluated cell value. Never a formula — see docs/09 "never executes any formula". */
  value: string | number | Date | boolean | null;
  /** A1-style reference, e.g. "C4", for provenance drill-down. */
  ref: string;
  /**
   * True when the source cell held a formula (only its cached result is
   * read). A formula usually means a derived figure — a subtotal restating
   * rows already counted — which must not be imported as a line item.
   */
  isFormula?: boolean;
}

export interface RawRow {
  /** 1-based worksheet row number. */
  rowNumber: number;
  /** Cells keyed by their header text, as it appeared in the header row. */
  cells: Record<string, RawCell>;
}

/**
 * A row addressed by column position rather than header text.
 *
 * Needed for layouts where meaning comes from position rather than a header
 * — the reference budget workbook places income and expenses in side-by-side
 * label+amount column pairs whose positions shift between sheets
 * (docs/REFERENCE_DOCUMENT_REGISTER.md, R-01).
 */
export interface RawGridRow {
  readonly rowNumber: number;
  /** Indexed by 1-based column number; absent entries are empty cells. */
  readonly cells: ReadonlyMap<number, RawCell>;
}

export interface RawSheet {
  name: string;
  kind: SheetKind;
  headers: string[];
  rows: RawRow[];
  /** Positional view of the same sheet, for position-driven layouts. */
  grid: RawGridRow[];
}

export interface RawWorkbook {
  fileName: string;
  fileHash: string;
  sheets: RawSheet[];
}

/**
 * One extracted, normalized budget line, before persistence. `labelRaw`
 * always preserves the original source text (docs/09 step 4).
 */
export interface ExtractedRow {
  periodMonth: string; // "YYYY-MM"
  category: PlanCategory;
  labelRaw: string;
  labelNormalized: string;
  /** Integer minor units (paise). Null when the source cell was unparseable. */
  amountMinorUnits: number | null;
  trustState: TrustState;
  /** Human-readable reasons this row is not `validated`. Empty when it is. */
  validationIssues: string[];
  /** Provenance: worksheet row number and the amount cell's A1 reference. */
  rowNumber: number;
  amountCellRef: string;
}

export interface ExtractedSheet {
  name: string;
  kind: SheetKind;
  headers: string[];
  /**
   * Extracted budget lines. Populated for `month` sheets only — `reference`
   * and `unrecognized` sheets carry no period, so attributing their rows to
   * a budget month would be inventing data. Their content is still hashed,
   * diffed, and retained in full for provenance.
   */
  rows: ExtractedRow[];
  /** Sheet-level problems, e.g. a month sheet missing its Amount column. */
  sheetIssues: string[];
  /**
   * Stable hash over the sheet's normalized extracted content. Two uploads
   * of the same sheet content produce the same hash regardless of file
   * bytes, so idempotency is content-based, not byte-based.
   */
  contentHash: string;
}

export interface ExtractedWorkbook {
  fileName: string;
  fileHash: string;
  sheets: ExtractedSheet[];
}

/** Per-sheet outcome of diffing this upload against stored history. */
export interface SheetDiff {
  sheetName: string;
  kind: SheetKind;
  classification: SheetClassification;
  /** Set when classification is `conflict`, explaining what could not be resolved. */
  conflictReason?: string;
  /** The extracted sheet, absent for `deleted_renamed` (it isn't in this upload). */
  extracted?: ExtractedSheet;
}

/**
 * The Import Audit surfaced to the user after every upload
 * (docs/09 step 9). Counts are per sheet, not per row.
 */
export interface ImportAudit {
  fileName: string;
  fileHash: string;
  /** True when a document with this exact file hash was already imported before. */
  isRepeatUpload: boolean;
  sheetsScanned: number;
  counts: Record<SheetClassification, number>;
  sheets: SheetDiff[];
  /** Rows that landed in `needs_review` across the whole import. */
  rowsNeedingReview: number;
  /** Total plan records newly written by this import. */
  recordsCreated: number;
  /** Plan records marked superseded by a revision during this import. */
  recordsSuperseded: number;
  /**
   * Records whose budget line disappeared from a modified sheet. They are
   * never deleted — they are flagged `needs_review` so a human decides
   * whether the line was intentionally dropped.
   */
  recordsFlaggedRemoved: number;
  /** Sheet-level problems collected across the whole import. */
  sheetIssues: string[];
}
