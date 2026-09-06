import { parseAmountToMinorUnits } from "../normalize";
import type { TrustState } from "../types";
import type {
  ExtractedPosition,
  ExtractedSnapshot,
  PortfolioAssetClass,
  RawSnapshotFile,
} from "./types";

/**
 * Header spellings seen across broker and fund-house exports. Explicitly
 * enumerated — an unrecognized layout is reported as a file issue rather
 * than guessed at, since mapping the wrong column to "quantity" would
 * silently corrupt every holding.
 */
export const COLUMN_ALIASES = {
  identifier: [
    "symbol",
    "ticker",
    "instrument",
    "isin",
    "scheme code",
    "scheme_code",
    "tradingsymbol",
    "trading symbol",
    "code",
  ],
  name: ["name", "scheme name", "instrument name", "company", "description", "security"],
  quantity: ["quantity", "qty", "units", "held", "holdings", "balance units", "shares"],
  price: ["price", "ltp", "nav", "last price", "closing price", "market price", "current price"],
  averageCost: ["avg cost", "avg. cost", "average price", "avg price", "buy price", "cost price"],
  totalCost: ["cost value", "invested", "invested value", "total cost", "investment"],
  /**
   * The holding's TOTAL market value at the statement date, as opposed to
   * `price`, which is per unit. Fund-house mutual-fund statements report
   * this instead of a NAV — they state what the holding is worth, not what
   * one unit costs — so without it such a statement yields no price at all
   * and every holding is excluded as unvalued.
   */
  totalValue: [
    "current value",
    "cur. val",
    "cur value",
    "market value",
    "present value",
    "current market value",
    "value",
  ],
  /**
   * Folio number. Part of a mutual-fund holding's IDENTITY, not decoration:
   * one scheme held under three folios is three distinct holdings, and
   * keying instruments on scheme name alone silently merges them into one
   * (and then flags them as duplicate rows of each other).
   */
  folio: ["folio no.", "folio no", "folio number", "folio"],
} as const;

const UNIT_BY_ASSET_CLASS: Record<PortfolioAssetClass, string> = {
  equity: "shares",
  etf: "units",
  mutual_fund: "units",
  gold: "grams",
  silver: "grams",
  epf: "rupees",
};

export function findColumn(headers: readonly string[], aliases: readonly string[]): string | null {
  for (const header of headers) {
    if (aliases.includes(header.trim().toLowerCase())) return header;
  }
  return null;
}

/** Parses a bare unit count (shares, MF units, grams) — not a currency amount. */
export function parseQuantity(value: string): { quantity: number | null; issue: string | null } {
  const cleaned = value.replace(/[,\s]/g, "");
  if (cleaned === "") return { quantity: null, issue: "quantity is empty" };
  if (!/^-?\d*\.?\d+$/.test(cleaned)) {
    return { quantity: null, issue: `quantity is not numeric: "${value}"` };
  }

  const quantity = Number(cleaned);
  if (!Number.isFinite(quantity)) {
    return { quantity: null, issue: `quantity is not a finite number: "${value}"` };
  }
  return { quantity, issue: null };
}

export interface NormalizeOptions {
  /**
   * The date this snapshot describes. Required, never inferred from the file
   * or the clock: a holdings export carries no reliable as-of date of its
   * own, and guessing one would misdate the whole portfolio (see D-011).
   */
  readonly asOf: Date;
  /** Asset class for every holding in this file. */
  readonly assetClass: PortfolioAssetClass;
}

