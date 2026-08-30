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
  searchParams: Promise<{ period?: string }>;
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
