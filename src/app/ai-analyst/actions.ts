"use server";

import { redirect } from "next/navigation";
import { explainReport, realFetcher, resolveAiProvider, type AiEnv } from "../../ai";
import { db } from "../../lib/db";
import { getDailyBriefReport } from "../../views/dailyBriefView";
import { getReport, type Report } from "../../views/reportView";

/**
 * Requests a grounded explanation of the given report and writes the
 * outcome (shown / rejected / unavailable) as an audit_event, the same
 * pattern the Data Center's import/backup/restore actions use, rather
 * than carrying a potentially-long response through a URL query string.
 *
 * Shared by both AI actions on this screen: the M10/M11 period report
 * (`explainAction`) and the v1.1 Daily Brief (`explainDailyBriefAction`,
 * IM-07). Both hand the exact same `Report` shape to `explainReport` — no
 * number the model could reference is anything the engine did not already
 * compute (docs/12_AI_ANALYST_SPEC.md, "grounding architecture").
 */
async function runGroundedExplanation(report: Report, auditKind: string, redirectParam: string): Promise<never> {
  // process.env structurally matches AiEnv (every field is an optional
  // string) but TypeScript treats its index signature as having no
  // declared properties in common with a plain interface — a safe cast.
  const provider = resolveAiProvider(process.env as AiEnv, realFetcher);

  if (provider === null) {
    const event = await db.auditEvent.create({
      data: {
        kind: auditKind,
        payloadJson: JSON.stringify({
          outcome: "unavailable",
          reason:
            'The configured AI provider needs an API key that is not set. Ollama (the free local default) needs no key — install and run it, or switch AI_PROVIDER back to "ollama" in .env.',
        }),
      },
    });
    redirect(`/ai-analyst?${redirectParam}=${event.id}`);
  }

  const result = await explainReport(provider, report);

  const event = await db.auditEvent.create({
    data: {
      kind: auditKind,
      payloadJson: JSON.stringify(
        result.kind === "ok"
          ? {
              outcome: "shown",
              providerName: result.value.providerName,
              text: result.value.text,
            }
          : { outcome: "rejected", reason: result.reasons.join("; ") },
      ),
    },
  });

  redirect(`/ai-analyst?${redirectParam}=${event.id}`);
}

/**
 * Requests an explanation of the current M10/M11 report. `getReport`
 * reuses the exact same view models the Market/Report screen shows.
 */
export async function explainAction(): Promise<void> {
  const report = await getReport(db);
  await runGroundedExplanation(report, "ai_explanation", "event");
}

/**
 * Requests the v1.1 WealthForge Daily Brief (IM-07,
 * `docs/24_DAILY_BRIEF_SPEC.md`) — the same grounding pipeline, fed a
 * richer report built from the intelligence layer's own Insight<T>
 * outputs (`src/views/dailyBriefView.ts`) instead of the M10 report.
 */
export async function explainDailyBriefAction(): Promise<void> {
  const report = await getDailyBriefReport(db);
  await runGroundedExplanation(report, "ai_daily_brief", "brief");
}
