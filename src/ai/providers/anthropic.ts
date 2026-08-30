import { insufficient, ok, type Computed } from "../../domain";
import type { AiProvider, AiRequest, Fetcher } from "../types";

/**
 * Optional cloud provider (ADR 0004) — never the default, never required.
 * Selected only when the user sets `AI_PROVIDER=anthropic` and supplies
 * `ANTHROPIC_API_KEY` in `.env`.
 */

interface AnthropicContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
}
interface AnthropicResponse {
  readonly content?: readonly AnthropicContentBlock[];
  readonly error?: unknown;
}

export function createAnthropicProvider(options: {
  apiKey: string;
  model: string;
  fetcher: Fetcher;
}): AiProvider {
  return {
    name: "anthropic",
    async generate(request: AiRequest): Promise<Computed<string>> {
      let response;
      try {
        response = await options.fetcher("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: 1024,
            system: request.systemPrompt,
            messages: [{ role: "user", content: request.userPrompt }],
          }),
        });
      } catch (err) {
        return insufficient(
          `could not reach Anthropic: ${err instanceof Error ? err.message : "unknown network error"}`,
        );
      }

      if (!response.ok) {
        return insufficient(`Anthropic returned HTTP ${response.status}`);
      }

      const text = await response.text();
      let parsed: AnthropicResponse;
      try {
        parsed = JSON.parse(text) as AnthropicResponse;
      } catch {
        return insufficient("Anthropic's response was not valid JSON");
      }

      if (parsed.error != null) {
        return insufficient(
          `Anthropic reported an error: ${JSON.stringify(parsed.error)}`,
        );
      }

      const textBlock = parsed.content?.find((block) => block.type === "text");
      if (typeof textBlock?.text !== "string" || textBlock.text.trim() === "") {
        return insufficient("Anthropic returned no usable text");
      }

      return ok(textBlock.text);
    },
  };
}
