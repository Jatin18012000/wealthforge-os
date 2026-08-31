# Final Acceptance Matrix

Produced during the post-M12 "FINAL ENGINEERING CLOSURE" directive, Phase 8.
Statuses are restricted to **PASS / FAIL / DEFERRED / NOT VERIFIED / NOT
APPLICABLE** — no vague language. Evidence cites the actual test file/count
or the actual screen/route, not a description of intent.

As of this matrix: 388 unit/integration tests (`vitest`), 112 Playwright
E2E tests (56 × 2 viewports), `tsc --noEmit` clean, `eslint .` clean,
`next build` clean.

## Screens (docs/03_INFORMATION_ARCHITECTURE.md)

| Requirement | Implementation | Test | Evidence | Status |
| --- | --- | --- | --- | --- |
| Command Center | `src/app/page.tsx`, `src/views/commandCenterView.ts` | `tests/views/views.test.ts`, E2E | Route builds, view-model tested | PASS |
| Budget | `src/app/budget/`, `src/views/budgetView.ts` | `tests/domain/budget.test.ts` (14), `tests/views/goalAllocation.test.ts` (5), E2E | Plan-vs-Reality, goal allocation | PASS |
| Portfolio | `src/app/portfolio/`, `src/views/portfolioView.ts` | `tests/domain/portfolio.test.ts` (16), E2E | Allocation, concentration, P&L | PASS |
| Goals | `src/app/goals/` | `tests/domain/goals.test.ts` (16), E2E | Progress, protection, allocation flow | PASS |
| Liabilities | `src/app/liabilities/`, `src/views/liabilitiesView.ts` | `tests/domain/liabilities.test.ts` (10), E2E | EMI, payer split, release | PASS |
| Insurance | `src/app/insurance/`, `src/views/insuranceView.ts` | `tests/views/insuranceView.test.ts` (5), E2E | Built post-M12 (R2-01) | PASS |
| Analytics | `src/app/analytics/`, `src/views/analyticsView.ts` | `tests/domain/analytics.test.ts` (17), `tests/views/analyticsView.test.ts` (11), E2E | Periods, filters, custom comparison | PASS |
| Data Center | `src/app/data-center/`, `src/views/dataCenterView.ts` | `tests/views/dataCenterView.test.ts` (12), E2E | Audit log, backup/restore, provenance | PASS |
| Settings | `src/app/settings/` | `tests/manual/overrides.test.ts` (16), E2E | Preview-then-confirm override flow | PASS |
| Market | `src/app/market/`, `src/views/marketView.ts` | `tests/market/*.test.ts` (33), `tests/views/marketView.test.ts` (10), E2E | Fetch + manual fallback for all instrument kinds | PASS |
| AI Analyst | `src/app/ai-analyst/` | `tests/ai/*.test.ts` (28), E2E | Grounded, provider-abstracted | PASS |

## Financial calculation rules (docs/07_FINANCIAL_CALCULATIONS.md, CLAUDE.md §4)

| Requirement | Implementation | Test | Evidence | Status |
| --- | --- | --- | --- | --- |
| All calculation logic lives only in `src/domain/` | ESLint `no-restricted-imports` on `src/domain/**` blocks `react`/`next`/AI imports | `.eslintrc.json` override | Rule verified present and matches doc's claim | PASS |
| `Computed<T>` never fabricates a value for missing data | `src/domain/result.ts` | Used throughout `src/domain/*.test.ts` | Every engine function returns `insufficient-data` explicitly | PASS |
| Only `validated`/`verified` trust states count toward headline totals | `src/domain/trust.ts` | `tests/domain/adjustments.test.ts`, `tests/domain/budget.test.ts` | `isTrusted` gate used in every summarizer | PASS |
| Money uses integer minor units + banker's rounding | `src/domain/money.ts` | `tests/domain/money.test.ts` (8) | `roundHalfToEven` | PASS |
| Goal contribution/withdrawal never double-counted against income/expense/investment | `activityCategory()` maps them to `null` | `tests/domain/budget.test.ts` ("excludes goal transfers") | Explicit test | PASS |
| Credit card purchase (expense) vs. bill payment (liability settlement) never double-counted | `activityCategory()` one-kind-to-one-category mapping | `tests/domain/budget.test.ts` ("never double-counts a credit card purchase...") | Added this session (Phase 3) | PASS |
| Snapshot ≠ activity — an observed quantity change is never inferred as a trade | `src/ingestion/portfolio.ts` unexplained-change detection | `tests/ingestion/portfolioSnapshot.test.ts` (18) | "unexplained observation" path tested | PASS |
| Cost basis unavailable ⇒ insufficient data, never inferred from later price | `src/domain/returns.ts`, `src/domain/portfolio.ts` | `tests/domain/returns.test.ts` (16), `tests/domain/portfolio.test.ts` | Explicit insufficiency guards | PASS |
| A same-date correction is a revision; the original is retained | `src/data/adjustmentStore.ts` / revision pattern (`supersededById`) | `tests/persistence/revision-non-destructive.test.ts` (2) | Original row never mutated | PASS |
| Manual overrides show Source → Adjustment → Result → Reason → History, no silent overwrites | `src/manual/overrides.ts` | `tests/manual/overrides.test.ts` (16) | Preview-before-confirm, revoke-not-delete | PASS |

