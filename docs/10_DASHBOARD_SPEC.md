# 10 — Dashboard Spec

Status: **Dashboard V1 built (M6)** — Command Center, Budget, Portfolio,
Goals and Liabilities. Analytics, Data Center, Settings and AI Analyst
remain unbuilt and are deliberately absent from the navigation: a link to a
screen that does nothing is a promise the app has not kept.

## How the UI is wired

```
loaders (src/data)  →  domain engine (src/domain)  →  view models (src/views)
                                                            ↓
                                              server components (src/app)
```

Screens are React Server Components that render a view model and nothing
else. No component performs arithmetic, divides by 100, or touches the
database — the view layer composes loaders and the engine, and
`src/presentation/format.ts` is the single place minor units become
displayed rupees (`CLAUDE.md` §3).

That split is what makes the screens testable where it matters: view models
are unit-tested without a DOM (`tests/views/`), and rendering is covered by
Playwright across laptop and iPad widths (`tests/e2e/`).

## Making the engine's honesty visible

The engine refuses to invent figures; the UI has to carry that through or
the discipline is wasted. Concretely:

- Every `Computed<T>` renders through one component, so an
  insufficient-data result appears as **"Insufficient data"** with its
  reasons — never as ₹0.
- Any total that excluded records shows what was left out and why.
- Prices show their date and age, and the word "live" appears nowhere.
- Records below `validated` carry a trust badge and a tinted row.
- Missing actuals in Plan vs Reality read **"No data"**, not zero.
- Position changes no transaction explains are raised on the Command
  Center, not buried in the audit log.

## Design priority

Decision usefulness over visual decoration. Every screen must let the user
immediately answer at least one of the questions in
`01_PRODUCT_VISION.md` §"What the dashboard is for".

## Command Center (primary landing screen)

- Net worth headline (with as-of date, drillable).
- Cash available.
- Portfolio value summary.
- Liabilities summary (outstanding, next EMI dates).
- Monthly surplus.
- Goal funding summary in priority order (emergency fund → car → marriage →
  third floor), each showing progress and whether on track for its target
  date.
- Alerts: stale data, concentration warnings, unfunded EMI risk, insufficient
  emergency fund, data needing review.
- Global data-freshness indicator.

## Budget

Current month, with historical month picker; income/expense/investment
breakdown; EMI releases; Plan vs Reality per category; Import Audit history
entry point.

## Portfolio

Holdings by instrument (stocks/ETFs/MFs/metals/EPF), P&L where data
supports it (else `insufficient-data`), allocation, concentration
highlighting.

## Goals

One card per goal (fixed goals + user-created), lifecycle state, target vs
current, funding history, and an allocation action ("add surplus cash to
goal") per `04_USER_FLOWS.md`.

## Liabilities

Per-liability balance, EMI, payer split, interest/tenure, projected release
date and trajectory if paid on schedule vs. actual payment history.

## Insurance

Policies by type, cover amount, premium, and an explicit term-insurance
status/gap indicator against the "planned by end of 2026" baseline.

## Analytics

See `11_ANALYTICS_SPEC.md` — this screen is the full expression of the
universal period/filter/comparison system; other screens use a lighter
version of the same period selector.

## Data Center

Import history with Import Audits, revision browser, provenance drill-down,
trust-state overview, audit log, backup/restore controls.

## Settings

All manual overrides and assumptions (salary-split ratio, thresholds, active
data sources), organized by domain area.

## AI Analyst

Chat/explanation surface consuming only trusted domain output; every
response visually distinguishes fact vs inference vs recommendation
(`12_AI_ANALYST_SPEC.md`).

## Responsive requirement

Laptop-first layout; must remain fully usable on iPad viewport widths as the
secondary device (`15_DEPLOYMENT_ARCHITECTURE.md`) — not a separate mobile
design, a responsive one.
