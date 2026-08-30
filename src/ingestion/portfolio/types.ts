import type { TrustState } from "../types";

/** Asset classes a portfolio snapshot can describe. */
export type PortfolioAssetClass = "equity" | "etf" | "mutual_fund" | "gold" | "silver" | "epf";

/** One row of a broker or fund-house holdings export, before normalization. */
export interface RawSnapshotRow {
  readonly rowNumber: number;
  readonly cells: Readonly<Record<string, string>>;
}

export interface RawSnapshotFile {
  readonly fileName: string;
  readonly fileHash: string;
  readonly headers: readonly string[];
  readonly rows: readonly RawSnapshotRow[];
}

/** A normalized, validated holding ready to persist. */
export interface ExtractedPosition {
  readonly identifier: string;
  readonly displayName: string;
  readonly assetClass: PortfolioAssetClass;
  readonly unit: string;
  /** Null when the source cell could not be parsed — never coerced to 0. */
  readonly quantity: number | null;
  /** Per-unit price/NAV in paise, when the export reports one. */
  readonly priceMinorUnits: number | null;
  /** Total acquisition cost in paise, when the export reports it. */
  readonly costBasisMinorUnits: number | null;
  readonly trustState: TrustState;
  readonly validationIssues: readonly string[];
  readonly rowNumber: number;
}

export interface ExtractedSnapshot {
  readonly fileName: string;
  readonly fileHash: string;
  readonly asOf: Date;
  readonly positions: readonly ExtractedPosition[];
  readonly fileIssues: readonly string[];
}

/**
 * A holding whose quantity differs from the previous observation.
 *
 * Reported, never acted on: a difference between two snapshots is an
 * observation, not a confirmed transaction, and the system must never
 * invent a buy or sell to explain it
 * (docs/01_PRODUCT_VISION.md, "Observed change ≠ confirmed transaction").
 */
export interface ObservedPositionChange {
  readonly instrumentLabel: string;
  readonly previousQuantity: number;
  readonly previousAsOf: Date;
  readonly newQuantity: number;
  readonly quantityDelta: number;
  /** Recorded buy/sell quantity between the two dates, when transactions carry quantity. */
  readonly recordedTransactionQuantity: number | null;
  readonly transactionCount: number;
  /**
   * True when recorded transactions account for the delta exactly. False
   * means the change is unexplained and needs human attention.
   */
  readonly reconciled: boolean;
}

/** The Portfolio Import Audit surfaced after every snapshot upload. */
export interface PortfolioImportAudit {
  readonly fileName: string;
  readonly fileHash: string;
  readonly asOf: Date;
  readonly isRepeatUpload: boolean;
  readonly rowsScanned: number;
  readonly instrumentsCreated: number;
  readonly positionsCreated: number;
  readonly positionsUnchanged: number;
  readonly positionsRevised: number;
  readonly valuationsCreated: number;
  readonly rowsNeedingReview: number;
  readonly observedChanges: readonly ObservedPositionChange[];
  readonly issues: readonly string[];
}