## Ingestion integrity (docs/07, docs/features/*)

| Requirement | Implementation | Test | Evidence | Status |
| --- | --- | --- | --- | --- |
| Budget workbook: NEW/MODIFIED/UNCHANGED/DELETED_RENAMED/CONFLICT diff | `src/ingestion/diff.ts` | `tests/ingestion/importWorkbook.test.ts` (15), `tests/ingestion/referenceLayouts.test.ts` (17) | All 5 diff kinds tested against the real layout | PASS |
| Zerodha holdings reconciliation uses the centralized column registry | `src/ingestion/sources/zerodhaHoldings.ts` + `mappings.ts` | `tests/ingestion/referenceLayouts.test.ts` | Fixed a real bug this program's backlog scan found (registry was declared but never consulted) | PASS |
| Duplicate rows are ambiguity unless the source establishes otherwise | `src/ingestion/normalize.ts` | `tests/ingestion/normalize.test.ts` (12) | | PASS |
| Portfolio snapshot ingestion (CSV + XLSX, column alias tolerance) | `src/ingestion/portfolio.ts` | `tests/ingestion/portfolioSnapshot.test.ts` (18) | | PASS |
| Upload path is validated/non-user-controlled | `src/ingestion/uploadStorage.ts` | `tests/ingestion/uploadStorage.test.ts` (10) | Path resolves from `process.cwd()`, not `__dirname` | PASS |

## Data Center / backup (docs/09, M9)

| Requirement | Implementation | Test | Evidence | Status |
| --- | --- | --- | --- | --- |
| Every operational event is an audit-log entry | `src/views/dataCenterView.ts` `summarize()` | `tests/views/dataCenterView.test.ts` (12) | Covers import/revision/manual_override/backup/restore/market_refresh/ai_explanation | PASS |
| Manual + automatic backup | `src/backup/*` | `tests/backup/autoBackup.test.ts` (5), `tests/backup/restore.test.ts` (3) | | PASS |
| Restore detects conflicts and requires confirmation | `src/backup/restore.ts` | `tests/backup/restore.test.ts` | | PASS |

## Manual controls coverage (docs/05, R2-06)

| Requirement | Implementation | Test | Evidence | Status |
| --- | --- | --- | --- | --- |
| Budget, portfolio quantities, cost basis, liability fields, insurance fields overridable | `src/manual/registry.ts` (`OVERRIDABLE_FIELDS`) | `tests/manual/overrides.test.ts` | | PASS |
| Goal contribution/withdrawal recording | `src/app/budget/actions.ts` `allocateToGoalAction` | `tests/views/goalAllocation.test.ts` (5) | Built this session (R2-06) — previously entirely missing | PASS |
| Manual price/NAV entry for any held instrument with no automatic price | `src/app/market/actions.ts` `recordManualQuoteAction` | `tests/views/marketView.test.ts` | Extended this session (R2-06) from indices-only to equities/ETFs/MFs | PASS |
| Manual controls audit registry ordering matches declared group order | `src/manual/overrides.ts` `listOverrideTargets` | `tests/manual/overrides.test.ts` | Fixed a real bug this program's backlog scan found | PASS |

