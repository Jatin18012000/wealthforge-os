/**
 * The grounding check: verifies every financial figure an AI response
 * states also appears in the payload it was given, before the response is
 * allowed on screen (docs/12_AI_ANALYST_SPEC.md, "every AI response is
 * checked against the grounding payload... any numeric claim not
 * traceable to the payload is treated as a defect").
 *
 * Scope, stated plainly: this catches fabricated *financial figures* —
 * rupee amounts, percentages, and large bare numbers — which is the
 * specific failure mode this project prohibits (inventing a balance,
 * price, NAV, or return). It is not a general hallucination detector for
 * prose claims with no number attached; that is a different, much harder
 * problem this milestone does not claim to solve.
 */

/** A rupee amount, a percentage, or a bare number with 3+ digits (an amount too large to be an ordinary list index or count). */
const NUMERIC_CLAIM_PATTERN =
  /₹\s?[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?%|\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b|\b\d{3,}(?:\.\d+)?\b/g;

/** Strips formatting so "₹86,106" / "86106" / "86,106.0" all normalize to comparable digits. */
function normalize(token: string): string {
  return token.replace(/[₹,\s]/g, "").replace(/^0+(?=\d)/, "");
}

export function extractNumericClaims(text: string): readonly string[] {
  const matches = text.match(NUMERIC_CLAIM_PATTERN) ?? [];
  return matches.map(normalize);
}

export interface GroundingResult {
  readonly grounded: boolean;
  /** Claims present in the response but not traceable to the payload. */
  readonly unsupportedClaims: readonly string[];
}

export function checkGrounding(
  responseText: string,
  groundingPayload: string,
): GroundingResult {
  const payloadNumbers = new Set(extractNumericClaims(groundingPayload));
  const responseNumbers = extractNumericClaims(responseText);

  const unsupportedClaims = [...new Set(responseNumbers)].filter(
    (claim) => !payloadNumbers.has(claim),
  );

  return { grounded: unsupportedClaims.length === 0, unsupportedClaims };
}
