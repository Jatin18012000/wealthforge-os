# AGENTS.md

Framework-agnostic instructions for any AI coding agent working in this
repository (Claude Code, or otherwise). If you are Claude Code, `CLAUDE.md` is
the authoritative version of this contract — read it first; this file is a
portable summary for other tooling and for humans skimming the repo root.

## What this is

WEALTHFORGE OS: a local-first personal financial operating system. Single
Next.js + TypeScript application, SQLite as the source of truth, deterministic
financial engine, full-workbook Excel ingestion with revision history, and a
guardrailed AI analyst layer.

## Non-negotiables

1. **Local-first.** Core financial features work fully offline. SQLite file
   under `data/` is the source of truth. No cloud database.
2. **No silent overwrites.** Every correction to historical data creates a new
   revision; the old value is retained and queryable.
3. **Deterministic math lives in `src/domain/` only.** No financial arithmetic
   in UI components, API routes, or the AI layer.
4. **AI never invents financial facts.** It explains trusted, already-computed
   domain output. If the data doesn't have a number, the AI says so.
5. **Full workbook re-read on every budget import**, diffed sheet-by-sheet
   against history, classified NEW/MODIFIED/UNCHANGED/DELETED-RENAMED/
   CONFLICT, and reported as an Import Audit.
6. **Every important financial variable is manually overridable**, and every
   manual change is an explicit, auditable adjustment layered over the
   source value — never an in-place mutation.
7. **No feature is "done" without tests + typecheck + lint + build passing in
   the current session**, plus documentation updated in the same change. See
   `CLAUDE.md` §14 for the full Definition of Done.

## Where things live

- `docs/` — requirements, architecture, and specs. Read the relevant doc
  before touching that area of the codebase.
- `docs/decisions/` — ADRs for consequential technical decisions.
- `docs/19_OPEN_DECISIONS.md` — anything genuinely unresolved. Check before
  assuming a decision hasn't been made.
- `docs/20_BUILD_ROADMAP.md` — milestone status. Check before picking up new
  work.
- `src/domain/` — pure financial/business logic, framework-free.
- `src/ai/providers/` — pluggable AI provider abstraction.
- `tests/fixtures/`, `data/fixtures/` — representative test data, including a
  synthetic budget workbook fixture (no real personal financial data is
  committed to source control).

## When blocked

Ask exactly one concise question when a decision requires information only
the user can provide, or when an action is destructive/irreversible, or an
external access/credential issue blocks progress. Otherwise, use professional
engineering judgment and keep moving — do not ask about routine
implementation choices.
