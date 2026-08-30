# AI Analyst (M11)

Implements `docs/12_AI_ANALYST_SPEC.md`: an explanatory decision-support
layer that is never the source of truth for a number, built last, after
the domain layer, ingestion, and M10's rule-based report already had
something grounded to explain.

## Provider abstraction (ADR 0004)

`src/ai/providers/`: one `AiProvider` interface, three implementations
selected via `AI_PROVIDER` in `.env`:

- **Ollama** (default) — local, no API key, no network beyond `localhost`,
  ₹0 cost. This is the only provider the app depends on by default.
- **OpenAI** / **Anthropic** — optional, selected explicitly, require an
  API key from `.env`; `resolveAiProvider` returns `null` rather than a
  provider that can only fail if the selected cloud provider has no key
  configured, so the caller shows "AI unavailable" immediately instead of
  wasting a request.

Every provider returns `Computed<string>` — a network failure, non-200
response, or unexpected response shape all resolve to `insufficient-data`
with a stated reason, never a throw. Network calls go through an
injectable `Fetcher` (duplicated in shape from `src/market/`'s, on
purpose — the two features are independent) so the test suite never makes
a live call.

This sandboxed build environment has no Ollama installed, which turned
the "AI unavailable" path into a genuine, not simulated, test case: the
AI Analyst E2E suite exercises the real failure, the same way M10's
market-data E2E suite did for its own blocked hosts.

## Grounding: the actual guardrail

`src/ai/analyst.ts` builds the payload the model is allowed to know
anything from — `buildGroundingPayload` serializes the **exact same M10
rule-based `Report`** (`src/views/reportView.ts`) the Market screen
already shows, labeled `[FACT]`/`[INFERENCE]`/`[RECOMMENDATION]` per line.
No raw source file, no direct database access, and no write access ever
reach the model — this is the "structured payload of already-computed
domain outputs" `docs/12_AI_ANALYST_SPEC.md`'s grounding architecture
section specifies, made concrete.

`src/ai/grounding.ts` then checks the model's response before it is ever
shown: every rupee amount, percentage, or large bare number the response
states must also appear in the payload it was given. A response with even
one unsupported figure is rejected outright — not shown with a caveat,
not shown with the bad figure removed — because a partially-fabricated
financial explanation is worse than none (`docs/21`, "prefer insufficient
data over false certainty"). This is the concrete implementation of
`docs/14_TESTING_STRATEGY.md`'s required "AI grounding tests."

Scope, stated plainly in the module itself: this catches fabricated
_financial figures_, which is the specific failure this project
prohibits. It does not attempt to be a general hallucination detector for
prose claims that carry no number.

## The screen

`/ai-analyst` has exactly one action: explain the current report. The
outcome — shown, rejected by the grounding check, or provider-unavailable
— is written as an `ai_explanation` audit_event (decoded readably in the
Data Center's existing audit log, same pattern as import/backup/restore/
market_refresh) and the screen is pointed at it by id, rather than
carrying a potentially-long response through a URL query string.

## Zero-cost verification

The default provider (Ollama) requires no key, no signup, and no network
beyond the user's own machine. The two optional cloud providers are never
selected unless the user explicitly sets `AI_PROVIDER` and supplies a key
— the AI Analyst screen, like every other optional feature in this
project, degrades to "unavailable" rather than the app failing to run.
