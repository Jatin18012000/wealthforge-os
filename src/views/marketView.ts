import type { PrismaClient } from "@prisma/client";
import { daysBetween } from "../domain";
import { formatPriceAge } from "../presentation/format";
import {
  STALENESS_THRESHOLD_DAYS,
  TRACKED_INDICES,
  ensureIndexInstruments,
} from "../market";

/**
 * The Market screen's view model: where each tracked index stands, how
 * fresh that reading is, and which instruments have opted into a live
 * price fetch at all.
 *
 * Reuses `Valuation` exactly as the portfolio view does — there is no
 * separate "market price" concept, per docs/06_DATABASE_SCHEMA.md and the
 * "no parallel implementations" rule.
 */

export interface IndexRow {
  readonly instrumentId: string;
  readonly code: string;
  readonly label: string;
  readonly hasFreeSource: boolean;
  readonly latestPriceMinorUnits: number | null;
  readonly asOfDate: Date | null;
  readonly ageDays: number | null;
  readonly ageLabel: string | null;
  readonly isStale: boolean;
}

export interface PricedInstrumentRow {
  readonly instrumentId: string;
  readonly displayName: string;
  readonly kind: string;
  readonly marketSymbol: string | null;
  readonly latestPriceMinorUnits: number | null;
  readonly asOfDate: Date | null;
  readonly ageDays: number | null;
  readonly source: string | null;
}

export interface MarketView {
  readonly asOf: Date;
  readonly indices: readonly IndexRow[];
  /** Mutual funds are priced automatically (matched by ISIN); nothing to opt into. */
  readonly mutualFundCount: number;
  /** Equities/ETFs, showing which have opted into a live-price symbol. */
  readonly instruments: readonly PricedInstrumentRow[];
}

async function latestValuation(db: PrismaClient, instrumentId: string) {
  return db.valuation.findFirst({
    where: { instrumentId },
    orderBy: { asOfDate: "desc" },
  });
}

export async function getMarketView(db: PrismaClient, asOf: Date): Promise<MarketView> {
  const instrumentIdByCode = await ensureIndexInstruments(db);

  const indices: IndexRow[] = [];
  for (const index of TRACKED_INDICES) {
    // ensureIndexInstruments always bootstraps one row per tracked index,
    // so this is never actually undefined — the `as string` below documents
    // that guarantee rather than silently trusting it.
    const instrumentId = instrumentIdByCode.get(index.code) as string;
    const latest = await latestValuation(db, instrumentId);
    const ageDays = latest === null ? null : daysBetween(asOf, latest.asOfDate);

    indices.push({
      instrumentId,
      code: index.code,
      label: index.label,
      hasFreeSource: index.yahooSymbol !== null,
      latestPriceMinorUnits: latest?.priceMinorUnits ?? null,
      asOfDate: latest?.asOfDate ?? null,
      ageDays,
      ageLabel: ageDays === null ? null : formatPriceAge(ageDays),
      isStale: ageDays !== null && ageDays > STALENESS_THRESHOLD_DAYS,
    });
  }

  const mutualFundCount = await db.instrument.count({ where: { kind: "mutual_fund" } });

  const heldInstruments = await db.instrument.findMany({
    where: { kind: { in: ["equity", "etf"] } },
    orderBy: { displayName: "asc" },
  });

  const instruments: PricedInstrumentRow[] = [];
  for (const instrument of heldInstruments) {
    const latest = await latestValuation(db, instrument.id);
    instruments.push({
      instrumentId: instrument.id,
      displayName: instrument.displayName,
      kind: instrument.kind,
      marketSymbol: instrument.marketSymbol,
      latestPriceMinorUnits: latest?.priceMinorUnits ?? null,
      asOfDate: latest?.asOfDate ?? null,
      ageDays: latest === null ? null : daysBetween(asOf, latest.asOfDate),
      source: latest?.source ?? null,
    });
  }

  return { asOf, indices, mutualFundCount, instruments };
}
