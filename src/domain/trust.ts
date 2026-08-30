/**
 * Which records are allowed to contribute to a headline figure.
 * Mirrors docs/08_DATA_TRUST_MODEL.md and is the single gate every total
 * passes through — no calculation filters trust states on its own.
 */

export type TrustState =
  | "extracted"
  | "needs_review"
  | "validated"
  | "verified"
  | "rejected"
  | "superseded";

/**
 * Only `validated` and `verified` records count toward headline totals.
 * Everything else remains visible and queryable in drill-downs but is
 * excluded from net worth, budget totals, portfolio value, and goal
 * progress until a human resolves it.
 */
const TRUSTED_STATES: ReadonlySet<string> = new Set<TrustState>(["validated", "verified"]);

export function isTrusted(trustState: string): boolean {
  return TRUSTED_STATES.has(trustState);
}

/** Human-readable reason a record was excluded, for the Exclusion list. */
export function untrustedReason(trustState: string): string {
  switch (trustState) {
    case "extracted":
      return "extracted but not yet validated";
    case "needs_review":
      return "flagged for human review";
    case "rejected":
      return "rejected; retained for audit only";
    case "superseded":
      return "superseded by a later revision";
    default:
      return `unrecognized trust state: ${trustState}`;
  }
}
