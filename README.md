# WEALTHFORGE OS

Personal financial operating system — laptop-first, local-first.

WEALTHFORGE OS replaces a manually-maintained Excel budget workbook and
ad-hoc portfolio tracking with a single local application that ingests the
recurring budget workbook, tracks holdings and liabilities, runs a
deterministic financial engine (net worth, P&L, allocation, EMI, goal
funding), and provides an AI analyst layer that explains — but never
invents — the numbers.

Status: **M0–M11 complete, M12 (release hardening) in progress** (see
[`docs/20_BUILD_ROADMAP.md`](docs/20_BUILD_ROADMAP.md)). All ten screens —
Command Center, Budget, Portfolio, Goals, Liabilities, Analytics, Settings,
Data Center, Market, and AI Analyst — are built against the real ingestion
and financial engine, with 370+ unit/integration tests and 90+ Playwright
E2E tests across laptop and iPad.

## Why this exists

See [`docs/01_PRODUCT_VISION.md`](docs/01_PRODUCT_VISION.md) and
[`docs/02_REQUIREMENTS.md`](docs/02_REQUIREMENTS.md) for the full product
rationale. In short:

- _What do I own, owe, and have available right now?_
- _What did I plan versus what actually happened?_
- _Am I on track for my funding goals, in priority order?_
- _What changed, why, and what — if anything — should I consider doing?_

## Architecture at a glance

```
PLAN → POSITION → ACTIVITY → DETERMINISTIC ENGINE → ANALYTICS → DASHBOARD → AI ANALYST
```

- **App:** Next.js 15 (App Router), TypeScript, single local process.
- **Storage:** SQLite (`data/wealthforge.db`) via Prisma. Local-first; no
  cloud database is the source of truth.
- **Ingestion:** full-workbook Excel re-read and diff on every upload, with
  revision history and an Import Audit (see
  [`docs/09_INGESTION_ARCHITECTURE.md`](docs/09_INGESTION_ARCHITECTURE.md)).
- **Domain layer:** framework-free deterministic financial engine
  (`src/domain/`).
- **AI layer:** provider-abstracted explanatory layer only, grounded against
  already-computed figures and rejected outright if it states one that
  isn't — never a source of truth (see
  [`docs/12_AI_ANALYST_SPEC.md`](docs/12_AI_ANALYST_SPEC.md),
  [`docs/features/ai-analyst.md`](docs/features/ai-analyst.md)). Defaults to
  local Ollama — no API key, no cost.
- **Market data:** optional, free (AMFI's official NAV file + Yahoo
  Finance's free endpoint), never required — see
  [`docs/MARKET_DATA_PROVIDER_EVALUATION.md`](docs/MARKET_DATA_PROVIDER_EVALUATION.md).

Full architecture decisions: [`docs/decisions/`](docs/decisions/). Anything
still open: [`docs/19_OPEN_DECISIONS.md`](docs/19_OPEN_DECISIONS.md).

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The app runs entirely on your machine. The database file is created under
`data/` on first run and is not committed to version control.

Secondary device (iPad): reach the same local app over your LAN — see
[`docs/15_DEPLOYMENT_ARCHITECTURE.md`](docs/15_DEPLOYMENT_ARCHITECTURE.md).

## Development

See [`CLAUDE.md`](CLAUDE.md) for the full development contract (financial
calculation rules, data integrity rules, testing rules, Definition of Done).
[`AGENTS.md`](AGENTS.md) is the framework-agnostic summary for other AI
tooling.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Repository layout

```
wealthforge-os/
├── docs/            requirements, architecture, specs, decisions, roadmap
├── src/             application source (domain, ingestion, ai, app)
├── tests/           unit, integration, and fixture-based tests
├── scripts/         one-off and maintenance scripts
└── data/            local SQLite database + fixtures (gitignored, except fixtures)
```

## Project status

Tracked in [`docs/20_BUILD_ROADMAP.md`](docs/20_BUILD_ROADMAP.md). No
milestone is marked complete without passing tests, typecheck, lint, build,
and a recorded audit result.
