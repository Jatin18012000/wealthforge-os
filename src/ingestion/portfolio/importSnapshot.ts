import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { hashBuffer } from "../parseWorkbook";
import { extractZerodhaStatement } from "../sources/zerodhaHoldings";
import { extractSnapshot, type NormalizeOptions } from "./normalizeSnapshot";
import { parseSnapshotFile } from "./parseSnapshot";
import type {
  ExtractedPosition,
  ExtractedSnapshot,
  ObservedPositionChange,
  PortfolioImportAudit,
} from "./types";

export interface ImportSnapshotOptions extends Partial<NormalizeOptions> {
  /**
   * Optional when the file states its own as-of date (a Zerodha statement
   * carries "…as on YYYY-MM-DD"). Required otherwise. When both are present
   * and disagree, the import is refused rather than silently misdating the
   * portfolio — see D-011.
   */
  readonly asOf?: Date;
  /**
   * The name to record and display for this document, when it differs from
   * `filePath`'s basename — see `ImportOptions.displayFileName` in
   * `../importWorkbook.ts` for why (browser uploads via
   * `src/ingestion/uploadStorage.ts`).
   */
  readonly displayFileName?: string;
}

/**
 * Imports a holdings snapshot (docs/09_INGESTION_ARCHITECTURE.md, M5).
 *
 * A snapshot is a POSITION at a date, not a record of activity. Re-importing
 * the same date is a correction and creates a revision; a later date is a
 * new observation and gets its own row. A quantity that changed between two
 * dates is reported as an observed change and reconciled against recorded
 * transactions where possible — it is never turned into an invented buy or
 * sell.
 */
export async function importPortfolioSnapshot(
  db: PrismaClient,
  filePath: string,
  options: ImportSnapshotOptions,
): Promise<PortfolioImportAudit> {
  const snapshot = await resolveSnapshot(filePath, options);

  const existingDocument = await db.sourceDocument.findUnique({
    where: { fileHash: snapshot.fileHash },
  });
  const isRepeatUpload = existingDocument !== null;

  const sourceDocument =
    existingDocument ??
    (await db.sourceDocument.create({
      data: {
        fileName: snapshot.fileName,
        fileHash: snapshot.fileHash,
        kind: "portfolio_snapshot",
      },
    }));

  let instrumentsCreated = 0;
  let positionsCreated = 0;
  let positionsUnchanged = 0;
  let positionsRevised = 0;
  let valuationsCreated = 0;
  const observedChanges: ObservedPositionChange[] = [];

  // Rows this run has already written, keyed by instrument + date. A second
  // row for the same key is a duplicate WITHIN one file, not a correction of
  // an earlier import — see persistPosition.
  const writtenThisRun = new Set<string>();

  await db.$transaction(async (tx) => {
    for (const position of snapshot.positions) {
      if (position.identifier === "") continue; // nothing to key an instrument on

      const instrument = await resolveInstrument(tx, position);
      if (instrument.created) instrumentsCreated += 1;

      if (position.priceMinorUnits !== null) {
        const created = await recordValuation(
          tx,
          instrument.id,
          snapshot.asOf,
          position.priceMinorUnits,
          snapshot.fileName,
        );
        if (created) valuationsCreated += 1;
      }

      const change = await detectObservedChange(
        tx,
        instrument.id,
        position,
        snapshot.asOf,
      );
      if (change !== null) observedChanges.push(change);

      const outcome = await persistPosition(tx, {
        instrumentId: instrument.id,
        position,
        asOf: snapshot.asOf,
        sourceDocumentId: sourceDocument.id,
        writtenThisRun,
      });

      if (outcome === "created") positionsCreated += 1;
      if (outcome === "unchanged") positionsUnchanged += 1;
      if (outcome === "revised") {
        positionsCreated += 1;
        positionsRevised += 1;
      }
    }
  });

  const audit: PortfolioImportAudit = {
    fileName: snapshot.fileName,
    fileHash: snapshot.fileHash,
    asOf: snapshot.asOf,
    isRepeatUpload,
    rowsScanned: snapshot.positions.length,
    instrumentsCreated,
    positionsCreated,
    positionsUnchanged,
    positionsRevised,
    valuationsCreated,
    rowsNeedingReview: snapshot.positions.filter((p) => p.trustState === "needs_review")
      .length,
    observedChanges,
    issues: [
      ...snapshot.fileIssues,
      ...observedChanges
        .filter((change) => !change.reconciled)
        .map(
          (change) =>
            `"${change.instrumentLabel}" changed from ${change.previousQuantity} to ${change.newQuantity} with no recorded transaction accounting for it; reported for review, not recorded as a trade`,
        ),
    ],
  };

  await db.auditEvent.create({
    data: {
      kind: "import",
      payloadJson: JSON.stringify({ portfolioSnapshot: audit }),
    },
  });

  return audit;
}

