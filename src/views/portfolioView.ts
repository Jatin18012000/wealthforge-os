import type { PrismaClient } from "@prisma/client";
import { loadCostBasesAsOf, loadPositionsAsOf, loadValuations } from "../data/loaders";
import {
  allocationByAssetClass,
  computeProfitAndLoss,
  concentrationByInstrument,
  flagConcentration,
  valuePortfolio,
  type AllocationSlice,
  type Computed,
  type Exclusion,
  type PortfolioValuation,
  type ProfitAndLoss,
} from "../domain";

export interface HoldingRow {
  readonly instrumentLabel: string;
  readonly assetClass: string;
  readonly quantity: number;
  readonly priceMinorUnits: number;
  readonly priceAsOf: Date;
  readonly priceAgeDays: number;
  readonly valueMinorUnits: number;
  readonly profitAndLoss: Computed<ProfitAndLoss>;
}

export interface PortfolioView {
  readonly asOf: Date;
  readonly valuation: Computed<PortfolioValuation>;
  readonly holdings: readonly HoldingRow[];
  readonly allocation: Computed<readonly AllocationSlice[]>;
  readonly concentration: Computed<readonly AllocationSlice[]>;
  readonly concentrated: readonly AllocationSlice[];
  readonly exclusions: readonly Exclusion[];
  /** The oldest price contributing to the total, for the freshness note. */
  readonly stalestPriceAgeDays: number | null;
}

/**
 * Cash is modelled as an instrument priced at ₹1 per unit, so the engine
 * values it with no special case. It is excluded from the *portfolio* view,
 * where mixing a bank balance into asset allocation would distort every
 * share, but it still counts toward net worth.
 */
export const CASH_ASSET_CLASS = "cash";

const CONCENTRATION_THRESHOLD = 0.25;

export async function getPortfolioView(
  db: PrismaClient,
  asOf: Date,
): Promise<PortfolioView> {
  const allPositions = await loadPositionsAsOf(db, asOf);
  const positions = allPositions.filter((p) => p.assetClass !== CASH_ASSET_CLASS);
  const valuations = await loadValuations(db, asOf);

  const valuation = valuePortfolio(positions, valuations, asOf);

  if (valuation.kind !== "ok") {
    return {
      asOf,
      valuation,
      holdings: [],
      allocation: valuation,
      concentration: valuation,
      concentrated: [],
      exclusions: [],
      stalestPriceAgeDays: null,
    };
  }

  // Cost basis comes from the snapshot the position was read from (with any
  // manual correction applied), so P&L is computed per holding and reports
  // insufficient-data where no cost was ever recorded rather than inferring one.
  const costBases = await loadCostBasesAsOf(db, asOf);

  const holdings: HoldingRow[] = valuation.value.positions.map((position) => ({
    instrumentLabel: position.instrumentLabel,
    assetClass: position.assetClass,
    quantity: position.quantity,
    priceMinorUnits: position.priceMinorUnits,
    priceAsOf: position.priceAsOf,
    priceAgeDays: position.priceAgeDays,
    valueMinorUnits: position.valueMinorUnits,
    profitAndLoss: computeProfitAndLoss(
      costBases.get(position.instrumentId) ?? null,
      position.valueMinorUnits,
    ),
  }));

  const concentration = concentrationByInstrument(valuation.value);

  return {
    asOf,
    valuation,
    holdings,
    allocation: allocationByAssetClass(valuation.value),
    concentration,
    concentrated:
      concentration.kind === "ok"
        ? flagConcentration(concentration.value, CONCENTRATION_THRESHOLD)
        : [],
    exclusions: valuation.value.exclusions,
    stalestPriceAgeDays:
      holdings.length === 0
        ? null
        : holdings.reduce((oldest, h) => Math.max(oldest, h.priceAgeDays), 0),
  };
}
