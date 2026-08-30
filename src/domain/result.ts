/**
 * The engine's answer type.
 *
 * Every calculation that can fail for lack of data returns a `Computed<T>`
 * rather than a bare number. There is deliberately no "default", "estimate",
 * or "assume zero" path: when the trusted data does not support a figure,
 * the engine says so and the UI shows "Insufficient data"
 * (docs/07_FINANCIAL_CALCULATIONS.md, CLAUDE.md §4).
 */
export type Computed<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "insufficient-data"; readonly reasons: readonly string[] };

export function ok<T>(value: T): Computed<T> {
  return { kind: "ok", value };
}

export function insufficient<T>(...reasons: string[]): Computed<T> {
  return { kind: "insufficient-data", reasons };
}

export function isOk<T>(result: Computed<T>): result is { kind: "ok"; value: T } {
  return result.kind === "ok";
}

/**
 * Unwraps a result, throwing if it is insufficient. For use in tests and in
 * call sites that have already checked `isOk` — never as a way to make an
 * insufficient result disappear in production code paths.
 */
export function expectOk<T>(result: Computed<T>): T {
  if (result.kind === "ok") return result.value;
  throw new Error(`Expected a computed value but data was insufficient: ${result.reasons.join("; ")}`);
}

/** A record that was left out of a total, and why. Always surfaced, never silent. */
export interface Exclusion {
  readonly recordId: string;
  readonly label: string;
  readonly reason: string;
}
