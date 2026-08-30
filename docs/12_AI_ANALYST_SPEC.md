# 12 — AI Analyst Spec

Status: implemented last (M11), after the domain layer, ingestion, and
analytics are trustworthy and tested — the AI layer has nothing grounded to
explain until then.

## Role

Explanatory decision-support layer only. Never authoritative for balances,
prices, NAVs, transactions, or coverage figures.

## What the AI may do

- Explain changes in trusted figures (why net worth moved, why a budget
  category deviated from plan).
- Summarize a period.
- Identify patterns, anomalies, concentration risk, and stale/missing data.
- Suggest actions (e.g. "surplus cash could go to the emergency fund, which
  is below its target").
- Describe risks in plain language.

## What the AI must never do

- Invent or estimate a balance, price, NAV, transaction, or insurance figure
  that isn't in the trusted data.
- Write to the database, directly or indirectly.
- Blend fact, inference, and recommendation without labeling which is which.
- Present itself as the source of truth for any number — every number it
  states must be traceable to a domain-layer output.

## Grounding architecture

- The AI layer receives a structured payload of already-computed domain
  outputs (e.g. this period's net worth, variance, goal progress) — never
  raw source files, never direct database access, never write access.
- `src/ai/providers/` defines one interface; `ollama` (local, default),
  `openai`, and `anthropic` providers implement it identically from the
  caller's perspective — see `docs/decisions/0004-ai-provider-abstraction.md`.
- Every AI response is checked against the grounding payload before being
  shown: any numeric claim not traceable to the payload is treated as a
  defect (`14_TESTING_STRATEGY.md` "AI grounding tests").

## Output structure

Responses are structured to visually separate:
1. **Fact** — a number/date/state pulled directly from the trusted payload.
2. **Inference** — a pattern the AI is identifying across facts.
3. **Recommendation** — a suggested action, always phrased as a suggestion,
   never as an instruction the system will act on.

## Failure mode

If the AI provider is unavailable (local model not running, cloud provider
unreachable/misconfigured), the app must degrade gracefully — Command
Center, Budget, Portfolio, Goals, etc. remain fully functional; only the AI
Analyst screen shows an explicit "AI unavailable" state (`18_FAILURE_MODES.md`).
