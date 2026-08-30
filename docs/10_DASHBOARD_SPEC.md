# 10 — Dashboard Spec

Status: not yet built (M6). This doc is the target spec the M6 vertical
slice implements; it will be expanded with exact component/layout detail
during M6 once the domain layer (M4) and portfolio ingestion (M5) exist to
build against. Building the UI ahead of trustworthy data is explicitly out
of order (`00_MASTER_PLAN.md`).

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
