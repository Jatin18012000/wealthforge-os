/**
 * Money handling. Every monetary value in the engine is an integer number
 * of minor units (paise). Floating-point rupees never appear in a stored or
 * computed amount — only at the presentation boundary
 * (docs/07_FINANCIAL_CALCULATIONS.md, "Rounding & currency handling").
 */

/** Rupees to integer paise. For converting literals and user input only. */
export function rupeesToMinorUnits(rupees: number): number {
  return roundHalfToEven(rupees * 100);
}

/** Integer paise to a rupee number. Presentation only — never feed this back into arithmetic. */
export function minorUnitsToRupees(minorUnits: number): number {
  return minorUnits / 100;
}

/**
 * Banker's rounding (round-half-to-even).
 *
 * Applied once per derived amount, never to intermediate values in a sum —
 * rounding intermediates accumulates a bias that shows up as rupees of
 * drift across a year of records. Half-to-even rather than half-up because
 * half-up biases every tie upward, which compounds in the same direction.
 */
export function roundHalfToEven(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot round a non-finite value: ${String(value)}`);
  }

  const floor = Math.floor(value);
  const diff = value - floor;

  // Guard against binary-float noise like 0.49999999999999994 being treated
  // as a genuine tie.
  const EPSILON = 1e-9;
  if (Math.abs(diff - 0.5) < EPSILON) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(value);
}

/** Sums minor units exactly. Integer addition — no rounding needed or applied. */
export function sumMinorUnits(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Minor-unit amounts must be safe integers, received: ${String(value)}`);
    }
    total += value;
  }
  return total;
}

/**
 * Multiplies a minor-unit price by a fractional quantity (mutual fund units,
 * grams of gold), rounding the single final result.
 */
export function multiplyMinorUnits(priceMinorUnits: number, quantity: number): number {
  return roundHalfToEven(priceMinorUnits * quantity);
}

/**
 * A ratio in 0..1, or null when the denominator is zero.
 *
 * Returns null rather than 0, Infinity, or NaN: "0% of nothing" is not a
 * meaningful rate, and callers must decide how to present the absence
 * rather than inheriting a misleading number.
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

/** Basis points (1/100th of a percent) to a ratio. 10000 bps === 1.0. */
export function bpsToRatio(bps: number): number {
  return bps / 10_000;
}
