import { Card, Computed$, EmptyState, StatTile } from "../../components/Primitives";
import { db } from "../../lib/db";
import { formatDate, formatMoney, formatRatio } from "../../presentation/format";
import { resolveAsOf } from "../../views/context";
import { getLiabilitiesView } from "../../views/liabilitiesView";

export const dynamic = "force-dynamic";

export default async function LiabilitiesPage() {
  const asOf = await resolveAsOf(db);
  const view = await getLiabilitiesView(db, asOf);

  return (
    <>
      <div className="page-header">
        <h1>Liabilities</h1>
        <p>Balances and EMI obligations as of {formatDate(view.asOf)}.</p>
      </div>

      <div className="stack">
        <div className="grid grid--tiles">
          <StatTile
            label="Total outstanding"
            value={formatMoney(view.totalOutstandingMinorUnits)}
            note={`${view.cards.length} liabilit${view.cards.length === 1 ? "y" : "ies"}`}
          />
          <StatTile
            label="Total monthly EMI"
            value={formatMoney(view.totalEmiMinorUnits)}
            note="Household total, before payer split"
          />
        </div>

        {view.cards.length === 0 ? (
          <Card>
            <EmptyState>No liabilities recorded.</EmptyState>
          </Card>
        ) : (
          view.cards.map((card) => (
            <Card key={card.liability.id} title={card.liability.name}>
              <div className="grid grid--halves">
                <div className="table-scroll">
                  <table>
                    <tbody>
                      <tr>
                        <td>Outstanding</td>
                        <td className="num">
                          {formatMoney(card.liability.outstandingMinorUnits)}
                        </td>
                      </tr>
                      <tr>
                        <td>Balance dated</td>
                        <td className="num">{formatDate(card.liability.outstandingAsOf)}</td>
                      </tr>
                      <tr>
                        <td>Monthly EMI</td>
                        <td className="num">
                          {formatMoney(card.liability.emiAmountMinorUnits)}
                        </td>
                      </tr>
                      <tr>
                        <td>Interest rate</td>
                        <td className="num">
                          {formatRatio(card.liability.interestRateBps / 10_000)}
                        </td>
                      </tr>
                      <tr>
                        <td>Tenure</td>
                        <td className="num">{card.liability.tenureMonths} months</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3 className="card__title">Who pays what</h3>
                  <Computed$ result={card.payerShares}>
                    {(shares) => (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Payer</th>
                              <th className="num">Share</th>
                              <th className="num">Monthly</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shares.map((share) => (
                              <tr key={share.payerName}>
                                <td className="label-cell">{share.payerName}</td>
                                <td className="num">
                                  {formatRatio(share.shareBps / 10_000)}
                                </td>
                                <td className="num">{formatMoney(share.shareMinorUnits)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="note" style={{ marginTop: "0.5rem" }}>
                          Shares sum to exactly the EMI — the final payer absorbs the
                          rounding remainder so the parts equal the whole.
                        </p>
                      </div>
                    )}
                  </Computed$>

                  <h3 className="card__title" style={{ marginTop: "1rem" }}>
                    Release
                  </h3>
                  <Computed$ result={card.release}>
                    {(release) => (
                      <p style={{ margin: 0 }}>
                        {formatDate(release.projectedFinalPayment)}
                        <br />
                        <span className="note">
                          {release.paymentsMade} payment
                          {release.paymentsMade === 1 ? "" : "s"} recorded,{" "}
                          {release.paymentsRemaining} remaining
                          {release.fromScheduleOnly
                            ? " — projected from the recorded tenure, not from observed payments"
                            : ""}
                          .
                        </span>
                      </p>
                    )}
                  </Computed$>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
