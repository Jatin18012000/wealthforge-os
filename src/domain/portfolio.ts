import { multiplyMinorUnits, safeRatio, sumMinorUnits } from "./money";
import { insufficient, ok, type Computed, type Exclusion } from "./result";
import { isTrusted, untrustedReason } from "./trust";

export interface PositionInput {
  readonly id: string;
  readonly instrumentId: string;
  readonly instrumentLabel: string;
  /** equity | etf | mutual_fund | gold | silver | epf | cash */
  readonly assetClass: string;
  readonly quantity: number;
  readonly asOfDate: Date;
  readonly trustState: string;
  /**
   * What the source stated this holding was worth at `asOfDate`, when it
   * stated it outright rather than leaving it to be computed from a
   * per-unit price. Optional: sources that report only a price omit it.
   */
  readonly marketValueMinorUnits?: number | null;
  /**
   * The asset category the SOURCE states this holding is invested in, when
   * it says so — "Equity" for an equity mutual fund. Used only to group the
   * allocation breakdown by exposure rather than by product wrapper; it
   * never replaces `assetClass`, which stays the instrument's own kind.
   */
  readonly underlyingCategory?: string | null;
}

export interface ValuationInput {
  readonly instrumentId: string;
  readonly asOfDate: Date;
  readonly priceMinorUnits: number;
}

export interface ValuedPosition {
  readonly positionId: string;
  readonly instrumentId: string;
  readonly instrumentLabel: string;
  readonly assetClass: string;
  readonly quantity: number;
  readonly priceMinorUnits: number;
  /** The date of the price actually used — never implied to be "now". */
  readonly priceAsOf: Date;
  /** Whole days between `priceAsOf` and the requested as-of date. */
  readonly priceAgeDays: number;
  readonly valueMinorUnits: number;
  /** See PositionInput.underlyingCategory. */
  readonly underlyingCategory?: string | null;
}

export interface PortfolioValuation {
  readonly asOf: Date;
  readonly positions: readonly ValuedPosition[];
  readonly totalMinorUnits: number;
  /** Positions deliberately left out of the total, each with a reason. */
  readonly exclusions: readonly Exclusion[];
}

const MS_PER_DAY = 86_400_000;

/**
 * The most recent price dated at or before `asOf`.
 *
 * Never returns a price dated after `asOf` — valuing a historical position
 * with a later price would silently rewrite history and make past net worth
 * drift every time new prices arrive (docs/07, "Portfolio valuation").
 */
export function findPriceAsOf(
  valuations: readonly ValuationInput[],
  instrumentId: string,
  asOf: Date,
): ValuationInput | null {
  let best: ValuationInput | null = null;
  for (const valuation of valuations) {
    if (valuation.instrumentId !== instrumentId) continue;
    if (valuation.asOfDate.getTime() > asOf.getTime()) continue;
    if (best === null || valuation.asOfDate.getTime() > best.asOfDate.getTime()) {
      best = valuation;
    }
  }
  return best;
}

/**
 * Values one position. Returns insufficient-data — never zero — when no
 * usable price exists, so an unpriced holding cannot quietly shrink a
 * portfolio total.
 */
export function valuePosition(
  position: PositionInput,
  valuations: readonly ValuationInput[],
  asOf: Date,
): Computed<ValuedPosition> {
  if (!isTrusted(position.trustState)) {
    return insufficient(
      `position "${position.instrumentLabel}" is ${untrustedReason(position.trustState)}`,
    );
  }
  if (position.asOfDate.getTime() > asOf.getTime()) {
    return insufficient(
      `position "${position.instrumentLabel}" is dated after the requested as-of date`,
    );
  }

  const price = findPriceAsOf(valuations, position.instrumentId, asOf);
  const statedValue = position.marketValueMinorUnits ?? null;

  // A source that states the holding's own total worth needs no price to be
  // valued — the figure is already the answer. Only when neither exists is
  // the holding genuinely unvaluable.
  if (price === null && statedValue === null) {
    return insufficient(
      `no price for "${position.instrumentLabel}" dated on or before ${asOf.toISOString().slice(0, 10)}`,
    );
  }

  // The stated total wins over price × quantity. Both describe the same
  // holding, but the stated figure is the source's own, while the product
  // is reconstructed from a per-unit price already rounded to whole paise —
  // which drifts by rupees on a holding of thousands of units and stops the
  // portfolio reconciling against the statement being read.
  const valueMinorUnits =
    statedValue ?? multiplyMinorUnits((price as ValuationInput).priceMinorUnits, position.quantity);

  // When only a stated total exists, the per-unit figure it implies is
  // reported for display, dated to the position's own snapshot — never to
  // "now", and never later than the requested as-of date, since a position
  // dated after `asOf` was already refused above.
  const impliedPrice =
    position.quantity === 0 ? 0 : Math.round((statedValue as number) / position.quantity);
  const priceMinorUnits = price?.priceMinorUnits ?? impliedPrice;
  const priceAsOf = price?.asOfDate ?? position.asOfDate;

  return ok({
    positionId: position.id,
    instrumentId: position.instrumentId,
    instrumentLabel: position.instrumentLabel,
    assetClass: position.assetClass,
    quantity: position.quantity,
    priceMinorUnits,
    priceAsOf,
    priceAgeDays: Math.floor((asOf.getTime() - priceAsOf.getTime()) / MS_PER_DAY),
    valueMinorUnits,
    underlyingCategory: position.underlyingCategory ?? null,
  });
}