/**
 * Chooses a source adapter for the file and produces a canonical snapshot.
 *
 * Source-specific layout handling is confined to the adapters; everything
 * below this function sees the same shape regardless of where the file came
 * from (docs/09_INGESTION_ARCHITECTURE.md, source-adapter architecture).
 */
async function resolveSnapshot(
  filePath: string,
  options: ImportSnapshotOptions,
): Promise<ExtractedSnapshot> {
  const buffer = await readFile(filePath);
  const fileHash = hashBuffer(buffer);
  const fileName = options.displayFileName ?? path.basename(filePath);

  const zerodha =
    path.extname(filePath).toLowerCase() === ".xlsx"
      ? await extractZerodhaStatement(filePath, fileName, fileHash)
      : null;

  if (zerodha !== null) {
    const statementDate = zerodha.asOf.getTime() === 0 ? null : zerodha.asOf;

    if (statementDate === null && options.asOf === undefined) {
      throw new Error(
        `${fileName}: the statement carries no readable date and no asOf was supplied; refusing to guess the portfolio's date.`,
      );
    }
    // Trusting one over the other silently would misdate every historical
    // valuation built on this snapshot, so a disagreement is fatal (D-011).
    if (
      statementDate !== null &&
      options.asOf !== undefined &&
      statementDate.getTime() !== options.asOf.getTime()
    ) {
      throw new Error(
        `${fileName}: the statement is dated ${statementDate.toISOString().slice(0, 10)} but ${options.asOf.toISOString().slice(0, 10)} was supplied. Refusing to import rather than misdate the portfolio.`,
      );
    }

    return { ...zerodha, asOf: statementDate ?? (options.asOf as Date) };
  }

  // Generic tabular export: the file states no date, so the caller must.
  if (options.asOf === undefined || options.assetClass === undefined) {
    throw new Error(
      `${fileName}: this layout states neither an as-of date nor an asset class, so both must be supplied explicitly.`,
    );
  }

  const raw = await parseSnapshotFile(filePath);
  // parseSnapshotFile derives its own fileName from the path, independent of
  // the display-name override above (it has no reason to know about one) —
  // so the override is re-applied here, exactly as the Zerodha branch above
  // already gets it by construction (extractZerodhaStatement is called with
  // `fileName` directly).
  return {
    ...extractSnapshot(raw, { asOf: options.asOf, assetClass: options.assetClass }),
    fileName,
  };
}

async function resolveInstrument(
  tx: Prisma.TransactionClient,
  position: ExtractedPosition,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.instrument.findFirst({
    where: { kind: position.assetClass, identifier: position.identifier },
  });
  if (existing !== null) return { id: existing.id, created: false };

  const created = await tx.instrument.create({
    data: {
      kind: position.assetClass,
      identifier: position.identifier,
      displayName: position.displayName,
    },
  });
  return { id: created.id, created: true };
}

/**
 * Records the snapshot's reported price as a dated valuation. Skips writing
 * a duplicate when the same price for the same date is already on record,
 * so re-importing a file cannot inflate the valuation history.
 */
async function recordValuation(
  tx: Prisma.TransactionClient,
  instrumentId: string,
  asOf: Date,
  priceMinorUnits: number,
  fileName: string,
): Promise<boolean> {
  const existing = await tx.valuation.findFirst({
    where: { instrumentId, asOfDate: asOf },
  });
  if (existing !== null) return false;

  await tx.valuation.create({
    data: {
      instrumentId,
      asOfDate: asOf,
      priceMinorUnits,
      source: `portfolio-snapshot:${fileName}`,
    },
  });
  return true;
}

/**
 * Compares this holding against the most recent EARLIER observation and
 * reports any quantity difference, reconciling it against recorded
 * transactions when those carry quantities.
 */
