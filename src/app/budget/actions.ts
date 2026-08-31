"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";
import { loadGoals } from "../../data/loaders";
import { canAllocateToGoal } from "../../domain";
import { parseRupees } from "../../presentation/parse";
import { getBudgetView } from "../../views/budgetView";
import { listPeriods } from "../../views/context";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * docs/04_USER_FLOWS.md, "Allocate leftover cash to a goal": records a goal
 * contribution as one atomic Activity, after `canAllocateToGoal` confirms
 * the amount is positive, does not exceed what is left of the period's
 * unallocated cash once earlier allocations are accounted for, and the goal
 * is still accepting contributions (not achieved/cancelled — the
 * emergency-fund protection this check also enforces applies to
 * *withdrawals*, not contributions, so it never blocks this flow).
 *
 * This is the only place in the app that writes an Activity directly rather
 * than through ingestion — the goal's balance is, as everywhere else,
 * derived from summing these rows, never stored as its own number.
 */
export async function allocateToGoalAction(form: FormData): Promise<void> {
  const periodMonth = text(form, "periodMonth");
  const goalId = text(form, "goalId");
  const amountRaw = text(form, "amount");

  const fail = (message: string): never => {
    redirect(`/budget?period=${encodeURIComponent(periodMonth)}&allocationError=${encodeURIComponent(message)}`);
  };

  if (goalId === "") fail("No goal was selected.");

  const parsedAmount = parseRupees(amountRaw);
  if (parsedAmount.kind !== "ok") fail(parsedAmount.reasons.join("; "));
  const amountMinorUnits = (parsedAmount as { kind: "ok"; value: number }).value;

  const periods = await listPeriods(db);
  const view = await getBudgetView(db, periodMonth, periods);
  if (view.summary.kind !== "ok") {
    fail(`Cannot allocate: ${view.summary.reasons.join("; ")}`);
  }
  if (view.remainingToAllocateMinorUnits.kind !== "ok") {
    fail(`Cannot allocate: ${view.remainingToAllocateMinorUnits.reasons.join("; ")}`);
  }
  const remaining = (view.remainingToAllocateMinorUnits as { kind: "ok"; value: number }).value;

  const goals = await loadGoals(db);
  const goal = goals.find((g) => g.id === goalId);
  if (goal === undefined) fail("That goal no longer exists.");

  const check = canAllocateToGoal(goal as NonNullable<typeof goal>, amountMinorUnits, remaining);
  if (!check.allowed) fail(check.reason ?? "That allocation is not allowed.");

  await db.activity.create({
    data: {
      kind: "goal_contribution",
      goalId,
      amountMinorUnits,
      occurredOn: new Date(),
      trustState: "verified",
    },
  });

  revalidatePath("/budget");
  revalidatePath("/goals");
  revalidatePath("/");
  redirect(`/budget?period=${encodeURIComponent(periodMonth)}&allocated=1`);
}
