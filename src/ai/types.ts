import type { Computed } from "../domain";

/**
 * The AI provider boundary (docs/decisions/0004-ai-provider-abstraction.md).
 *
 * One interface; three implementations select via `AI_PROVIDER` in
 * `.env`. Nothing above this boundary (the grounding/verification logic in
 * `src/ai/analyst.ts`) knows or cares which provider answered — swapping
 * providers never touches the guardrail logic, per the ADR's rationale.
 */

export interface AiRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface AiProvider {
  readonly name: string;
  generate(request: AiRequest): Promise<Computed<string>>;
}

/**
 * The network boundary, injectable exactly like `src/market/types.ts`'s
 * `Fetcher` — so every provider is testable against recorded fixture
 * responses with zero live network calls in the suite. Duplicated rather
 * than imported from `src/market/` on purpose: the two features are
 * independent, and importing one into the other for a five-line interface
 * would be a needless coupling.
 */
export interface Fetcher {
  (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<FetchResponse>;
}

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export const realFetcher: Fetcher = (url, init) => fetch(url, init);
