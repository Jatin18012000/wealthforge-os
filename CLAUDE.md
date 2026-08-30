# WEALTHFORGE OS — CLAUDE.md

This is the permanent instruction file for any Claude Code session working in this
repository. It is the controlling operating contract. The build plan documents in
`docs/` are the requirements; this file is the behavioral contract for how those
requirements get implemented, session after session.

Read `docs/19_OPEN_DECISIONS.md` and `docs/20_BUILD_ROADMAP.md` at the start of
every session to see current state before touching anything.

---

## 1. Project purpose

WEALTHFORGE OS is a laptop-first, local-first personal financial operating system
for a single household. It replaces a manually-maintained Excel budget workbook
and ad-hoc portfolio tracking with:

- a deterministic financial engine (net worth, P&L, allocation, EMI, goals),
- full-workbook budget ingestion with historical revision tracking,
- manual override capability for every important financial variable,
- universal time-range analytics with Plan vs Reality comparison,
- a goal-funding system with a fixed priority order,
- an AI analyst layer that explains trusted numbers but never invents them.

Primary device: laptop. Secondary device: iPad (browser-based, same local app,
reachable over the LAN — see `docs/15_DEPLOYMENT_ARCHITECTURE.md`).

## 2. Architecture (frozen — see docs/05, 06, 09, 15 and docs/decisions/)

- **App shell:** Next.js 15 (App Router), TypeScript strict, single deployable
  process serving both UI and API routes. No separate backend service — this is
  a single-user local application, not a distributed system.
- **Persistence:** SQLite (file-based, `data/wealthforge.db`), accessed through
  Prisma ORM. No cloud database is the source of truth. See
  `docs/decisions/0001-local-persistence.md`.
- **Excel ingestion:** `exceljs`, full-workbook re-read on every upload, diffed
  against stored history sheet-by-sheet. See `docs/09_INGESTION_ARCHITECTURE.md`.
- **Domain/financial engine:** pure TypeScript, zero UI or React imports, zero
  AI imports. Lives under `src/domain/`. Every formula is unit-tested.
- **AI layer:** provider-abstracted (`src/ai/providers/`). Default is a local
  model (Ollama) with OpenAI/Anthropic as optional, swappable providers behind
  the same interface. The AI layer only ever receives already-computed,
  trusted domain outputs — never raw source files, never write access to the
  database.
- **Package manager:** pnpm. Single package (not a monorepo) — see
  `docs/decisions/0002-single-package-not-monorepo.md`.
- **Testing:** Vitest (unit/integration/domain), Playwright (E2E/UI).

Do not change any of the above without adding a new ADR under `docs/decisions/`
explaining why and updating this file in the same commit.

## 3. Development rules

- Design first. Read the relevant `docs/` file(s) before writing code that
  touches that area.
- Work in vertical slices tied to the milestone list in
  `docs/20_BUILD_ROADMAP.md`. Do not implement pieces of multiple milestones
  interleaved in one change.
- Keep the domain/financial layer (`src/domain/`) free of framework, UI, and
  AI dependencies. It must be independently unit-testable with plain data in,
  plain data out.
- Never put financial calculation logic inside a React component, API route
  handler, or the AI layer. Route handlers call the domain layer; they do not
  contain arithmetic.
