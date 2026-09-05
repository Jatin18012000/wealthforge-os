"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";
import { parseRupees } from "../../presentation/parse";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function fail(message: string): never {
  redirect(`/liabilities?error=${encodeURIComponent(message)}`);
}

/**
 * A manual, uncapped EMI payment record — the same pattern as
 * `topUpGoalAction`: type any amount, any time, regardless of whether a
 * budget workbook covering this month has been imported. Recorded as one
 * `emi_payment` Activity, the same row type ingestion would create, so
 * every downstream calculation (release schedule, debt freedom meter,
 * milestones) reads it identically either way.
 */
export async function recordEmiPaymentAction(form: FormData): Promise<void> {
  const liabilityId = text(form, "liabilityId");
  const liability = await db.liability.findUnique({ where: { id: liabilityId } });
  if (liability === null) fail("That liability no longer exists.");
  if (liability.closedAt !== null) {
    fail(`"${liability.name}" is closed and does not accept new payments.`);
  }

  const parsedAmount = parseRupees(text(form, "amount"));
  if (parsedAmount.kind !== "ok") fail(parsedAmount.reasons.join("; "));
  const amountMinorUnits = (parsedAmount as { kind: "ok"; value: number }).value;
  if (amountMinorUnits <= 0) fail("Payment amount must be greater than zero.");

  await db.activity.create({
    data: {
      kind: "emi_payment",
      liabilityId: liability.id,
      amountMinorUnits,
      occurredOn: new Date(),
      trustState: "verified",
    },
  });

  revalidatePath("/liabilities");
  revalidatePath("/");
  redirect("/liabilities?paymentRecorded=1");
}
