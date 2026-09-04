import Link from "next/link";
import { Card, EmptyState, InsufficientData } from "../../components/Primitives";
import {
  DASHBOARD_WIDGET_CATALOG,
  type AdjustmentUnit,
  type DashboardLayoutPreferences,
} from "../../domain";
import { db } from "../../lib/db";
import type { OverrideTarget } from "../../manual/overrides";
import { formatDate, formatPeriodMonth } from "../../presentation/format";
import { entryValueString } from "../../presentation/parse";
import {
  entryUnitHint,
  formatUnitValue,
  formatUnitValueSigned,
} from "../../presentation/units";
import { getDashboardLayoutPreferences } from "../../views/dashboardLayoutStore";
import {
  getSettingsView,
  toMode,
  type OverrideEntry,
  type PreviewPanel,
} from "../../views/settingsView";
import {
  applyOverrideAction,
  resetDashboardLayoutAction,
  revokeOverrideAction,
  saveDashboardLayoutAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Settings — manual controls.
 *
 * Overriding a figure is a two-step flow on purpose: the first submission
 * only computes what would happen, and the resulting arithmetic — source
 * value, adjustment, resulting value — is what the user confirms
 * (docs/04_USER_FLOWS.md, "Manually override a value"). Nothing is written
 * until that confirmation.
 */

function targetKey(target: OverrideTarget): string {
  return `${target.definition.entityType}.${target.definition.field}.${target.entityId}`;
}

function ValueCell({ value, unit }: { value: number | null; unit: AdjustmentUnit }) {
  if (value === null) return <span className="note">No value recorded</span>;
  return <>{formatUnitValue(value, unit)}</>;
}

function OverrideForm({ target, period }: { target: OverrideTarget; period: string }) {
  const { definition } = target;

  return (
    <form method="get" action="/settings" className="entry-form">
      <input type="hidden" name="entityType" value={definition.entityType} />
      <input type="hidden" name="entityId" value={target.entityId} />
      <input type="hidden" name="field" value={definition.field} />
      <input type="hidden" name="period" value={period} />

      <label className="field">
        <span className="field__label">How</span>
        <select className="field__select" name="mode" defaultValue="set">
          <option value="set">Set to</option>
          {definition.allowsDelta && <option value="delta">Adjust by</option>}
        </select>
      </label>

      <label className="field">
        <span className="field__label">{entryUnitHint(definition.unit)}</span>
        <input
          className="field__input"
          name="value"
          inputMode="decimal"
          defaultValue={entryValueString(target.currentValue, definition.unit)}
          aria-label={`New value for ${definition.label}, ${target.label}`}
        />
      </label>

      <label className="field">
        <span className="field__label">Why</span>
        <input
          className="field__input field__input--wide"
          name="reason"
          placeholder="Optional note kept with the override"
          aria-label={`Reason for overriding ${definition.label}, ${target.label}`}
        />
      </label>

      <button type="submit" className="button">
        Preview
      </button>
    </form>
  );
}

function PreviewCard({ preview, period }: { preview: PreviewPanel; period: string }) {
  const { entry, result } = preview;

  return (
    <Card title="Confirm this override">
      {result.kind !== "ok" ? (
        <>
          <p className="note">
            Nothing has been changed. This is what the entered value would run into:
          </p>
          <InsufficientData reasons={result.reasons} />
          <p style={{ marginTop: "0.6rem" }}>
            <Link
              href={period === "" ? "/settings" : `/settings?period=${period}`}
              className="button button--quiet"
            >
              Back
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="note">
            {result.value.definition.label}
            {preview.target === null ? "" : ` · ${preview.target.label}`}
          </p>

          <p className="equation">
            <span>
              <span className="field__label">Source value </span>
              {result.value.sourceValue === null ? (
                <span className="note">none</span>
              ) : (
                formatUnitValue(result.value.sourceValue, result.value.unit)
              )}
            </span>
            <span className="equation__operator">+</span>
            <span>
              <span className="field__label">Manual adjustment </span>
              {formatUnitValueSigned(result.value.adjustmentValue, result.value.unit)}
            </span>
            <span className="equation__operator">=</span>
            <span className="equation__result">
              <span className="field__label">Current value </span>
              {formatUnitValue(result.value.resultingValue, result.value.unit)}
            </span>
          </p>

          {result.value.sourceValue === null && (
            <p className="note">
              This field has no imported source value, so the figure entered is the whole
              of it — nothing is being layered on top of a source.
            </p>
          )}

          {result.value.mode === "delta" && (
            <p className="note">
              Recorded as a difference: a later import that changes the source value will
              carry this adjustment forward rather than being overruled by a figure fixed
              today.
            </p>
          )}

          {result.value.companion !== null && (
            <p className="alert">
              <span className="alert__title">
                {result.value.companion.label}&apos;s share moves with it.
              </span>{" "}
              {formatUnitValue(result.value.companion.sourceValue, result.value.unit)} →{" "}
              {formatUnitValue(result.value.companion.resultingValue, result.value.unit)},
              so the payer shares still total 100%. Both are recorded together.
            </p>
          )}

          {result.value.isNoOp && (
            <p className="alert alert--caution">
              This matches the source value exactly, so it would change nothing.
            </p>
          )}

          <form
            action={applyOverrideAction}
            className="entry-form"
            style={{ marginTop: "0.6rem" }}
          >
            <input type="hidden" name="entityType" value={entry.entityType} />
            <input type="hidden" name="entityId" value={entry.entityId} />
            <input type="hidden" name="field" value={entry.field} />
            <input type="hidden" name="mode" value={entry.mode} />
            <input type="hidden" name="value" value={entry.value} />
            <input type="hidden" name="reason" value={entry.reason} />
            <input type="hidden" name="period" value={period} />
            <button type="submit" className="button button--primary">
              Confirm override
            </button>
            <Link
              href={period === "" ? "/settings" : `/settings?period=${period}`}
              className="button button--quiet"
            >
              Cancel
            </Link>
          </form>

          <p className="note" style={{ marginTop: "0.5rem" }}>
            The source value is not modified. Withdrawing this override at any time
            restores it exactly.
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * v1.1.1 F4 — dashboard personalization.
 *
 * Renders one row per catalog widget grouped by section. A required
 * (non-hideable) widget's checkbox is disabled and forced checked rather
 * than omitted, so the user can see it exists and why it can't be turned
 * off, instead of it silently not appearing in the list.
 */
function DashboardLayoutCard({
  preferences,
}: {
  preferences: DashboardLayoutPreferences;
}) {
  const prefById = new Map(preferences.widgets.map((w) => [w.id, w]));
  const sections = [...new Set(DASHBOARD_WIDGET_CATALOG.map((w) => w.section))];

  return (
    <Card title="Dashboard layout">
      <p className="note" style={{ marginBottom: "0.6rem" }}>
        Choose which Command Center widgets appear, their order, and which are favorited
        (favorites always render first among the widgets you keep visible).
      </p>
      <form action={saveDashboardLayoutAction} className="stack" style={{ gap: "1rem" }}>
        <label className="field">
          <span className="field__label">Density</span>
          <select
            className="field__select"
            name="density"
            defaultValue={preferences.density}
            aria-label="Dashboard density"
          >
            <option value="expanded">Expanded</option>
            <option value="compact">Compact</option>
          </select>
        </label>

        {sections.map((section) => (
          <div key={section}>
            <p className="note" style={{ marginBottom: "0.3rem" }}>
              <strong>{section}</strong>
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Widget</th>
                    <th scope="col">Visible</th>
                    <th scope="col">Order</th>
                    <th scope="col">Favorite</th>
                  </tr>
                </thead>
                <tbody>
                  {DASHBOARD_WIDGET_CATALOG.filter((w) => w.section === section).map(
                    (widget) => {
                      const pref = prefById.get(widget.id);
                      const visible = pref?.visible ?? true;
                      const order = pref?.order ?? widget.defaultOrder;
                      const favorite = pref?.favorite ?? false;
                      return (
                        <tr key={widget.id}>
                          <td>{widget.label}</td>
                          <td>
                            <input
                              type="checkbox"
                              name={`visible_${widget.id}`}
                              defaultChecked={visible}
                              disabled={!widget.hideable}
                              aria-label={`Show ${widget.label}`}
                            />
                          </td>
                          <td>
                            <input
                              className="field__input"
                              type="number"
                              name={`order_${widget.id}`}
                              defaultValue={order}
                              style={{ width: "5rem" }}
                              aria-label={`Order for ${widget.label}`}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              name={`favorite_${widget.id}`}
                              defaultChecked={favorite}
                              aria-label={`Favorite ${widget.label}`}
                            />
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div>
          <button type="submit" className="button button--primary">
            Save layout
          </button>
        </div>
      </form>

      <form action={resetDashboardLayoutAction} style={{ marginTop: "0.6rem" }}>
        <button type="submit" className="button button--quiet">
          Reset to default layout
        </button>
      </form>
    </Card>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };

  const requestedPeriod = one("period");
  const entityType = one("entityType");
  const entityId = one("entityId");
  const field = one("field");

  const entry: OverrideEntry | undefined =
    entityType !== "" && entityId !== "" && field !== ""
      ? {
          entityType,
          entityId,
          field,
          mode: toMode(one("mode")),
          value: one("value"),
          reason: one("reason"),
        }
      : undefined;

  const view = await getSettingsView(db, {
    ...(requestedPeriod === "" ? {} : { periodMonth: requestedPeriod }),
    ...(entry === undefined ? {} : { entry }),
  });
  const dashboardLayout = await getDashboardLayoutPreferences(db);

  const period = view.periodMonth ?? "";
  const applied = one("applied");
  const error = one("error");
  const layoutSaved = one("layoutSaved");
  const layoutReset = one("layoutReset");

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
        <p>
          Every figure below can be overridden by hand. An override never replaces what
          the source said — it is recorded separately as source value + adjustment =
          current value, applies everywhere at once, and can be withdrawn to restore the
          source exactly.
        </p>
      </div>

      <div className="stack">
        {error !== "" && (
          <p className="alert alert--caution">
            <span className="alert__title">Nothing was changed.</span> {error}
          </p>
        )}
        {applied !== "" && (
          <p className="alert">
            <span className="alert__title">{applied} overridden.</span> Every screen now
            uses the new value.
          </p>
        )}
        {one("withdrawn") !== "" && (
          <p className="alert">
            <span className="alert__title">Override withdrawn.</span> The source value
            applies again.
          </p>
        )}
        {layoutSaved !== "" && (
          <p className="alert">
            <span className="alert__title">Dashboard layout saved.</span> The Command
            Center now reflects it.
          </p>
        )}
        {layoutReset !== "" && (
          <p className="alert">
            <span className="alert__title">Dashboard layout reset.</span> Every widget is
            visible again in its default order.
          </p>
        )}

        {view.preview !== null && <PreviewCard preview={view.preview} period={period} />}

        <Card title="Budget period">
          {view.periods.length === 0 ? (
            <EmptyState>No budget periods have been imported yet.</EmptyState>
          ) : (
            <>
              <p className="note">
                Budget lines are per month, so the lines listed below are the ones in this
                period.
              </p>
              <ul className="inline-list">
                {view.periods.map((candidate) => (
                  <li key={candidate}>
                    <Link
                      href={`/settings?period=${candidate}`}
                      className={`badge ${candidate === view.periodMonth ? "badge--accent" : "badge--muted"}`}
                      aria-current={candidate === view.periodMonth ? "true" : undefined}
                    >
                      {formatPeriodMonth(candidate)}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {view.groups.length === 0 ? (
          <Card>
            <EmptyState>
              Nothing has been imported yet, so there are no values to override.
            </EmptyState>
          </Card>
        ) : (
          view.groups.map((group) => (
            <Card key={group.group} title={group.group}>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Value</th>
                      <th scope="col" className="num">
                        Source
                      </th>
                      <th scope="col" className="num">
                        Manual adjustment
                      </th>
                      <th scope="col" className="num">
                        Current
                      </th>
                      <th scope="col">Override</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.targets.map((target) => (
                      <tr key={targetKey(target)}>
                        <td>
                          {target.label}
                          <br />
                          <span className="note">{target.definition.label}</span>
                        </td>
                        <td className="num">
                          <ValueCell
                            value={target.sourceValue}
                            unit={target.definition.unit}
                          />
                        </td>
                        <td className="num">
                          {target.effective === null ? (
                            <span className="note">—</span>
                          ) : (
                            <>
                              {formatUnitValueSigned(
                                target.effective.adjustmentValue,
                                target.definition.unit,
                              )}
                              <br />
                              <span className="note">
                                {target.effective.mode === "delta"
                                  ? "difference"
                                  : "stated"}{" "}
                                · {formatDate(target.effective.appliedAt)}
                              </span>
                              {target.effective.sourceMovedSince && (
                                <>
                                  <br />
                                  <span className="badge badge--caution">
                                    source has changed since
                                  </span>
                                </>
                              )}
                            </>
                          )}
                        </td>
                        <td className="num">
                          <ValueCell
                            value={target.currentValue}
                            unit={target.definition.unit}
                          />
                        </td>
                        <td>
                          {target.unresolved.length > 0 && (
                            <InsufficientData reasons={target.unresolved} />
                          )}
                          <OverrideForm target={target} period={period} />
                          {target.effective !== null && (
                            <form
                              action={revokeOverrideAction}
                              style={{ marginTop: "0.35rem" }}
                            >
                              <input
                                type="hidden"
                                name="adjustmentId"
                                value={target.effective.adjustmentId}
                              />
                              <input type="hidden" name="period" value={period} />
                              <button type="submit" className="button button--quiet">
                                Withdraw override
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note" style={{ marginTop: "0.5rem" }}>
                {group.targets[0]?.definition.help}
              </p>
            </Card>
          ))
        )}

        <Card title={`Override history — ${view.activeCount} in force`}>
          {view.history.length === 0 ? (
            <EmptyState>No value has been overridden yet.</EmptyState>
          ) : (
            <>
              <p className="note">
                Withdrawn overrides are kept: that a figure was once changed by hand, and
                then changed back, is itself part of the record.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Field</th>
                      <th scope="col" className="num">
                        Source at the time
                      </th>
                      <th scope="col" className="num">
                        Resulting value
                      </th>
                      <th scope="col">Reason</th>
                      <th scope="col">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.history.map((row) => (
                      <tr key={row.adjustment.id}>
                        <td>{formatDate(row.adjustment.createdAt)}</td>
                        <td>{row.definition?.label ?? row.adjustment.field}</td>
                        <td className="num">
                          <ValueCell
                            value={row.adjustment.sourceValueAtEntry}
                            unit={row.adjustment.unit}
                          />
                        </td>
                        <td className="num">
                          {row.resolved === null ? (
                            <span className="note">could not be applied</span>
                          ) : (
                            formatUnitValue(
                              row.resolved.currentValue,
                              row.adjustment.unit,
                            )
                          )}
                        </td>
                        <td>
                          {row.adjustment.reason ?? <span className="note">—</span>}
                        </td>
                        <td>
                          {row.adjustment.revokedAt === null ? (
                            <span className="badge badge--accent">In force</span>
                          ) : (
                            <span className="badge badge--muted">
                              Withdrawn {formatDate(row.adjustment.revokedAt)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <DashboardLayoutCard preferences={dashboardLayout} />
      </div>
    </>
  );
}