## Analytics (docs/11_ANALYTICS_SPEC.md, R2-02..05)

| Requirement | Implementation | Test | Evidence | Status |
| --- | --- | --- | --- | --- |
| One global period selector across Command Center, Budget, Portfolio, Analytics | `src/views/context.ts` | Manual code inspection (all four screens import the same functions) | PASS |
| Headline numbers are drillable to contributing records + provenance/trust | Every screen's line-item tables + `TrustBadge`, one navigation away | Manual inspection | Satisfied by design (not a literal click-through modal); see roadmap Round 2 notes | PASS |
| Filters: asset class | `src/views/analyticsView.ts` `assetClasses`, UI control on `/analytics` | E2E "filters the allocation table by asset class" | Wired this session (R2-04) | PASS |
| Filters: instrument | `ActivityFilter.instrumentIds` exists in domain | none | No UI control — no enumerable instrument list wired to this view | DEFERRED |
| Filters: source/provider | Not modeled | none | No `source`/`provider` field exists on `Activity` to filter by | DEFERRED |
| Filters: metric | Not modeled | none | No defined UI semantics for a "metric" selector against the current table layout | DEFERRED |
| Filters: activity kind | `src/views/analyticsView.ts` `kinds` | E2E "Filter activity" | | PASS |
| Filters compose | Query-string-driven `href()`/form pattern threads all active filters together | E2E (asset class + custom period + kind all preserved across links/forms) | | PASS |
| Custom comparison: any two arbitrary periods | `getAnalyticsView({ comparisonMode: "custom", customComparison })` | `tests/views/analyticsView.test.ts` ("compares any two arbitrary custom periods"), E2E | Built this session (R2-05) | PASS |
| Data-coverage warnings, never pro-rated | `src/domain/analytics.ts` `monthsInRange` | `tests/domain/analytics.test.ts`, `tests/views/analyticsView.test.ts` | | PASS |

## Zero-cost requirement (CLAUDE.md, docs/19_OPEN_DECISIONS.md)

| Requirement | Implementation | Test | Evidence | Status |
| --- | --- | --- | --- | --- |
| No mandatory paid database, hosting, storage, or API | SQLite (local file), local filesystem storage, no cloud calls required to run | `docker-compose.yml` (self-hostable), `.env.example` | | PASS |
| AI defaults to free local Ollama; cloud providers optional and key-gated | `src/ai/providerFactory.ts` `resolveAiProvider` returns `null` without a key, never throws or requires one | `tests/ai/providers.test.ts` (12) | | PASS |
| Market data: AMFI (official, free) + Yahoo Finance (free, unofficial) + manual entry fallback | `src/market/providers/*` | `tests/market/*.test.ts` (33) | No feature requires a paid market-data API | PASS |
| No new paid dependency introduced by any post-M12 fix this session | Insurance, goal allocation, manual quotes, analytics filters/custom comparison are all local logic | Manual inspection of each commit's diff | | PASS |

## Outstanding known gaps (deferred, not blocking per CLAUDE.md §29's stated success condition)

| Item | Classification | Reference |
| --- | --- | --- |
| D-006 — brokerage/Zerodha live integration | User confirmed: leave deferred | `docs/19_OPEN_DECISIONS.md` |
| D-008 — desktop packaging | Optional, existing web app satisfies needs | `docs/19_OPEN_DECISIONS.md` |
| D-015 — overriding a payer split with more than two payers | Deferred, narrow edge case | `docs/19_OPEN_DECISIONS.md` |
| D-016 — Nifty Metal has no free automatic source | Manual entry fallback built | `docs/19_OPEN_DECISIONS.md`, `docs/MARKET_DATA_PROVIDER_EVALUATION.md` |
| Analytics: instrument / source-provider / metric filters | Deferred — no enumerable list or defined UI semantics yet | This matrix, "Analytics" section |
| R2-07 — Groww statement compatibility | No real fixture exists; not claimed anywhere | `docs/19_OPEN_DECISIONS.md` D-014 |
