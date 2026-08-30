import { insufficient, ok, type Computed } from "../../domain";
import type { AiProvider, AiRequest, Fetcher } from "../types";

/**
 * Optional cloud provider (ADR 0004) — never the default, never required.
 * Selected only when the user sets `AI_PROVIDER=openai` and supplies
 * `OPENAI_API_KEY` in `.env`; the key is read once at construction and
 * never logged (docs/13_SECURITY_PRIVACY.md).
 */

interface OpenAiChoice {
  readonly message?: { readonly content?: unknown };
}
interface OpenAiResponse {
  readonly choices?: readonly OpenAiChoice[];
  readonly error?: unknown;
}

export function createOpenAiProvider(options: {
  apiKey: string;
  model: string;
  fetcher: Fetcher;
}): AiProvider {
  return {
    name: "openai",
    async generate(request: AiRequest): Promise<Computed<string>> {
      let response;
      try {
        response = await options.fetcher("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
          }),
        });
      } catch (err) {
        return insufficient(
          `could not reach OpenAI: ${err instanceof Error ? err.message : "unknown network error"}`,
        );
      }

      if (!response.ok) {
        return insufficient(`OpenAI returned HTTP ${response.status}`);
      }

      const text = await response.text();
      let parsed: OpenAiResponse;
      try {
        parsed = JSON.parse(text) as OpenAiResponse;
      } catch {
        return insufficient("OpenAI's response was not valid JSON");
      }

      if (parsed.error != null) {
        return insufficient(`OpenAI reported an error: ${JSON.stringify(parsed.error)}`);
      }

      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        return insufficient("OpenAI returned no usable text");
      }

      return ok(content);
    },
  };
}
