# ADR 0004: AI provider abstraction, default local provider

Status: Accepted (M0, 30 Aug 2026)

## Context

The source documents require the AI Analyst layer to be guardrailed (never
the source of truth, never inventing figures) but do not name a specific
provider. The project's broader local-first, no-paid-service-required spirit
(explicit throughout the source docs for storage, and implicit in "developer
can clone and run without paid third-party services" style requirements
seen across this project's sibling documentation) argues for a free default.

## Decision

- Define one `AiProvider` interface in `src/ai/providers/`.
- Default provider: **Ollama**, running a local model, requiring no API key
  and no network access beyond `localhost`.
- Optional providers: **OpenAI**, **Anthropic** — implemented behind the
  same interface, selected via `AI_PROVIDER` in `.env`, never required for
  the app to be useful.

## Rationale

- Keeps "clone and run with no paid services" true for the AI Analyst
  feature, not just for storage.
- A single interface means swapping providers never touches the guardrail
  logic (grounding-payload construction, fact/inference/recommendation
  labeling) — that logic lives above the provider boundary and is provider-
  agnostic by construction.

## Consequences

- Local-model quality/latency will generally be lower than a frontier cloud
  model; this is an accepted tradeoff for the default, with cloud providers
  available as an explicit opt-in for users who want them.
- Provider-specific prompt/response quirks are isolated inside each
  provider's implementation file, not leaked into the AI Analyst's calling
  code.
