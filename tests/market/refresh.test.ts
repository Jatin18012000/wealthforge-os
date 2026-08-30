import { afterAll, describe, expect, it } from "vitest";
import {
  ensureIndexInstruments,
  refreshAllMarketData,
  refreshInstrumentQuotes,
  refreshMutualFundNavs,
  refreshTrackedIndices,
} from "../../src/market/refresh";
import type { Fetcher } from "../../src/market/types";
import { createTestDb } from "../setup/testDb";

const AMFI_SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

100010;INF002B05678;-;Sample Flexi Cap Fund - Direct Growth;456.789;29-Aug-2026
`;

function yahooOk(price = 24500.35, time = 1756540200): Fetcher {
  return async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        chart: {
          result: [
            {
              meta: {
                regularMarketPrice: price,
                regularMarketTime: time,
                currency: "INR",
              },
            },
          ],
        },
      }),
  });
}

const amfiOk: Fetcher = async () => ({
  ok: true,
  status: 200,
  text: async () => AMFI_SAMPLE,
});
const alwaysFails: Fetcher = async () => {
  throw new Error("network unreachable");
};

describe("market data refresh", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("bootstraps one instrument per tracked index, idempotently", async () => {
    const first = await ensureIndexInstruments(db);
    const second = await ensureIndexInstruments(db);
    expect(first.size).toBe(4); // NIFTY50, SENSEX, NIFTY_BANK, NIFTY_METAL
    expect(second.get("NIFTY50")).toBe(first.get("NIFTY50"));
    expect(await db.instrument.count({ where: { kind: "index" } })).toBe(4);
  });

  it("refreshes every index with a free symbol and reports the one without as failed", async () => {
    const summary = await refreshTrackedIndices(db, yahooOk());

    const metal = summary.outcomes.find((o) => o.label === "Nifty Metal");
    expect(metal?.status).toBe("failed");
    expect(metal?.detail).toContain("D-016");

    expect(summary.outcomes.filter((o) => o.status === "updated")).toHaveLength(3);
  });

  it("does not duplicate a valuation for the same instrument and date on a second refresh", async () => {
    const before = await db.valuation.count();
    const summary = await refreshTrackedIndices(db, yahooOk());
    const after = await db.valuation.count();

    expect(after).toBe(before); // same date already priced
    expect(summary.outcomes.filter((o) => o.status === "unchanged")).toHaveLength(3);
  });

  it("stores a new valuation when the fetched date moves forward", async () => {
    const before = await db.valuation.count();
    await refreshTrackedIndices(db, yahooOk(24600, 1756626600)); // next day
    expect(await db.valuation.count()).toBe(before + 3);
  });

  it("keeps one provider's failure from blocking the others (provider-abstraction fallback)", async () => {
    const summary = await refreshTrackedIndices(db, alwaysFails);
    expect(summary.failedCount).toBe(4); // 3 network failures + the permanently-unavailable Nifty Metal
    expect(summary.outcomes.every((o) => o.status === "failed")).toBe(true);

    // The instruments themselves, and their prior successful valuations,
    // are untouched by this failed run.
    expect(await db.instrument.count({ where: { kind: "index" } })).toBe(4);
  });

  it("matches a mutual fund holding to AMFI by ISIN and stores its NAV", async () => {
    const fund = await db.instrument.create({
      data: {
        kind: "mutual_fund",
        identifier: "INF002B05678",
        displayName: "Sample Flexi Cap Fund",
      },
    });

    const summary = await refreshMutualFundNavs(db, amfiOk);
    expect(summary.outcomes[0]?.status).toBe("updated");

    const valuation = await db.valuation.findFirst({ where: { instrumentId: fund.id } });
    expect(valuation?.priceMinorUnits).toBe(45679); // 456.789 -> 456.79 -> 45679 paise
    expect(valuation?.source).toBe("amfi-navall");
  });

  it("reports a fund with no matching ISIN as failed, rather than guessing", async () => {
    await db.instrument.create({
      data: {
        kind: "mutual_fund",
        identifier: "INF999NOMATCH",
        displayName: "Unlisted Fund",
      },
    });

    const summary = await refreshMutualFundNavs(db, amfiOk);
    const unmatched = summary.outcomes.find((o) => o.label === "Unlisted Fund");
    expect(unmatched?.status).toBe("failed");
    expect(unmatched?.detail).toContain("no AMFI scheme matches");
  });

  it("reports a fund with no recorded ISIN as failed rather than crashing", async () => {
    await db.instrument.create({
      data: { kind: "mutual_fund", identifier: null, displayName: "No ISIN Fund" },
    });

    const summary = await refreshMutualFundNavs(db, amfiOk);
    const noIsin = summary.outcomes.find((o) => o.label === "No ISIN Fund");
    expect(noIsin?.status).toBe("failed");
    expect(noIsin?.detail).toContain("no ISIN recorded");
  });

  it("refreshes an instrument with an opt-in marketSymbol, and skips one without", async () => {
    const withSymbol = await db.instrument.create({
      data: {
        kind: "equity",
        identifier: "INE123",
        displayName: "Priced Co",
        marketSymbol: "PRICEDCO.NS",
      },
    });
    await db.instrument.create({
      data: { kind: "equity", identifier: "INE456", displayName: "Unpriced Co" },
    });

    const summary = await refreshInstrumentQuotes(db, yahooOk(500, 1756713000));
    expect(summary.outcomes).toHaveLength(1); // only the opted-in instrument is attempted at all
    expect(summary.outcomes[0]?.label).toBe("Priced Co");

    const valuation = await db.valuation.findFirst({
      where: { instrumentId: withSymbol.id },
    });
    expect(valuation?.priceMinorUnits).toBe(50000);
  });

  it("runs every source independently via refreshAllMarketData", async () => {
    const summaries = await refreshAllMarketData(db, yahooOk(600, 1756799400));
    expect(summaries.map((s) => s.source)).toEqual([
      "Yahoo Finance (indices)",
      "AMFI (mutual funds)",
      "Yahoo Finance (holdings)",
    ]);
  });
});
