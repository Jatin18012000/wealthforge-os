"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { backupAfterImport, exportFullBackup, restoreFullBackup } from "../../backup";
import { BACKUP_DIR, SAFETY_BACKUP_DIR } from "../../data/dataCenterStore";
import {
  addMonthsClamped,
  computeEmiAmount,
  computeTenureMonthsBetween,
} from "../../domain";
import { hashBuffer, importBudgetWorkbook, storeUpload } from "../../ingestion";
import { importPortfolioSnapshot } from "../../ingestion/portfolio";
import type { PortfolioAssetClass } from "../../ingestion/portfolio/types";
import { db } from "../../lib/db";
import { parsePercentAsBps, parseRupees } from "../../presentation/parse";

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

// --- Manual record creation & management ------------------------------------
//
// Goals, Liabilities, and Insurance Policies previously had no creation path
// at all outside the initial seed. These forms register a new one of each,
// the same way an import registers a new source document — recorded here,
// then visible on its own screen. A close/delete pair exists for each:
// close (mark inactive) is always available; delete is a hard removal
// permitted only when the record has no payment/contribution history yet,
// so real financial history is never silently discarded.

const GOAL_KINDS = [
  "emergency_fund",
  "car",
  "marriage",
  "third_floor",
  "custom",
] as const;
const LIABILITY_KINDS = ["home_loan", "other"] as const;
const INSURANCE_KINDS = ["health_personal", "health_family", "term", "other"] as const;
const PREMIUM_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;

function fail(message: string): never {
  redirect(dataCenterUrl({ error: message }));
}

