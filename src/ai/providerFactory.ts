import { createAnthropicProvider } from "./providers/anthropic";
import { createOllamaProvider } from "./providers/ollama";
import { createOpenAiProvider } from "./providers/openai";
import type { AiProvider, Fetcher } from "./types";

/**
 * Selects the configured provider (`.env`'s `AI_PROVIDER`), defaulting to
 * local Ollama — the only provider that requires no key and no cost
 * (ADR 0004). Returns null when a cloud provider is selected but its key
 * is missing, so the caller can show "AI unavailable" rather than send a
 * request that can only fail.
 */
export interface AiEnv {
  readonly AI_PROVIDER?: string;
  readonly OLLAMA_BASE_URL?: string;
  readonly OLLAMA_MODEL?: string;
  readonly OPENAI_API_KEY?: string;
  readonly OPENAI_MODEL?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly ANTHROPIC_MODEL?: string;
}

export function resolveAiProvider(env: AiEnv, fetcher: Fetcher): AiProvider | null {
  const selected = (env.AI_PROVIDER ?? "ollama").trim().toLowerCase();

  switch (selected) {
    case "openai": {
      const apiKey = env.OPENAI_API_KEY;
      if (apiKey === undefined || apiKey === "") return null;
      return createOpenAiProvider({
        apiKey,
        model: env.OPENAI_MODEL ?? "gpt-4o-mini",
        fetcher,
      });
    }
    case "anthropic": {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (apiKey === undefined || apiKey === "") return null;
      return createAnthropicProvider({
        apiKey,
        model: env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
        fetcher,
      });
    }
    case "ollama":
    default:
      return createOllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434",
        model: env.OLLAMA_MODEL ?? "llama3.1",
        fetcher,
      });
  }
}
