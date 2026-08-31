"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { realFetcher, refreshAllMarketData } from "../../market";
import { db } from "../../lib/db";
import { parseRupees } from "../../presentation/parse";

/**
 * The one write this screen performs: fetch from the real, free providers
 * (never a fixture, never mocked — that discipline is for the test suite
 * only) and persist whatever comes back. Failure per source is expected
 * and surfaced, never thrown past this action.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function refreshMarketDataAction(): Promise<void> {
  const summaries = await refreshAllMarketData(db, realFetcher);

  const totalUpdated = summaries.reduce((sum, s) => sum + s.updatedCount, 0);
  const totalFailed = summaries.reduce((sum, s) => sum + s.failedCount, 0);

  revalidatePath("/", "layout");
  redirect(`/market?refreshed=1&updated=${totalUpdated}&failed=${totalFailed}`);
}

/**
 * Sets or clears the optional live-price symbol for one equity/ETF
 * instrument. This is metadata about *where to look up a price*, not a
 * financial value — it does not go through the M8 manual-adjustment
 * machinery, which exists for source-value-plus-adjustment numeric
 * overrides with a resulting-value audit trail; a ticker symbol has no
 * "source value" to differ from.
 */
export async function setMarketSymbolAction(form: FormData): Promise<void> {
  const instrumentId = text(form, "instrumentId");
  const symbol = text(form, "marketSymbol").trim();

  if (instrumentId === "") {
    redirect("/market?error=No instrument was identified.");
  }

  await db.instrument.update({
    where: { id: instrumentId },
    data: { marketSymbol: symbol === "" ? null : symbol },
  });

  revalidatePath("/market");
  redirect("/market?symbolSet=1");
}

/**
 * Records a manually entered index level — the last rung of the fallback
 * hierarchy (docs/MARKET_DATA_PROVIDER_EVALUATION.md, D-016) for an index
 * with no free automatic source (currently only Nifty Metal). Written into
 * the same `Valuation` table an automatic fetch uses, tagged
 * `source: "manual"`, so the freshness/staleness display needs no special
 * case for where a reading came from — exactly the principle
 * `docs/features/market-data.md` states for fetched prices, extended here
 * to a typed-in one.
 *
 * Deliberately not layered through the M8 manual-adjustment machinery:
 * there is no automatically-fetched "source value" for Nifty Metal to
 * differ from — this is the only value, not an override of one.
 */
export async function recordManualIndexQuoteAction(form: FormData): Promise<void> {
  const instrumentId = text(form, "instrumentId");
  const dateRaw = text(form, "asOf");
  const valueRaw = text(form, "value");

  if (instrumentId === "") {
    redirect("/market?error=" + encodeURIComponent("No index was identified."));
  }

  const asOf = dateRaw === "" ? new Date() : new Date(`${dateRaw}T00:00:00.000Z`);
  if (Number.isNaN(asOf.getTime())) {
    redirect("/market?error=" + encodeURIComponent("That date could not be read."));
  }

  const parsed = parseRupees(valueRaw);
  if (parsed.kind !== "ok") {
    redirect("/market?error=" + encodeURIComponent(parsed.reasons.join("; ")));
  }

  const existing = await db.valuation.findFirst({
    where: { instrumentId, asOfDate: asOf },
  });
  if (existing !== null) {
    redirect(
      "/market?error=" +
        encodeURIComponent(
          "A value for that date is already recorded; pick a different date.",
        ),
    );
  }

  await db.valuation.create({
    data: {
      instrumentId,
      asOfDate: asOf,
      priceMinorUnits: parsed.value,
      currency: "INR",
      source: "manual",
    },
  });

  revalidatePath("/market");
  redirect("/market?manualQuoteSet=1");
}
