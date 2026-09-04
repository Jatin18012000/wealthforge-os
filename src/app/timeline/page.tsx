import Link from "next/link";
import { Card, EmptyState, TrustBadge } from "../../components/Primitives";
import type { TimelineBucket, TimelineEntry } from "../../domain";
import { db } from "../../lib/db";
import { formatMoney, formatPeriodMonth } from "../../presentation/format";
import { getWealthTimelineView } from "../../views/timelineView";

export const dynamic = "force-dynamic";

const BUCKET_LABELS: Record<TimelineBucket, string> = {
  confirmed_activity: "Confirmed activity",
  observed: "Observed",
  plan: "Plan",
};

const FILTERS: readonly { value: TimelineBucket | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "confirmed_activity", label: "Confirmed activity" },
  { value: "observed", label: "Observed" },
  { value: "plan", label: "Plan" },
];

function isTimelineBucket(value: string): value is TimelineBucket {
  return value === "confirmed_activity" || value === "observed" || value === "plan";
}

function formatUTCDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function WhenCell({ entry }: { entry: TimelineEntry }) {
  if (entry.date !== null) return <>{formatUTCDate(entry.date)}</>;
  if (entry.periodMonth !== null) return <>{formatPeriodMonth(entry.periodMonth)} (planned)</>;
  return <span className="note">—</span>;
}

/**
 * Unified Wealth Timeline (v1.1.1 F6).
 *
 * A single chronological feed over three sources that already exist
 * elsewhere on their own screens (budget plan lines, portfolio/goal/EMI
 * activity, and portfolio position snapshots) — this screen composes them,
 * it does not recompute anything they already state
 * (`docs/30_V1_1_1_COMMAND_CENTER_POLISH.md`, F6).
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const bucketParam = params.bucket;
  const bucketRaw = typeof bucketParam === "string" ? bucketParam : "";
  const bucket = isTimelineBucket(bucketRaw) ? bucketRaw : undefined;

  const view = await getWealthTimelineView(db, bucket === undefined ? {} : { bucket });

  return (
    <>
      <div className="page-header">
        <h1>Timeline</h1>
        <p>
          Every plan line, confirmed activity, and observed position in one chronological
          feed — most recent first. Nothing here is a new calculation; each row restates one
          record that already exists on its own screen.
        </p>
      </div>

      <div className="stack">
        <Card title="Filter">
          <ul className="inline-list">
            {FILTERS.map((filter) => (
              <li key={filter.value}>
                <Link
                  href={filter.value === "" ? "/timeline" : `/timeline?bucket=${filter.value}`}
                  className={`badge ${bucket === filter.value || (filter.value === "" && bucket === undefined) ? "badge--accent" : "badge--muted"}`}
                  aria-current={
                    bucket === filter.value || (filter.value === "" && bucket === undefined)
                      ? "true"
                      : undefined
                  }
                >
                  {filter.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Timeline">
          {view.entries.length === 0 ? (
            <EmptyState>Nothing to show for this filter yet.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Type</th>
                    <th scope="col">What</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Trust</th>
                  </tr>
                </thead>
                <tbody>
                  {view.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <WhenCell entry={entry} />
                      </td>
                      <td>{BUCKET_LABELS[entry.bucket]}</td>
                      <td>{entry.label}</td>
                      <td className="num">
                        {entry.amountMinorUnits === null ? (
                          <span className="note">—</span>
                        ) : (
                          formatMoney(entry.amountMinorUnits)
                        )}
                      </td>
                      <td>
                        <TrustBadge trustState={entry.trustState} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {view.limitApplied && (
                <p className="note" style={{ marginTop: "0.5rem" }}>
                  Showing the {view.entries.length} most recent of {view.totalBeforeLimit}{" "}
                  matching entries.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
