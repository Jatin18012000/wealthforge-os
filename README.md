# WEALTHFORGE OS

Personal Financial Operating System

**Status: FINAL RELEASE — v1.0.0**
(ENGINEERING COMPLETE · UI TESTING COMPLETE · RELEASE VERIFIED · LOCAL
DEPLOYMENT VERIFIED)

WEALTHFORGE OS replaces a manually-maintained Excel budget workbook and
ad-hoc portfolio tracking with a single local application that ingests the
recurring budget workbook, tracks holdings and liabilities, runs a
deterministic financial engine (net worth, P&L, allocation, EMI, goal
funding), and provides an AI analyst layer that explains — but never
invents — the numbers.

## Purpose

- _What do I own, owe, and have available right now?_
- _What did I plan versus what actually happened?_
- _Am I on track for my funding goals, in priority order?_
- _What changed, why, and what — if anything — should I consider doing?_

See [`docs/01_PRODUCT_VISION.md`](docs/01_PRODUCT_VISION.md) and
[`docs/02_REQUIREMENTS.md`](docs/02_REQUIREMENTS.md) for the full product
rationale.

## Major capabilities

Eleven screens, each backed by the real ingestion pipeline and financial
engine — no screen shows a fabricated or placeholder figure:

Command Center · Budget · Portfolio · Goals · Liabilities · Insurance ·
Analytics · Data Center · Settings · Market · AI Analyst

Highlights: full budget-workbook re-import with revision history; portfolio
snapshot ingestion (equities, ETFs, gold/silver, mutual funds) with
cost-basis and unexplained-change detection; goal funding with a working
"allocate leftover cash to a goal" flow; liability EMI/payer-split
tracking; insurance coverage and term-insurance gap tracking; Analytics
with every documented period, activity-kind and asset-class filters, and
true custom-vs-custom period comparison; a full audit log, provenance, and
trust-state model; automatic and manual backup/restore with conflict
detection; manual overrides for every financially significant field
(Source → Adjustment → Result → Reason → History, never a silent
overwrite); free market-data refresh (AMFI + Yahoo Finance) with a manual
entry fallback for any instrument with no automatic price; a grounded AI
Analyst that refuses to state a figure not present in its data.

## Architecture summary

```
PLAN → POSITION → ACTIVITY → DETERMINISTIC ENGINE → ANALYTICS → DASHBOARD → AI ANALYST
```

- **App:** Next.js 15 (App Router), TypeScript, single local process.
- **Storage:** SQLite (`data/wealthforge.db`) via Prisma. Local-first; no
  cloud database is the source of truth.
- **Ingestion:** full-workbook Excel re-read and diff on every upload, with
  revision history and an Import Audit
  ([`docs/09_INGESTION_ARCHITECTURE.md`](docs/09_INGESTION_ARCHITECTURE.md)).
- **Domain layer:** framework-free deterministic financial engine
  (`src/domain/`), frozen as of engineering closure — see
  [`docs/UI_TESTING_PHASE.md`](docs/UI_TESTING_PHASE.md).
- **AI layer:** provider-abstracted explanatory layer only, grounded against
  already-computed figures and rejected outright if it states one that
  isn't — never a source of truth
  ([`docs/12_AI_ANALYST_SPEC.md`](docs/12_AI_ANALYST_SPEC.md),
  [`docs/features/ai-analyst.md`](docs/features/ai-analyst.md)). Defaults to
  local Ollama — no API key, no cost.
