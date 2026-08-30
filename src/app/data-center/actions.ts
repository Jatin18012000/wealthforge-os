"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { backupAfterImport, exportFullBackup, restoreFullBackup } from "../../backup";
import { BACKUP_DIR, SAFETY_BACKUP_DIR } from "../../data/dataCenterStore";
import { hashBuffer, importBudgetWorkbook, storeUpload } from "../../ingestion";
import { importPortfolioSnapshot } from "../../ingestion/portfolio";
import type { PortfolioAssetClass } from "../../ingestion/portfolio/types";
import { db } from "../../lib/db";

/**
 * Data Center writes: upload → real ingestion pipeline → automatic backup,
 * and export/restore wrapping `src/backup/`.
 *
 * As in Settings (`src/app/settings/actions.ts`), every write re-derives
 * what it needs from the form and the database rather than trusting a
 * value posted back, and every outcome — success or refusal — is
 * redirected back to the screen rather than left for the caller to guess.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function dataCenterUrl(params: Record<string, string>): string {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== ""));
  const query = search.toString();
  return query === "" ? "/data-center" : `/data-center?${query}`;
}

const ASSET_CLASSES: readonly PortfolioAssetClass[] = [
  "equity",
  "etf",
  "mutual_fund",
  "gold",
  "silver",
  "epf",
];

function isAssetClass(value: string): value is PortfolioAssetClass {
  return (ASSET_CLASSES as readonly string[]).includes(value);
}

export async function uploadBudgetWorkbookAction(form: FormData): Promise<void> {
  const file = form.get("file");
  const defaultYear = Number(text(form, "defaultYear"));

  if (!(file instanceof File) || file.size === 0) {
    redirect(dataCenterUrl({ error: "Choose a budget workbook file to upload." }));
  }
  if (!Number.isInteger(defaultYear)) {
    redirect(dataCenterUrl({ error: "The default year must be a whole number." }));
  }

  const stored = await storeUpload(file, "budgetWorkbook");
  if (stored.kind !== "ok") {
    redirect(dataCenterUrl({ error: stored.reasons.join("; ") }));
  }

  try {
    await importBudgetWorkbook(db, stored.value.path, {
      defaultYear,
      displayFileName: stored.value.originalName,
    });
  } catch (err) {
    // The file was never referenced by a source_document, so nothing keeps
    // a dangling upload around once ingestion has refused it.
    await stored.value.cleanup();
    redirect(dataCenterUrl({ error: describeError(err) }));
  }

  // Past this point the source_document row points at this exact file, so
  // it is kept on disk rather than cleaned up — see recordRawBlobPath.
  await recordRawBlobPath(stored.value.path);
  const eventId = await backupAfterImportAndFindEvent();

  revalidatePath("/", "layout");
  redirect(dataCenterUrl({ event: eventId ?? "" }));
}

export async function uploadPortfolioSnapshotAction(form: FormData): Promise<void> {
  const file = form.get("file");
  const asOfRaw = text(form, "asOf");
  const assetClassRaw = text(form, "assetClass");

  if (!(file instanceof File) || file.size === 0) {
    redirect(dataCenterUrl({ error: "Choose a portfolio snapshot file to upload." }));
  }

  const asOf = asOfRaw === "" ? undefined : new Date(`${asOfRaw}T00:00:00.000Z`);
  if (asOf !== undefined && Number.isNaN(asOf.getTime())) {
    redirect(dataCenterUrl({ error: "That as-of date could not be read." }));
  }
  if (assetClassRaw !== "" && !isAssetClass(assetClassRaw)) {
    redirect(
      dataCenterUrl({ error: `"${assetClassRaw}" is not a recognized asset class.` }),
    );
  }

  const stored = await storeUpload(file, "portfolioSnapshot");
  if (stored.kind !== "ok") {
    redirect(dataCenterUrl({ error: stored.reasons.join("; ") }));
  }

  try {
    await importPortfolioSnapshot(db, stored.value.path, {
      displayFileName: stored.value.originalName,
      ...(asOf === undefined ? {} : { asOf }),
      ...(assetClassRaw === ""
        ? {}
        : { assetClass: assetClassRaw as PortfolioAssetClass }),
    });
  } catch (err) {
    await stored.value.cleanup();
    redirect(dataCenterUrl({ error: describeError(err) }));
  }

  await recordRawBlobPath(stored.value.path);
  const eventId = await backupAfterImportAndFindEvent();

  revalidatePath("/", "layout");
  redirect(dataCenterUrl({ event: eventId ?? "" }));
}

/**
 * The raw file is kept on disk (docs/13_SECURITY_PRIVACY.md, "Data at
 * rest") rather than deleted after parsing, and its path is attached to
 * the source_document ingestion already created — so provenance can point
 * back at the exact bytes uploaded, not just the parsed result.
 */
async function recordRawBlobPath(storedPath: string): Promise<void> {
  const buffer = await readFile(storedPath);
  const fileHash = hashBuffer(buffer);
  await db.sourceDocument.updateMany({
    where: { fileHash },
    data: { rawBlobPath: storedPath },
  });
}

async function backupAfterImportAndFindEvent(): Promise<string | null> {
  await backupAfterImport(db, BACKUP_DIR);
  const latest = await db.auditEvent.findFirst({
    where: { kind: "import" },
    orderBy: { createdAt: "desc" },
  });
  return latest?.id ?? null;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "The upload could not be processed.";
}

export async function exportBackupAction(): Promise<void> {
  await exportFullBackup(db, BACKUP_DIR);
  revalidatePath("/data-center");
  redirect(dataCenterUrl({ backedUp: "1" }));
}

export async function restoreBackupAction(form: FormData): Promise<void> {
  const backupPath = text(form, "backupPath");
  const force = text(form, "force") === "1";

  if (backupPath.trim() === "") {
    redirect(dataCenterUrl({ error: "Choose a backup to restore." }));
  }

  const result = await restoreFullBackup(db, backupPath, SAFETY_BACKUP_DIR, { force });

  if (result.status === "conflict") {
    redirect(
      dataCenterUrl({
        conflictBackup: backupPath,
        conflictReason: result.conflict?.reason ?? "",
        safetyBackup: result.safetyBackupPath,
      }),
    );
  }

  revalidatePath("/", "layout");
  redirect(dataCenterUrl({ restored: "1", safetyBackup: result.safetyBackupPath }));
}