function parseOptionalDate(raw: string): Date | null {
  if (raw.trim() === "") return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredMinorUnits(raw: string, label: string): number {
  const parsed = parseRupees(raw);
  if (parsed.kind !== "ok") fail(`${label}: ${parsed.reasons.join("; ")}`);
  return (parsed as { kind: "ok"; value: number }).value;
}

function optionalMinorUnits(raw: string, label: string): number | null {
  if (raw.trim() === "") return null;
  return requiredMinorUnits(raw, label);
}

export async function createGoalAction(form: FormData): Promise<void> {
  const name = text(form, "name").trim();
  if (name === "") fail("Give the goal a name.");

  const kind = text(form, "kind");
  if (!(GOAL_KINDS as readonly string[]).includes(kind)) {
    fail(`"${kind}" is not a recognized goal type.`);
  }
  if (kind === "emergency_fund") {
    const existing = await db.goal.findFirst({ where: { kind: "emergency_fund" } });
    if (existing !== null) {
      fail(
        "An Emergency Fund goal already exists — top it up from the Goals screen instead of creating another.",
      );
    }
  }

  const targetAmountMinorUnits = requiredMinorUnits(
    text(form, "targetAmount"),
    "Target amount",
  );
  if (targetAmountMinorUnits <= 0) fail("Target amount must be greater than zero.");

  const targetDate = parseOptionalDate(text(form, "targetDate"));

  const maxPriority = await db.goal.aggregate({ _max: { priorityRank: true } });
  const priorityRank = (maxPriority._max.priorityRank ?? 0) + 1;

  await db.goal.create({
    data: {
      name,
      kind,
      targetAmountMinorUnits,
      priorityRank,
      lifecycleState: "planned",
      ...(targetDate === null ? {} : { targetDate }),
    },
  });

  revalidatePath("/goals");
  revalidatePath("/");
  redirect(dataCenterUrl({ recordCreated: `Goal "${name}"` }));
}

export async function closeGoalAction(form: FormData): Promise<void> {
  const goalId = text(form, "goalId");
  const goal = await db.goal.findUnique({ where: { id: goalId } });
  if (goal === null) fail("That goal no longer exists.");

  await db.goal.update({ where: { id: goalId }, data: { lifecycleState: "cancelled" } });
  revalidatePath("/goals");
  revalidatePath("/");
  redirect(dataCenterUrl({ recordClosed: goal.name }));
}

export async function deleteGoalAction(form: FormData): Promise<void> {
  const goalId = text(form, "goalId");
  const goal = await db.goal.findUnique({ where: { id: goalId } });
  if (goal === null) fail("That goal no longer exists.");

  const activityCount = await db.activity.count({ where: { goalId } });
  if (activityCount > 0) {
    fail(
      `"${goal.name}" has ${activityCount} recorded contribution(s)/withdrawal(s) — close it instead of deleting, so the history is kept.`,
    );
  }

  await db.goal.delete({ where: { id: goalId } });
  revalidatePath("/goals");
  revalidatePath("/");
  redirect(dataCenterUrl({ recordDeleted: goal.name }));
}

export async function createLiabilityAction(form: FormData): Promise<void> {
  const name = text(form, "name").trim();
  if (name === "") fail("Give the liability a name.");

  const kind = text(form, "kind");
  if (!(LIABILITY_KINDS as readonly string[]).includes(kind)) {
    fail(`"${kind}" is not a recognized liability type.`);
  }

  const totalPriceMinorUnits = requiredMinorUnits(
    text(form, "totalPrice"),
    "Total price",
  );
  if (totalPriceMinorUnits <= 0) fail("Total price must be greater than zero.");

  const amountPaidUpfrontMinorUnits =
    optionalMinorUnits(text(form, "amountPaidUpfront"), "Amount paid upfront") ?? 0;
  if (amountPaidUpfrontMinorUnits < 0) fail("Amount paid upfront cannot be negative.");
  if (amountPaidUpfrontMinorUnits >= totalPriceMinorUnits) {
    fail(
      "Amount paid upfront must be less than the total price — otherwise there is nothing to finance as an EMI.",
    );
  }

  const startDate = parseOptionalDate(text(form, "startDate"));
  const endDate = parseOptionalDate(text(form, "endDate"));
  if (startDate === null || endDate === null)
    fail("Both a start date and an end date are required.");
  if (endDate.getTime() <= startDate.getTime())
    fail("The end date must be after the start date.");

  const interestRateRaw = text(form, "annualInterestRate");
  let interestRateBps = 0;
  if (interestRateRaw.trim() !== "") {
    const parsedRate = parsePercentAsBps(interestRateRaw);
    if (parsedRate.kind !== "ok") fail(`Interest rate: ${parsedRate.reasons.join("; ")}`);
    interestRateBps = (parsedRate as { kind: "ok"; value: number }).value;
  }
  if (interestRateBps < 0) fail("Interest rate cannot be negative.");

  const principalMinorUnits = totalPriceMinorUnits - amountPaidUpfrontMinorUnits;
  const tenureMonths = computeTenureMonthsBetween(startDate, endDate);

  // A monthly amount typed in directly — e.g. copied off a bank
  // statement — is trusted over the computed one: it's the actual figure,
  // while the computed one is only ever an estimate from price/rate/tenure.
  const monthlyEmiRaw = text(form, "monthlyEmiAmount");
  let emiAmountMinorUnits: number;
  if (monthlyEmiRaw.trim() !== "") {
    emiAmountMinorUnits = requiredMinorUnits(monthlyEmiRaw, "Monthly EMI amount");
    if (emiAmountMinorUnits <= 0) fail("Monthly EMI amount must be greater than zero.");
  } else {
    emiAmountMinorUnits = computeEmiAmount(
      principalMinorUnits,
      interestRateBps,
      tenureMonths,
    );
  }

  // Installments already paid before this liability was registered — e.g. a
  // loan running long before it was ever imported here. Never inferred from
  // dates: only counted from what the user states.
  const emisAlreadyPaidRaw = text(form, "emisAlreadyPaid").trim();
  let emisAlreadyPaid = 0;
  if (emisAlreadyPaidRaw !== "") {
    emisAlreadyPaid = Number(emisAlreadyPaidRaw);
    if (!Number.isInteger(emisAlreadyPaid) || emisAlreadyPaid < 0) {
      fail("EMIs already paid must be a whole number, zero or more.");
    }
    if (emisAlreadyPaid > tenureMonths) {
      fail(
        `EMIs already paid (${emisAlreadyPaid}) cannot exceed the ${tenureMonths}-month tenure.`,
      );
    }
  }

  const liability = await db.liability.create({
    data: {
      name,
      kind,
      principalMinorUnits,
      outstandingMinorUnits: principalMinorUnits,
      outstandingAsOf: startDate,
      interestRateBps,
      tenureMonths,
      emiAmountMinorUnits,
    },
  });

  if (emisAlreadyPaid > 0) {
    await db.activity.createMany({
      data: Array.from({ length: emisAlreadyPaid }, (_, i) => ({
        kind: "emi_payment",
        liabilityId: liability.id,
        amountMinorUnits: emiAmountMinorUnits,
        occurredOn: addMonthsClamped(startDate, i),
        trustState: "verified",
      })),
    });
  }

  // Set only when this liability was registered from a detected budget-EMI
  // label (see "Unlinked EMIs" on this screen) — links the label to the new
  // liability and backfills every month already imported under it, so past
  // payments count immediately rather than only future re-imports.
  const linkLabelNormalized = text(form, "linkEmiLabelNormalized").trim();
  if (linkLabelNormalized !== "") {
    await linkEmiLabelToLiability(linkLabelNormalized, liability.id);
  }

  revalidatePath("/liabilities");
  revalidatePath("/data-center");
  revalidatePath("/");
  redirect(
    dataCenterUrl({
      recordCreated: `Liability "${name}" — ${(emiAmountMinorUnits / 100).toFixed(2)}/month for ${tenureMonths} months${
        emisAlreadyPaid > 0 ? ` (${emisAlreadyPaid} already-paid EMI(s) recorded)` : ""
      }`,
    }),
  );
}

/** The first day of a "YYYY-MM" period, UTC — same convention as ingestion's own periodMonthToDate. */
function periodMonthToDate(periodMonth: string): Date {
  const [yearPart, monthPart] = periodMonth.split("-");
  return new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1, 1));
}