async function detectObservedChange(
  tx: Prisma.TransactionClient,
  instrumentId: string,
  position: ExtractedPosition,
  asOf: Date,
): Promise<ObservedPositionChange | null> {
  if (position.quantity === null) return null;

  const previous = await tx.positionSnapshot.findFirst({
    where: { instrumentId, asOfDate: { lt: asOf }, supersededById: null },
    orderBy: { asOfDate: "desc" },
  });
  if (previous === null || previous.quantity === position.quantity) return null;

  const transactions = await tx.activity.findMany({
    where: {
      instrumentId,
      kind: { in: ["buy", "sell"] },
      occurredOn: { gt: previous.asOfDate, lte: asOf },
    },
  });

  const quantityDelta = position.quantity - previous.quantity;

  // Reconcile only when every transaction in the window carries a quantity;
  // otherwise we genuinely cannot say whether they explain the change, and
  // claiming reconciliation would be a guess.
  const allHaveQuantity =
    transactions.length > 0 && transactions.every((t) => t.quantity !== null);

  const recordedTransactionQuantity = allHaveQuantity
    ? transactions.reduce(
        (sum, t) =>
          sum + (t.kind === "buy" ? (t.quantity as number) : -(t.quantity as number)),
        0,
      )
    : null;

  return {
    instrumentLabel: position.displayName,
    previousQuantity: previous.quantity,
    previousAsOf: previous.asOfDate,
    newQuantity: position.quantity,
    quantityDelta,
    recordedTransactionQuantity,
    transactionCount: transactions.length,
    reconciled:
      recordedTransactionQuantity !== null &&
      Math.abs(recordedTransactionQuantity - quantityDelta) < 1e-9,
  };
}

type PersistOutcome = "created" | "unchanged" | "revised";

async function persistPosition(
  tx: Prisma.TransactionClient,
  args: {
    instrumentId: string;
    position: ExtractedPosition;
    asOf: Date;
    sourceDocumentId: string;
    writtenThisRun: Set<string>;
  },
): Promise<PersistOutcome> {
  const { instrumentId, position, asOf, sourceDocumentId, writtenThisRun } = args;

  const runKey = `${instrumentId}::${asOf.getTime()}`;
  const isDuplicateWithinThisFile = writtenThisRun.has(runKey);
  writtenThisRun.add(runKey);

  const sameDate = isDuplicateWithinThisFile
    ? null
    : await tx.positionSnapshot.findFirst({
        where: { instrumentId, asOfDate: asOf, supersededById: null },
      });

  const data = {
    instrumentId,
    asOfDate: asOf,
    quantity: position.quantity ?? 0,
    unit: position.unit,
    costBasisMinorUnits: position.costBasisMinorUnits,
    trustState: position.trustState,
    sourceDocumentId,
  };

  // A second row for the same instrument and date WITHIN one file is a
  // duplicate, not a correction. Superseding here would silently discard the
  // first lot — the precise outcome the duplicate flagging exists to prevent.
  // Both rows are written (already flagged needs_review) for a human to resolve.
  if (sameDate === null) {
    await tx.positionSnapshot.create({ data });
    return "created";
  }

  const unchanged =
    sameDate.quantity === (position.quantity ?? 0) &&
    sameDate.costBasisMinorUnits === position.costBasisMinorUnits &&
    sameDate.trustState === position.trustState;

  if (unchanged) return "unchanged";

  // Same date, different numbers: a correction. The prior observation is
  // retained and superseded, never overwritten in place.
  const replacement = await tx.positionSnapshot.create({ data });
  await tx.positionSnapshot.update({
    where: { id: sameDate.id },
    data: { supersededById: replacement.id, trustState: "superseded" },
  });
  await tx.revision.create({
    data: {
      entityType: "position_snapshot",
      entityId: sameDate.id,
      originalValueJson: JSON.stringify({
        quantity: sameDate.quantity,
        costBasisMinorUnits: sameDate.costBasisMinorUnits,
        trustState: sameDate.trustState,
      }),
      revisedValueJson: JSON.stringify({
        quantity: position.quantity,
        costBasisMinorUnits: position.costBasisMinorUnits,
        trustState: position.trustState,
      }),
      source: "portfolio-snapshot-reimport",
      reason: "holding corrected by a re-imported snapshot for the same date",
    },
  });

  return "revised";
}
