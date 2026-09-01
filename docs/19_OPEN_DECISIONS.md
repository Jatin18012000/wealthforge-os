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
one specific one of these, the dashboard can label that one as _the_
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

## Resolved by the supplied reference files (2026-08-30)

### D-005: real source files — NOW SUPPLIED, closed

The real 2026 budget workbook (two copies) and three Zerodha holdings
statements were supplied. Both parsers were validated against their actual
structures and both needed dedicated adapters — see
`REFERENCE_COVERAGE_AUDIT.md` §4 for the five defects this uncovered. The
long-standing caveat on M3 and M5 ("validated against synthetic fixtures
only") is **lifted**.

### D-010: "surplus" definition — RESOLVED by the workbook itself

The workbook's own formulas settle it: EMIs sit in the Expenses column,
`Investment` available `= income total − expense total`, and `Left over cash
for the month = available − invested`. These are exactly the engine's
`retainedMinorUnits` and `unallocatedMinorUnits`. No code change was needed;
the engine already matched the user's model.

### D-011: snapshot as-of date — AMENDED

Originally the caller had to supply `asOf`. Zerodha statements carry their
own date ("…Statement as on 2026-08-03"), so the file's date is now used when
present. When a caller supplies a date that **contradicts** the file, the
import is refused rather than silently picking one — a wrong date would
misdate every historical valuation built on the snapshot.

## Open — genuinely unresolved, flagging rather than guessing

### D-012: Does carry-over income count toward the savings rate?

The budget workbook has income rows named "Previous month left" / "Previous
month leftover salary" — last month's unspent cash re-entering as this
month's income. Counting it inflates the income denominator (money is
counted in two months); excluding it understates the cash genuinely
available to allocate.
**Current behaviour:** counted as income, and flagged in the Import Audit so
it is never invisible. **Impact:** savings and investment rate denominators.
**Needed from the user:** whether carry-over should be excluded from rate
denominators while remaining in available cash.

### D-013: Are pledged units included in "Quantity Available"?

Zerodha reports `Quantity Available` alongside `Quantity Pledged (Margin)`
and `(Loan)`. In all three supplied statements every pledged quantity is
zero, so the data cannot say whether a pledged holding is inside or outside
the Available figure.
**Current behaviour:** `Available` is used as the quantity, and any non-zero
pledge flags the holding `needs_review` rather than guessing.
**Impact:** portfolio value would be understated if pledged units are
excluded from Available. **Needed from the user:** confirmation, ideally with
a statement in which something is pledged.

### D-014: Mutual funds held outside Zerodha

The budget plans monthly contributions to three mutual funds ("Index fund",
"Flexi cap", "Midcap"), but the Zerodha `Mutual Funds` sheet is empty in all
three statements — they are held elsewhere (Groww, per the specification's
tools table). No statement for them was supplied.
**Impact:** portfolio value and net worth exclude these holdings entirely,
and Plan vs Reality cannot compare planned against actual for them.
**Needed from the user:** a Groww (or equivalent) holdings export, or
confirmation that these should be tracked by manual entry.

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

### D-006: Zerodha/Kite and Groww integration timing and auth method — CONFIRMED DEFERRED (post-M12)

The source documents say to prefer read-only access and never store secrets
in source, but do not specify _when_ to build these integrations or which
auth flow (API key vs. OAuth-style token) to use for either.

Raised as the one required question in the post-M12 continuation pass,
since it genuinely cannot be resolved autonomously: Zerodha's official API
(Kite Connect) requires a paid developer subscription (~₹500/month,
billed to the user's own Zerodha account) plus registering an app and
completing an OAuth-style login flow — a real-money, account-level
decision this agent must not make silently. Groww has no official public
API at all; integrating it would mean reverse-engineering a private
endpoint, carrying ToS/legal risk beyond what any other integration in
this project accepts (contrast the Yahoo Finance provider, M10, which is
free and merely unofficial, not proprietary/reverse-engineered).

**User's decision: leave deferred.** Manual CSV/XLSX import remains the
only portfolio data path, exactly as documented and tested throughout
M5–M12 — no paid subscription, no ToS risk, nothing further required.
Per the source documents' own instruction (§21, §7), imported/manual data
is fully sufficient without this integration, and this decision confirms
that remains the intended state, not merely an interim one. Not blocking
any milestone. May be revisited if the user later decides the Kite
Connect subscription cost is worthwhile.

### D-007: Market data provider selection — RESOLVED (M10)

The source documents require tracking Nifty 50, Sensex, Nifty Bank, Nifty
Metal with an "explicit provider + freshness policy" (source doc §7 tools
table) but do not name a provider. Full evaluation in
`docs/MARKET_DATA_PROVIDER_EVALUATION.md`.

**Decision:** a provider abstraction (`src/market/`) with two free sources,
neither ever required:

- **AMFI `NAVAll.txt`** (official, free, unauthenticated) for mutual fund
  NAVs — primary and sufficient on its own for MF tracking.
- **Yahoo Finance's unofficial chart endpoint** (free, no key, but
  unofficial with no SLA — documented risk) for index levels (Nifty 50,
  Nifty Bank, Sensex) and individual equity/ETF prices, polled
  conservatively (default once daily).
