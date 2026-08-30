import Link from "next/link";
import { Card, EmptyState } from "../../components/Primitives";
import { db } from "../../lib/db";
import { formatDate, formatMoney } from "../../presentation/format";
import { getMarketView } from "../../views/marketView";
import { refreshMarketDataAction, setMarketSymbolAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Market — tracked indices and opt-in live pricing for holdings.
 *
 * Every price here is free and optional (`docs/MARKET_DATA_PROVIDER_EVALUATION.md`,
 * D-007): mutual fund NAVs come from AMFI's official daily file automatically;
 * index levels and individual equity/ETF prices come from Yahoo Finance's
 * unofficial endpoint only for instruments that opt in with a symbol. Nothing
 * here is required for the app to work — every screen that shows a price
 * falls back to the last known or manually entered value if this is stale
 * or unreachable.
 */

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };

  const view = await getMarketView(db, new Date());

  return (
    <>
      <div className="page-header">
        <h1>Market</h1>
        <p>
          Nifty 50, Sensex and Nifty Bank refresh from Yahoo Finance&apos;s free endpoint;
          mutual fund NAVs refresh from AMFI&apos;s official daily file. Both are optional
          — every figure elsewhere in the app keeps working from the last known price if
          neither is reachable.
        </p>
      </div>

      <div className="stack">
        {one("error") !== "" && <p className="alert alert--caution">{one("error")}</p>}
        {one("symbolSet") !== "" && <p className="alert">Symbol saved.</p>}
        {one("refreshed") !== "" && (
          <p className={one("failed") !== "0" ? "alert alert--caution" : "alert"}>
            <span className="alert__title">Refresh complete.</span> {one("updated")} price
            {one("updated") === "1" ? "" : "s"} updated, {one("failed")} failed. Details
            are in the audit log on the <Link href="/data-center">Data Center</Link>.
          </p>
        )}

        <Card
          title="Tracked indices"
          action={
            <form action={refreshMarketDataAction}>
              <button type="submit" className="button button--primary">
                Refresh market data now
              </button>
            </form>
          }
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Index</th>
                  <th scope="col" className="num">
                    Level
                  </th>
                  <th scope="col">As of</th>
                  <th scope="col">Freshness</th>
                </tr>
              </thead>
              <tbody>
                {view.indices.map((index) => (
                  <tr key={index.code}>
                    <td>{index.label}</td>
                    <td className="num">
                      {index.latestPriceMinorUnits === null ? (
                        <span className="note">No data</span>
                      ) : (
                        formatMoney(index.latestPriceMinorUnits)
                      )}
                    </td>
                    <td>{index.asOfDate === null ? "—" : formatDate(index.asOfDate)}</td>
                    <td>
                      {!index.hasFreeSource ? (
                        <span className="badge badge--caution">
                          no free source found (D-016)
                        </span>
                      ) : index.ageLabel === null ? (
                        <span className="note">never refreshed</span>
                      ) : (
                        <span
                          className={
                            index.isStale ? "badge badge--caution" : "badge badge--muted"
                          }
                        >
                          {index.ageLabel}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Mutual funds">
          <p className="note">
            {view.mutualFundCount === 0
              ? "No mutual fund holdings recorded yet."
              : `${view.mutualFundCount} mutual fund holding${view.mutualFundCount === 1 ? "" : "s"} — NAVs are matched automatically by ISIN against AMFI's file, so there is nothing to configure here.`}
          </p>
        </Card>

        <Card title="Equities & ETFs — optional live pricing">
          <p className="note">
            A holding is only ever fetched if you give it a symbol below (e.g. a Yahoo
            Finance ticker like &quot;RELIANCE.NS&quot;). Leaving it blank is a normal
            choice — the engine reports insufficient data for that holding&apos;s
            valuation rather than guessing, exactly as it did before this feature existed.
          </p>
          {view.instruments.length === 0 ? (
            <EmptyState>No equity or ETF holdings recorded yet.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Holding</th>
                    <th scope="col">Symbol</th>
                    <th scope="col" className="num">
                      Last price
                    </th>
                    <th scope="col">As of</th>
                  </tr>
                </thead>
                <tbody>
                  {view.instruments.map((instrument) => (
                    <tr key={instrument.instrumentId}>
                      <td>{instrument.displayName}</td>
                      <td>
                        <form action={setMarketSymbolAction} className="entry-form">
                          <input
                            type="hidden"
                            name="instrumentId"
                            value={instrument.instrumentId}
                          />
                          <input
                            className="field__input"
                            name="marketSymbol"
                            defaultValue={instrument.marketSymbol ?? ""}
                            placeholder="e.g. RELIANCE.NS"
                            aria-label={`Live-price symbol for ${instrument.displayName}`}
                          />
                          <button type="submit" className="button button--quiet">
                            Save
                          </button>
                        </form>
                      </td>
                      <td className="num">
                        {instrument.latestPriceMinorUnits === null ? (
                          <span className="note">No data</span>
                        ) : (
                          formatMoney(instrument.latestPriceMinorUnits)
                        )}
                      </td>
                      <td>
                        {instrument.asOfDate === null
                          ? "—"
                          : formatDate(instrument.asOfDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Report">
          <p className="note">
            A locally generated summary of market movement, portfolio impact, goal effect
            and risk — printable to PDF from your browser, no external service involved.
          </p>
          <Link href="/market/report" className="button">
            Open the report
          </Link>
        </Card>
      </div>
    </>
  );
}
