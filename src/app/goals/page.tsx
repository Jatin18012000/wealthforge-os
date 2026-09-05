import { Card, Computed$, EmptyState, ProgressBar } from "../../components/Primitives";
import { db } from "../../lib/db";
import { formatDate, formatMoney, formatRatio } from "../../presentation/format";
import { resolveAsOf, resolveLatestPeriod } from "../../views/context";
import { getGoalLiabilityIntelligenceView } from "../../views/goalLiabilityIntelligenceView";
import { getGoalsView, type GoalCard } from "../../views/goalsView";
import { createEmergencyFundGoalAction, topUpEmergencyFundAction, topUpGoalAction } from "./actions";

export const dynamic = "force-dynamic";

const LIFECYCLE_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In progress",
  achieved: "Achieved",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

function GoalPanel({ card, canTopUp }: { card: GoalCard; canTopUp: boolean }) {
  const { goal, progress, projection, effectiveBalance } = card;

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
            {effectiveBalance !== null && (
              <tr>
                <td>Balance stated by hand</td>
                <td className="num">
                  {formatMoney(effectiveBalance.currentValue)}
                  <br />
                  <span className="note">
                    {formatMoney(effectiveBalance.sourceValue ?? 0)} derived from
                    contributions
                    {effectiveBalance.reason === null
                      ? ""
                      : ` · ${effectiveBalance.reason}`}
                  </span>
                </td>
              </tr>
            )}
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
                        {value.monthsToTarget} month
                        {value.monthsToTarget === 1 ? "" : "s"}
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

      {canTopUp && (
        <form action={topUpGoalAction} className="entry-form" style={{ marginTop: "0.7rem" }}>
          <input type="hidden" name="goalId" value={goal.id} />
          <label className="field">
            <span className="field__label">Add a contribution (₹)</span>
            <input
              className="field__input"
              type="text"
              name="amount"
              inputMode="decimal"
              placeholder="e.g. 2000"
              required
              aria-label={`Contribution amount for ${goal.name}`}
            />
          </label>
          <button type="submit" className="button button--quiet">
            Add
          </button>
        </form>
      )}
    </Card>
  );
}

/**
 * Emergency Fund — set-up and manual top-up (resolves D-017,
 * `docs/19_OPEN_DECISIONS.md`).
 *
 * There is no general "create a goal" feature anywhere in the app; this is
 * narrowly scoped to the one goal kind the intelligence layer treats
 * specially. The top-up form deliberately has no leftover-cash cap, unlike
 * the Budget screen's "allocate leftover cash to a goal" flow — the
 * account owner asked for a way to record an Emergency Fund contribution
 * of any amount, independent of whether a given month's budget has been
 * imported.
 */
function EmergencyFundCard({
  hasGoal,
  runway,
}: {
  hasGoal: boolean;
  runway: Awaited<ReturnType<typeof getGoalLiabilityIntelligenceView>>["emergencyFundRunway"];
}) {
  if (!hasGoal) {
    return (
      <Card title="Set up your Emergency Fund">
        <p className="note" style={{ marginBottom: "0.6rem" }}>
          Once created, its balance is tracked the same way every goal&apos;s is — as a
          running sum of contributions, never a separately-stored total. You can top it up
          below at any time after this.
        </p>
        <form action={createEmergencyFundGoalAction} className="entry-form">
          <label className="field">
            <span className="field__label">Starting target (₹)</span>
            <input
              className="field__input"
              type="text"
              name="targetAmount"
              inputMode="decimal"
              placeholder="e.g. 300000"
              required
              aria-label="Emergency Fund starting target amount"
            />
          </label>
          <button type="submit" className="button button--primary">
            Create Emergency Fund goal
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card title="Emergency Fund">
      {runway.result.kind === "ok" ? (
        <div className="table-scroll" style={{ marginBottom: "0.7rem" }}>
          <table>
            <tbody>
              <tr>
                <td>Current balance</td>
                <td className="num">{formatMoney(runway.result.value.currentBalanceMinorUnits)}</td>
              </tr>
              <tr>
                <td>Target (6 months of essential spending)</td>
                <td className="num">
                  {runway.result.value.targetMinorUnits === null
                    ? "—"
                    : formatMoney(runway.result.value.targetMinorUnits)}
                </td>
              </tr>
              <tr>
                <td>Runway</td>
                <td className="num">
                  <Computed$ result={runway.result.value.monthsOfRunway} showReasons={false}>
                    {(months) => <>{months.toFixed(1)} months</>}
                  </Computed$>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="note" style={{ marginBottom: "0.7rem" }}>
          {runway.result.reasons.join("; ")}
        </p>
      )}
      <form action={topUpEmergencyFundAction} className="entry-form">
        <label className="field">
          <span className="field__label">Top up by (₹)</span>
          <input
            className="field__input"
            type="text"
            name="amount"
            inputMode="decimal"
            placeholder="e.g. 5000"
            required
            aria-label="Emergency Fund top-up amount"
          />
        </label>
        <button type="submit" className="button button--primary">
          Add to Emergency Fund
        </button>
      </form>
    </Card>
  );
}

export default async function GoalsPage({
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
  const latestPeriodMonth = await resolveLatestPeriod(db);
  const view = await getGoalsView(db, asOf);
  const goalLiability = await getGoalLiabilityIntelligenceView(db, asOf, latestPeriodMonth);
  const hasEmergencyFundGoal = [...view.active, ...view.inactive].some(
    (card) => card.goal.kind === "emergency_fund",
  );

  const error = one("error");

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
        {error !== "" && (
          <p className="alert alert--caution">
            <span className="alert__title">Nothing was changed.</span> {error}
          </p>
        )}
        {one("created") !== "" && (
          <p className="alert">
            <span className="alert__title">Emergency Fund goal created.</span> Top it up below
            whenever you like.
          </p>
        )}
        {one("toppedUp") !== "" && (
          <p className="alert">
            <span className="alert__title">Emergency Fund topped up.</span> Every screen now
            reflects it.
          </p>
        )}

        <EmergencyFundCard
          hasGoal={hasEmergencyFundGoal}
          runway={goalLiability.emergencyFundRunway}
        />

        <h2 className="section-heading">Active, in priority order</h2>
        {view.active.length === 0 ? (
          <Card>
            <EmptyState>No active goals.</EmptyState>
          </Card>
        ) : (
          <div className="grid grid--halves">
            {view.active.map((card) => (
              <GoalPanel key={card.goal.id} card={card} canTopUp />
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
                <GoalPanel key={card.goal.id} card={card} canTopUp={false} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
