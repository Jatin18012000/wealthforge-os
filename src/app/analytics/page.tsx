import Link from "next/link";
import { Card, Computed$, EmptyState } from "../../components/Primitives";
import { PERIOD_OPTIONS, isPeriodKey, periodLabel, type PeriodKey } from "../../domain";
import { db } from "../../lib/db";
import {
  formatDate,
  formatMoney,
  formatMoneySigned,
  formatRatio,
  formatRatioSigned,
} from "../../presentation/format";
import { getAnalyticsView, type ComparisonMode } from "../../views/analyticsView";
import { resolveAsOf } from "../../views/context";

export const dynamic = "force-dynamic";

const DEFAULT_PERIOD: PeriodKey = "3m";

function href(
  period: PeriodKey,
  compare: ComparisonMode,
  kind?: string,
  assetClass?: string,
): string {
  const params = new URLSearchParams({ period, compare });
  if (kind !== undefined && kind !== "") params.set("kind", kind);
  if (assetClass !== undefined && assetClass !== "") params.set("assetClass", assetClass);
  return `/analytics?${params.toString()}`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    compare?: string;
    kind?: string;
    assetClass?: string;
  }>;
}) {
  const params = await searchParams;
  const anchor = await resolveAsOf(db);

  const periodKey: PeriodKey =
    params.period !== undefined && isPeriodKey(params.period) ? params.period : DEFAULT_PERIOD;
  const comparisonMode: ComparisonMode =
    params.compare === "prior-year" ? "prior-year" : "preceding";
  const selectedKind = params.kind ?? "";
  const selectedAssetClass = params.assetClass ?? "";

  const filters = {
    ...(selectedKind === "" ? {} : { kinds: [selectedKind] }),
    ...(selectedAssetClass === "" ? {} : { assetClasses: [selectedAssetClass] }),
  };

  const view = await getAnalyticsView(db, anchor, periodKey, {
    comparisonMode,
    ...(Object.keys(filters).length === 0 ? {} : { filters }),
  });

  return (
    <>
      <div className="page-header">
        <h1>Analytics</h1>
        <p>
          Measured against {formatDate(anchor)} — the most recent date the data covers.
        </p>
      </div>

      <div className="stack">
        <Card title="Period">
          <ul className="inline-list">
            {PERIOD_OPTIONS.filter((option) => option.key !== "custom").map((option) => (
              <li key={option.key}>
                <Link
                  href={href(option.key, comparisonMode, selectedKind, selectedAssetClass)}
                  className={`badge ${option.key === periodKey ? "badge--accent" : "badge--muted"}`}
                  aria-current={option.key === periodKey ? "true" : undefined}
                >
                  {option.label}
                </Link>
              </li>
            ))}
          </ul>

          <h3 className="card__title" style={{ marginTop: "1rem" }}>
            Compare against
          </h3>
          <ul className="inline-list">
            {(
              [
                ["preceding", "Preceding period"],
                ["prior-year", "Same period last year"],
              ] as const
            ).map(([mode, label]) => (
              <li key={mode}>
                <Link
                  href={href(periodKey, mode, selectedKind, selectedAssetClass)}
                  className={`badge ${mode === comparisonMode ? "badge--accent" : "badge--muted"}`}
                  aria-current={mode === comparisonMode ? "true" : undefined}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>

          {view.availableActivityKinds.length > 0 && (
            <>
              <h3 className="card__title" style={{ marginTop: "1rem" }}>
                Filter activity
              </h3>
              <ul className="inline-list">
                <li>
                  <Link
                    href={href(periodKey, comparisonMode, undefined, selectedAssetClass)}
                    className={`badge ${selectedKind === "" ? "badge--accent" : "badge--muted"}`}
                    aria-current={selectedKind === "" ? "true" : undefined}
                  >
                    All activity
                  </Link>
                </li>
                {view.availableActivityKinds.map((kind) => (
                  <li key={kind}>
                    <Link
                      href={href(periodKey, comparisonMode, kind, selectedAssetClass)}
                      className={`badge ${kind === selectedKind ? "badge--accent" : "badge--muted"}`}
                      aria-current={kind === selectedKind ? "true" : undefined}
                    >
                      {kind.replace(/_/g, " ")}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {view.availableAssetClasses.length > 0 && (
            <>
              <h3 className="card__title" style={{ marginTop: "1rem" }}>
                Filter asset class
              </h3>
              <p className="note">Applies to the planned-vs-held allocation table below.</p>
              <ul className="inline-list">
                <li>
                  <Link
                    href={href(periodKey, comparisonMode, selectedKind)}
                    className={`badge ${selectedAssetClass === "" ? "badge--accent" : "badge--muted"}`}
                    aria-current={selectedAssetClass === "" ? "true" : undefined}
                  >
                    All asset classes
                  </Link>
                </li>
                {view.availableAssetClasses.map((assetClass) => (
                  <li key={assetClass}>
                    <Link
                      href={href(periodKey, comparisonMode, selectedKind, assetClass)}
                      className={`badge ${assetClass === selectedAssetClass ? "badge--accent" : "badge--muted"}`}
                      aria-current={assetClass === selectedAssetClass ? "true" : undefined}
                    >
                      {assetClass.replace(/_/g, " ")}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Computed$ result={view.range}>
          {(range) => (
            <Card title={`${periodLabel(periodKey)} · ${formatDate(range.start)} to ${formatDate(range.end)}`}>
              {view.comparison === null ? (
                <EmptyState>Nothing to compare for this period.</EmptyState>
              ) : (
                <>
                  {view.comparison.coverageNotes.length > 0 && (
                    <ul className="alert-list" style={{ marginBottom: "1rem" }}>
                      {view.comparison.coverageNotes.map((note) => (
                        <li key={note} className="alert alert--caution">
                          <div>
                            <span className="alert__title">Data coverage</span>
                            <p className="alert__detail">{note}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="table-scroll">
                    <table>
                      <caption className="visually-hidden">
                        Planned budget figures compared with the preceding period
                      </caption>
                      <thead>
                        <tr>
                          <th>Planned</th>
                          <th className="num">Selected</th>
                          <th className="num">Comparison</th>
                          <th className="num">Change</th>
                          <th className="num">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.comparison.budgetVariances.map((variance) => (
                          <tr key={variance.metric}>
                            <td>{variance.metric}</td>
                            <td className="num">
                              {variance.currentMinorUnits === null ? (
                                <span className="badge badge--muted">No data</span>
                              ) : (
                                formatMoney(variance.currentMinorUnits)
                              )}
                            </td>
                            <td className="num">
                              {variance.priorMinorUnits === null ? (
                                <span className="badge badge--muted">No data</span>
                              ) : (
                                formatMoney(variance.priorMinorUnits)
                              )}
                            </td>
                            <td className="num">
                              {variance.absoluteMinorUnits === null
                                ? "—"
                                : formatMoneySigned(variance.absoluteMinorUnits)}
                            </td>
                            <td className="num">
                              {variance.ratio === null ? "—" : formatRatioSigned(variance.ratio)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h3 className="card__title" style={{ marginTop: "1.25rem" }}>
                    Confirmed activity
                  </h3>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Actual</th>
                          <th className="num">Selected</th>
                          <th className="num">Comparison</th>
                          <th className="num">Change</th>
                          <th className="num">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.comparison.activityVariances.map((variance) => (
                          <tr key={variance.metric}>
                            <td>{variance.metric}</td>
                            <td className="num">
                              {variance.currentMinorUnits === null ? (
                                <span className="badge badge--muted">No data</span>
                              ) : (
                                formatMoney(variance.currentMinorUnits)
                              )}
                            </td>
                            <td className="num">
                              {variance.priorMinorUnits === null ? (
                                <span className="badge badge--muted">No data</span>
                              ) : (
                                formatMoney(variance.priorMinorUnits)
                              )}
                            </td>
                            <td className="num">
                              {variance.absoluteMinorUnits === null
                                ? "—"
                                : formatMoneySigned(variance.absoluteMinorUnits)}
                            </td>
                            <td className="num">
                              {variance.ratio === null ? "—" : formatRatioSigned(variance.ratio)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="note" style={{ marginTop: "0.7rem" }}>
                    Months counted: {view.comparison.current.coverage.monthsCounted.join(", ") || "none"}.
                    Budget figures are recorded per whole month, so a month the range only
                    partly covers is excluded rather than divided up.
                  </p>
                </>
              )}
            </Card>
          )}
        </Computed$>

        <Card title="Planned allocation vs what is held">
          {view.allocation.length === 0 ? (
            <EmptyState>
              No planned investment lines or holdings fall in this period.
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th className="num">Planned</th>
                    <th className="num">Planned share</th>
                    <th className="num">Held</th>
                    <th className="num">Held share</th>
                  </tr>
                </thead>
                <tbody>
                  {view.allocation.map((row) => (
                    <tr key={row.label}>
                      <td className="label-cell">{row.label}</td>
                      <td className="num">
                        {row.plannedMinorUnits === null ? (
                          <span className="badge badge--muted">Not planned</span>
                        ) : (
                          formatMoney(row.plannedMinorUnits)
                        )}
                      </td>
                      <td className="num">
                        {row.plannedRatio === null ? "—" : formatRatio(row.plannedRatio)}
                      </td>
                      <td className="num">
                        {row.observedMinorUnits === null ? (
                          <span className="badge badge--muted">Not held</span>
                        ) : (
                          formatMoney(row.observedMinorUnits)
                        )}
                      </td>
                      <td className="num">
                        {row.observedRatio === null ? "—" : formatRatio(row.observedRatio)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note" style={{ marginTop: "0.7rem" }}>
                A line planned but not held, or held but never planned, keeps a blank on the
                other side — the two situations are different and should not look identical.
              </p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
