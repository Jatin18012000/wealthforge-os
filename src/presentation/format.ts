/**
 * The presentation boundary: the ONLY place minor units become displayed
 * rupees.
 *
 * Rounding happens exactly once, here, at the moment of display — never in
 * the engine and never accumulated across intermediate values
 * (docs/07_FINANCIAL_CALCULATIONS.md, "Rounding & currency handling").
 * Components import these helpers; they never divide by 100 themselves.
 */

const RUPEE_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const RUPEE_FORMATTER_PAISE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const QUANTITY_FORMATTER = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 4,
});

/** Whole rupees, Indian digit grouping. The default for headline figures. */
export function formatMoney(minorUnits: number): string {
  return RUPEE_FORMATTER.format(minorUnits / 100);
}

/** Rupees and paise, for figures where the exact amount matters. */
export function formatMoneyExact(minorUnits: number): string {
  return RUPEE_FORMATTER_PAISE.format(minorUnits / 100);
}

/** Signed, for variances and gains where direction is the point. */
export function formatMoneySigned(minorUnits: number): string {
  const formatted = formatMoney(Math.abs(minorUnits));
  if (minorUnits > 0) return `+${formatted}`;
  if (minorUnits < 0) return `−${formatted}`;
  return formatted;
}

/** A ratio (0.25) as a percentage ("25.0%"). */
export function formatRatio(ratio: number): string {
  return PERCENT_FORMATTER.format(ratio);
}

export function formatRatioSigned(ratio: number): string {
  const formatted = PERCENT_FORMATTER.format(Math.abs(ratio));
  if (ratio > 0) return `+${formatted}`;
  if (ratio < 0) return `−${formatted}`;
  return formatted;
}

/** Units, shares or grams — a count, never a currency. */
export function formatQuantity(quantity: number): string {
  return QUANTITY_FORMATTER.format(quantity);
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "2026-08" → "August 2026".
 *
 * An unparseable period is passed through verbatim rather than run through
 * Date, which would render the literal string "Invalid Date" on screen —
 * worse than showing the raw value, because it hides what the data said.
 */
export function formatPeriodMonth(periodMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (match === null) return periodMonth;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return periodMonth;

  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * How old a price is, in words.
 *
 * Never says "live" — the sources this app reads are dated closing prices,
 * and implying otherwise would be exactly the misrepresentation
 * docs/18_FAILURE_MODES.md warns about under "stale price".
 */
export function formatPriceAge(days: number): string {
  if (days <= 0) return "same day";
  if (days === 1) return "1 day old";
  return `${days} days old`;
}

/** Human-readable trust state, for the badge shown beside untrusted records. */
export function formatTrustState(trustState: string): string {
  switch (trustState) {
    case "validated":
      return "Validated";
    case "verified":
      return "Verified";
    case "needs_review":
      return "Needs review";
    case "extracted":
      return "Not yet validated";
    case "rejected":
      return "Rejected";
    case "superseded":
      return "Superseded";
    default:
      return trustState;
  }
}
