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
import { resolvePeriod } from "../domain";
import { db } from "../lib/db";
import {
  formatDate,
  formatMoney,
  formatMoneySigned,
  formatPeriodMonth,
  formatRatio,
} from "../presentation/format";
import { getCommandCenterView } from "../views/commandCenterView";
import { listPeriods, resolveAsOf, resolveLatestPeriod } from "../views/context";
import { getWealthIntelligenceView } from "../views/wealthIntelligenceView";

export const dynamic = "force-dynamic";

const DECOMPOSITION_STEP_LABELS: Record<string, string> = {
  opening: "Opening net worth",
  contribution: "New investment capital",
  appreciation: "Market movement & unconfirmed changes",
  depreciation: "Market movement (loss)",
  distribution: "Distributions",
  withdrawal: "Withdrawals",
  liability_change: "Liability change",
  other: "Other",
  closing: "Closing net worth",
};

export default async function CommandCenterPage() {
  const asOf = await resolveAsOf(db);
  const periods = await listPeriods(db);
  const latestPeriod = await resolveLatestPeriod(db);
  const view = await getCommandCenterView(db, asOf, latestPeriod, periods);

  const wealthRange = resolvePeriod("6m", { anchor: asOf });
  const wealth =
    wealthRange.kind === "ok"
      ? await getWealthIntelligenceView(db, wealthRange.value, asOf)
      : null;

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

        {wealth !== null && (
          <>
            <h2>Wealth intelligence</h2>
            <p className="note">Last 6 months, where data exists.</p>

            <div className="grid grid--halves">
              <Card title="Net worth trajectory">
                <Computed$ result={wealth.netWorthTrajectory.result}>
                  {(points) => (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Month</th>
                            <th scope="col" className="num">
                              Net worth
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {points.map((point) => (
                            <tr key={point.periodMonth}>
                              <td>{formatPeriodMonth(point.periodMonth)}</td>
                              <td className="num">
                                {point.value === null ? (
                                  <span className="note">No data</span>
                                ) : (
                                  formatMoney(point.value)
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Computed$>
                <p className="note" style={{ marginTop: "0.5rem" }}>
                  {wealth.netWorthTrajectory.calculationBasis}
                </p>
              </Card>

              <Card title="Monthly money flow">
                <Computed$ result={wealth.moneyFlow.result}>
                  {(points) => (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Month</th>
                            <th scope="col" className="num">
                              Income
                            </th>
                            <th scope="col" className="num">
                              Expenses
                            </th>
                            <th scope="col" className="num">
                              EMIs
                            </th>
                            <th scope="col" className="num">
                              Investments
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {points.map((point) => (
                            <tr key={point.periodMonth}>
                              <td>{formatPeriodMonth(point.periodMonth)}</td>
                              {point.value === null ? (
                                <td colSpan={4}>
                                  <span className="note">No data</span>
                                </td>
                              ) : (
                                <>
                                  <td className="num">{formatMoney(point.value.incomeMinorUnits)}</td>
                                  <td className="num">{formatMoney(point.value.expenseMinorUnits)}</td>
                                  <td className="num">{formatMoney(point.value.emiMinorUnits)}</td>
                                  <td className="num">
                                    {formatMoney(point.value.investmentMinorUnits)}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Computed$>
              </Card>
            </div>

            <div className="grid grid--halves">
              <Card title="Savings & investment rate trend">
                <Computed$ result={wealth.savingsRateTrend.result}>
                  {(savingsPoints) => (
                    <Computed$ result={wealth.investmentRateTrend.result}>
                      {(investmentPoints) => (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Month</th>
                                <th scope="col" className="num">
                                  Savings rate
                                </th>
                                <th scope="col" className="num">
                                  Investment rate
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {savingsPoints.map((point, index) => (
                                <tr key={point.periodMonth}>
                                  <td>{formatPeriodMonth(point.periodMonth)}</td>
                                  <td className="num">
                                    {point.value === null ? (
                                      <span className="note">No data</span>
                                    ) : (
                                      formatRatio(point.value)
                                    )}
                                  </td>
                                  <td className="num">
                                    {investmentPoints[index]?.value == null ? (
                                      <span className="note">No data</span>
                                    ) : (
                                      formatRatio(investmentPoints[index].value as number)
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Computed$>
                  )}
                </Computed$>
              </Card>

              <Card title="Net worth waterfall">
                <Computed$ result={wealth.netWorthWaterfall.result}>
                  {(decomposition) => (
                    <div className="table-scroll">
                      <table>
                        <tbody>
                          <tr>
                            <td>Opening net worth</td>
                            <td className="num">{formatMoney(decomposition.openingMinorUnits)}</td>
                          </tr>
                          {decomposition.steps.map((step, index) => (
                            <tr key={`${step.kind}-${index}`}>
                              <td>{step.label || DECOMPOSITION_STEP_LABELS[step.kind]}</td>
                              <td className="num">{formatMoneySigned(step.amountMinorUnits)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td>
                              <strong>Closing net worth</strong>
                            </td>
                            <td className="num">
                              <strong>{formatMoney(decomposition.closingMinorUnits)}</strong>
                            </td>
                          </tr>
                          {!decomposition.isComplete && (
                            <tr>
                              <td>Unexplained</td>
                              <td className="num">
                                {decomposition.unexplainedMinorUnits === null
                                  ? "—"
                                  : formatMoneySigned(decomposition.unexplainedMinorUnits)}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Computed$>
                <p className="note" style={{ marginTop: "0.5rem" }}>
                  {wealth.netWorthWaterfall.calculationBasis}
                </p>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}
