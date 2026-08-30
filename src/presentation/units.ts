import type { AdjustmentUnit } from "../domain";
import { formatMoney, formatMoneySigned, formatQuantity } from "./format";

/**
 * Displays a value in the unit it is actually measured in.
 *
 * A quantity is not money and basis points are not rupees; rendering any of
 * them with a ₹ sign would misstate what the number is.
 */
export function formatUnitValue(value: number, unit: AdjustmentUnit): string {
  switch (unit) {
    case "money":
      return formatMoney(value);
    case "quantity":
      return formatQuantity(value);
    case "count":
      return String(value);
    case "bps":
      return `${(value / 100).toFixed(2)}%`;
  }
}

export function formatUnitValueSigned(value: number, unit: AdjustmentUnit): string {
  if (unit === "money") return formatMoneySigned(value);

  const formatted = formatUnitValue(Math.abs(value), unit);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

/** How the input box should be labelled, so the user knows what they are typing. */
export function entryUnitHint(unit: AdjustmentUnit): string {
  switch (unit) {
    case "money":
      return "rupees";
    case "quantity":
      return "units, shares or grams";
    case "count":
      return "whole months";
    case "bps":
      return "percent of the instalment";
  }
}
