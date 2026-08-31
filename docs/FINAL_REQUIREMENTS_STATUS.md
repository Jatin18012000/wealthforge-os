# Final Requirements Status

Produced for the v1.0.0 release freeze. Supersedes nothing —
`docs/FINAL_ACCEPTANCE_MATRIX.md` (post-M12 engineering closure) remains
the detailed evidence trail; this document is the release-facing summary
verified against the controlling requirements docs
(`docs/01_PRODUCT_VISION.md`, `docs/02_REQUIREMENTS.md`,
`docs/03_INFORMATION_ARCHITECTURE.md`, `docs/04_USER_FLOWS.md`,
`docs/07_FINANCIAL_CALCULATIONS.md`, `docs/11_ANALYTICS_SPEC.md`, the
`docs/decisions/` ADRs, and `docs/19_OPEN_DECISIONS.md`) as they exist in
this repository today. No external "Financial OS V3 PRD" or "Master
Product & Architecture Brief" exists anywhere in this repository or its
history; the documents named above are the actual controlling
specification for this project and are what this table is verified
against.

Statuses: **PASS** / **DEFERRED** (intentional, non-blocking) / **NOT
VERIFIED** / **NOT APPLICABLE**.

| Requirement | Implementation | Test/Evidence | Status |
|-------------|----------------|---------------|--------|
| Ingest recurring budget workbook (XLSX) | `src/ingestion/importWorkbook.ts` | `tests/ingestion/importWorkbook.test.ts` (15), `tests/ingestion/referenceLayouts.test.ts` (17) | PASS |
| Ingest portfolio snapshot (CSV + XLSX) | `src/ingestion/portfolio.ts` | `tests/ingestion/portfolioSnapshot.test.ts` (18) | PASS |
| Zerodha holdings layout support | `src/ingestion/sources/zerodhaHoldings.ts` | `tests/ingestion/referenceLayouts.test.ts` (against an anonymized real-layout fixture) | PASS |
| Groww statement support | Not implemented | No fixture exists; not claimed anywhere in docs or code | DEFERRED (D-014) |
| Net worth, cash, portfolio, liabilities on one screen | Command Center (`src/app/page.tsx`) | `tests/views/views.test.ts` | PASS |
| Monthly budget + Plan vs Reality | Budget screen | `tests/domain/budget.test.ts` (14) | PASS |
| Portfolio valuation, allocation, concentration, P&L | Portfolio screen | `tests/domain/portfolio.test.ts` (16) | PASS |
| Goals with priority order, protection, funding history | Goals screen | `tests/domain/goals.test.ts` (16) | PASS |
| Allocate leftover cash to a goal (docs/04_USER_FLOWS.md) | `src/app/budget/actions.ts` | `tests/views/goalAllocation.test.ts` (5), E2E | PASS |
| Liabilities: EMI, payer split, interest/tenure, release | Liabilities screen | `tests/domain/liabilities.test.ts` (10) | PASS |
| Insurance: coverage, premiums, term-insurance gap/status | Insurance screen | `tests/views/insuranceView.test.ts` (5), E2E | PASS |
| Analytics: universal periods, comparisons, trends | Analytics screen | `tests/domain/periods.test.ts` (22), `tests/domain/analytics.test.ts` (17) | PASS |
| Analytics: custom comparison (any two arbitrary periods) | `getAnalyticsView({comparisonMode:"custom"})` | `tests/views/analyticsView.test.ts`, E2E | PASS |
| Analytics filters: activity kind, asset class | Analytics screen filter badges | E2E | PASS |
| Analytics filters: instrument, source/provider, metric | Not exposed in UI | No UI control; `instrumentIds` exists in the domain filter type but nothing wires it to a control | DEFERRED |
| One global period selector across Command Center/Budget/Portfolio/Analytics | `src/views/context.ts` | Code inspection — all four screens import the same resolvers | PASS |
| Data Center: imports, revisions, provenance, trust, audit log | `src/app/data-center/` | `tests/views/dataCenterView.test.ts` (12) | PASS |
| Automatic + manual backup | `src/backup/autoBackup.ts`, `scripts/backup-cli.ts`, Data Center UI | `tests/backup/autoBackup.test.ts` (5) | PASS |
| Restore with conflict detection and safety backup | `src/backup/restore.ts` | `tests/backup/restore.test.ts` (3) | PASS |
| Manual overrides: Source → Adjustment → Result → Reason → History | Settings screen, `src/manual/` | `tests/manual/overrides.test.ts` (17) | PASS |
| AI Analyst: grounded, provider-abstracted, free by default | `src/ai/` | `tests/ai/*.test.ts` (28) | PASS |
| Market data: free sources + manual fallback for every held instrument kind | `src/market/`, Market screen | `tests/market/*.test.ts` (33), `tests/views/marketView.test.ts` (10) | PASS |
| Zero mandatory-cost operation | SQLite, local filesystem, Ollama-default AI, free market-data sources | `docs/MARKET_DATA_PROVIDER_EVALUATION.md`, `.env.example` | PASS |
| Snapshot ≠ Activity (never invent a trade from an observed quantity change) | `src/ingestion/portfolio.ts` unexplained-change detection | `tests/ingestion/portfolioSnapshot.test.ts` | PASS |
| No double-counting (goal transfers, credit-card purchase vs. bill payment) | `activityCategory()` one-kind-to-one-category mapping | `tests/domain/budget.test.ts` | PASS |
| Historical revisions retained, never silently overwritten | Revision/supersede pattern | `tests/persistence/revision-non-destructive.test.ts` (2) | PASS |
| Insurance/liability manual-override fields never fabricate a value | `InsurancePolicy` nullable cover/premium fields | `tests/views/insuranceView.test.ts` | PASS |
| Financial engine frozen post-engineering-closure | `docs/UI_TESTING_PHASE.md` | This release added no calculation changes — see `docs/RELEASE_NOTES_v1.0.0.md` | PASS |
| Local-first, self-hostable, no login/auth infrastructure | SQLite file, no auth layer anywhere in `src/` | Code inspection | PASS |

## Deferred items — explicitly non-blocking

- **Analytics instrument / source-provider / metric filters** — no
  enumerable instrument/provider list is wired into the Analytics view,
  and "metric" filtering has no defined UI semantics in the current
  comparison-table layout. Not a release blocker: the four required
  filter axes (period, comparison, activity kind, asset class) all work
  and compose.
- **Data Center backup-retention/pagination** — the backup list has no
  cap, pagination, or deletion. Not a release blocker: nothing is lost or
  mis-displayed; the list is simply long after heavy use.
- **Groww statement support (D-014)** — no real fixture exists; not
  claimed. Manual CSV/XLSX import remains the functional path for any
  unsupported source.
- **D-006** (brokerage/Zerodha live API integration), **D-008** (desktop
  packaging), **D-015** (>2-payer liability split override) — all
  explicitly deferred in `docs/19_OPEN_DECISIONS.md`, none required for
  release.
