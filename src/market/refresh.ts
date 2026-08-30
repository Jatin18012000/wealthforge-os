import type { PrismaClient } from "@prisma/client";
import {
  fetchAmfiNav,
  indexAmfiNavByIsin,
  toFetchedQuote as amfiToFetchedQuote,
} from "./providers/amfiNav";
import { fetchYahooQuote } from "./providers/yahooFinance";
import { MIN_PLAUSIBLE_PRICE_MINOR_UNITS, TRACKED_INDICES } from "./registry";
import type { Fetcher } from "./types";

/**
 * Runs a fetch and persists the result as a `Valuation` row — the exact
 * same table and shape a manual entry writes to, so nothing downstream
 * needs to know whether a price was typed in or fetched
 * (docs/06_DATABASE_SCHEMA.md; this is deliberately not a parallel
 * "market price" table).
 *
 * One instrument failing to fetch never aborts the batch — a stale
 * portfolio because AMFI is briefly unreachable is expected and handled
 * by the freshness indicator; refusing to price every OTHER holding
 * because of it would be a worse failure than the one being guarded
 * against (docs/18_FAILURE_MODES.md, "market data provider unavailable").
 */

export interface RefreshOutcome {
  readonly label: string;
  readonly status: "updated" | "unchanged" | "failed";
  readonly detail: string;
}

export interface RefreshSummary {
  readonly source: string;
  readonly outcomes: readonly RefreshOutcome[];
  readonly updatedCount: number;
  readonly failedCount: number;
}

function summarize(source: string, outcomes: readonly RefreshOutcome[]): RefreshSummary {
  return {
    source,
    outcomes,
    updatedCount: outcomes.filter((o) => o.status === "updated").length,
    failedCount: outcomes.filter((o) => o.status === "failed").length,
  };
}

async function persistQuoteIfNew(
  db: PrismaClient,
  instrumentId: string,
  quote: { priceMinorUnits: number; asOfDate: Date; currency: string },
  source: string,
): Promise<"updated" | "unchanged" | "rejected"> {
  if (
    !Number.isFinite(quote.priceMinorUnits) ||
    quote.priceMinorUnits < MIN_PLAUSIBLE_PRICE_MINOR_UNITS
  ) {
    return "rejected";
  }

  const existing = await db.valuation.findFirst({
    where: { instrumentId, asOfDate: quote.asOfDate },
  });
  if (existing !== null) return "unchanged"; // same date already has a valuation; never overwritten in place

  await db.valuation.create({
    data: {
      instrumentId,
      asOfDate: quote.asOfDate,
      priceMinorUnits: quote.priceMinorUnits,
      currency: quote.currency,
      source,
    },
  });
  return "updated";
}

/**
 * Finds-or-creates the bootstrap `Instrument` rows for tracked indices.
 * These are never held (no position ever references them) — they exist
 * purely so an index has somewhere to store a priced history using the
 * same `Valuation` mechanism as everything else, per `TRACKED_INDICES`.
 */
export async function ensureIndexInstruments(
  db: PrismaClient,
): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();
  for (const index of TRACKED_INDICES) {
    const existing = await db.instrument.findFirst({
      where: { kind: "index", identifier: index.code },
    });
    const instrument =
      existing ??
      (await db.instrument.create({
        data: {
          kind: "index",
          identifier: index.code,
          displayName: index.label,
          marketSymbol: index.yahooSymbol,
        },
      }));
    byCode.set(index.code, instrument.id);
  }
  return byCode;
}

/** Refreshes every tracked index that has a free symbol (D-016: Nifty Metal does not). */
export async function refreshTrackedIndices(
  db: PrismaClient,
  fetcher: Fetcher,
): Promise<RefreshSummary> {
  const instrumentIdByCode = await ensureIndexInstruments(db);
  const outcomes: RefreshOutcome[] = [];

  for (const index of TRACKED_INDICES) {
    if (index.yahooSymbol === null) {
      outcomes.push({
        label: index.label,
        status: "failed",
        detail: "no reliable free source is known for this index (see D-016)",
      });
      continue;
    }

    const instrumentId = instrumentIdByCode.get(index.code);
    if (instrumentId === undefined) {
      outcomes.push({
        label: index.label,
        status: "failed",
        detail: "instrument bootstrap failed",
      });
      continue;
    }

    const quote = await fetchYahooQuote(index.yahooSymbol, fetcher);
    if (quote.kind !== "ok") {
      outcomes.push({
        label: index.label,
        status: "failed",
        detail: quote.reasons.join("; "),
      });
      continue;
    }

    const outcome = await persistQuoteIfNew(
      db,
      instrumentId,
      quote.value,
      "yahoo-finance",
    );
    outcomes.push({
      label: index.label,
      status: outcome === "rejected" ? "failed" : outcome,
      detail:
        outcome === "rejected"
          ? `Yahoo Finance returned an implausible price for ${index.label}; not stored`
          : `as of ${quote.value.asOfDate.toISOString().slice(0, 10)}`,
    });
  }

  return summarize("Yahoo Finance (indices)", outcomes);
}

