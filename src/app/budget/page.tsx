import Link from "next/link";
import {
  Card,
  Computed$,
  EmptyState,
  ExclusionList,
  TrustBadge,
} from "../../components/Primitives";
import { db } from "../../lib/db";
import {
  formatMoney,
  formatMoneySigned,
  formatPeriodMonth,
  formatRatio,
  formatRatioSigned,
} from "../../presentation/format";
import { getBudgetView } from "../../views/budgetView";
import { listPeriods, resolveLatestPeriod } from "../../views/context";
import { allocateToGoalAction } from "./actions";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  income: "Income",
  expense: "Expenses",
  emi: "EMIs",
  investment: "Investments",
};

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; allocated?: string; allocationError?: string }>;
}) {
  const params = await searchParams;
  const periods = await listPeriods(db);
  const latest = await resolveLatestPeriod(db);
  const selected = params.period ?? latest;

  if (selected === null || periods.length === 0) {
    return (
      <>
        <div className="page-header">
          <h1>Budget</h1>
        </div>
        <Card>
          <EmptyState>
            No budget workbook has been imported yet. Import one to see monthly income,
            expenses, EMIs and planned investments here.
          </EmptyState>
        </Card>
      </>
    );
  }

  const view = await getBudgetView(db, selected, periods);

  return (
    <>
      <div className="page-header">
        <h1>Budget</h1>
        <p>{formatPeriodMonth(view.periodMonth)}</p>
      </div>

      <div className="stack">
        {params.allocated !== undefined && (
          <p className="alert">Contribution recorded.</p>
        )}
        {params.allocationError !== undefined && (
          <p className="alert alert--caution">{params.allocationError}</p>
        )}

        <Card title="Period">
          <ul className="inline-list">
            {view.availablePeriods.map((period) => (
              <li key={period}>
                {/*
                  aria-current="true", not "page": these switch a filter on
                  this screen rather than navigating to a different page, and
                  using "page" here would leave two elements claiming to be
                  the current page alongside the sidebar link.
                */}
                <Link
                  href={`/budget?period=${period}`}
                  className={`badge ${period === view.periodMonth ? "badge--accent" : "badge--muted"}`}
                  aria-current={period === view.periodMonth ? "true" : undefined}
                >
                  {formatPeriodMonth(period)}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Summary">
          <Computed$ result={view.summary}>
            {(summary) => (
              <>
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
                          <strong>Retained</strong>{" "}
                          <span className="note">(income − expenses − EMIs)</span>
                        </td>
                        <td className="num">
                          <strong>{formatMoney(summary.retainedMinorUnits)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <strong>Left over cash</strong>{" "}
                          <span className="note">(retained − investments)</span>
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
                      <tr>
                        <td>Investment rate</td>
                        <td className="num">
                          <Computed$ result={summary.investmentRate} showReasons={false}>
                            {(rate) => <>{formatRatio(rate)}</>}
                          </Computed$>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <ExclusionList exclusions={summary.exclusions} />
              </>
            )}
          </Computed$>
        </Card>

        <Card title="Allocate leftover cash to a goal">
          <div className="table-scroll">
            <table>
              <tbody>
                <tr>
                  <td>Already allocated to goals this period</td>
                  <td className="num">
                    {formatMoney(view.alreadyAllocatedToGoalsMinorUnits)}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Remaining to allocate</strong>
                  </td>
                  <td className="num">
                    <Computed$ result={view.remainingToAllocateMinorUnits} showReasons={false}>
                      {(remaining) => <strong>{formatMoney(remaining)}</strong>}
                    </Computed$>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {view.remainingToAllocateMinorUnits.kind === "ok" &&
            view.remainingToAllocateMinorUnits.value <= 0 && (
              <p className="alert alert--caution" style={{ marginTop: "0.5rem" }}>
                Nothing is left to allocate this period — an allocation below will be
                refused until more cash is left over or an earlier one is withdrawn.
              </p>
            )}

          {view.allocatableGoals.length === 0 ? (
            <p className="note" style={{ marginTop: "0.5rem" }}>
              No goal is currently open to contributions.
            </p>
          ) : (
            <form action={allocateToGoalAction} className="entry-form" style={{ marginTop: "0.75rem" }}>
              <input type="hidden" name="periodMonth" value={view.periodMonth} />
              <select
                name="goalId"
                className="field__input"
                aria-label="Goal to allocate to"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  Choose a goal
                </option>
                {view.allocatableGoals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.name}
                  </option>
                ))}
              </select>
              <input
                className="field__input"
                name="amount"
                inputMode="decimal"
                placeholder="e.g. 1000"
                aria-label="Amount to allocate, in rupees"
                required
              />
              <button type="submit" className="button button--primary">
                Allocate
              </button>
            </form>
          )}
        </Card>

        <Card title="Plan vs Reality">
          <Computed$ result={view.planVsReality}>
            {(comparison) => (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="num">Planned</th>
                      <th className="num">Actual</th>
                      <th className="num">Variance</th>
                      <th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.categories.map((row) => (
                      <tr key={row.category}>
                        <td>{CATEGORY_LABELS[row.category] ?? row.category}</td>
                        <td className="num">{formatMoney(row.plannedMinorUnits)}</td>
                        <td className="num">
                          {row.actualMinorUnits === null ? (
                            <span className="badge badge--muted">No data</span>
                          ) : (
                            formatMoney(row.actualMinorUnits)
                          )}
                        </td>
                        <td className="num">
                          {row.varianceMinorUnits === null
                            ? "—"
                            : formatMoneySigned(row.varianceMinorUnits)}
                        </td>
                        <td className="num">
                          {row.varianceRatio === null ? "—" : formatRatioSigned(row.varianceRatio)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {comparison.hasNoActuals && (
                  <p className="note" style={{ marginTop: "0.6rem" }}>
                    No confirmed activity is recorded for this period. Missing actuals are
                    shown as &ldquo;no data&rdquo; rather than as zero, which would claim a
                    100% underspend that never happened.
                  </p>
                )}
              </div>
            )}
          </Computed$>
        </Card>

        <Card title={`Line items (${view.lines.length})`}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Line</th>
                  <th className="num">Amount</th>
                  <th>Trust</th>
                </tr>
              </thead>
              <tbody>
                {view.lines.map((line) => (
                  <tr key={line.id} className={line.isTrusted ? undefined : "is-untrusted"}>
                    <td>{CATEGORY_LABELS[line.category] ?? line.category}</td>
                    <td className="label-cell">{line.labelRaw}</td>
                    <td className="num">
                      {line.amountMinorUnits === null ? (
                        <span className="note">no amount</span>
                      ) : (
                        formatMoney(line.amountMinorUnits)
                      )}
                    </td>
                    <td>
                      <TrustBadge trustState={line.trustState} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
