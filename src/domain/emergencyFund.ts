import { insufficient, ok, type Computed } from "./result";
import { safeRatio } from "./money";

/**
 * Emergency Fund target & runway (resolves D-017, `docs/19_OPEN_DECISIONS.md`).
 *
 * D-017 blocked this on the lack of an essential/discretionary expense
 * split anywhere in the data model. The account owner has since supplied
 * an explicit definition rather than one being invented here: essential
 * spending, for this purpose, is a month's total expenses plus EMIs
 * (`MonthlyBudget.committedOutflowMinorUnits`, already computed by
 * `summarizeMonth` — nothing new is calculated, this module only applies
 * the owner's stated 6-month multiple and states insufficiency when that
 * figure isn't available).
 */

export const EMERGENCY_FUND_TARGET_MONTHS = 6;

/** 6 × the latest complete month's essential spending — the owner's own stated target. */
export function computeEmergencyFundTargetMinorUnits(
  monthlyEssentialSpendMinorUnits: number,
): number {
  return Math.round(monthlyEssentialSpendMinorUnits * EMERGENCY_FUND_TARGET_MONTHS);
}

/** Current balance ÷ monthly essential spend. Insufficient when essential spend is unknown or zero. */
export function computeEmergencyFundRunwayMonths(
  currentBalanceMinorUnits: number,
  monthlyEssentialSpendMinorUnits: number,
): Computed<number> {
  if (monthlyEssentialSpendMinorUnits <= 0) {
    return insufficient(
      "no essential spending (expenses + EMIs) is recorded for the latest complete month",
    );
  }
  const ratio = safeRatio(currentBalanceMinorUnits, monthlyEssentialSpendMinorUnits);
  if (ratio === null) {
    return insufficient(
      "no essential spending (expenses + EMIs) is recorded for the latest complete month",
    );
  }
  return ok(ratio);
}

export interface EmergencyFundTopUpValidation {
  readonly allowed: boolean;
  readonly reason: string | null;
}

/**
 * Deliberately carries no leftover-cash cap, unlike `canAllocateToGoal` —
 * the account owner explicitly asked for a manual, uncapped Emergency Fund
 * top-up distinct from the ordinary "allocate leftover cash to a goal"
 * flow's safety check, so they can record a top-up regardless of whether a
 * given month's budget has been imported yet.
 */
export function validateEmergencyFundTopUp(amountMinorUnits: number): EmergencyFundTopUpValidation {
  if (!Number.isFinite(amountMinorUnits) || amountMinorUnits <= 0) {
    return { allowed: false, reason: "top-up amount must be greater than zero" };
  }
  return { allowed: true, reason: null };
}