export function extractSnapshot(
  file: RawSnapshotFile,
  options: NormalizeOptions,
): ExtractedSnapshot {
  const fileIssues: string[] = [];

  const identifierColumn = findColumn(file.headers, COLUMN_ALIASES.identifier);
  const nameColumn = findColumn(file.headers, COLUMN_ALIASES.name);
  const quantityColumn = findColumn(file.headers, COLUMN_ALIASES.quantity);
  const priceColumn = findColumn(file.headers, COLUMN_ALIASES.price);
  const averageCostColumn = findColumn(file.headers, COLUMN_ALIASES.averageCost);
  const totalCostColumn = findColumn(file.headers, COLUMN_ALIASES.totalCost);
  const totalValueColumn = findColumn(file.headers, COLUMN_ALIASES.totalValue);
  const folioColumn = findColumn(file.headers, COLUMN_ALIASES.folio);

  // A holding needs something to identify it and something to count. Either
  // an identifier or a name will do for identity; quantity is mandatory.
  if (identifierColumn === null && nameColumn === null) {
    fileIssues.push("no recognizable instrument identifier or name column");
  }
  if (quantityColumn === null) {
    fileIssues.push("no recognizable quantity column");
  }

  if ((identifierColumn === null && nameColumn === null) || quantityColumn === null) {
    return {
      fileName: file.fileName,
      fileHash: file.fileHash,
      asOf: options.asOf,
      positions: [],
      fileIssues,
    };
  }

  const positions: ExtractedPosition[] = [];

  for (const row of file.rows) {
    const validationIssues: string[] = [];

    const rawIdentifier = identifierColumn ? (row.cells[identifierColumn] ?? "") : "";
    const rawName = nameColumn ? (row.cells[nameColumn] ?? "") : "";
    const baseIdentifier = rawIdentifier.trim() || rawName.trim();
    const displayName = rawName.trim() || rawIdentifier.trim();

    // A folio makes the holding distinct: the same scheme held under three
    // folios is three holdings, each with its own units and cost, and they
    // must not collapse into one instrument (nor be mistaken for duplicate
    // rows of each other). Appended to the identifier rather than stored
    // separately, because `identifier` is already this layer's free-form
    // natural key (ISIN, scheme code, symbol, or name) and instruments are
    // resolved by it — see resolveInstrument in ./importSnapshot.ts.
    const folio = folioColumn ? (row.cells[folioColumn] ?? "").trim() : "";
    const identifier =
      baseIdentifier !== "" && folio !== "" ? `${baseIdentifier} · ${folio}` : baseIdentifier;

    if (identifier === "") validationIssues.push("holding has neither an identifier nor a name");

    const { quantity, issue: quantityIssue } = parseQuantity(row.cells[quantityColumn] ?? "");
    if (quantityIssue) validationIssues.push(quantityIssue);
    if (quantity !== null && quantity < 0) {
      // A negative holding is not a short position in this product; it is a
      // data error, and must be reviewed rather than accepted.
      validationIssues.push(`negative quantity: ${quantity}`);
    }

    const reportedPrice = priceColumn
      ? readOptionalAmount(row.cells[priceColumn], "price", validationIssues)
      : null;

    // A statement that reports the holding's total value but no per-unit
    // price still states, unambiguously, what the holding was worth at its
    // own date — so it is valued from that, not left unpriced awaiting a
    // market lookup it never needed. The per-unit figure is DERIVED from the
    // statement's own two numbers (value ÷ units), never invented and never
    // fetched: it is the arithmetic the statement itself implies. A reported
    // per-unit price always wins, since that is the source's own figure
    // rather than one derived from it.
    const totalValueMinorUnits = totalValueColumn
      ? readOptionalAmount(row.cells[totalValueColumn], "current value", validationIssues)
      : null;

    const priceMinorUnits =
      reportedPrice ??
      deriveUnitPrice(totalValueMinorUnits, quantity, validationIssues);

    const costBasisMinorUnits = resolveCostBasis({
      totalCost: totalCostColumn ? row.cells[totalCostColumn] : undefined,
      averageCost: averageCostColumn ? row.cells[averageCostColumn] : undefined,
      quantity,
      validationIssues,
    });

    const trustState: TrustState = validationIssues.length === 0 ? "validated" : "needs_review";

    positions.push({
      identifier,
      displayName: displayName || identifier,
      assetClass: options.assetClass,
      unit: UNIT_BY_ASSET_CLASS[options.assetClass],
      quantity,
      priceMinorUnits,
      costBasisMinorUnits,
      marketValueMinorUnits: totalValueMinorUnits,
      trustState,
      validationIssues,
      rowNumber: row.rowNumber,
    });
  }

  flagDuplicateHoldings(positions, fileIssues);

  return {
    fileName: file.fileName,
    fileHash: file.fileHash,
    asOf: options.asOf,
    positions,
    fileIssues,
  };
}