/**
 * Values a whole portfolio at a point in time.
 *
 * Positions that cannot be valued are reported in `exclusions` rather than
 * contributing zero, so the caller can show "₹X across N holdings, 2 not
 * valued" instead of a total that silently understates.
 */
export function valuePortfolio(
  positions: readonly PositionInput[],
  valuations: readonly ValuationInput[],
  asOf: Date,
): Computed<PortfolioValuation> {
  const valued: ValuedPosition[] = [];
  const exclusions: Exclusion[] = [];

  for (const position of positions) {
    const result = valuePosition(position, valuations, asOf);
    if (result.kind === "ok") {
      valued.push(result.value);
    } else {
      exclusions.push({
        recordId: position.id,
        label: position.instrumentLabel,
        reason: result.reasons.join("; "),
      });
    }
  }

  if (valued.length === 0) {
    return insufficient(
      "no position could be valued at the requested date",
      ...exclusions.map((e) => `${e.label}: ${e.reason}`),
    );
  }

  return ok({
    asOf,
    positions: valued,
    totalMinorUnits: sumMinorUnits(valued.map((p) => p.valueMinorUnits)),
    exclusions,
  });
}

export interface AllocationSlice {
  readonly key: string;
  readonly valueMinorUnits: number;
  /** Share of the valued total, 0..1. */
  readonly ratio: number;
}

/**
 * The class a holding is allocated to: what its money is actually invested
 * in, rather than the wrapper it is held through.
 *
 * An equity mutual fund is an equity holding. Grouping it as "mutual fund"
 * describes the product, not the exposure, and splits a portfolio's real
 * equity share across two slices. Where a source states the underlying
 * category, that wins; otherwise the instrument's own kind stands.
 *
 * Normalized to the kind vocabulary's casing and spacing, because a source
 * writes "Equity" where the taxonomy says "equity" — leaving both would
 * produce two slices rendering under the same label, silently halving each.
 * A category the taxonomy has no word for (a debt fund, say) is kept as its
 * own normalized slice rather than being forced into a class it does not
 * belong to.
 */
export function allocationClassOf(position: ValuedPosition): string {
  const stated = position.underlyingCategory ?? null;
  if (stated === null || stated.trim() === "") return position.assetClass;
  return stated.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Allocation by asset class, computed from valued positions only, and
 * grouped by what each holding is invested in — see `allocationClassOf`.
 */
export function allocationByAssetClass(
  valuation: PortfolioValuation,
): Computed<readonly AllocationSlice[]> {
  return allocationBy(valuation, allocationClassOf);
}

/** Concentration per individual instrument. */
export function concentrationByInstrument(
  valuation: PortfolioValuation,
): Computed<readonly AllocationSlice[]> {
  return allocationBy(valuation, (position) => position.instrumentLabel);
}

function allocationBy(
  valuation: PortfolioValuation,
  keyOf: (position: ValuedPosition) => string,
): Computed<readonly AllocationSlice[]> {
  if (valuation.totalMinorUnits === 0) {
    // Every share would be 0/0. An allocation breakdown of a zero-valued
    // portfolio is undefined, not "0% each".
    return insufficient("portfolio total is zero; allocation shares are undefined");
  }

  const totals = new Map<string, number>();
  for (const position of valuation.positions) {
    const key = keyOf(position);
    totals.set(key, (totals.get(key) ?? 0) + position.valueMinorUnits);
  }

  const slices: AllocationSlice[] = [];
  for (const [key, valueMinorUnits] of totals) {
    const ratio = safeRatio(valueMinorUnits, valuation.totalMinorUnits);
    /* c8 ignore next -- totalMinorUnits !== 0 is guaranteed above */
    if (ratio === null) continue;
    slices.push({ key, valueMinorUnits, ratio });
  }

  slices.sort((a, b) => b.valueMinorUnits - a.valueMinorUnits);
  return ok(slices);
}

/**
 * Instruments exceeding a concentration threshold. The threshold is a
 * caller-supplied setting, never hardcoded into the formula
 * (docs/07, "Asset allocation & concentration").
 */
export function flagConcentration(
  slices: readonly AllocationSlice[],
  thresholdRatio: number,
): readonly AllocationSlice[] {
  return slices.filter((slice) => slice.ratio > thresholdRatio);
}