- **Market data:** optional, free (AMFI's official NAV file + Yahoo
  Finance's free endpoint), with manual entry as the documented fallback
  for anything neither source covers — never required
  ([`docs/MARKET_DATA_PROVIDER_EVALUATION.md`](docs/MARKET_DATA_PROVIDER_EVALUATION.md)).

Full architecture decisions: [`docs/decisions/`](docs/decisions/).
Deferred/open items: [`docs/19_OPEN_DECISIONS.md`](docs/19_OPEN_DECISIONS.md).

## Local-first design & zero mandatory cost

Nothing about core operation requires a network connection, a cloud
account, or payment of any kind. No mandatory: cloud database, paid
hosting, paid API, paid authentication, paid storage, paid market data, or
paid email service. The only network calls the app ever makes are
optional (AMFI/Yahoo Finance market data refresh, or a cloud AI provider
you explicitly configure) and every feature works without them. See
[`docs/MARKET_DATA_PROVIDER_EVALUATION.md`](docs/MARKET_DATA_PROVIDER_EVALUATION.md)
for the full zero-cost verification.

## Supported devices

Laptop (primary) and iPad (secondary, over your LAN — see
[`docs/15_DEPLOYMENT_ARCHITECTURE.md`](docs/15_DEPLOYMENT_ARCHITECTURE.md)).
Both are covered by the automated E2E suite.

## Installation & local deployment

```bash
git clone https://github.com/Jatin18012000/wealthforge-os
cd wealthforge-os
pnpm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
pnpm build
pnpm start
```

Full beginner-friendly procedure, including troubleshooting:
[`docs/LOCAL_DEPLOYMENT.md`](docs/LOCAL_DEPLOYMENT.md). First-time owners
should also read [`docs/OWNER_HANDOFF.md`](docs/OWNER_HANDOFF.md).

## Data storage, backup & restore

Your data lives entirely in `data/wealthforge.db` plus `data/uploads/` and
`data/backups/`, all local, all gitignored. Automatic backups run after
every import and on a configurable interval; manual backup/restore is
available from the Data Center screen or via `pnpm backup:export` /
`pnpm backup:restore`. Restoring always takes a safety backup first and
refuses to overwrite newer data without explicit confirmation. Full
procedure: [`docs/BACKUP_AND_RECOVERY.md`](docs/BACKUP_AND_RECOVERY.md).

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
pnpm build
```

As of this release: 389 unit/integration tests, 122 Playwright E2E tests
(across laptop and iPad viewports) — 511 automated tests total, all
passing, alongside a clean typecheck, lint, and production build. See
[`docs/PROJECT_COMPLETION_CERTIFICATE.md`](docs/PROJECT_COMPLETION_CERTIFICATE.md)
for the verified release-time results and
[`docs/UI_TEST_MATRIX.md`](docs/UI_TEST_MATRIX.md) for the UI/visual QA
pass.

## Known limitations & deferred features

Non-blocking, explicitly tracked:

- **Analytics instrument / source-provider / metric filters** are not
  built (period, comparison, activity-kind, and asset-class filters all
  work and compose).
- **Data Center's backup list** has no pagination or retention policy yet
  — it will grow long over sustained heavy use, with no correctness
  impact.
- **Groww statement support** does not exist (no real fixture was ever
  available); manual CSV/XLSX import remains the path for any unsupported
  source.
- **Brokerage/Zerodha live API integration**, **desktop packaging**, and
  **>2-payer liability-split override** remain open per
  [`docs/19_OPEN_DECISIONS.md`](docs/19_OPEN_DECISIONS.md).

Full detail: [`docs/FINAL_REQUIREMENTS_STATUS.md`](docs/FINAL_REQUIREMENTS_STATUS.md),
[`docs/RELEASE_NOTES_v1.0.0.md`](docs/RELEASE_NOTES_v1.0.0.md).

## Security & privacy notes

Single-user, local-first application — no authentication layer is
included or needed, since nothing leaves your machine unless you
explicitly configure a cloud AI provider. Uploaded file paths are
validated and never derived from user-controlled input; backup restore
paths are safe and non-destructive by default. No secret, credential, or
personal financial data is ever committed to this repository — see
[`docs/BACKUP_AND_RECOVERY.md`](docs/BACKUP_AND_RECOVERY.md) and
`.gitignore`.

## Development

See [`CLAUDE.md`](CLAUDE.md) for the full development contract (financial
calculation rules, data integrity rules, testing rules, Definition of
Done). [`AGENTS.md`](AGENTS.md) is the framework-agnostic summary for
other AI tooling. The financial engine (`src/domain/`), ingestion
semantics, and manual-adjustment model are **frozen** as of engineering
closure — see [`docs/UI_TESTING_PHASE.md`](docs/UI_TESTING_PHASE.md) for
the freeze scope and unfreeze procedure.

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

**FINAL — COMPLETE.** M0–M12, post-M12 hardening, Round 2 remediation,
engineering closure, and UI testing are all complete; the financial engine
is frozen. Full history: [`docs/20_BUILD_ROADMAP.md`](docs/20_BUILD_ROADMAP.md),
[`CHANGELOG.md`](CHANGELOG.md).
