import { roundHalfToEven } from "./money";
import { insufficient, ok, type Computed } from "./result";

/**
 * IM-06 Scenario Engine domain math (v1.1, `docs/21_INTELLIGENCE_MASTER_PLAN.md`).
 *
 * These are genuinely new calculations — nothing elsewhere in the engine
 * projects a future value or amortizes a loan — but they follow the same
 * rules as every other function here: integer minor units in, a rounded
 * integer minor-unit (or bounded count) out, and an explicit
 * `insufficient-data` result rather than a guess when the inputs cannot
 * support the math. Every growth-rate input is expected to come from an
 * *observed* figure computed elsewhere (e.g. `computeCagr` over real
 * history) — this file never invents a market-return assumption of its
 * own; the caller supplies one and it is always retained alongside the
 * result (`Insight.calculationBasis`, `ScenarioResult.assumptions`).
 */

export interface FutureValueInput {
  readonly openingMinorUnits: number;
  readonly monthlyContributionMinorUnits: number;
  /** Annual, e.g. 0.12 for 12%/year. Supplied by the caller — never invented here. */
  readonly annualGrowthRatio: number;
  readonly months: number;
}

/**
 * Future value of a lump sum plus a level monthly contribution, compounded
 * monthly at the equivalent monthly rate of `annualGrowthRatio`.
 *
 * Standard annuity-with-lump-sum formula:
 * FV = PV·(1+r)^n + PMT·(((1+r)^n − 1) / r), r the monthly rate.
 */
export function projectFutureValue(input: FutureValueInput): Computed<number> {
  const { openingMinorUnits, monthlyContributionMinorUnits, annualGrowthRatio, months } = input;

  if (months <= 0) {
    return insufficient("the projection horizon must be a positive number of months");
  }
  if (annualGrowthRatio <= -1) {
    return insufficient("an annual growth ratio of -100% or below makes compounding undefined");
  }

  const monthlyRate = Math.pow(1 + annualGrowthRatio, 1 / 12) - 1;
  const growthFactor = Math.pow(1 + monthlyRate, months);

  const futureValue =
    monthlyRate === 0
      ? openingMinorUnits + monthlyContributionMinorUnits * months
      : openingMinorUnits * growthFactor +
        monthlyContributionMinorUnits * ((growthFactor - 1) / monthlyRate);

  if (!Number.isFinite(futureValue)) {
    return insufficient("the projection did not produce a finite result");
  }
  return ok(roundHalfToEven(futureValue));
}

/** Upper bound on how far `monthsUntilTarget` will search — a search limit, not a claim about the future. */
export const PROJECTION_SEARCH_LIMIT_MONTHS = 600;

/**
 * How many whole months, compounding monthly at `annualGrowthRatio`, until
 * a lump sum plus level monthly contributions first reaches `targetMinorUnits`.
 *
 * A bounded month-by-month walk rather than a closed-form solve, so the
 * same compounding this file uses everywhere else is exactly what is
 * being searched over.
 */
export function monthsUntilTarget(
  openingMinorUnits: number,
  monthlyContributionMinorUnits: number,
  annualGrowthRatio: number,
  targetMinorUnits: number,
  maxMonths: number = PROJECTION_SEARCH_LIMIT_MONTHS,
): Computed<number> {
  if (targetMinorUnits <= 0) {
    return insufficient("the target must be a positive amount");
  }
  if (openingMinorUnits >= targetMinorUnits) return ok(0);
  if (annualGrowthRatio <= -1) {
    return insufficient("an annual growth ratio of -100% or below makes compounding undefined");
  }
  if (monthlyContributionMinorUnits <= 0 && annualGrowthRatio <= 0) {
    return insufficient("with no positive contribution and no positive growth, the target is never reached");
  }

  const monthlyRate = Math.pow(1 + annualGrowthRatio, 1 / 12) - 1;
  let balance = openingMinorUnits;
  let months = 0;
  while (balance < targetMinorUnits && months < maxMonths) {
    balance = balance * (1 + monthlyRate) + monthlyContributionMinorUnits;
    months += 1;
  }

  if (balance < targetMinorUnits) {
    return insufficient(
      `the target is not reached within ${maxMonths} months at this contribution and growth rate`,
    );
  }
  return ok(months);
}

export interface DebtAmortizationResult {
  readonly monthsToPayoff: number;
  readonly totalInterestMinorUnits: number;
}

/** Upper bound on how many months `simulateDebtPrepayment` will amortize over — a search limit, not a claim. */
export const AMORTIZATION_SEARCH_LIMIT_MONTHS = 1_200;

/**
 * Amortizes an outstanding balance at a fixed monthly payment (EMI plus any
 * hypothetical prepayment), reducing-balance, no invented fees or rate
 * changes.
 *
 * Refuses rather than looping forever when the payment does not even cover
 * the first month's interest — such a balance never reduces to zero.
 */
export function simulateDebtPrepayment(
  outstandingMinorUnits: number,
  annualInterestRateBps: number,
  monthlyPaymentMinorUnits: number,
): Computed<DebtAmortizationResult> {
  if (outstandingMinorUnits <= 0) {
    return insufficient("no outstanding balance to amortize");
  }
  if (monthlyPaymentMinorUnits <= 0) {
    return insufficient("the monthly payment must be a positive amount");
  }

  const monthlyRate = annualInterestRateBps / 10_000 / 12;
  const firstMonthInterest = outstandingMinorUnits * monthlyRate;
  if (monthlyPaymentMinorUnits <= firstMonthInterest) {
    return insufficient(
      "the monthly payment does not cover the first month's interest; the balance would never reduce to zero",
    );
  }

  let balance = outstandingMinorUnits;
  let totalInterestMinorUnits = 0;
  let months = 0;
  while (balance > 0 && months < AMORTIZATION_SEARCH_LIMIT_MONTHS) {
    const interest = balance * monthlyRate;
    totalInterestMinorUnits += interest;
    const principalPortion = monthlyPaymentMinorUnits - interest;
    balance -= principalPortion;
    months += 1;
  }

  if (balance > 0) {
    return insufficient(`payoff was not reached within ${AMORTIZATION_SEARCH_LIMIT_MONTHS} months at this payment`);
  }

  return ok({ monthsToPayoff: months, totalInterestMinorUnits: roundHalfToEven(totalInterestMinorUnits) });
}
