import {
  Card,
  Computed$,
  EmptyState,
  ExclusionList,
  FreshnessNote,
  ProgressBar,
} from "../../components/Primitives";
import { db } from "../../lib/db";
import {
  formatDate,
  formatMoney,
  formatMoneySigned,
  formatQuantity,
  formatRatio,
  formatRatioSigned,
} from "../../presentation/format";
import { resolveAsOf } from "../../views/context";
import { getPortfolioView } from "../../views/portfolioView";

export const dynamic = "force-dynamic";

const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: "Equity",
  etf: "ETF",
  mutual_fund: "Mutual fund",
  gold: "Gold",
  silver: "Silver",
  epf: "EPF",
  cash: "Cash",
};

function assetClassLabel(kind: string): string {
  return ASSET_CLASS_LABELS[kind] ?? kind;
}

export default async function PortfolioPage() {
  const asOf = await resolveAsOf(db);
  const view = await getPortfolioView(db, asOf);

  return (
    <>
      <div className="page-header">
        <h1>Portfolio</h1>
        <p>
          Valued as of {formatDate(view.asOf)} using the latest dated closing price at or
          before that date — never a later one.
        </p>
      </div>

      <div className="stack">
        <Card title="Valuation">
          <Computed$ result={view.valuation}>
            {(valuation) => (
              <>
                <p className="tile__value">{formatMoney(valuation.totalMinorUnits)}</p>
                <p className="tile__note">
                  {valuation.positions.length} holdings valued
                  {view.stalestPriceAgeDays !== null && view.stalestPriceAgeDays > 0
                    ? ` · oldest price ${view.stalestPriceAgeDays} day${view.stalestPriceAgeDays === 1 ? "" : "s"} old`
                    : ""}
                </p>
                <ExclusionList exclusions={valuation.exclusions} />
              </>
            )}
          </Computed$>
        </Card>

        <div className="grid grid--halves">
          <Card title="Allocation by asset class">
            <Computed$ result={view.allocation}>
              {(slices) => (
                <div className="stack" style={{ gap: "0.7rem" }}>
                  {slices.map((slice) => (
                    <div key={slice.key}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: "0.25rem",
                        }}
                      >
                        <span>{assetClassLabel(slice.key)}</span>
                        <span className="note">
                          {formatMoney(slice.valueMinorUnits)} · {formatRatio(slice.ratio)}
                        </span>
                      </div>
                      <ProgressBar
                        ratio={slice.ratio}
                        label={`${assetClassLabel(slice.key)} share`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Computed$>
          </Card>

          <Card title="Concentration">
            {view.concentrated.length === 0 ? (
              <EmptyState>
                No single holding exceeds 25% of the portfolio.
              </EmptyState>
            ) : (
              <ul className="alert-list">
                {view.concentrated.map((slice) => (
                  <li key={slice.key} className="alert alert--caution">
                    <div>
                      <span className="alert__title">{slice.key}</span>
                      <p className="alert__detail">
                        {formatRatio(slice.ratio)} of the portfolio ·{" "}
                        {formatMoney(slice.valueMinorUnits)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title={`Holdings (${view.holdings.length})`}>
          {view.holdings.length === 0 ? (
            <EmptyState>
              No holdings could be valued at this date. Import a holdings statement to
              populate this screen.
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Class</th>
                    <th className="num">Quantity</th>
                    <th className="num">Price</th>
                    <th>Priced</th>
                    <th className="num">Value</th>
                    <th className="num">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {view.holdings.map((holding) => (
                    <tr key={holding.instrumentLabel}>
                      <td className="label-cell">{holding.instrumentLabel}</td>
                      <td>{assetClassLabel(holding.assetClass)}</td>
                      <td className="num">{formatQuantity(holding.quantity)}</td>
                      <td className="num">{formatMoney(holding.priceMinorUnits)}</td>
                      <td>
                        <FreshnessNote
                          days={holding.priceAgeDays}
                          asOf={holding.priceAsOf}
                        />
                      </td>
                      <td className="num">{formatMoney(holding.valueMinorUnits)}</td>
                      <td className="num">
                        {holding.profitAndLoss.kind === "ok" ? (
                          <span
                            style={{
                              color:
                                holding.profitAndLoss.value.absoluteMinorUnits >= 0
                                  ? "var(--positive)"
                                  : "var(--negative)",
                            }}
                          >
                            {formatMoneySigned(holding.profitAndLoss.value.absoluteMinorUnits)}
                            <br />
                            <span className="note">
                              {formatRatioSigned(holding.profitAndLoss.value.ratio)}
                            </span>
                          </span>
                        ) : (
                          <span className="note" title={holding.profitAndLoss.reasons.join("; ")}>
                            no cost basis
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
