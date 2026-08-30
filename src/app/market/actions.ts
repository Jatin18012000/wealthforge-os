"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { realFetcher, refreshAllMarketData } from "../../market";
import { db } from "../../lib/db";

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
