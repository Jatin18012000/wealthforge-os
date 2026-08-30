import { Card, Computed$, EmptyState, ProgressBar } from "../../components/Primitives";
import { db } from "../../lib/db";
import { formatDate, formatMoney, formatRatio } from "../../presentation/format";
import { resolveAsOf } from "../../views/context";
import { getGoalsView, type GoalCard } from "../../views/goalsView";

export const dynamic = "force-dynamic";

const LIFECYCLE_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In progress",
  achieved: "Achieved",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

function GoalPanel({ card }: { card: GoalCard }) {
  const { goal, progress, projection } = card;

  return (
    <Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
          marginBottom: "0.5rem",
        }}
      >
        <h2 className="section-heading" style={{ margin: 0 }}>
          {goal.name}
        </h2>
        <span className="badge badge--muted">
          {LIFECYCLE_LABELS[goal.lifecycleState] ?? goal.lifecycleState}
        </span>
      </div>

      <div className="inline-list" style={{ marginBottom: "0.7rem" }}>
        <span className="badge badge--muted">Priority {goal.priorityRank}</span>
        {progress.isProtected && (
          <span className="badge badge--accent">
            Protected from ordinary reallocation
          </span>
        )}
        {goal.targetDate !== null && (
          <span className="badge badge--muted">Target {formatDate(goal.targetDate)}</span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "0.3rem",
        }}
      >
        <strong>{formatMoney(progress.currentAmountMinorUnits)}</strong>
        <span className="note">of {formatMoney(goal.targetAmountMinorUnits)}</span>
      </div>

      <ProgressBar
        ratio={progress.progressRatio.kind === "ok" ? progress.progressRatio.value : 0}
        label={`${goal.name} progress`}
      />

      <div className="table-scroll" style={{ marginTop: "0.7rem" }}>
        <table>
          <tbody>
            <tr>
              <td>Remaining</td>
              <td className="num">{formatMoney(progress.remainingMinorUnits)}</td>
            </tr>
            <tr>
              <td>Progress</td>
              <td className="num">
                <Computed$ result={progress.progressRatio} showReasons={false}>
                  {(ratio) => <>{formatRatio(ratio)}</>}
                </Computed$>
              </td>
            </tr>
            <tr>
              <td>Funding history</td>
              <td className="num">
                {progress.contributionCount} in, {progress.withdrawalCount} out
              </td>
            </tr>
            <tr>
              <td>Projected completion</td>
              <td className="num">
                <Computed$ result={projection} showReasons={false}>
                  {(value) => (
                    <>
                      {formatDate(value.projectedCompletion)}
                      <br />
                      <span className="note">
                        {value.monthsToTarget} month{value.monthsToTarget === 1 ? "" : "s"}
                        {value.missesTargetDate ? " · misses target date" : ""}
                      </span>
                    </>
                  )}
                </Computed$>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {progress.anomaly !== null && (
        <p className="alert alert--caution" style={{ marginTop: "0.6rem" }}>
          {progress.anomaly}
        </p>
      )}
    </Card>
  );
}

export default async function GoalsPage() {
  const asOf = await resolveAsOf(db);
  const view = await getGoalsView(db, asOf);

  return (
    <>
      <div className="page-header">
        <h1>Goals</h1>
        <p>
          Every balance is derived from its contribution and withdrawal history — no goal
          stores a total that could drift from the transactions behind it.
        </p>
      </div>

      <div className="stack">
        <h2 className="section-heading">Active, in priority order</h2>
        {view.active.length === 0 ? (
          <Card>
            <EmptyState>No active goals.</EmptyState>
          </Card>
        ) : (
          <div className="grid grid--halves">
            {view.active.map((card) => (
              <GoalPanel key={card.goal.id} card={card} />
            ))}
          </div>
        )}

        {view.inactive.length > 0 && (
          <>
            <h2 className="section-heading" style={{ marginTop: "0.5rem" }}>
              Achieved, on hold and cancelled
            </h2>
            <p className="note" style={{ marginTop: "-0.4rem" }}>
              Retained in full — an achieved goal stays on the record rather than
              disappearing from history.
            </p>
            <div className="grid grid--halves">
              {view.inactive.map((card) => (
                <GoalPanel key={card.goal.id} card={card} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