/**
 * Links a normalized budget-EMI label to a liability and backfills an
 * `emi_payment` Activity for every currently-effective "emi" plan record
 * already imported under that label — the same records a future re-import
 * of that label would now auto-record against this liability.
 */
async function linkEmiLabelToLiability(
  labelNormalized: string,
  liabilityId: string,
): Promise<void> {
  await db.emiLabelLink.upsert({
    where: { labelNormalized },
    create: { labelNormalized, liabilityId },
    update: { liabilityId },
  });

  const pastRecords = await db.planRecord.findMany({
    where: {
      category: "emi",
      labelNormalized,
      supersededById: null,
      amountMinorUnits: { not: null },
    },
  });

  if (pastRecords.length === 0) return;

  await db.activity.createMany({
    data: pastRecords.map((record) => ({
      kind: "emi_payment",
      liabilityId,
      amountMinorUnits: record.amountMinorUnits as number,
      occurredOn: periodMonthToDate(record.periodMonth),
      sourceDocumentId: record.sourceDocumentId,
      trustState: record.trustState,
    })),
  });
}

export async function linkEmiLabelAction(form: FormData): Promise<void> {
  const labelNormalized = text(form, "labelNormalized").trim();
  if (labelNormalized === "") fail("No EMI label given to link.");

  const liabilityId = text(form, "liabilityId");
  const liability = await db.liability.findUnique({ where: { id: liabilityId } });
  if (liability === null) fail("That liability no longer exists.");
  if (liability.closedAt !== null) {
    fail(`"${liability.name}" is closed and cannot accept a new linked EMI label.`);
  }

  const existingLink = await db.emiLabelLink.findUnique({ where: { labelNormalized } });
  if (existingLink !== null) fail("That EMI label is already linked to a liability.");

  await linkEmiLabelToLiability(labelNormalized, liabilityId);

  revalidatePath("/liabilities");
  revalidatePath("/data-center");
  revalidatePath("/");
  redirect(
    dataCenterUrl({
      recordCreated: `Linked EMI label to "${liability.name}" — past imported months were recorded as payments.`,
    }),
  );
}