/** An optional monetary column: absent is fine, present-but-unparseable is not. */
function readOptionalAmount(
  raw: string | undefined,
  label: string,
  validationIssues: string[],
): number | null {
  if (raw === undefined || raw.trim() === "") return null;

  const { minorUnits, issue } = parseAmountToMinorUnits(raw);
  if (issue !== null) {
    validationIssues.push(`${label}: ${issue}`);
    return null;
  }
  return minorUnits;
}

/**
 * Per-unit price implied by a reported total value and unit count.
 *
 * The mirror image of `resolveCostBasis`, which derives a total from a
 * per-unit figure; this derives a per-unit figure from a total. Used only
 * when the statement reports no price of its own — a fund-house mutual-fund
 * statement reports "Current Value" per holding rather than a NAV per unit,
 * and valuation is `price × quantity` throughout the engine
 * (`src/domain/portfolio.ts`), so a per-unit figure is what it needs.
 *
 * Returns null rather than 0 when either input is missing or the unit count
 * is not positive: dividing by zero units yields no meaningful price, and a
 * zero price would silently value a real holding at nothing — the exact
 * failure `valuePosition`'s insufficient-data path exists to prevent.
 */
function deriveUnitPrice(
  totalValueMinorUnits: number | null,
  quantity: number | null,
  validationIssues: string[],
): number | null {
  if (totalValueMinorUnits === null || quantity === null) return null;
  if (quantity <= 0) {
    validationIssues.push(
      `cannot derive a unit price from a total value with ${quantity} units`,
    );
    return null;
  }
  return Math.round(totalValueMinorUnits / quantity);
}

/**
 * Cost basis, preferring a reported total over one derived from average cost.
 *
 * A reported total is a fact from the source; average × quantity is a
 * derivation, used only when the total is absent.
 */
function resolveCostBasis({
  totalCost,
  averageCost,
  quantity,
  validationIssues,
}: {
  totalCost: string | undefined;
  averageCost: string | undefined;
  quantity: number | null;
  validationIssues: string[];
}): number | null {
  const reportedTotal = readOptionalAmount(totalCost, "cost value", validationIssues);
  if (reportedTotal !== null) return reportedTotal;

  const perUnit = readOptionalAmount(averageCost, "average cost", validationIssues);
  if (perUnit === null || quantity === null) return null;

  return Math.round(perUnit * quantity);
}

/**
 * Flags the same instrument appearing more than once in one snapshot.
 *
 * Summing the rows would double-count a duplicated export line; keeping one
 * would drop a genuine second lot. The file cannot distinguish them, so both
 * are flagged for review — the same stance budget ingestion takes on
 * duplicate rows.
 */
function flagDuplicateHoldings(positions: ExtractedPosition[], fileIssues: string[]): void {
  const byIdentifier = new Map<string, ExtractedPosition[]>();

  for (const position of positions) {
    const key = position.identifier.toLowerCase();
    const group = byIdentifier.get(key);
    if (group) group.push(position);
    else byIdentifier.set(key, [position]);
  }

  for (const [key, group] of byIdentifier) {
    if (group.length < 2 || key === "") continue;

    const rows = group.map((p) => p.rowNumber).join(", ");
    fileIssues.push(
      `"${group[0]?.displayName ?? key}" appears ${group.length} times (rows ${rows}); flagged for review rather than summed or dropped`,
    );
    for (const position of group) {
      (position.validationIssues as string[]).push(
        `duplicate holding: appears ${group.length} times in this snapshot (rows ${rows})`,
      );
      (position as { trustState: TrustState }).trustState = "needs_review";
    }
  }
}
