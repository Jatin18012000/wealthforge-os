import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { diffWorkbook, type PriorSheetState } from "./diff";
import { extractWorkbook } from "./normalize";
import { hashBuffer, parseWorkbookFile } from "./parseWorkbook";
import type {
  ExtractedRow,
  ExtractedSheet,
  ImportAudit,
  SheetClassification,
  SheetDiff,
} from "./types";

export interface ImportOptions {
  /**
   * Year to attribute bare month sheet names ("August") to. Required, never
   * inferred — a workbook must never be silently attributed to the wrong
   * year. Sheet names carrying their own year ("Aug-26") override this.
   */
  defaultYear: number;
}

/**
 * The full budget ingestion pipeline (docs/09_INGESTION_ARCHITECTURE.md).
 *
 * Every upload re-reads the ENTIRE workbook, diffs every sheet against
 * stored history, and never overwrites a stored value in place — a changed
 * figure supersedes its predecessor through a Revision, leaving the
 * original queryable forever.
 */
export async function importBudgetWorkbook(
  db: PrismaClient,
  filePath: string,
  options: ImportOptions,
): Promise<ImportAudit> {
  const buffer = await readFile(filePath);
  const fileHash = hashBuffer(buffer);
  const fileName = path.basename(filePath);

  const existingDocument = await db.sourceDocument.findUnique({ where: { fileHash } });
  const isRepeatUpload = existingDocument !== null;

  const raw = await parseWorkbookFile(filePath, fileName, fileHash, options.defaultYear);
  const extracted = extractWorkbook(raw, options.defaultYear);

  const prior = await loadPriorSheetState(db);
  const diffs = diffWorkbook(extracted, prior);

  const sourceDocument =
    existingDocument ??
    (await db.sourceDocument.create({
      data: { fileName, fileHash, kind: "budget_workbook" },
    }));

  let recordsCreated = 0;
  let recordsSuperseded = 0;
  let recordsFlaggedRemoved = 0;

  await db.$transaction(async (tx) => {
    for (const diff of diffs) {
      const snapshot = await tx.sheetSnapshot.create({
        data: {
          sourceDocumentId: sourceDocument.id,
          sheetName: diff.sheetName,
          sheetKind: diff.kind,
          classification: diff.classification,
          contentHash: diff.extracted?.contentHash ?? "",
          rawDataJson: JSON.stringify({
            headers: diff.extracted?.headers ?? [],
            rowCount: diff.extracted?.rows.length ?? 0,
            sheetIssues: diff.extracted?.sheetIssues ?? [],
            conflictReason: diff.conflictReason ?? null,
            rows: diff.extracted?.rows ?? [],
          }),
        },
      });

      // Only month sheets carry period-attributed budget lines. UNCHANGED
      // sheets need no writes; CONFLICT sheets must write nothing at all,
      // since we cannot tell which contradictory value is authoritative.
      if (
        diff.extracted === undefined ||
        diff.kind !== "month" ||
        diff.classification === "unchanged" ||
        diff.classification === "conflict" ||
        diff.classification === "deleted_renamed"
      ) {
        continue;
      }

      const result = await applySheetRows(tx, {
        sheet: diff.extracted,
        sourceDocumentId: sourceDocument.id,
        sheetSnapshotId: snapshot.id,
      });

      recordsCreated += result.created;
      recordsSuperseded += result.superseded;
      recordsFlaggedRemoved += result.flaggedRemoved;
    }
  });

  const audit = buildAudit({
    fileName,
    fileHash,
    isRepeatUpload,
    diffs,
    recordsCreated,
    recordsSuperseded,
    recordsFlaggedRemoved,
  });

  await db.auditEvent.create({
    data: { kind: "import", payloadJson: JSON.stringify(audit) },
  });

  return audit;
}

/**
 * The most recent stored content hash per sheet name, ignoring
 * `deleted_renamed` markers (which record an absence, not content).
 */
async function loadPriorSheetState(db: PrismaClient): Promise<PriorSheetState[]> {
  const snapshots = await db.sheetSnapshot.findMany({
    where: { classification: { not: "deleted_renamed" } },
    orderBy: { importedAt: "desc" },
    select: { sheetName: true, contentHash: true },
  });

  const latest = new Map<string, string>();
  for (const snapshot of snapshots) {
    if (!latest.has(snapshot.sheetName)) latest.set(snapshot.sheetName, snapshot.contentHash);
  }

  return [...latest].map(([sheetName, contentHash]) => ({ sheetName, contentHash }));
}

interface ApplyRowsArgs {
  sheet: ExtractedSheet;
  sourceDocumentId: string;
  sheetSnapshotId: string;
}

interface ApplyRowsResult {
  created: number;
  superseded: number;
  flaggedRemoved: number;
}

/**
 * Reconciles one month sheet's rows against the currently-effective plan
 * records for its period.
 *
 * Matching is pairwise by category+normalized label, so a sheet with two
 * legitimately identical labels reconciles against two existing records
 * rather than collapsing them.
 *
 * Reconciliation is keyed on the PERIOD, never on whether the sheet is new.
 * A renamed sheet ("August" becoming "Aug-26") is a new sheet covering an
 * existing period; treating "new sheet" as "new period" and skipping
 * reconciliation duplicated every line in that month, double-counting it in
 * every total. Always reconciling against the period's effective records is
 * both simpler and correct — for a genuinely new period the query returns
 * nothing and every row is created.
 */
