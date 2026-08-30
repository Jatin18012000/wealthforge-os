import { insufficient, ok, type Computed } from "./result";

/**
 * Manual adjustments: the layer that makes every financial variable
 * overridable without ever overwriting what a source said.
 *
 * The rule this module implements is one sentence from
 * docs/08_DATA_TRUST_MODEL.md: "source value → manual adjustment →
 * resulting current value. The source value remains queryable even after an
 * override is applied." Nothing here mutates a source record; an adjustment
 * is a separate, revocable row that layers on top of one, and revoking it
 * restores the source value exactly.
 */

/** What kind of number is being overridden — money is never mixed with units. */
export type AdjustmentUnit = "money" | "quantity" | "count" | "bps";

/**
 * How the override relates to the source value.
 *
 * - `set` states the answer outright: "the current SIP is ₹12,000",
 *   regardless of what the workbook said. Used when the user knows the
 *   correct figure.
 * - `delta` states a difference: "whatever the import says, add ₹500".
 *   It re-applies against the *live* source, so a later import flows
 *   through instead of being frozen out.
 *
 * Both are stored; neither is inferred. A `set` override whose source has
 * since moved is flagged rather than silently pinning a stale figure — see
 * `sourceMovedSince`.
 */
export type AdjustmentMode = "set" | "delta";

export interface AdjustmentInput {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  /** Which field of that entity this overrides, e.g. "amount". */
  readonly field: string;
  readonly unit: AdjustmentUnit;
  readonly mode: AdjustmentMode;
  /**
   * The source value as it stood when the override was recorded. Kept so
   * the app can tell "the source has changed since you overrode this" from
   * "the source is unchanged" — a distinction the user needs to make a
   * decision, and one the current source value alone cannot answer.
   */
  readonly sourceValueAtEntry: number | null;
  /** The delta (mode "delta") or the stated absolute value (mode "set"). */
  readonly adjustmentValue: number;
  readonly reason: string | null;
  readonly createdAt: Date;
  /** Set when the override was withdrawn. Revoked rows are kept, never deleted. */
  readonly revokedAt: Date | null;
}

export interface EffectiveValue {
  /** What the source says right now, or null when the source has no value. */
  readonly sourceValue: number | null;
  /** The signed difference the override makes: current − source. */
  readonly adjustmentValue: number;
  /** The figure every downstream calculation should use. */
  readonly currentValue: number;
  readonly adjustmentId: string;
  readonly mode: AdjustmentMode;
  readonly unit: AdjustmentUnit;
  readonly reason: string | null;
  readonly appliedAt: Date;
  /**
   * True when a `set` override was recorded against a different source value
   * than the one in the data today — the import moved underneath the
   * override. The override still applies (silently dropping it would lose a
   * deliberate human decision), but the screen says so.
   */
  readonly sourceMovedSince: boolean;
}

/** Identity of an overridable field, used as the composition key. */
export function adjustmentKey(
  entityType: string,
  entityId: string,
  field: string,
): string {
  return `${entityType}|${entityId}|${field}`;
}

/**
 * The one adjustment in force per field: the most recently created that has
 * not been revoked.
 *
 * Earlier adjustments are not deleted and remain readable as history — the
 * same non-destructive rule the revision chain follows for source records
 * (CLAUDE.md, "historical data is sacred").
 */
export function effectiveAdjustments(
  adjustments: readonly AdjustmentInput[],
): Map<string, AdjustmentInput> {
  const byKey = new Map<string, AdjustmentInput>();

  for (const adjustment of adjustments) {
    if (adjustment.revokedAt !== null) continue;

    const key = adjustmentKey(
      adjustment.entityType,
      adjustment.entityId,
      adjustment.field,
    );
    const held = byKey.get(key);
    if (held === undefined || isNewer(adjustment, held)) byKey.set(key, adjustment);
  }

  return byKey;
}

/**
 * Two adjustments can share a createdAt to the millisecond (SQLite stores
 * milliseconds, and two writes in one request can land in the same one). The
 * id breaks the tie deterministically so the effective value never depends
 * on row order.
 */
