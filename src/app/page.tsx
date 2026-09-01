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
  formatRatioSigned,
} from "../presentation/format";
import { explainDailyBriefFromHomeAction } from "./ai-analyst/actions";
import { getBehavioralIntelligenceView } from "../views/behavioralIntelligenceView";
import { getCommandCenterView } from "../views/commandCenterView";
import { listPeriods, resolveAsOf, resolveLatestPeriod } from "../views/context";
import { getGoalLiabilityIntelligenceView } from "../views/goalLiabilityIntelligenceView";
import { getInvestmentIntelligenceView } from "../views/investmentIntelligenceView";
import { getScenarioEngineView } from "../views/scenarioEngineView";
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

const ALLOCATION_STATUS_LABELS: Record<string, string> = {
  matched: "Matched",
  overweight: "Overweight",
  underweight: "Underweight",
  planned_only: "Planned, not yet held",
  observed_only: "Held, not in plan",
};

const ADHERENCE_STATUS_LABELS: Record<string, string> = {
  "insufficient-data": "Insufficient data",
  exact: "On plan",
  "under-invested": "Under-invested",
  "over-invested": "Over-invested",
};

interface AiExplanationPayload {
  readonly outcome: "shown" | "rejected" | "unavailable";
  readonly providerName?: string;
  readonly text?: string;
  readonly reason?: string;
}

/**
 * Command Center 2.0 (v1.1, IM-08, `docs/25_COMMAND_CENTER_V2_SPEC.md`).
 *
 * Section order follows the v1.1 directive exactly: Daily Brief → tiles →
 * Net Worth Trajectory/Money Flow → Portfolio X-Ray/Risk → Plan vs
 * Reality/Adherence → Goal Radar/EMI Freedom → Wealth Waterfall/Financial
 * Health → What Needs Attention/Data Health. Every widget below this
 * point (What's Changed, the Scenario Engine, and the rest of IM-02–IM-06)
 * is preserved under "More intelligence" — nothing built in IM-01 through
 * IM-07 was removed, only reordered.
 */