/**
 * Refreshes every equity/ETF instrument that has an optional
 * `marketSymbol` set (docs/features/market-data.md — nothing is fetched
 * for an instrument without one; that is a deliberate opt-in, not a gap).
 */
export async function refreshInstrumentQuotes(
  db: PrismaClient,
  fetcher: Fetcher,
): Promise<RefreshSummary> {
  const instruments = await db.instrument.findMany({
    where: { marketSymbol: { not: null }, kind: { not: "index" } },
  });

  const outcomes: RefreshOutcome[] = [];
  for (const instrument of instruments) {
    const symbol = instrument.marketSymbol as string;
    const quote = await fetchYahooQuote(symbol, fetcher);
    if (quote.kind !== "ok") {
      outcomes.push({
        label: instrument.displayName,
        status: "failed",
        detail: quote.reasons.join("; "),
      });
      continue;
    }

    const outcome = await persistQuoteIfNew(
      db,
      instrument.id,
      quote.value,
      "yahoo-finance",
    );
    outcomes.push({
      label: instrument.displayName,
      status: outcome === "rejected" ? "failed" : outcome,
      detail:
        outcome === "rejected"
          ? "Yahoo Finance returned an implausible price; not stored"
          : `as of ${quote.value.asOfDate.toISOString().slice(0, 10)}`,
    });
  }

  return summarize("Yahoo Finance (holdings)", outcomes);
}

/**
 * Refreshes mutual fund NAVs by matching AMFI's file against
 * `Instrument.identifier` (the ISIN every mutual-fund holding is already
 * keyed by — see `src/ingestion/sources/mappings.ts`). One fetch serves
 * every mutual fund holding, which is also why this only ever needs one
 * network call regardless of how many funds are held.
 */
export async function refreshMutualFundNavs(
  db: PrismaClient,
  fetcher: Fetcher,
): Promise<RefreshSummary> {
  const funds = await db.instrument.findMany({ where: { kind: "mutual_fund" } });
  if (funds.length === 0) {
    return summarize("AMFI (mutual funds)", []);
  }

  const rows = await fetchAmfiNav(fetcher);
  if (rows.kind !== "ok") {
    return summarize(
      "AMFI (mutual funds)",
      funds.map((fund) => ({
        label: fund.displayName,
        status: "failed",
        detail: rows.reasons.join("; "),
      })),
    );
  }

  const byIsin = indexAmfiNavByIsin(rows.value);
  const outcomes: RefreshOutcome[] = [];

  for (const fund of funds) {
    const identifier = fund.identifier;
    const row = identifier === null ? undefined : byIsin.get(identifier);
    if (row === undefined) {
      outcomes.push({
        label: fund.displayName,
        status: "failed",
        detail:
          identifier === null
            ? "this holding has no ISIN recorded, so it cannot be matched against AMFI's file"
            : `no AMFI scheme matches ISIN ${identifier}`,
      });
      continue;
    }

    const outcome = await persistQuoteIfNew(
      db,
      fund.id,
      amfiToFetchedQuote(row),
      "amfi-navall",
    );
    outcomes.push({
      label: fund.displayName,
      status: outcome === "rejected" ? "failed" : outcome,
      detail:
        outcome === "rejected"
          ? "AMFI returned an implausible NAV; not stored"
          : `${row.schemeName} as of ${row.asOfDate.toISOString().slice(0, 10)}`,
    });
  }

  return summarize("AMFI (mutual funds)", outcomes);
}

/**
 * Runs every source. Each source's failure is independent of the others,
 * and the combined outcome is written to the audit log — the same
 * provenance principle the Data Center's import/backup/restore paths
 * follow, so "when was market data last refreshed, and how did it go" is
 * answered the same way everything else in the app answers it.
 */
export async function refreshAllMarketData(
  db: PrismaClient,
  fetcher: Fetcher,
): Promise<readonly RefreshSummary[]> {
  const summaries = [
    await refreshTrackedIndices(db, fetcher),
    await refreshMutualFundNavs(db, fetcher),
    await refreshInstrumentQuotes(db, fetcher),
  ];

  await db.auditEvent.create({
    data: {
      kind: "market_refresh",
      payloadJson: JSON.stringify(
        summaries.map((summary) => ({
          source: summary.source,
          updatedCount: summary.updatedCount,
          failedCount: summary.failedCount,
        })),
      ),
    },
  });

  return summaries;
}
