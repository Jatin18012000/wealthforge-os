import { addMonthsClamped } from "./dates";
import { bpsToRatio, roundHalfToEven, safeRatio, sumMinorUnits } from "./money";
import { insufficient, ok, type Computed } from "./result";
import { isTrusted } from "./trust";

export interface PayerSplitInput {
  readonly payerName: string;
  readonly shareBps: number;
  readonly effectiveFrom: Date;
}

export interface LiabilityDetail {
  readonly id: string;
  readonly name: string;
  readonly principalMinorUnits: number;
  readonly outstandingMinorUnits: number;
  readonly outstandingAsOf: Date;
  readonly emiAmountMinorUnits: number;
  readonly tenureMonths: number;
  readonly interestRateBps: number;
  readonly payerSplits: readonly PayerSplitInput[];
}

export interface EmiPaymentInput {
  readonly id: string;
  readonly liabilityId: string;
  readonly amountMinorUnits: number;
  readonly occurredOn: Date;
  readonly trustState: string;
}

export interface PayerShare {
  readonly payerName: string;
  readonly shareBps: number;
  readonly shareMinorUnits: number;
}

/**
 * Splits an EMI across its payers.
 *
 * Requires the splits in effect at `asOf` to sum to exactly 10000 bps.
 * A split that doesn't total 100% means either an unrecorded payer or a
 * data-entry error; either way the per-payer burden would be wrong, so the
 * engine refuses rather than normalizing the numbers into looking correct.
 *
 * The final payer absorbs the rounding remainder so the shares always sum
 * back to the exact EMI — otherwise the parts would not equal the whole.
 */
export function splitEmiByPayer(
  liability: LiabilityDetail,
  asOf: Date,
): Computed<readonly PayerShare[]> {
  const effective = liability.payerSplits.filter(
    (split) => split.effectiveFrom.getTime() <= asOf.getTime(),
  );

  if (effective.length === 0) {
    return insufficient(
      `no payer split for "${liability.name}" is in effect on ${asOf.toISOString().slice(0, 10)}`,
    );
  }

  const totalBps = effective.reduce((sum, split) => sum + split.shareBps, 0);
  if (totalBps !== 10_000) {
    return insufficient(
      `payer shares for "${liability.name}" total ${totalBps} bps, not 10000; the split is incomplete or incorrect`,
    );
  }

  const shares: PayerShare[] = [];
  let allocated = 0;

  effective.forEach((split, index) => {
    const isLast = index === effective.length - 1;
    const shareMinorUnits = isLast
      ? liability.emiAmountMinorUnits - allocated
      : roundHalfToEven(liability.emiAmountMinorUnits * bpsToRatio(split.shareBps));
    allocated += shareMinorUnits;
    shares.push({ payerName: split.payerName, shareBps: split.shareBps, shareMinorUnits });
  });

  return ok(shares);
}

/**
 * A payer's EMI burden as a share of their take-home income.
 * Uses actual payer responsibility, not the headline household EMI
 * (docs/07, "EMI burden & release").
 */
export function emiBurdenForPayer(
  liabilities: readonly LiabilityDetail[],
  payerName: string,
  takeHomeMinorUnits: number,
  asOf: Date,
): Computed<{ readonly totalShareMinorUnits: number; readonly burdenRatio: number }> {
  const shares: number[] = [];
  const problems: string[] = [];

  for (const liability of liabilities) {
    const split = splitEmiByPayer(liability, asOf);
    if (split.kind !== "ok") {
      problems.push(...split.reasons);
      continue;
    }
    for (const share of split.value) {
      if (share.payerName === payerName) shares.push(share.shareMinorUnits);
    }
  }

  if (problems.length > 0) {
    // A partial burden figure computed while ignoring a broken split would
    // understate what this payer actually owes.
    return insufficient(...problems);
  }
  if (shares.length === 0) {
    return insufficient(`"${payerName}" has no EMI share in any liability as of the requested date`);
  }

  const totalShareMinorUnits = sumMinorUnits(shares);
  const burdenRatio = safeRatio(totalShareMinorUnits, takeHomeMinorUnits);
  if (burdenRatio === null) {
    return insufficient(
      `take-home income is zero; EMI burden as a share of income is undefined for "${payerName}"`,
    );
  }

  return ok({ totalShareMinorUnits, burdenRatio });
}

export interface ReleaseSchedule {
  readonly liabilityId: string;
  readonly paymentsMade: number;
  readonly paymentsRemaining: number;
  readonly projectedFinalPayment: Date;
  /**
   * True when the projection rests on the recorded tenure rather than on a
   * complete payment history — the date is a schedule, not an observation.
   */
  readonly fromScheduleOnly: boolean;
}

/**
 * Projects when a liability's EMI obligation ends.
 *
 * Uses confirmed payment activity where available. With no payment history
 * the projection falls back to the recorded tenure and is explicitly marked
 * `fromScheduleOnly`, so a scheduled date is never presented as an
 * observed one.
 */
export function projectEmiRelease(
  liability: LiabilityDetail,
  payments: readonly EmiPaymentInput[],
  asOf: Date,
): Computed<ReleaseSchedule> {
  if (liability.tenureMonths <= 0) {
    return insufficient(
      `"${liability.name}" has no recorded tenure; a release date cannot be projected`,
    );
  }

  const confirmed = payments.filter(
    (payment) =>
      payment.liabilityId === liability.id &&
      isTrusted(payment.trustState) &&
      payment.occurredOn.getTime() <= asOf.getTime(),
  );

  const paymentsMade = confirmed.length;
  const paymentsRemaining = Math.max(liability.tenureMonths - paymentsMade, 0);

  const projectedFinalPayment = addMonthsClamped(asOf, paymentsRemaining);

  return ok({
    liabilityId: liability.id,
    paymentsMade,
    paymentsRemaining,
    projectedFinalPayment,
    fromScheduleOnly: paymentsMade === 0,
  });
}