export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const briefId = typeof params.brief === "string" ? params.brief : "";
  const briefEvent =
    briefId === "" ? null : await db.auditEvent.findUnique({ where: { id: briefId } });
  const briefPayload: AiExplanationPayload | null =
    briefEvent === null ? null : (JSON.parse(briefEvent.payloadJson) as AiExplanationPayload);

  const asOf = await resolveAsOf(db);
  const periods = await listPeriods(db);
  const latestPeriod = await resolveLatestPeriod(db);
  const view = await getCommandCenterView(db, asOf, latestPeriod, periods);

  const wealthRange = resolvePeriod("6m", { anchor: asOf });
  const wealth =
    wealthRange.kind === "ok"
      ? await getWealthIntelligenceView(db, wealthRange.value, asOf)
      : null;
  const investment =
    wealthRange.kind === "ok"
      ? await getInvestmentIntelligenceView(db, wealthRange.value, asOf)
      : null;
  const goalLiability = await getGoalLiabilityIntelligenceView(db, asOf, latestPeriod);
  const behavioral = await getBehavioralIntelligenceView(db, asOf);
  const scenarios = await getScenarioEngineView(db, asOf, latestPeriod);

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
        <Card title="WealthForge Daily Brief">
          <p className="note" style={{ marginBottom: "0.6rem" }}>
            Position, what changed, why, plan deviations, risks, goals, portfolio, and data
            quality — grounded against the figures below, never invented.
          </p>
          <form action={explainDailyBriefFromHomeAction}>
            <button type="submit" className="button button--primary">
              Generate daily brief
            </button>
          </form>
          {briefPayload !== null && (
            <div style={{ marginTop: "0.75rem" }}>
              {briefPayload.outcome === "shown" ? (
                <>
                  <p style={{ whiteSpace: "pre-wrap" }}>{briefPayload.text}</p>
                  <p className="note" style={{ marginTop: "0.6rem" }}>
                    Answered by {briefPayload.providerName}. Checked against the report before
                    being shown.
                  </p>
                </>
              ) : (
                <>
                  <p className="alert alert--caution">{briefPayload.reason}</p>
                  <p className="note">
                    Every other screen keeps working normally — this feature is optional and
                    never required.
                  </p>
                </>
              )}
            </div>
          )}
        </Card>

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

        {wealth !== null && (
          <>
            <h2>Net worth trajectory &amp; money flow</h2>
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
          </>
        )}

        {investment !== null && (
          <>
            <h2>Portfolio X-Ray &amp; risk</h2>

            <Card title="Portfolio X-Ray">
              <Computed$ result={investment.portfolioXRay.result}>
                {(xray) => (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Holding</th>
                          <th>Asset class</th>
                          <th className="num">Value</th>
                          <th className="num">Weight</th>
                          <th className="num">P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {xray.holdings.map((h) => (
                          <tr key={h.instrumentLabel}>
                            <td>{h.instrumentLabel}</td>
                            <td>{h.assetClass}</td>
                            <td className="num">{formatMoney(h.valueMinorUnits)}</td>
                            <td className="num">{h.weightRatio === null ? "—" : formatRatio(h.weightRatio)}</td>
                            <td className="num">
                              <Computed$ result={h.profitAndLoss} showReasons={false}>
                                {(pnl) => <>{formatMoneySigned(pnl.absoluteMinorUnits)}</>}
                              </Computed$>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <ExclusionList exclusions={xray.exclusions} />
                  </div>
                )}
              </Computed$>
            </Card>

            <div className="grid grid--halves">
              <Card title="Concentration heatmap">
                <Computed$ result={investment.concentrationHeatmap.result}>
                  {(heatmap) => (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Instrument</th>
                            <th className="num">Weight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {heatmap.byInstrument.map((slice) => (
                            <tr key={slice.key}>
                              <td>{slice.key}</td>
                              <td className="num">
                                {formatRatio(slice.ratio)}
                                {slice.ratio > heatmap.concentratedThresholdRatio ? " ⚠" : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="note" style={{ marginTop: "0.5rem" }}>
                        ⚠ marks a holding above the {formatRatio(heatmap.concentratedThresholdRatio)}{" "}
                        concentration threshold.
                      </p>
                    </div>
                  )}
                </Computed$>
              </Card>

              <Card title="Drawdown monitor">
                <Computed$ result={investment.drawdownMonitor.result}>
                  {(d) => (
                    <div className="table-scroll">
                      <table>
                        <tbody>
                          <tr>
                            <td>Peak</td>
                            <td className="num">
                              {formatMoney(d.peak.valueMinorUnits)} ({formatDate(d.peak.asOf)})
                            </td>
                          </tr>
                          <tr>
                            <td>Trough</td>
                            <td className="num">
                              {formatMoney(d.trough.valueMinorUnits)} ({formatDate(d.trough.asOf)})
                            </td>
                          </tr>
                          <tr>
                            <td>Max drawdown</td>
                            <td className="num">{formatRatioSigned(d.maxDrawdownRatio)}</td>
                          </tr>
                          <tr>
                            <td>Current drawdown</td>
                            <td className="num">
                              {formatRatioSigned(d.currentDrawdownRatio)} —{" "}
                              {d.recovered ? "recovered" : "still below peak"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </Computed$>
              </Card>
            </div>
          </>
        )}

        <h2>Plan vs reality &amp; adherence</h2>

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

          <Card title="Plan vs reality">
            {view.budget === null ? (
              <EmptyState>No budget has been imported yet.</EmptyState>
            ) : (
              <Computed$ result={view.budget.planVsReality}>
                {(reality) => (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th className="num">Planned</th>
                          <th className="num">Actual</th>
                          <th className="num">Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reality.categories.map((category) => (
                          <tr key={category.category}>
                            <td>{category.category}</td>
                            <td className="num">{formatMoney(category.plannedMinorUnits)}</td>
                            <td className="num">
                              {category.actualMinorUnits === null ? (
                                <span className="note">No data</span>
                              ) : (
                                formatMoney(category.actualMinorUnits)
                              )}
                            </td>
                            <td className="num">
                              {category.varianceMinorUnits === null
                                ? "—"
                                : formatMoneySigned(category.varianceMinorUnits)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {reality.hasNoActuals && (
                      <p className="note" style={{ marginTop: "0.5rem" }}>
                        No confirmed activity recorded for this month — variances are shown as
                        uncovered rather than as zero.
                      </p>
                    )}
                  </div>
                )}
              </Computed$>
            )}
          </Card>
        </div>

        {investment !== null && (
          <div className="grid grid--halves">
            <Card title="Planned vs actual allocation">
              <Computed$ result={investment.plannedVsActualAllocation.result}>
                {(rows) => (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th className="num">Planned</th>
                          <th className="num">Held</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.label}>
                            <td>{row.label}</td>
                            <td className="num">
                              {row.plannedMinorUnits === null ? "—" : formatMoney(row.plannedMinorUnits)}
                            </td>
                            <td className="num">
                              {row.observedMinorUnits === null ? "—" : formatMoney(row.observedMinorUnits)}
                            </td>
                            <td>{ALLOCATION_STATUS_LABELS[row.status]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Computed$>
            </Card>

            <Card title="Investment plan adherence">
              <Computed$ result={investment.planAdherence.result}>
                {(rows) => (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="num">Planned</th>
                          <th className="num">Actual</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.periodMonth}>
                            <td>{formatPeriodMonth(row.periodMonth)}</td>
                            <td className="num">
                              {row.plannedMinorUnits === null ? "—" : formatMoney(row.plannedMinorUnits)}
                            </td>
                            <td className="num">
                              {row.actualMinorUnits === null ? "—" : formatMoney(row.actualMinorUnits)}
                            </td>
                            <td>{ADHERENCE_STATUS_LABELS[row.status]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Computed$>
            </Card>
          </div>
        )}

        <h2>Goal radar &amp; EMI freedom</h2>

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

        <Card title="Goal funding radar">
          <Computed$ result={goalLiability.goalFundingRadar.result}>
            {(rows) => (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Goal</th>
                      <th className="num">Current</th>
                      <th className="num">Target</th>
                      <th className="num">Progress</th>
                      <th>Projected completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.goal.id}>
                        <td>
                          {row.goal.name}
                          {row.progress.isProtected ? " (protected)" : ""}
                        </td>
                        <td className="num">{formatMoney(row.progress.currentAmountMinorUnits)}</td>
                        <td className="num">{formatMoney(row.goal.targetAmountMinorUnits)}</td>
                        <td className="num">
                          <Computed$ result={row.progress.progressRatio} showReasons={false}>
                            {(ratio) => <>{formatRatio(ratio)}</>}
                          </Computed$>
                        </td>
                        <td>
                          <Computed$ result={row.projection} showReasons={false}>
                            {(projection) => (
                              <>
                                {formatDate(projection.projectedCompletion)}
                                {projection.missesTargetDate ? " — after target date" : ""}
                              </>
                            )}
                          </Computed$>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Computed$>
        </Card>

        <div className="grid grid--halves">
          <Card title="Debt freedom meter">
            <Computed$ result={goalLiability.debtFreedomMeter.result}>
              {(meter) => (
                <div className="table-scroll">
                  <table>
                    <tbody>
                      <tr>
                        <td>Repaid</td>
                        <td className="num">{formatRatio(meter.repaidRatio)}</td>
                      </tr>
                      <tr>
                        <td>Outstanding</td>
                        <td className="num">{formatMoney(meter.totalOutstandingMinorUnits)}</td>
                      </tr>
                      <tr>
                        <td>Projected debt-free date</td>
                        <td className="num">{formatDate(meter.latestDebtFreeDate)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {meter.liabilitiesExcluded.length > 0 && (
                    <p className="note" style={{ marginTop: "0.5rem" }}>
                      Excluded from the debt-free date (no recorded tenure): {meter.liabilitiesExcluded.join(", ")}.
                    </p>
                  )}
                </div>
              )}
            </Computed$>
          </Card>

          <Card title="EMI release timeline">
            <Computed$ result={goalLiability.emiReleaseTimeline.result}>
              {(rows) => (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Liability</th>
                        <th className="num">Payments made</th>
                        <th>Projected final payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.liability.id}>
                          <td>{row.liability.name}</td>
                          <td className="num">
                            <Computed$ result={row.release} showReasons={false}>
                              {(release) => <>{release.paymentsMade}</>}
                            </Computed$>
                          </td>
                          <td>
                            <Computed$ result={row.release} showReasons={false}>
                              {(release) => (
                                <>
                                  {formatDate(release.projectedFinalPayment)}
                                  {release.fromScheduleOnly ? " (from schedule)" : ""}
                                </>
                              )}
                            </Computed$>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Computed$>
          </Card>
        </div>

        <h2>Wealth waterfall &amp; financial health</h2>

        <div className="grid grid--halves">
          {wealth !== null && (
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
          )}

          <Card title="Financial health score">
            <Computed$ result={behavioral.healthScore.result}>
              {(score) => (
                <div className="table-scroll">
                  <p>
                    <strong>
                      {score.totalPoints} / {score.maxPoints}
                    </strong>
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Component</th>
                        <th className="num">Points</th>
                        <th>Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {score.components.map((component) => (
                        <tr key={component.label}>
                          <td>{component.label}</td>
                          <td className="num">
                            {component.points} / {component.maxPoints}
                          </td>
                          <td>{component.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Computed$>
          </Card>
        </div>

        <h2>What needs attention &amp; data health</h2>

        <div className="grid grid--halves">
          <Card title="Needs attention">
            {view.alerts.length === 0 ? (
              <EmptyState>No alerts are currently raised.</EmptyState>
            ) : (
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
            )}
          </Card>

          <Card title="Data health">
            <Computed$ result={behavioral.dataHealth.result}>
              {(health) => (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Records</th>
                        <th className="num">Validated/verified</th>
                        <th className="num">Needs review/rejected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.trustSummaries.map((summary) => (
                        <tr key={summary.entityType}>
                          <td>{summary.label}</td>
                          <td className="num">{summary.counts.validated + summary.counts.verified}</td>
                          <td className="num">{summary.counts.needs_review + summary.counts.rejected}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="note" style={{ marginTop: "0.5rem" }}>
                    {health.unexplainedPositionChanges.length} unexplained position change(s).{" "}
                    {health.stalestPriceAgeDays === null
                      ? "No priced holding yet."
                      : `Stalest price is ${health.stalestPriceAgeDays} days old${health.isStale ? " (stale)" : ""}.`}
                  </p>
                </div>
              )}
            </Computed$>
          </Card>
        </div>

        <h2>More intelligence</h2>
        <p className="note">
          Everything else built in the v1.1 intelligence layer — not part of the primary
          section order above, but still one click away.
        </p>

        {wealth !== null && (
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
        )}

        {investment !== null && (
          <>
            <div className="grid grid--halves">
              <Card title="Portfolio growth decomposition">
                <Computed$ result={investment.growthDecomposition.result}>
                  {(decomposition) => (
                    <div className="table-scroll">
                      <table>
                        <tbody>
                          <tr>
                            <td>Opening value</td>
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
                              <strong>Closing value</strong>
                            </td>
                            <td className="num">
                              <strong>{formatMoney(decomposition.closingMinorUnits)}</strong>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </Computed$>
              </Card>

              <Card title="Contribution vs return">
                <Computed$ result={investment.contributionVsReturn.result}>
                  {(c) => (
                    <div className="table-scroll">
                      <table>
                        <tbody>
                          <tr>
                            <td>Net contribution</td>
                            <td className="num">{formatMoneySigned(c.netContributionMinorUnits)}</td>
                          </tr>
                          <tr>
                            <td>Market/residual return</td>
                            <td className="num">{formatMoneySigned(c.returnMinorUnits)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </Computed$>
              </Card>
            </div>

            <div className="grid grid--halves">
              <Card title="Portfolio performance">
                <Computed$ result={investment.performance.result}>
                  {(perf) => (
                    <div className="table-scroll">
                      <table>
                        <tbody>
                          <tr>
                            <td>Profit &amp; loss</td>
                            <td className="num">
                              <Computed$ result={perf.aggregatePnl} showReasons={false}>
                                {(pnl) => <>{formatMoneySigned(pnl.absoluteMinorUnits)}</>}
                              </Computed$>
                            </td>
                          </tr>
                          <tr>
                            <td>CAGR</td>
                            <td className="num">
                              <Computed$ result={perf.cagr} showReasons={false}>
                                {(cagr) => <>{formatRatioSigned(cagr)}</>}
                              </Computed$>
                            </td>
                          </tr>
                          <tr>
                            <td>XIRR</td>
                            <td className="num">
                              <Computed$ result={perf.xirr} showReasons={false}>
                                {(xirr) => <>{formatRatioSigned(xirr)}</>}
                              </Computed$>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </Computed$>
              </Card>

              <Card title="Portfolio vs benchmark">
                <Computed$ result={investment.portfolioVsBenchmark.result}>
                  {(rows) => (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Index</th>
                            <th className="num">Portfolio return</th>
                            <th className="num">Index return</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.indexCode}>
                              <td>{row.indexLabel}</td>
                              <td className="num" colSpan={row.result.kind === "ok" ? 1 : 2}>
                                <Computed$ result={row.result} showReasons={false}>
                                  {(r) => <>{formatRatioSigned(r.portfolioReturnRatio)}</>}
                                </Computed$>
                              </td>
                              {row.result.kind === "ok" && (
                                <td className="num">{formatRatioSigned(row.result.value.indexReturnRatio)}</td>
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
          </>
        )}

        <div className="grid grid--halves">
          <Card title="Goal collision detector">
            <Computed$ result={goalLiability.goalCollisionDetector.result}>
              {(collision) => (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Goal</th>
                        <th>Target date</th>
                        <th className="num">Required/month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collision.collidingGoals.map((goal) => (
                        <tr key={goal.goalId}>
                          <td>{goal.name}</td>
                          <td>{formatDate(goal.targetDate)}</td>
                          <td className="num">{formatMoney(goal.requiredMonthlyMinorUnits)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td>
                          <strong>Combined demand</strong>
                        </td>
                        <td />
                        <td className="num">
                          <strong>{formatMoney(collision.totalRequiredMonthlyMinorUnits)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td>Capacity (unallocated cash)</td>
                        <td />
                        <td className="num">{formatMoney(collision.monthlyCapacityMinorUnits)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {collision.shortfallMinorUnits > 0 && (
                    <p className="note" style={{ marginTop: "0.5rem" }}>
                      Combined demand exceeds capacity by {formatMoney(collision.shortfallMinorUnits)}/month.
                      This identifies the conflict only — the existing fixed priority order decides funding
                      order, not this widget.
                    </p>
                  )}
                </div>
              )}
            </Computed$>
          </Card>

          <Card title="Emergency fund runway">
            <Computed$ result={goalLiability.emergencyFundRunway.result}>
              {(runway) => <>{runway.monthsOfRunway} months</>}
            </Computed$>
          </Card>
        </div>

        <Card title="Goal trade-off simulator">
          <Computed$ result={goalLiability.goalTradeOffSimulator.result}>
            {(scenario) => (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Goal</th>
                      <th className="num">Funding starts (months)</th>
                      <th className="num">Months to complete</th>
                      <th>Projected completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenario.base.map((row) => (
                      <tr key={row.goalId}>
                        <td>{row.name}</td>
                        <td className="num">{row.monthsUntilFundingStarts}</td>
                        <td className="num">{row.monthsToComplete}</td>
                        <td>{formatDate(row.projectedCompletionDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="note" style={{ marginTop: "0.5rem" }}>
                  Scenario — assumes a monthly capacity of{" "}
                  {formatMoney(scenario.assumptions.monthlyCapacityMinorUnits as number)}. {scenario.disclaimer}
                </p>
              </div>
            )}
          </Computed$>
        </Card>

        <div className="grid grid--halves">
          <Card title="What's changed">
            <Computed$ result={behavioral.whatsChanged.result}>
              {(changed) => (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th className="num">This month</th>
                        <th className="num">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...changed.budgetVariances, ...changed.activityVariances]
                        .filter((v) => !v.incomplete)
                        .map((variance) => (
                          <tr key={variance.metric}>
                            <td>{`Δ ${variance.metric}`}</td>
                            <td className="num">
                              {variance.currentMinorUnits === null ? "—" : formatMoney(variance.currentMinorUnits)}
                            </td>
                            <td className="num">
                              {variance.absoluteMinorUnits === null
                                ? "—"
                                : formatMoneySigned(variance.absoluteMinorUnits)}
                            </td>
                          </tr>
                        ))}
                      <tr>
                        <td>Net worth</td>
                        <td className="num" colSpan={2}>
                          <Computed$ result={changed.netWorthVariance} showReasons={false}>
                            {(nw) => <>{formatMoneySigned(nw.deltaMinorUnits)}</>}
                          </Computed$>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Computed$>
          </Card>

          <Card title="Financial anomaly detector">
            <Computed$ result={behavioral.anomalyDetector.result}>
              {(findings) =>
                findings.length === 0 ? (
                  <EmptyState>No anomalies flagged.</EmptyState>
                ) : (
                  <ul className="alert-list">
                    {findings.map((finding, index) => (
                      <li key={`${finding.kind}-${index}`}>{finding.description}</li>
                    ))}
                  </ul>
                )
              }
            </Computed$>
          </Card>
        </div>

        <Card title="Historical coverage">
          <Computed$ result={behavioral.historicalCoverage.result}>
            {(historical) => (
              <div className="table-scroll">
                <p>Since {formatDate(historical.inceptionDate)}:</p>
                <table>
                  <tbody>
                    <tr>
                      <td>Fully covered months</td>
                      <td className="num">{historical.coverage.monthsCounted.length}</td>
                    </tr>
                    <tr>
                      <td>Partially covered months</td>
                      <td className="num">{historical.coverage.monthsPartial.length}</td>
                    </tr>
                    <tr>
                      <td>Missing months</td>
                      <td className="num">{historical.coverage.monthsMissing.length}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Computed$>
        </Card>

        <h2>Scenario engine</h2>

        <Card title="SIP increase simulator">
          <Computed$ result={scenarios.sipIncreaseSimulator.result}>
            {(scenario) => (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>SIP increase</th>
                      {[...new Set(scenario.base.map((r) => r.horizonYears))].map((years) => (
                        <th key={years} className="num">
                          {years}y
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(scenario.base.map((r) => r.increaseRatio))].map((ratio) => (
                      <tr key={ratio}>
                        <td>{formatRatio(ratio)}</td>
                        {scenario.base
                          .filter((r) => r.increaseRatio === ratio)
                          .map((r) => (
                            <td key={r.horizonYears} className="num">
                              <Computed$ result={r.projectedCorpus} showReasons={false}>
                                {(v) => <>{formatMoney(v)}</>}
                              </Computed$>
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="note" style={{ marginTop: "0.5rem" }}>
                  Illustrative comparison points, not a recommendation. {scenario.disclaimer}
                </p>
              </div>
            )}
          </Computed$>
        </Card>

        <div className="grid grid--halves">
          <Card title="Debt prepayment simulator">
            <Computed$ result={scenarios.debtPrepaymentSimulator.result}>
              {(scenario) => (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Liability</th>
                        <th className="num">Extra/month</th>
                        <th className="num">Payoff (months)</th>
                        <th className="num">Total interest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenario.base.map((row) => (
                        <tr key={`${row.liabilityId}-${row.extraMonthlyMinorUnits}`}>
                          <td>{row.liabilityName}</td>
                          <td className="num">{formatMoney(row.extraMonthlyMinorUnits)}</td>
                          <td className="num">
                            <Computed$ result={row.result} showReasons={false}>
                              {(r) => <>{r.monthsToPayoff}</>}
                            </Computed$>
                          </td>
                          <td className="num">
                            <Computed$ result={row.result} showReasons={false}>
                              {(r) => <>{formatMoney(r.totalInterestMinorUnits)}</>}
                            </Computed$>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="note" style={{ marginTop: "0.5rem" }}>
                    Illustrative extra amounts, not a recommended prepayment. {scenario.disclaimer}
                  </p>
                </div>
              )}
            </Computed$>
          </Card>

          <Card title="Wealth projection">
            <Computed$ result={scenarios.wealthProjection.result}>
              {(scenario) => (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Horizon</th>
                        <th className="num">Projected net worth</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenario.base.map((row) => (
                        <tr key={row.horizonYears}>
                          <td>{row.horizonYears} years</td>
                          <td className="num">
                            <Computed$ result={row.projectedNetWorth} showReasons={false}>
                              {(v) => <>{formatMoney(v)}</>}
                            </Computed$>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="note" style={{ marginTop: "0.5rem" }}>{scenario.disclaimer}</p>
                </div>
              )}
            </Computed$>
          </Card>
        </div>

        <Card title="Financial independence projection">
          <Computed$ result={scenarios.financialIndependenceProjection.result}>
            {(scenario) => (
              <div className="table-scroll">
                <table>
                  <tbody>
                    <tr>
                      <td>FI target (25x annual expense)</td>
                      <td className="num">{formatMoney(scenario.assumptions.fiTargetMinorUnits as number)}</td>
                    </tr>
                    <tr>
                      <td>Months to reach it</td>
                      <td className="num">
                        <Computed$ result={scenario.base} showReasons={false}>
                          {(months) => <>{months}</>}
                        </Computed$>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="note" style={{ marginTop: "0.5rem" }}>
                  Based on the widely-used 4% rule (25x annual expense), not this system&apos;s own
                  recommendation. {scenario.disclaimer}
                </p>
              </div>
            )}
          </Computed$>
        </Card>
      </div>
    </>
  );
}
