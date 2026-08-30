"use server";

import { redirect } from "next/navigation";
import { explainReport, realFetcher, resolveAiProvider, type AiEnv } from "../../ai";
import { db } from "../../lib/db";
import { getReport } from "../../views/reportView";

/**
 * Requests an explanation of the current report. Every number the model
 * could reference was already computed by the engine (`getReport` reuses
 * the exact same M10 view models the Market/Report screen shows) — the AI
 * never touches the database, a source file, or anything not already in
 * that payload (docs/12_AI_ANALYST_SPEC.md, "grounding architecture").
 *
 * The outcome — success or refusal — is written as an audit_event and the
 * screen is pointed at it by id, the same pattern the Data Center's
 * import/backup/restore actions use, rather than carrying a
 * potentially-long response through a URL query string.
 */
export async function explainAction(): Promise<void> {
  const report = await getReport(db);
  // process.env structurally matches AiEnv (every field is an optional
  // string) but TypeScript treats its index signature as having no
  // declared properties in common with a plain interface — a safe cast.
  const provider = resolveAiProvider(process.env as AiEnv, realFetcher);

  if (provider === null) {
    const event = await db.auditEvent.create({
      data: {
        kind: "ai_explanation",
        payloadJson: JSON.stringify({
          outcome: "unavailable",
          reason:
            'The configured AI provider needs an API key that is not set. Ollama (the free local default) needs no key — install and run it, or switch AI_PROVIDER back to "ollama" in .env.',
        }),
      },
    });
    redirect(`/ai-analyst?event=${event.id}`);
  }

  const result = await explainReport(provider, report);

  const event = await db.auditEvent.create({
    data: {
      kind: "ai_explanation",
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

  redirect(`/ai-analyst?event=${event.id}`);
}
