import { insufficient, ok, type Computed } from "./result";
import { safeRatio } from "./money";

/**
 * Overall Savings Rate (resolves F8's second blocked sub-item,
 * `docs/30_V1_1_1_COMMAND_CENTER_POLISH.md`).
 *
 * A distinct metric from `MonthlyBudget.savingsRate` (retained ÷ income)
 * and `investmentRate` (planned investment ÷ income) already computed in
 * `src/domain/budget.ts` — this one is the account owner's own definition:
 * everything that left the month's income as savings in any form —
 * net stock/mutual-fund/ETF/EPF contributions, net Emergency Fund
 * contributions, and whatever cash was left over unallocated — divided by
 * income. The 25% milestone threshold is the owner's own stated target,
 * not one invented here.
 */

export const OVERALL_SAVINGS_RATE_MILESTONE_RATIO = 0.25;

export interface OverallSavingsRateInput {
  readonly incomeMinorUnits: number;
  /** Net of buys minus sells, for stock/mutual-fund/ETF/EPF instruments only. */
  readonly netInvestmentContributionMinorUnits: number;
  /** Net of contributions minus withdrawals, for the Emergency Fund goal(s) only. */
  readonly netEmergencyFundContributionMinorUnits: number;
  /** Income − expenses − EMIs − planned investments: cash left genuinely unallocated. */
  readonly leftoverCashMinorUnits: number;
}

export function computeOverallSavingsRate(input: OverallSavingsRateInput): Computed<number> {
  if (input.incomeMinorUnits <= 0) {
    return insufficient("no trusted income is recorded for the month");
  }
  const numerator =
    input.netInvestmentContributionMinorUnits +
    input.netEmergencyFundContributionMinorUnits +
    input.leftoverCashMinorUnits;
  const ratio = safeRatio(numerator, input.incomeMinorUnits);
  if (ratio === null) {
    return insufficient("no trusted income is recorded for the month");
  }
  return ok(ratio);
}