- **Manual entry** (already built in M8) is the permanent fallback under
  both — every fetched value lands in the same `Valuation` table a manual
  entry writes to, so the engine needs no special case for where a price
  came from.

**Nifty Metal has no reliable free symbol on either source** — tracked
separately as D-016 rather than guessed at.

This sandboxed build environment's egress proxy blocks both hosts outright
(`connect_rejected` — organization policy, neither on the allowlist),
which could not be worked around and is not a defect: it is direct
confirmation that the app's core features do not depend on either being
reachable. Live behavior against the real endpoints must be verified on a
normal internet-connected deployment; this repo's tests use recorded
fixture responses rather than live calls.

### D-016: No reliable free source for Nifty Metal

Neither AMFI (indices are out of scope for it) nor Yahoo Finance's
unofficial endpoint has a verified, stable symbol for the Nifty Metal
index. Rather than guess at an unverified symbol — which risks exactly the
"market data becomes financial history" failure the project prohibits —
Nifty Metal tracking falls back to manual entry only until a reliable free
source is found. **Not blocking M10**; the market-data layer is designed
so a missing index source degrades to "no data" (never a guessed number),
which is the documented, tested behavior for this case.

### D-008: Packaging beyond `pnpm dev`/`pnpm start` — triaged, classified C (M12)

Whether to eventually package as a desktop app (Tauri/Electron) for
double-click launch is left open (`15_DEPLOYMENT_ARCHITECTURE.md`).

Triaged under the post-M12 continuation directive: Tauri is free and
open-source and could in principle be built at ₹0 mandatory cost, so this
is not blocked by the cost requirement. It is classified **C — optional
feature, safe to defer** rather than built now, because the existing
local web application already satisfies every capability in the stated
success condition (`CLAUDE.md` §29: laptop as primary device, iPad as
secondary, both reached via a browser over LAN per
`15_DEPLOYMENT_ARCHITECTURE.md`) without it. Adding a native packaging
toolchain (a Rust build per target OS) is new build-system surface with
no functional gain over `pnpm dev`/`pnpm start` for this project's stated
scale — exactly the "avoid unnecessary... complex deployment systems"
instruction in `CLAUDE.md`'s Cost Philosophy. Not required for v1, not
blocking any milestone, and not built.

### D-015: Overriding a payer split with more than two payers

`checkPayerSplitTotal`/`planPayerSplitChange` (M8) can compute the one
companion change needed to keep a two-payer EMI split at 100% automatically.
With three or more payers there is no single correct redistribution — the
system refuses the override and asks the user to record the shares together
rather than guessing which other payer absorbs the difference. No liability
in the reference data has more than two payers, so this has not blocked
anything. **Decision deferred** until a real liability needs it; if raised,
the likely answer is a "record all shares at once" form rather than a
single-field override for that case.

### D-017: No essential-expense methodology defined (v1.1, IM-04)

The Emergency Fund Runway widget (`docs/21_INTELLIGENCE_MASTER_PLAN.md`)
is meant to answer "how many months of essential spending does the
emergency fund cover" — but the budget's `PlanCategory` (`income |
expense | investment | emi`, `src/domain/budget.ts`) has no
essential/discretionary split, and no source document defines one. Using
the whole `expense` category (or `committedOutflowMinorUnits`, expense +
EMI) as a stand-in for "essential spending" would silently substitute
total spending for essential spending — a mislabeling the IM-04 directive
explicitly forbids, since a household's discretionary spending (dining
out, entertainment, etc.) is bundled into the same `expense` lines as
genuinely essential ones (groceries, utilities, rent) with nothing in the
data model to tell them apart.

**Decision: Emergency Fund Runway reports `insufficient-data` in every
case** until a real essential/discretionary split exists in the plan
record model (e.g. a `subcategory` field, or a per-line "essential" flag
set at import or via manual override) — never approximated from total
expense. **Deferred**, not blocking IM-04 or v1.1: the widget still
reports the emergency fund's current balance and target via the existing
Goal Funding Radar; only the runway ("N months covered") figure is
gated on this decision.

## Non-decisions (explicitly out of scope, not "open")

Multi-user support, automatic trade execution, mandatory brokerage
integration, native mobile app — see `01_PRODUCT_VISION.md` "Non-goals."
These are not open questions; they are ruled out for v1 by the source
documents themselves.