export async function closeLiabilityAction(form: FormData): Promise<void> {
  const liabilityId = text(form, "liabilityId");
  const liability = await db.liability.findUnique({ where: { id: liabilityId } });
  if (liability === null) fail("That liability no longer exists.");

  await db.liability.update({
    where: { id: liabilityId },
    data: { closedAt: new Date() },
  });
  revalidatePath("/liabilities");
  revalidatePath("/");
  redirect(dataCenterUrl({ recordClosed: liability.name }));
}

export async function deleteLiabilityAction(form: FormData): Promise<void> {
  const liabilityId = text(form, "liabilityId");
  const liability = await db.liability.findUnique({ where: { id: liabilityId } });
  if (liability === null) fail("That liability no longer exists.");

  const activityCount = await db.activity.count({ where: { liabilityId } });
  if (activityCount > 0) {
    fail(
      `"${liability.name}" has ${activityCount} recorded payment(s) — close it instead of deleting, so the history is kept.`,
    );
  }

  // Payer splits carry no financial history of their own — cascade-deleted
  // with the liability (schema: onDelete: Cascade).
  await db.liability.delete({ where: { id: liabilityId } });
  revalidatePath("/liabilities");
  revalidatePath("/");
  redirect(dataCenterUrl({ recordDeleted: liability.name }));
}

export async function createInsurancePolicyAction(form: FormData): Promise<void> {
  const kind = text(form, "kind");
  if (!(INSURANCE_KINDS as readonly string[]).includes(kind)) {
    fail(`"${kind}" is not a recognized insurance type.`);
  }

  const insuredParty = text(form, "insuredParty").trim();
  if (insuredParty === "") fail("Name who this policy insures.");
  const provider = text(form, "provider").trim();
  if (provider === "") fail("Name the insurance provider.");

  const coverAmountMinorUnits = optionalMinorUnits(
    text(form, "coverAmount"),
    "Cover amount",
  );
  const premiumMinorUnits = optionalMinorUnits(text(form, "premium"), "Premium");

  const premiumFrequencyRaw = text(form, "premiumFrequency");
  let premiumFrequency: string | null = null;
  if (premiumFrequencyRaw !== "") {
    if (!(PREMIUM_FREQUENCIES as readonly string[]).includes(premiumFrequencyRaw)) {
      fail(`"${premiumFrequencyRaw}" is not a recognized premium frequency.`);
    }
    premiumFrequency = premiumFrequencyRaw;
  }

  const effectiveFrom = parseOptionalDate(text(form, "effectiveFrom"));

  await db.insurancePolicy.create({
    data: {
      kind,
      insuredParty,
      provider,
      coverAmountMinorUnits,
      premiumMinorUnits,
      premiumFrequency,
      status: "planned",
      ...(effectiveFrom === null ? {} : { effectiveFrom }),
    },
  });

  revalidatePath("/insurance");
  revalidatePath("/");
  redirect(dataCenterUrl({ recordCreated: `Insurance policy for ${insuredParty}` }));
}

export async function closeInsurancePolicyAction(form: FormData): Promise<void> {
  const policyId = text(form, "policyId");
  const policy = await db.insurancePolicy.findUnique({ where: { id: policyId } });
  if (policy === null) fail("That policy no longer exists.");

  await db.insurancePolicy.update({
    where: { id: policyId },
    data: { status: "cancelled" },
  });
  revalidatePath("/insurance");
  revalidatePath("/");
  redirect(dataCenterUrl({ recordClosed: `${policy.provider} policy` }));
}

export async function deleteInsurancePolicyAction(form: FormData): Promise<void> {
  const policyId = text(form, "policyId");
  const policy = await db.insurancePolicy.findUnique({ where: { id: policyId } });
  if (policy === null) fail("That policy no longer exists.");

  // Insurance policies carry no linked Activity ledger in this schema —
  // there is no payment history a delete could silently discard.
  await db.insurancePolicy.delete({ where: { id: policyId } });
  revalidatePath("/insurance");
  revalidatePath("/");
  redirect(dataCenterUrl({ recordDeleted: `${policy.provider} policy` }));
}
