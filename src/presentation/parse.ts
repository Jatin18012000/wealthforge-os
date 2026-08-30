import {
  insufficient,
  ok,
  roundHalfToEven,
  rupeesToMinorUnits,
  type AdjustmentUnit,
  type Computed,
} from "../domain";

/**
 * The input boundary: the ONLY place typed text becomes a number the engine
 * will store.
 *
 * It is the mirror of `format.ts`. Rupees entered by a person become integer
 * paise here and nowhere else, exactly as paise become rupees for display
 * there and nowhere else — so no other module has to know which side of the
 * boundary it is on.
 */

/** Strips grouping separators and the currency symbol a copy-paste brings along. */
function clean(raw: string): string {
  return raw.replace(/[,\s₹]/g, "").trim();
}

function toNumber(raw: string): Computed<number> {
  const cleaned = clean(raw);
  if (cleaned === "") return insufficient("enter a value");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) {
    return insufficient(`"${raw.trim()}" is not a number`);
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return insufficient(`"${raw.trim()}" is not a number`);
  return ok(value);
}

/**
 * Rupees (possibly with paise) to integer minor units.
 *
 * More than two decimal places is rejected rather than rounded: silently
 * turning ₹100.005 into ₹100.00 changes a figure the user typed, and they
 * are entitled to know that rather than discover it in a total later.
 */
export function parseRupees(raw: string): Computed<number> {
  const parsed = toNumber(raw);
  if (parsed.kind !== "ok") return parsed;

  const decimals = clean(raw).split(".")[1];
  if (decimals !== undefined && decimals.length > 2) {
    return insufficient("rupees take at most two decimal places (paise)");
  }
  return ok(rupeesToMinorUnits(parsed.value));
}

/** Units, shares or grams. Fractional by nature — mutual fund units are not integers. */
export function parseQuantity(raw: string): Computed<number> {
  return toNumber(raw);
}

/** A whole count, such as months of tenure. */
export function parseCount(raw: string): Computed<number> {
  const parsed = toNumber(raw);
  if (parsed.kind !== "ok") return parsed;
  if (!Number.isInteger(parsed.value)) return insufficient("enter a whole number");
  return ok(parsed.value);
}

/**
 * A percentage to basis points ("62.5" → 6250).
 *
 * Shares are entered the way people say them and stored the way the engine
 * needs them; two decimal places of a percent is exactly one basis point, so
 * nothing is lost.
 */
export function parsePercentAsBps(raw: string): Computed<number> {
  const parsed = toNumber(raw);
  if (parsed.kind !== "ok") return parsed;

  const decimals = clean(raw).split(".")[1];
  if (decimals !== undefined && decimals.length > 2) {
    return insufficient("a share takes at most two decimal places of a percent");
  }
  return ok(roundHalfToEven(parsed.value * 100));
}

export function parseEntryValue(raw: string, unit: AdjustmentUnit): Computed<number> {
  switch (unit) {
    case "money":
      return parseRupees(raw);
    case "quantity":
      return parseQuantity(raw);
    case "count":
      return parseCount(raw);
    case "bps":
      return parsePercentAsBps(raw);
  }
}

/** What to put in the input box so the user edits the current figure, not a blank. */
export function entryValueString(value: number | null, unit: AdjustmentUnit): string {
  if (value === null) return "";
  switch (unit) {
    case "money":
      return (value / 100).toFixed(2);
    case "quantity":
      return String(value);
    case "count":
      return String(value);
    case "bps":
      return (value / 100).toFixed(2);
  }
}
