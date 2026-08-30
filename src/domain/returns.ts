import { insufficient, ok, type Computed } from "./result";

/**
 * Minimum period for an annualized return to mean anything.
 *
 * Annualizing a very short window amplifies ordinary noise into an absurd
 * headline — a 2% move over four days annualizes past 500%. The engine
 * refuses rather than publishing a figure that is arithmetically correct
 * and financially meaningless (docs/07, "CAGR / XIRR").
 */
export const MIN_ANNUALIZATION_DAYS = 90;

const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 86_400_000;

export interface CagrInput {
  readonly beginValueMinorUnits: number;
  readonly endValueMinorUnits: number;
  readonly beginDate: Date;
  readonly endDate: Date;
}

/**
 * Compound annual growth rate, as a ratio (0.12 === 12% a year).
 *
 * Refuses rather than approximating when the inputs cannot support the
 * calculation: a non-positive starting value has no growth ratio, and a
 * window shorter than `MIN_ANNUALIZATION_DAYS` cannot be annualized
 * responsibly.
 */
export function computeCagr(input: CagrInput): Computed<number> {
  const { beginValueMinorUnits, endValueMinorUnits, beginDate, endDate } = input;

  if (beginValueMinorUnits <= 0) {
    return insufficient(
      "CAGR is undefined for a starting value of zero or less; there is no base to compound from",
    );
  }
  if (endValueMinorUnits < 0) {
    return insufficient("CAGR is undefined for a negative ending value");
  }

  const days = (endDate.getTime() - beginDate.getTime()) / MS_PER_DAY;
  if (days <= 0) {
    return insufficient("the end date must be after the start date");
  }
  if (days < MIN_ANNUALIZATION_DAYS) {
    return insufficient(
      `only ${Math.floor(days)} days of history; at least ${MIN_ANNUALIZATION_DAYS} are required before a return can be annualized`,
    );
  }

  const years = days / DAYS_PER_YEAR;
  const growth = endValueMinorUnits / beginValueMinorUnits;
  const cagr = Math.pow(growth, 1 / years) - 1;

  /* c8 ignore next 3 -- guarded by the checks above; a final safety net */
  if (!Number.isFinite(cagr)) {
    return insufficient("the CAGR calculation did not produce a finite result");
  }

  return ok(cagr);
}

export interface CashFlow {
  /** Negative for money paid in, positive for money received or current value. */
  readonly amountMinorUnits: number;
  readonly date: Date;
}

/** Net present value of a set of dated cash flows at a given annual rate. */
export function netPresentValue(flows: readonly CashFlow[], rate: number, from: Date): number {
  let npv = 0;
  for (const flow of flows) {
    const years = (flow.date.getTime() - from.getTime()) / MS_PER_DAY / DAYS_PER_YEAR;
    npv += flow.amountMinorUnits / Math.pow(1 + rate, years);
  }
  return npv;
}

function npvDerivative(flows: readonly CashFlow[], rate: number, from: Date): number {
  let derivative = 0;
  for (const flow of flows) {
    const years = (flow.date.getTime() - from.getTime()) / MS_PER_DAY / DAYS_PER_YEAR;
    derivative += (-years * flow.amountMinorUnits) / Math.pow(1 + rate, years + 1);
  }
  return derivative;
}

const NEWTON_MAX_ITERATIONS = 100;
const BISECTION_MAX_ITERATIONS = 200;
const CONVERGENCE_TOLERANCE = 1e-7;

/**
 * Extended internal rate of return over irregularly-dated cash flows, as an
 * annual ratio.
 *
 * Newton-Raphson first, falling back to bisection when Newton wanders (it
 * can, on irregular flow patterns). If neither converges the engine returns
 * insufficient-data — it never falls back to an approximation, a nearby
 * rate, or a simple return dressed up as an XIRR.
 *
 * Requires at least one negative and one positive flow: without money going
 * both in and out there is no rate to solve for.
 */