async function applySheetRows(
  tx: Prisma.TransactionClient,
  { sheet, sourceDocumentId, sheetSnapshotId }: ApplyRowsArgs,
): Promise<ApplyRowsResult> {
  const result: ApplyRowsResult = { created: 0, superseded: 0, flaggedRemoved: 0 };
  const periodMonth = sheet.rows[0]?.periodMonth;
  if (periodMonth === undefined) return result;

  // Currently-effective records for this period: those not yet superseded.
  const existing = await tx.planRecord.findMany({
    where: { periodMonth, supersededById: null },
    orderBy: { createdAt: "asc" },
  });

  const unmatched = new Map<string, typeof existing>();
  for (const record of existing) {
    const key = `${record.category}::${record.labelNormalized}`;
    const bucket = unmatched.get(key);
    if (bucket) bucket.push(record);
    else unmatched.set(key, [record]);
  }

  for (const row of sheet.rows) {
    const key = `${row.category}::${row.labelNormalized}`;
    const bucket = unmatched.get(key);
    const match = bucket?.shift();

    if (match === undefined) {
      await createPlanRecord(tx, row, sourceDocumentId, sheetSnapshotId);
      result.created += 1;
      continue;
    }

    const unchanged =
      match.amountMinorUnits === row.amountMinorUnits && match.trustState === row.trustState;
    if (unchanged) continue;

    // A corrected value never overwrites its predecessor. The prior record
    // is retained, marked superseded, and pointed at its replacement.
    const replacement = await createPlanRecord(tx, row, sourceDocumentId, sheetSnapshotId);
    await tx.planRecord.update({
      where: { id: match.id },
      data: { supersededById: replacement.id, trustState: "superseded" },
    });
    await tx.revision.create({
      data: {
        entityType: "plan_record",
        entityId: match.id,
        originalValueJson: JSON.stringify({
          amountMinorUnits: match.amountMinorUnits,
          trustState: match.trustState,
          labelRaw: match.labelRaw,
        }),
        revisedValueJson: JSON.stringify({
          amountMinorUnits: row.amountMinorUnits,
          trustState: row.trustState,
          labelRaw: row.labelRaw,
        }),
        source: `workbook-import:${sheet.name}`,
        reason: "value changed in a re-imported workbook sheet",
      },
    });
    result.created += 1;
    result.superseded += 1;
  }

  // Records whose line vanished from the sheet. Historical data is never
  // deleted — flag for human review rather than assuming intent.
  for (const bucket of unmatched.values()) {
    for (const orphan of bucket) {
      await tx.planRecord.update({
        where: { id: orphan.id },
        data: { trustState: "needs_review" },
      });
      await tx.revision.create({
        data: {
          entityType: "plan_record",
          entityId: orphan.id,
          originalValueJson: JSON.stringify({
            amountMinorUnits: orphan.amountMinorUnits,
            trustState: orphan.trustState,
          }),
          revisedValueJson: JSON.stringify({
            amountMinorUnits: orphan.amountMinorUnits,
            trustState: "needs_review",
          }),
          source: `workbook-import:${sheet.name}`,
          reason:
            "line no longer present in the re-imported sheet; retained and flagged rather than deleted",
        },
      });
      result.flaggedRemoved += 1;
    }
  }

  return result;
}

async function createPlanRecord(
  tx: Prisma.TransactionClient,
  row: ExtractedRow,
  sourceDocumentId: string,
  sheetSnapshotId: string,
) {
  return tx.planRecord.create({
    data: {
      periodMonth: row.periodMonth,
      category: row.category,
      labelRaw: row.labelRaw,
      labelNormalized: row.labelNormalized,
      amountMinorUnits: row.amountMinorUnits,
      trustState: row.trustState,
      sourceDocumentId,
      sheetSnapshotId,
    },
  });
}

interface BuildAuditArgs {
  fileName: string;
  fileHash: string;
  isRepeatUpload: boolean;
  diffs: SheetDiff[];
  recordsCreated: number;
  recordsSuperseded: number;
  recordsFlaggedRemoved: number;
}

function buildAudit({
  fileName,
  fileHash,
  isRepeatUpload,
  diffs,
  recordsCreated,
  recordsSuperseded,
  recordsFlaggedRemoved,
}: BuildAuditArgs): ImportAudit {
  const counts: Record<SheetClassification, number> = {
    new: 0,
    modified: 0,
    unchanged: 0,
    deleted_renamed: 0,
    conflict: 0,
  };

  let rowsNeedingReview = 0;
  const sheetIssues: string[] = [];

  for (const diff of diffs) {
    counts[diff.classification] += 1;
    if (diff.conflictReason !== undefined) sheetIssues.push(diff.conflictReason);
    if (diff.extracted) {
      sheetIssues.push(...diff.extracted.sheetIssues);
      rowsNeedingReview += diff.extracted.rows.filter(
        (row: ExtractedRow) => row.trustState === "needs_review",
      ).length;
    }
  }

  return {
    fileName,
    fileHash,
    isRepeatUpload,
    // Sheets actually present in this upload; deleted_renamed entries record
    // an absence and were not scanned from the file.
    sheetsScanned: diffs.filter((d) => d.classification !== "deleted_renamed").length,
    counts,
    sheets: diffs,
    rowsNeedingReview,
    recordsCreated,
    recordsSuperseded,
    recordsFlaggedRemoved,
    sheetIssues,
  };
}
