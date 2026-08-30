import { insufficient, ok, type Computed } from "../domain";
import type { Report, ReportLine } from "../views/reportView";
import { checkGrounding } from "./grounding";
import type { AiProvider } from "./types";

/**
 * Turns the M10 rule-based Report into the grounding payload an AI
 * provider reads, and verifies whatever comes back before it may be
 * shown. This IS the "structured payload of already-computed domain
 * outputs" docs/12_AI_ANALYST_SPEC.md specifies — no raw source files, no
 * database access, no write access reach the model; it only ever sees
 * this text.
 */

function serializeLine(line: ReportLine): string {
  return `[${line.kind.toUpperCase()}] ${line.text}`;
}

export function buildGroundingPayload(report: Report): string {
  const lines = [
    `As of ${report.asOf.toISOString().slice(0, 10)}${report.periodMonth === null ? "" : ` (period ${report.periodMonth})`}:`,
  ];
  for (const section of report.sections) {
    lines.push(`\n${section.title}:`);
    for (const line of section.lines) {
      lines.push(`- ${serializeLine(line)}`);
    }
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a financial analyst explaining a personal finance report.

RULES, NO EXCEPTIONS:
- Use ONLY the figures given to you below. Never state a rupee amount, percentage, or count that is not already present in that data.
- Never invent a balance, price, NAV, transaction, or return.
- If the data given to you is insufficient to answer something, say "Insufficient data" rather than estimating.
- Structure your answer in three clearly labeled parts: FACT (restate what the data says), INFERENCE (a pattern across facts), RECOMMENDATION (a suggestion only, phrased as a suggestion — you cannot and must not instruct the system to act).`;

export interface AnalystResponse {
  readonly text: string;
  readonly providerName: string;
}

/**
 * Requests an explanation and rejects it outright if it fails the
 * grounding check — the response is never shown, not even with a warning,
 * because a partially-fabricated financial explanation is worse than none
 * (docs/21, "prefer insufficient data over false certainty").
 */
export async function explainReport(
  provider: AiProvider,
  report: Report,
): Promise<Computed<AnalystResponse>> {
  const payload = buildGroundingPayload(report);

  const result = await provider.generate({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Here is the data:\n\n${payload}\n\nExplain what this means for the user.`,
  });

  if (result.kind !== "ok") {
    return insufficient(`AI unavailable: ${result.reasons.join("; ")}`);
  }

  const grounding = checkGrounding(result.value, payload);
  if (!grounding.grounded) {
    return insufficient(
      `the AI's response stated figures not present in the underlying data (${grounding.unsupportedClaims.join(", ")}) and was rejected rather than shown`,
    );
  }

  return ok({ text: result.value, providerName: provider.name });
}
