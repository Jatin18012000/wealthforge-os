import { insufficient, ok, type Computed } from "../../domain";
import type { AiProvider, AiRequest, Fetcher } from "../types";

/**
 * Local Ollama (the default provider, ADR 0004) — no API key, no network
 * beyond localhost, ₹0 cost. If Ollama isn't installed or running, this
 * fails exactly like any other "provider unavailable" case
 * (docs/18_FAILURE_MODES.md): the caller shows "AI unavailable" and every
 * other screen keeps working.
 */

interface OllamaGenerateResponse {
  readonly response?: unknown;
  readonly error?: unknown;
}

export function createOllamaProvider(options: {
  baseUrl: string;
  model: string;
  fetcher: Fetcher;
}): AiProvider {
  return {
    name: "ollama",
    async generate(request: AiRequest): Promise<Computed<string>> {
      let response;
      try {
        response = await options.fetcher(`${options.baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: options.model,
            system: request.systemPrompt,
            prompt: request.userPrompt,
            stream: false,
          }),
        });
      } catch (err) {
        return insufficient(
          `could not reach Ollama at ${options.baseUrl}: ${err instanceof Error ? err.message : "unknown network error"}. Is it installed and running locally?`,
        );
      }

      if (!response.ok) {
        return insufficient(`Ollama returned HTTP ${response.status}`);
      }

      const text = await response.text();
      let parsed: OllamaGenerateResponse;
      try {
        parsed = JSON.parse(text) as OllamaGenerateResponse;
      } catch {
        return insufficient("Ollama's response was not valid JSON");
      }

      if (parsed.error != null) {
        return insufficient(`Ollama reported an error: ${JSON.stringify(parsed.error)}`);
      }
      if (typeof parsed.response !== "string" || parsed.response.trim() === "") {
        return insufficient("Ollama returned no usable text");
      }

      return ok(parsed.response);
    },
  };
}
