import { Card } from "../../components/Primitives";
import { db } from "../../lib/db";
import { explainAction, explainDailyBriefAction } from "./actions";

export const dynamic = "force-dynamic";

interface AiExplanationPayload {
  readonly outcome: "shown" | "rejected" | "unavailable";
  readonly providerName?: string;
  readonly text?: string;
  readonly reason?: string;
}

function ExplanationCard({ title, payload }: { title: string; payload: AiExplanationPayload }) {
  return (
    <Card title={payload.outcome === "shown" ? title : "AI unavailable"}>
      {payload.outcome === "shown" ? (
        <>
          <p style={{ whiteSpace: "pre-wrap" }}>{payload.text}</p>
          <p className="note" style={{ marginTop: "0.6rem" }}>
            Answered by {payload.providerName}. Checked against the report before being shown.
          </p>
        </>
      ) : (
        <>
          <p className="alert alert--caution">{payload.reason}</p>
          <p className="note">
            Every other screen keeps working normally — this feature is optional and never
            required.
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * AI Analyst — grounded explanations only (docs/12_AI_ANALYST_SPEC.md).
 *
 * Two actions: explain the current M10/M11 period report, or generate the
 * v1.1 WealthForge Daily Brief (IM-07, docs/24_DAILY_BRIEF_SPEC.md) — a
 * richer report built from the intelligence layer. Both go through the
 * exact same grounding pipeline (`src/ai/analyst.ts`); a rejected or
 * unreachable-provider outcome is shown exactly as plainly as a shown one
 * — this screen refuses to smooth over an AI failure, per
 * docs/18_FAILURE_MODES.md, "Optional AI provider unavailable: AI Analyst
 * screen shows 'AI unavailable'; every other screen remains fully
 * functional."
 */
export default async function AiAnalystPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const eventId = typeof params.event === "string" ? params.event : "";
  const briefId = typeof params.brief === "string" ? params.brief : "";

  const event =
    eventId === "" ? null : await db.auditEvent.findUnique({ where: { id: eventId } });
  const payload: AiExplanationPayload | null =
    event === null ? null : (JSON.parse(event.payloadJson) as AiExplanationPayload);

  const briefEvent =
    briefId === "" ? null : await db.auditEvent.findUnique({ where: { id: briefId } });
  const briefPayload: AiExplanationPayload | null =
    briefEvent === null ? null : (JSON.parse(briefEvent.payloadJson) as AiExplanationPayload);

  return (
    <>
      <div className="page-header">
        <h1>AI Analyst</h1>
        <p>
          Explains the current report using only figures the engine has already computed —
          never the source of truth for a balance, price, or transaction. Every response
          is checked against that data before being shown; one that states a figure not in
          the data is rejected outright rather than shown with a caveat.
        </p>
      </div>

      <div className="stack">
        <Card title="Ask for an explanation">
          <form action={explainAction}>
            <button type="submit" className="button button--primary">
              Explain this period
            </button>
          </form>
        </Card>

        {payload !== null && <ExplanationCard title="Explanation" payload={payload} />}

        <Card title="WealthForge Daily Brief">
          <p className="note" style={{ marginBottom: "0.6rem" }}>
            A fuller brief drawn from the intelligence layer: position, what changed, why,
            plan deviations, risks, goals, portfolio, and data quality — the same
            grounding check applies.
          </p>
          <form action={explainDailyBriefAction}>
            <button type="submit" className="button button--primary">
              Generate daily brief
            </button>
          </form>
        </Card>

        {briefPayload !== null && <ExplanationCard title="Daily Brief" payload={briefPayload} />}
      </div>
    </>
  );
}
