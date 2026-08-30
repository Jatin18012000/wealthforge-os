# 00 — Master Plan

Status: living document. Update whenever milestone scope or sequencing changes.

## Controlling documents

This project is governed by two source documents (both provided at project
start, 30 August 2026):

1. *WEALTHFORGE OS — Final Dashboard Specification, Project Map, PID & Claude
   Code Build Plan* (v1.0) — the primary, detailed blueprint.
2. *WEALTHFORGE OS — Final Dashboard Specification & Claude Code Build Plan*
   (condensed companion, v1.0) — a shorter summary of the same decisions.

Both documents are internally consistent with each other; the condensed
version summarizes the detailed one rather than contradicting it. Neither
document contradicts the other on any point checked during M0. See
`19_OPEN_DECISIONS.md` for the one material limitation found (no actual 2026
budget workbook file was present in the build workspace — see that doc).

This repository, its docs, and `CLAUDE.md` are the implementation of those two
documents. Where this doc set and the source documents ever appear to
disagree, the source documents win unless a recorded decision in
`docs/decisions/` explicitly supersedes them.

## Mental model

```
PLAN → POSITION → ACTIVITY → DETERMINISTIC ENGINE → ANALYTICS → DASHBOARD → AI ANALYST
```

- **Plan** — monthly budget intentions (income, expense, investment allocation)
  from the ingested workbook and manual entry.
- **Position** — dated snapshots of what is held (cash, holdings, liabilities).
- **Activity** — confirmed transactions from authoritative sources.
- **Deterministic engine** — pure calculation layer producing net worth, P&L,
  allocation, EMI burden, goal progress, projections.
- **Analytics** — time-range comparison, Plan vs Reality, filters.
- **Dashboard** — the UI surfaces built on top of the above, never computing
  its own numbers.
- **AI Analyst** — explains the above; produces no numbers of its own.

## Milestone sequence

See `20_BUILD_ROADMAP.md` for live status. Order (do not reorder without a
recorded decision):

M0 Repository & governance → M1 Architecture freeze → M2 Local persistence →
M3 Budget ingestion vertical slice → M4 Deterministic financial engine →
M5 Portfolio ingestion → M6 Dashboard V1 → M7 Analytics → M8 Manual controls →
M9 Data Center (backup/restore) → M10 Market/reporting → M11 AI Analyst →
M12 Release hardening.

Rationale for the order: the financial engine and data model must be
trustworthy and tested against real ingestion before any UI is built on top
of them (source docs, §7 "Do not start with the UI").

## Non-goals (v1)

- No cloud database as source of truth.
- No automatic trade execution of any kind.
- No mandatory brokerage/account-aggregator integration — imports and manual
  entry must always be sufficient on their own.
- No multi-user/multi-tenant support. This is a single-household local app.
- No mobile native app — the iPad is a secondary browser client to the same
  local app, not a separate build target.
