# WEALTHFORGE OS

Personal Financial Operating System

**Status: FINAL RELEASE — v1.1.0**
(ENGINEERING COMPLETE · UI TESTING COMPLETE · RELEASE VERIFIED · LOCAL
DEPLOYMENT VERIFIED)

v1.1 adds a full **Personal Investment Master intelligence layer** on top
of the frozen v1.0 financial engine: 31 widgets across wealth, investment,
goal/liability, behavioral, and scenario intelligence, a WealthForge Daily
Brief, and a redesigned Command Center 2.0 — every widget a composition
over the existing engine, never a second calculation path. See
[`docs/21_INTELLIGENCE_MASTER_PLAN.md`](docs/21_INTELLIGENCE_MASTER_PLAN.md),
[`docs/22_INTELLIGENCE_WIDGET_CATALOG.md`](docs/22_INTELLIGENCE_WIDGET_CATALOG.md),
and [`docs/V1.1_RELEASE_NOTES.md`](docs/V1.1_RELEASE_NOTES.md).

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

**v1.1 intelligence layer** (31 widgets, `docs/22_INTELLIGENCE_WIDGET_CATALOG.md`):
Wealth Intelligence (net worth trajectory, waterfall, money flow, savings
and investment rate trends); Investment Intelligence (Portfolio X-Ray,
planned vs actual allocation, growth decomposition, contribution vs
return, performance/CAGR/XIRR, concentration heatmap, drawdown monitor,
benchmark comparison, plan adherence); Goal & Liability Intelligence
(goal funding radar, goal collision detection, debt freedom meter, EMI
release timeline, goal trade-off simulator); Behavioral & Data
Intelligence (what's changed, anomaly detector, financial health score,
data health, historical coverage); a Scenario Engine (SIP increase, debt
prepayment, wealth projection, and financial-independence simulators,
each built on the portfolio's or net worth's own observed CAGR — never
an invented market-return assumption); and a WealthForge Daily Brief that
narrates all of the above through the same grounded, non-fabricating AI
pipeline the AI Analyst already uses. Command Center 2.0 reorganizes
every widget from v1.0 and v1.1 into one page in a fixed, documented
order (`docs/25_COMMAND_CENTER_V2_SPEC.md`).

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

`pnpm e2e` never touches `data/wealthforge.db`. It runs against its own
database (`.env.test`, `data/e2e-test.db`), which `playwright.config.ts`
migrates and seeds with demo fixtures before every run — so E2E can be
run at any time, on a real installation with real data, with no risk to
it.

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
