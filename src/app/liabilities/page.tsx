import { Card, Computed$, EmptyState, StatTile } from "../../components/Primitives";
import { db } from "../../lib/db";
import { formatDate, formatMoney, formatRatio } from "../../presentation/format";
import { resolveAsOf } from "../../views/context";
import { getLiabilitiesView } from "../../views/liabilitiesView";
import { recordEmiPaymentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LiabilitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };

  const asOf = await resolveAsOf(db);
  const view = await getLiabilitiesView(db, asOf);
  const error = one("error");

  return (
    <>
      <div className="page-header">
        <h1>Liabilities</h1>
        <p>Balances and EMI obligations as of {formatDate(view.asOf)}.</p>
      </div>

      <div className="stack">
        {error !== "" && (
          <p className="alert alert--caution">
            <span className="alert__title">Nothing was changed.</span> {error}
          </p>
        )}
        {one("paymentRecorded") !== "" && (
          <p className="alert">
            <span className="alert__title">Payment recorded.</span> Every screen now
            reflects it.
          </p>
        )}

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

              <form
                action={recordEmiPaymentAction}
                className="entry-form"
                style={{ marginTop: "0.7rem" }}
              >
                <input type="hidden" name="liabilityId" value={card.liability.id} />
                <label className="field">
                  <span className="field__label">Record a payment (₹)</span>
                  <input
                    className="field__input"
                    type="text"
                    name="amount"
                    inputMode="decimal"
                    placeholder="e.g. 15000"
                    required
                    aria-label={`EMI payment amount for ${card.liability.name}`}
                  />
                </label>
                <button type="submit" className="button button--quiet">
                  Add
                </button>
              </form>
            </Card>
          ))
        )}

        <p className="note">
          To register a new liability, or to close one that has been fully paid off or
          cancelled, use the Data Center.
        </p>
      </div>
    </>
  );
}
