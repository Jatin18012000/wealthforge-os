import Link from "next/link";
import {
  Card,
  Computed$,
  EmptyState,
  ExclusionList,
  MoneyTile,
  ProgressBar,
  StatTile,
} from "../components/Primitives";
import { db } from "../lib/db";
import { formatDate, formatMoney, formatPeriodMonth, formatRatio } from "../presentation/format";
import { getCommandCenterView } from "../views/commandCenterView";
import { listPeriods, resolveAsOf, resolveLatestPeriod } from "../views/context";

export const dynamic = "force-dynamic";

export default async function CommandCenterPage() {
  const asOf = await resolveAsOf(db);
  const periods = await listPeriods(db);
  const latestPeriod = await resolveLatestPeriod(db);
  const view = await getCommandCenterView(db, asOf, latestPeriod, periods);

  return (
    <>
      <div className="page-header">
        <h1>Command Center</h1>
        <p>
          Figures as of {formatDate(view.asOf)} — the most recent date the data actually
          covers, not today.
        </p>
      </div>

      <div className="stack">
        <div className="grid grid--tiles">
          <StatTile
            label="Net worth"
            value={
              <Computed$ result={view.netWorth} showReasons={false}>
                {(netWorth) => <>{formatMoney(netWorth.netWorthMinorUnits)}</>}
              </Computed$>
            }
            note={
              view.netWorth.kind === "ok"
                ? `${formatMoney(view.netWorth.value.totalAssetsMinorUnits)} assets − ${formatMoney(view.netWorth.value.totalLiabilitiesMinorUnits)} liabilities`
                : "No trusted asset or liability records yet"
            }
            tone={
              view.netWorth.kind === "ok" && view.netWorth.value.netWorthMinorUnits < 0
                ? "negative"
                : "neutral"
            }
          />

          <StatTile
            label="Cash"
            value={view.cashMinorUnits === null ? "—" : formatMoney(view.cashMinorUnits)}
            note={view.cashMinorUnits === null ? "No cash balance recorded" : "Available to allocate"}
          />

          <StatTile
            label="Portfolio"
            value={
              <Computed$ result={view.portfolio.valuation} showReasons={false}>
                {(valuation) => <>{formatMoney(valuation.totalMinorUnits)}</>}
              </Computed$>
            }
            note={
              view.portfolio.valuation.kind === "ok"
                ? `${view.portfolio.holdings.length} holdings`
                : "No holdings could be valued"
            }
          />

          <MoneyTile
            label="Liabilities"
            minorUnits={view.liabilities.totalOutstandingMinorUnits}
            note={`${formatMoney(view.liabilities.totalEmiMinorUnits)} total monthly EMI`}
          />
        </div>

        {view.alerts.length > 0 && (
          <Card title="Needs attention">
            <ul className="alert-list">
              {view.alerts.map((alert) => (
                <li
                  key={alert.title}
                  className={`alert${alert.level === "caution" ? " alert--caution" : ""}`}
                >
                  <div>
                    <span className="alert__title">{alert.title}</span>
                    <p className="alert__detail">{alert.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid grid--halves">
          <Card
            title={
              view.budget === null
                ? "This month"
                : `This month · ${formatPeriodMonth(view.budget.periodMonth)}`
            }
            action={<Link href="/budget">Open budget →</Link>}
          >
            {view.budget === null ? (
              <EmptyState>No budget has been imported yet.</EmptyState>
            ) : (
              <Computed$ result={view.budget.summary}>
                {(summary) => (
                  <div className="table-scroll">
                    <table>
                      <tbody>
                        <tr>
                          <td>Income</td>
                          <td className="num">{formatMoney(summary.incomeMinorUnits)}</td>
                        </tr>
                        <tr>
                          <td>Expenses</td>
                          <td className="num">{formatMoney(summary.expenseMinorUnits)}</td>
                        </tr>
                        <tr>
                          <td>EMIs</td>
                          <td className="num">{formatMoney(summary.emiMinorUnits)}</td>
                        </tr>
                        <tr>
                          <td>Investments</td>
                          <td className="num">{formatMoney(summary.investmentMinorUnits)}</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Retained</strong>
                            <br />
                            <span className="note">income − expenses − EMIs</span>
                          </td>
                          <td className="num">
                            <strong>{formatMoney(summary.retainedMinorUnits)}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Left over cash</strong>
                            <br />
                            <span className="note">retained − investments</span>
                          </td>
                          <td className="num">
                            <strong>{formatMoney(summary.unallocatedMinorUnits)}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Savings rate</td>
                          <td className="num">
                            <Computed$ result={summary.savingsRate} showReasons={false}>
                              {(rate) => <>{formatRatio(rate)}</>}
                            </Computed$>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <ExclusionList exclusions={summary.exclusions} />
                  </div>
                )}
              </Computed$>
            )}
          </Card>

          <Card title="Goals in priority order" action={<Link href="/goals">Open goals →</Link>}>
            {view.goals.active.length === 0 ? (
              <EmptyState>No active goals.</EmptyState>
            ) : (
              <div className="stack" style={{ gap: "0.85rem" }}>
                {view.goals.active.map((card) => (
                  <div key={card.goal.id}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        marginBottom: "0.3rem",
                      }}
                    >
                      <span>
                        {card.goal.priorityRank}. {card.goal.name}{" "}
                        {card.progress.isProtected && (
                          <span className="badge badge--accent">Protected</span>
                        )}
                      </span>
                      <span className="note">
                        {formatMoney(card.progress.currentAmountMinorUnits)} of{" "}
                        {formatMoney(card.goal.targetAmountMinorUnits)}
                      </span>
                    </div>
                    <ProgressBar
                      ratio={
                        card.progress.progressRatio.kind === "ok"
                          ? card.progress.progressRatio.value
                          : 0
                      }
                      label={`${card.goal.name} progress`}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