function isNewer(candidate: AdjustmentInput, held: AdjustmentInput): boolean {
  if (candidate.createdAt.getTime() !== held.createdAt.getTime()) {
    return candidate.createdAt > held.createdAt;
  }
  return candidate.id > held.id;
}

/**
 * Resolves source + adjustment into the value to use.
 *
 * Returns `insufficient-data` for the one case that genuinely cannot be
 * answered: a delta applied to a source that has no value. "Unknown + ₹500"
 * is not ₹500, and producing a number there would be exactly the invention
 * this engine exists to refuse.
 */
export function resolveEffectiveValue(
  sourceValue: number | null,
  adjustment: AdjustmentInput,
): Computed<EffectiveValue> {
  if (adjustment.mode === "delta" && sourceValue === null) {
    return insufficient(
      `a manual adjustment of ${adjustment.adjustmentValue} was recorded as a difference, but the source has no value to apply it to`,
    );
  }

  const currentValue =
    adjustment.mode === "delta"
      ? (sourceValue as number) + adjustment.adjustmentValue
      : adjustment.adjustmentValue;

  return ok({
    sourceValue,
    adjustmentValue: currentValue - (sourceValue ?? 0),
    currentValue,
    adjustmentId: adjustment.id,
    mode: adjustment.mode,
    unit: adjustment.unit,
    reason: adjustment.reason,
    appliedAt: adjustment.createdAt,
    sourceMovedSince:
      adjustment.mode === "set" && !sameValue(sourceValue, adjustment.sourceValueAtEntry),
  });
}

function sameValue(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return a === b;
}

/**
 * Applies the adjustment in force for one field, if any.
 *
 * The no-override path returns the source value untouched, so callers can
 * run every value through this without branching — and so an unadjusted
 * figure is provably identical to what the source said.
 */
export function applyAdjustment(
  sourceValue: number | null,
  adjustment: AdjustmentInput | undefined,
): {
  readonly value: number | null;
  readonly effective: EffectiveValue | null;
  readonly unresolved: readonly string[];
} {
  if (adjustment === undefined)
    return { value: sourceValue, effective: null, unresolved: [] };

  const resolved = resolveEffectiveValue(sourceValue, adjustment);
  if (resolved.kind !== "ok") {
    // The override cannot be applied; the source value stands and the reason
    // travels with it rather than being swallowed.
    return { value: sourceValue, effective: null, unresolved: resolved.reasons };
  }

  return {
    value: resolved.value.currentValue,
    effective: resolved.value,
    unresolved: [],
  };
}

/**
 * What an override *would* do, computed before anything is written.
 *
 * docs/04_USER_FLOWS.md requires the user to see "source value + proposed
 * manual adjustment = resulting current value" before confirming, so the
 * preview and the write must be the same arithmetic — this function is what
 * both call.
 */
export interface AdjustmentPreview {
  readonly sourceValue: number | null;
  readonly adjustmentValue: number;
  readonly resultingValue: number;
  readonly mode: AdjustmentMode;
  readonly unit: AdjustmentUnit;
  /** True when the override changes nothing — worth saying before it is stored. */
  readonly isNoOp: boolean;
}

export function previewAdjustment(
  sourceValue: number | null,
  mode: AdjustmentMode,
  requestedValue: number,
  unit: AdjustmentUnit,
): Computed<AdjustmentPreview> {
  if (!Number.isFinite(requestedValue)) {
    return insufficient("the entered value is not a number");
  }
  if (unit !== "quantity" && !Number.isSafeInteger(requestedValue)) {
    return insufficient(
      "money, counts and basis points are whole minor units; the entered value is not a whole number",
    );
  }
  if (mode === "delta" && sourceValue === null) {
    return insufficient(
      "this field has no source value, so there is nothing to add a difference to — enter the value itself instead",
    );
  }

  const resultingValue =
    mode === "delta" ? (sourceValue as number) + requestedValue : requestedValue;

  return ok({
    sourceValue,
    adjustmentValue: resultingValue - (sourceValue ?? 0),
    resultingValue,
    mode,
    unit,
    isNoOp: sourceValue !== null && resultingValue === sourceValue,
  });
}