- Strict TypeScript everywhere. No `any` without a comment explaining why it's
  unavoidable at that boundary (e.g. a third-party library's untyped return).
- Small, composable functions and modules over large multi-purpose ones.
  Avoid speculative abstraction — build for the requirement in front of you,
  not a hypothetical future one.

## 4. Financial calculation rules

- Net worth = sum of trusted asset values − sum of trusted liability balances.
  "Trusted" means trust state is `Validated` or `Verified` (see
  `docs/08_DATA_TRUST_MODEL.md`); `Extracted`/`Needs Review`/`Rejected` records
  are excluded from headline totals but remain visible and queryable.
- Portfolio value = trusted quantity/unit position × the most recent dated
  price/NAV at or before the "as of" date being displayed. Never use a price
  from after the as-of date.
- P&L, CAGR and XIRR are computed ONLY when the underlying cost-basis/
  transaction data is sufficient for the specific instrument and period. When
  it is not, the engine returns an explicit `insufficient-data` result — it
  never estimates, extrapolates, or silently substitutes a proxy value.
- Every formula lives in exactly one place in `src/domain/`. If the UI or a
  report needs the number, it imports the domain function; it does not
  re-derive the arithmetic.
- Rounding: internal storage and computation always use integer paise (or the
  smallest currency unit) or exact decimal types — never floating point
  currency math. Rounding to rupees happens only at the display layer.
- Corporate actions (splits, bonuses, mergers) are explicit, dated records a
  user enters — a quantity change is never silently inferred as a purchase or
  sale.

## 5. Data integrity rules

- No silent overwrites, ever. An import or manual edit that changes a value
  the system already has on record creates a new revision; the prior value is
  retained and remains queryable (`docs/16_DATA_MIGRATION.md`,
  `docs/08_DATA_TRUST_MODEL.md`).
- Every financial record must be able to answer: where did this number come
  from (source file, sheet, cell/field, import timestamp, revision, current
  trust state), and was it ever manually overridden.
- Manual edits are stored as explicit adjustment records layered on top of the
  source value — never as an in-place mutation of the imported value. The UI
  must be able to show source value + manual adjustment = current value.
- Goal balances, cash, and asset totals must reconcile — allocating cash to a
  goal decreases unallocated cash and increases the goal balance in the same
  transaction; the system must never allow double counting.

## 6. Local-first requirement

- The application must run and remain fully functional for all core financial
  operations (viewing net worth, budget, goals, liabilities, portfolio,
  entering manual data) with no internet connection.
- The only features allowed to depend on network access are: fetching live
  market index/price data, and any optional AI provider that isn't the local
  default. Both must degrade gracefully (see `docs/18_FAILURE_MODES.md`) and
  never block core functionality.
- The SQLite database file is the durable source of truth and lives under
  `data/` on the local machine, outside of version control.

## 7. Historical data rules

- Historical financial data is immutable in the sense that it is never
  deleted or replaced destructively. A correction to an already-imported
  period is stored as a new revision referencing the original.
- The system must always be able to answer "what did we believe about period
  X at time T" as well as "what do we currently believe about period X."
- Comparisons across arbitrary historical periods must be supported (see
  `docs/11_ANALYTICS_SPEC.md`) and must clearly flag any period with
  incomplete data coverage rather than silently treating missing data as
  zero.

## 8. Ingestion rules

- Every workbook upload re-reads the ENTIRE workbook, every sheet, every
  time. Never process only the newest/changed sheet.
- Every sheet is classified against stored history as NEW / MODIFIED /
  UNCHANGED / DELETED-RENAMED / CONFLICT before anything is written.
- Re-uploading an identical workbook must be fully idempotent — zero new
  records, zero duplicate records.
- Every import produces an Import Audit record showing counts per
  classification and is surfaced to the user, not just logged.
- Malformed cells, unexpected sheets, blank rows, and formula cells must be
  handled per `docs/18_FAILURE_MODES.md` — flagged, never guessed past.

## 9. Testing rules

- Tests are written alongside the feature that needs them, not after a batch
  of features. No feature is complete without its tests (see Definition of
  Done, §14).
- Domain/financial logic requires unit tests for the happy path AND the
  documented edge cases (zero, negative, missing, duplicate, boundary dates).
- Ingestion requires fixture-based integration tests: a golden workbook, a
  modified workbook (corrected historical month), a workbook with a renamed
  sheet, a workbook with a deleted sheet, and a malformed workbook.
- Any feature touching money math must include at least one test asserting
  exact expected values against a fixture, not just "does not throw."

## 10. Audit rules

- After every meaningful coding increment, run the full audit loop from
  `docs/14_TESTING_STRATEGY.md` §"Continuous audit system" before treating the
  increment as done: typecheck, lint, unit tests, integration tests,
  fixture/real-data tests where relevant, visual QA for UI changes,
  edge-case audit, security audit, regression audit, documentation update,
  git checkpoint.
- A milestone is not complete until its exit gate in
  `docs/20_BUILD_ROADMAP.md` passes and the roadmap doc is updated to reflect
  that.
- Never state a task, feature, or milestone is "done" or "complete" without
  having actually run the checks above in this session. Files existing is not
  completion.

## 11. Git rules

- Logical, scoped commits. Group related changes; never bundle unrelated
  changes into one commit.
- Conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`,
  `chore:`.
- Never rewrite published history on a shared branch.
- Never commit `data/*.db`, `.env`, or any file containing real financial
  figures beyond what's intentionally checked in as a documented fixture
  under `tests/fixtures/` or `data/fixtures/`.

## 12. AI rules

- The AI layer is never the source of truth. It only receives structured,
  already-computed, trusted outputs from the domain layer.
- The AI layer must never invent, estimate, or "fill in" a balance, price,
  NAV, transaction, or insurance figure. If the trusted data doesn't have the
  number, the AI says the number is unavailable.
- The AI layer must distinguish stated fact (from trusted data), inference
  (a pattern it's identifying), and recommendation (a suggestion) in its
  output — never blend the three without marking which is which.
- AI provider access is behind `src/ai/providers/`. Adding a new provider
  must not require changing any caller of the AI layer.
- No AI-initiated writes to financial data, ever.

## 13. Security rules

- No hardcoded secrets. All provider keys/tokens via environment variables,
  documented in `.env.example` with no real values.
- No brokerage or market-data API keys ever committed to source control or
  written to application logs.
- Validate and sanitize all imported file content before it reaches the
  domain layer; never `eval` or execute content from an uploaded workbook.
- No unnecessary application-level authentication — this is a local, single
  user, local-network application. Do not add login/session infrastructure
  unless a genuine multi-user or remote-access requirement is later approved.
- See `docs/13_SECURITY_PRIVACY.md` for the full policy.

## 14. Definition of Done

A feature is done only when ALL of the following are true in the current
session, not assumed:

1. The requirement as written in the relevant `docs/` file is implemented.
2. `pnpm typecheck`, `pnpm lint`, and `pnpm build` all pass.
3. Relevant unit and integration tests exist and pass.
4. Representative/fixture data has been run through the feature.
5. The documented failure modes relevant to the feature have been tested.
6. UI changes have been visually verified (not just type-checked).
7. Security/privacy implications have been considered and, if relevant,
   documented.
8. Documentation (`docs/`, `README.md`, `.env.example` as applicable) is
   updated in the same change.
9. Any known gap or limitation is recorded (in `docs/18_FAILURE_MODES.md` or
   `docs/19_OPEN_DECISIONS.md` as appropriate) rather than hidden.
10. A git commit exists capturing the change with a clear message.

## 15. When blocked

If a genuine decision requires information only the user can provide, or an
action would be destructive/irreversible, or an external credential/access
issue blocks progress:

**STOP. Ask exactly ONE concise question. Wait for the answer. Then continue
from exactly where you left off.**

Do not ask about routine engineering decisions (naming, file layout, standard
library choices, ordinary UI implementation, ordinary refactors) — decide
those with professional judgment and record the decision if it's consequential
enough to belong in `docs/decisions/`.

Do not invent a financial rule, baseline figure, or priority order that isn't
in `docs/02_REQUIREMENTS.md` or a recorded decision. If a number or rule is
genuinely missing, ask, don't guess.
