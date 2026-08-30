# 19 — Open Decisions

Living log. "Resolved" entries record what was decided and why, so the
reasoning survives even after `CLAUDE.md`/the schema docs are updated.
"Open" entries are genuinely unresolved — do not implement around them by
guessing; ask.

## Resolved during M0

### D-001: Local persistence technology
**Decision:** SQLite via Prisma. See
`docs/decisions/0001-local-persistence.md`.
**Why now:** Required before M2 can start; the source documents mandate this
be decided and documented before schema freeze (source doc §8, §35 step 11).

### D-002: Repository structure — single package vs. monorepo
**Decision:** Single Next.js package, not a Turborepo monorepo. See
`docs/decisions/0002-single-package-not-monorepo.md`.
**Why now:** The repository tree specified in the source documents (§6/§27)
is a flat single-app layout (`src/`, `tests/`, `scripts/`, `data/`), not a
`apps/`+`packages/` monorepo — this is a single deployable local
application, not a multi-app platform.

### D-003: Excel ingestion library
**Decision:** `exceljs`. See `docs/decisions/0003-ingestion-library.md`.

### D-004: AI provider abstraction default
**Decision:** Local model via Ollama as default provider; OpenAI/Anthropic
as optional, swappable providers behind one interface. See
`docs/decisions/0004-ai-provider-abstraction.md`.
**Why now:** The source documents specify AI must never be the source of
truth and must be provider-abstracted for guardrails, but don't name a
specific default provider. Defaulting to a free, local, self-hostable option
keeps the app runnable without any paid service, consistent with the
project's "clone and run without paid third-party services" spirit found
throughout the sibling project's cost philosophy and this project's own
local-first mandate; cloud providers remain fully supported as an opt-in.

## Resolved during M3

### D-009: Period attribution for bare month sheet names
**Decision:** `importBudgetWorkbook` takes a required `defaultYear`
parameter. A sheet name carrying its own year ("Aug-26", "August 2027",
"2026-08") overrides it; a bare name ("August") uses it.
**Why:** the fixtures — and, per the controlling documents, the real
workbook — name sheets by bare month. A bare month name genuinely does not
determine a year, and inferring one from the file's timestamp or the
current date would silently misattribute an entire month of financial data
the first time a workbook is imported in a later year. Making the caller
state it keeps the assumption explicit and auditable.
**Still to confirm against the real workbook:** whether its month sheets
carry years. If they do, `defaultYear` becomes a fallback that never fires.

## Resolved during M4

### D-010: What "monthly surplus" includes
**Decision:** the engine does not publish a single figure called "surplus".
`summarizeMonth` reports every component separately — income, expense, EMI,
investment — plus two explicitly-named rollups:
- `retained` = income − expenses − EMI (money not consumed)
- `unallocated` = retained − investments (cash genuinely left over)

`savingsRate` = retained ÷ income; `investmentRate` = investments ÷ income.

**Why:** `docs/07` inherited "surplus = income − total_expenses" from the
source documents, which does not say whether EMI and investment count as
"expenses". They are materially different questions — with the August
fixture the two readings differ by ₹18,700 — and picking one silently would
bake an unstated assumption into every downstream figure, including
projections and Plan vs Reality. Exposing both costs nothing and hides
nothing.

**Open for confirmation, not blocking:** if the user thinks of "surplus" as
one specific one of these, the dashboard can label that one as *the*
headline surplus in M6. No stored data or calculation changes either way —
only which rollup gets top billing.

## Resolved during M5

### D-011: Snapshot as-of date is a required parameter
**Decision:** `importPortfolioSnapshot` takes an explicit `asOf` date and an
explicit `assetClass`; neither is inferred from the file or the clock.
**Why:** the same reasoning as D-009. Broker exports rarely carry a
machine-readable as-of date, and inferring one from the file's mtime or
"today" would misdate an entire portfolio — every historical valuation and
net-worth figure built on it would then be wrong in a way that looks
plausible. Asset class is explicit for the same reason: guessing "equity"
for a mutual-fund export would put units and shares in the same bucket.

## Open — genuinely unresolved, flagging rather than guessing

### D-005: No actual 2026 budget workbook file was supplied
The controlling build plan (§29, §10) describes the real 2026 workbook as
containing May, June, July, August, and "Core expenses" sheets, and
instructs Claude Code to inspect that workbook (§35 step 9, §27 step 4)
before building fixtures. **No workbook file was present in this build
workspace at M0** — only the two specification documents were supplied.
**What was done instead:** a synthetic fixture workbook was built under
`tests/fixtures/budget/` reproducing the documented sheet structure and
label conventions described in the spec, explicitly marked as synthetic
(not real financial data) in its own contents and in
`14_TESTING_STRATEGY.md`.
**What remains open:** the exact column headers, label text, and row layout
of the real workbook are not confirmed — M3's ingestion parser is built
against the documented structure and the synthetic fixture, and **must be
validated against the real workbook the first time the user uploads it**.
Expect the parser to need adjustment at that point; this is flagged in
advance rather than presented as already-validated.
**Action needed from user:** supply the real 2026 workbook (or a copy with
figures redacted/scaled if preferred) before or during M3, so the parser can
be validated against real structure rather than only the synthetic fixture.

### D-006: Zerodha/Kite and Groww integration timing and auth method
The source documents say to prefer read-only access and never store secrets
in source, but do not specify *when* to build these integrations or which
auth flow (API key vs. OAuth-style token) to use for either. Per the source
documents' own instruction (§21, §7), imported/manual data must remain fully
sufficient without these integrations — they are not required for any
milestone through M12. **Decision deferred**, not required to unblock any
current milestone. Will be raised as a single question if/when M5+ work
would otherwise require guessing an auth approach.

### D-007: Market data provider selection
The source documents require tracking Nifty 50, Sensex, Nifty Bank, Nifty
Metal with an "explicit provider + freshness policy" (source doc §7 tools
table) but do not name a provider. **Decision deferred to M10** — will
evaluate free/self-hostable options first per project cost philosophy and
propose one rather than guessing a paid dependency into the critical path.

### D-008: Packaging beyond `pnpm dev`/`pnpm start`
Whether to eventually package as a desktop app (Tauri/Electron) for
double-click launch is left open (`15_DEPLOYMENT_ARCHITECTURE.md`) — not
required for v1 and not blocking any milestone.

## Non-decisions (explicitly out of scope, not "open")

Multi-user support, automatic trade execution, mandatory brokerage
integration, native mobile app — see `01_PRODUCT_VISION.md` "Non-goals."
These are not open questions; they are ruled out for v1 by the source
documents themselves.
