import { afterAll, describe, expect, it } from "vitest";
import { getMarketView } from "../../src/views/marketView";
import { refreshTrackedIndices } from "../../src/market/refresh";
import type { Fetcher } from "../../src/market/types";
import { createTestDb } from "../setup/testDb";

const yahooOk: Fetcher = async () => ({
  ok: true,
  status: 200,
  text: async () =>
    JSON.stringify({
      chart: {
        result: [
          {
            meta: {
              regularMarketPrice: 24500.35,
              regularMarketTime: 1756540200,
              currency: "INR",
            },
          },
        ],
      },
    }),
});

describe("market view", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("lists every tracked index, even with no data fetched yet", async () => {
    const view = await getMarketView(db, new Date("2026-08-30T00:00:00Z"));
    expect(view.indices.map((i) => i.code)).toEqual([
      "NIFTY50",
      "SENSEX",
      "NIFTY_BANK",
      "NIFTY_METAL",
    ]);
    expect(view.indices[0]?.latestPriceMinorUnits).toBeNull();
    expect(view.indices[0]?.ageLabel).toBeNull();
  });

  it("marks Nifty Metal as having no free source", async () => {
    const view = await getMarketView(db, new Date("2026-08-30T00:00:00Z"));
    expect(view.indices.find((i) => i.code === "NIFTY_METAL")?.hasFreeSource).toBe(false);
  });

  it("exposes the instrument id for every index, so a manual reading can be recorded against it", async () => {
    const view = await getMarketView(db, new Date("2026-08-30T00:00:00Z"));
    for (const index of view.indices) {
      expect(index.instrumentId).toBeTruthy();
    }
  });

  it("shows a manually recorded reading (e.g. for Nifty Metal) the same way as a fetched one", async () => {
    const view = await getMarketView(db, new Date("2026-08-30T00:00:00Z"));
    const metal = view.indices.find((i) => i.code === "NIFTY_METAL");

    await db.valuation.create({
      data: {
        instrumentId: metal?.instrumentId as string,
        asOfDate: new Date("2026-08-29T00:00:00Z"),
        priceMinorUnits: 945_020,
        currency: "INR",
        source: "manual",
      },
    });

    const after = await getMarketView(db, new Date("2026-08-30T00:00:00Z"));
    const updated = after.indices.find((i) => i.code === "NIFTY_METAL");
    expect(updated?.latestPriceMinorUnits).toBe(945_020);
    expect(updated?.ageDays).toBe(1);
  });

  it("shows a fetched index price with its age, once refreshed", async () => {
    await refreshTrackedIndices(db, yahooOk); // 2025-08-30 (from the fixed timestamp)

    const asOf = new Date("2026-08-30T00:00:00Z");
    const view = await getMarketView(db, asOf);
    const nifty = view.indices.find((i) => i.code === "NIFTY50");

    expect(nifty?.latestPriceMinorUnits).toBe(2450035);
    expect(nifty?.ageDays).toBeGreaterThan(0);
    expect(nifty?.isStale).toBe(true); // a year old relative to `asOf` in this test
  });

  it("reports data as fresh when the as-of date matches the fetch date", async () => {
    const asOfSameDay = new Date(1756540200 * 1000);
    const view = await getMarketView(db, asOfSameDay);
    const nifty = view.indices.find((i) => i.code === "NIFTY50");
    expect(nifty?.isStale).toBe(false);
    expect(nifty?.ageDays).toBe(0);
  });

  it("lists an equity instrument's opt-in market symbol and last price", async () => {
    await db.instrument.create({
      data: {
        kind: "equity",
        identifier: "INE111",
        displayName: "Alpha Ltd",
        marketSymbol: "ALPHA.NS",
      },
    });
    await db.instrument.create({
      data: { kind: "equity", identifier: "INE222", displayName: "Beta Ltd" },
    });

    const view = await getMarketView(db, new Date("2026-08-30T00:00:00Z"));
    expect(view.instruments.map((i) => i.displayName)).toEqual(["Alpha Ltd", "Beta Ltd"]);
    expect(view.instruments[0]?.marketSymbol).toBe("ALPHA.NS");
    expect(view.instruments[1]?.marketSymbol).toBeNull();
  });

  it("counts mutual funds separately, since they are matched automatically rather than opted in", async () => {
    await db.instrument.create({
      data: { kind: "mutual_fund", identifier: "INF001", displayName: "Some Fund" },
    });
    const view = await getMarketView(db, new Date("2026-08-30T00:00:00Z"));
    expect(view.mutualFundCount).toBe(1);
  });
});