export function computeXirr(flows: readonly CashFlow[]): Computed<number> {
  if (flows.length < 2) {
    return insufficient("XIRR needs at least two dated cash flows");
  }

  const hasOutflow = flows.some((flow) => flow.amountMinorUnits < 0);
  const hasInflow = flows.some((flow) => flow.amountMinorUnits > 0);
  if (!hasOutflow || !hasInflow) {
    return insufficient(
      "XIRR needs both a negative and a positive cash flow; with money moving only one way there is no rate of return to solve for",
    );
  }

  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  /* c8 ignore next -- length >= 2 is guaranteed above */
  if (first === undefined || last === undefined) return insufficient("no cash flows");

  const spanDays = (last.date.getTime() - first.date.getTime()) / MS_PER_DAY;
  if (spanDays < MIN_ANNUALIZATION_DAYS) {
    return insufficient(
      `cash flows span only ${Math.floor(spanDays)} days; at least ${MIN_ANNUALIZATION_DAYS} are required before a return can be annualized`,
    );
  }

  const from = first.date;

  // Newton-Raphson.
  let rate = 0.1;
  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i += 1) {
    const npv = netPresentValue(sorted, rate, from);
    if (Math.abs(npv) < CONVERGENCE_TOLERANCE) return ok(rate);

    const derivative = npvDerivative(sorted, rate, from);
    if (derivative === 0 || !Number.isFinite(derivative)) break;

    const next = rate - npv / derivative;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < CONVERGENCE_TOLERANCE) return ok(next);
    rate = next;
  }

  // Bisection fallback over a wide but finite bracket.
  let low = -0.9999;
  let high = 10;
  let npvLow = netPresentValue(sorted, low, from);
  let npvHigh = netPresentValue(sorted, high, from);

  if (npvLow * npvHigh > 0) {
    return insufficient(
      "no rate of return could be found for these cash flows within a plausible range (-99.99% to 1000%)",
    );
  }

  for (let i = 0; i < BISECTION_MAX_ITERATIONS; i += 1) {
    const mid = (low + high) / 2;
    const npvMid = netPresentValue(sorted, mid, from);

    if (Math.abs(npvMid) < CONVERGENCE_TOLERANCE || (high - low) / 2 < CONVERGENCE_TOLERANCE) {
      return ok(mid);
    }

    if (npvLow * npvMid < 0) {
      high = mid;
      npvHigh = npvMid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }

  /* c8 ignore next 3 -- 200 bisection steps over this bracket always converge */
  return insufficient(
    "the rate-of-return calculation did not converge; the figure is not reported rather than approximated",
  );
}

export interface ProfitAndLoss {
  readonly costBasisMinorUnits: number;
  readonly currentValueMinorUnits: number;
  readonly absoluteMinorUnits: number;
  readonly ratio: number;
}

/**
 * Profit and loss against a known cost basis.
 *
 * Computed only when acquisition cost is actually known. A position whose
 * cost basis was never recorded returns insufficient-data — inferring a
 * cost from a later price would manufacture a gain or loss that no
 * transaction supports (docs/07, "P&L").
 */
export function computeProfitAndLoss(
  costBasisMinorUnits: number | null,
  currentValueMinorUnits: number,
): Computed<ProfitAndLoss> {
  if (costBasisMinorUnits === null) {
    return insufficient("no recorded cost basis; profit and loss cannot be derived");
  }
  if (costBasisMinorUnits <= 0) {
    return insufficient(
      "recorded cost basis is zero or negative; a profit-and-loss ratio is undefined",
    );
  }

  const absoluteMinorUnits = currentValueMinorUnits - costBasisMinorUnits;
  return ok({
    costBasisMinorUnits,
    currentValueMinorUnits,
    absoluteMinorUnits,
    ratio: absoluteMinorUnits / costBasisMinorUnits,
  });
}
