"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateEmergencyFundTopUp } from "../../domain";
import { db } from "../../lib/db";
import { parseRupees } from "../../presentation/parse";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function fail(message: string): never {
  redirect(`/goals?error=${encodeURIComponent(message)}`);
}

/**
 * Creates the household's single Emergency Fund goal, if one doesn't
 * already exist. There is no general "create any goal" feature — every
 * other goal still only enters the system via import — this is narrowly
 * scoped to the one goal kind the app treats specially
 * (`isProtectedGoal`, `docs/19_OPEN_DECISIONS.md` D-017) and for which no
 * creation path exists at all otherwise.
 */
export async function createEmergencyFundGoalAction(form: FormData): Promise<void> {
  const existing = await db.goal.findFirst({ where: { kind: "emergency_fund" } });
  if (existing !== null) fail("An Emergency Fund goal already exists.");

  const parsedTarget = parseRupees(text(form, "targetAmount"));
  if (parsedTarget.kind !== "ok") fail(parsedTarget.reasons.join("; "));
  const targetAmountMinorUnits = (parsedTarget as { kind: "ok"; value: number }).value;
  if (targetAmountMinorUnits <= 0) fail("Target amount must be greater than zero.");

  const maxPriority = await db.goal.aggregate({ _max: { priorityRank: true } });
  const priorityRank = (maxPriority._max.priorityRank ?? 0) + 1;

  await db.goal.create({
    data: {
      name: "Emergency Fund",
      kind: "emergency_fund",
      targetAmountMinorUnits,
      priorityRank,
      lifecycleState: "in_progress",
    },
  });

  revalidatePath("/goals");
  revalidatePath("/");
  redirect("/goals?created=1");
}

/**
 * A manual, uncapped Emergency Fund top-up — deliberately distinct from
 * the Budget screen's "allocate leftover cash to a goal" flow, which caps
 * a contribution at that period's actual computed leftover cash. The
 * account owner asked for a way to record a top-up of any amount,
 * independent of whether a given month's budget has been imported yet.
 * Recorded the same way every goal balance is: as one `goal_contribution`
 * Activity, never a separately-stored total.
 */
export async function topUpEmergencyFundAction(form: FormData): Promise<void> {
  const goal = await db.goal.findFirst({ where: { kind: "emergency_fund" } });
  if (goal === null) fail("No Emergency Fund goal exists yet — create one first.");
  if (goal.lifecycleState === "cancelled" || goal.lifecycleState === "achieved") {
    fail(`The Emergency Fund goal is ${goal.lifecycleState} and does not accept new contributions.`);
  }

  const parsedAmount = parseRupees(text(form, "amount"));
  if (parsedAmount.kind !== "ok") fail(parsedAmount.reasons.join("; "));
  const amountMinorUnits = (parsedAmount as { kind: "ok"; value: number }).value;

  const check = validateEmergencyFundTopUp(amountMinorUnits);
  if (!check.allowed) fail(check.reason ?? "That top-up is not allowed.");

  await db.activity.create({
    data: {
      kind: "goal_contribution",
      goalId: goal.id,
      amountMinorUnits,
      occurredOn: new Date(),
      trustState: "verified",
    },
  });

  revalidatePath("/goals");
  revalidatePath("/");
  redirect("/goals?toppedUp=1");
}
