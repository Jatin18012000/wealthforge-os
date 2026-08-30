import { sumMinorUnits } from "./money";
import { insufficient, ok, type Computed, type Exclusion } from "./result";
import { isTrusted, untrustedReason } from "./trust";

export interface AssetInput {
  readonly id: string;
  readonly label: string;
  /** cash | portfolio | epf | gold | other — free-form; used for grouping only. */
  readonly kind: string;
  readonly valueMinorUnits: number;
  readonly trustState: string;
}

export interface LiabilityInput {
  readonly id: string;
  readonly name: string;
  readonly outstandingMinorUnits: number;
  readonly outstandingAsOf: Date;
  readonly trustState: string;
}

export interface NetWorth {
  readonly asOf: Date;
  readonly totalAssetsMinorUnits: number;
  readonly totalLiabilitiesMinorUnits: number;
  readonly netWorthMinorUnits: number;
  readonly assetCount: number;
  readonly liabilityCount: number;
  /** Records left out of the totals, each with a reason. Always surfaced. */
  readonly exclusions: readonly Exclusion[];
}

/**
 * Net worth = trusted assets − trusted liabilities
 * (docs/07_FINANCIAL_CALCULATIONS.md).
 *
 * A liability dated after the as-of date is excluded rather than assumed
 * still outstanding: we do not know what its balance was at the earlier
 * date, and carrying a later balance backwards would overstate historical
 * debt.
 *
 * Returns insufficient-data when nothing at all is trusted — a net worth of
 * ₹0 derived from zero usable records is a fabricated number, not a fact.
 */
export function computeNetWorth(
  assets: readonly AssetInput[],
  liabilities: readonly LiabilityInput[],
  asOf: Date,
): Computed<NetWorth> {
  const exclusions: Exclusion[] = [];

  const trustedAssets = assets.filter((asset) => {
    if (!isTrusted(asset.trustState)) {
      exclusions.push({
        recordId: asset.id,
        label: asset.label,
        reason: untrustedReason(asset.trustState),
      });
      return false;
    }
    return true;
  });

  const trustedLiabilities = liabilities.filter((liability) => {
    if (!isTrusted(liability.trustState)) {
      exclusions.push({
        recordId: liability.id,
        label: liability.name,
        reason: untrustedReason(liability.trustState),
      });
      return false;
    }
    if (liability.outstandingAsOf.getTime() > asOf.getTime()) {
      exclusions.push({
        recordId: liability.id,
        label: liability.name,
        reason: `balance is dated after ${asOf.toISOString().slice(0, 10)}; the balance at that date is unknown`,
      });
      return false;
    }
    return true;
  });

  if (trustedAssets.length === 0 && trustedLiabilities.length === 0) {
    return insufficient(
      "no trusted asset or liability records are available for the requested date",
      ...exclusions.map((e) => `${e.label}: ${e.reason}`),
    );
  }

  const totalAssetsMinorUnits = sumMinorUnits(trustedAssets.map((a) => a.valueMinorUnits));
  const totalLiabilitiesMinorUnits = sumMinorUnits(
    trustedLiabilities.map((l) => l.outstandingMinorUnits),
  );

  return ok({
    asOf,
    totalAssetsMinorUnits,
    totalLiabilitiesMinorUnits,
    netWorthMinorUnits: totalAssetsMinorUnits - totalLiabilitiesMinorUnits,
    assetCount: trustedAssets.length,
    liabilityCount: trustedLiabilities.length,
    exclusions,
  });
}
