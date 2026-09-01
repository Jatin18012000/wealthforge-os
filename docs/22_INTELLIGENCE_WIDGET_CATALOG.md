# 22 — Intelligence Widget Catalog (v1.1)

Per-widget detail for all 31 widgets shipped across IM-02 through IM-07
(`docs/21_INTELLIGENCE_MASTER_PLAN.md`'s widget catalogue). Every row names
the existing engine function(s) the widget composes — none of these
introduces a second calculation path for a number the engine already
produces (root `CLAUDE.md`; `docs/21_INTELLIGENCE_MASTER_PLAN.md`).

"Trust" describes what gates the widget's headline figure. "Coverage"
describes what happens when the required data is missing or partial —
every widget reports `insufficient-data` rather than a best guess in that
case, per the `Insight<T>` contract (`src/domain/insight.ts`, IM-01).
"Test" names the unit test file covering the widget; every widget is also
exercised end-to-end by `tests/e2e/dashboard.spec.ts` as part of its
milestone's Command Center section.

## IM-02 — Wealth Intelligence (`src/views/wealthIntelligenceView.ts`)

| Widget | Purpose | Data | Calculation | Drilldown | Trust | Coverage | Test |
|---|---|---|---|---|---|---|---|
| Net Worth Trajectory | Net worth at each month-end over the selected range | Positions, valuations, liabilities | `computeNetWorthAsOf` sampled once per fully-covered month | Per-month net worth point | Only trusted assets/liabilities counted (inherited from `computeNetWorthAsOf`) | A month with no snapshot at or before it reports `null` for that point, never an interpolated guess | `tests/views/wealthIntelligenceView.test.ts` |
| Assets vs Liabilities | Total trusted assets vs total trusted liabilities as of a date | Positions, valuations, liabilities | Read directly from `computeNetWorthAsOf`'s totals | Same totals as the Command Center tiles | Same as Net Worth Trajectory | `insufficient-data` if net worth cannot be computed | `tests/views/wealthIntelligenceView.test.ts` |
| Net Worth Waterfall | Decomposes net worth change over a range into contributions, withdrawals, liability change, and residual market movement | Opening/closing net worth, confirmed `sip`/`buy`/`sell` activity, liability totals | `buildDecomposition` (IM-01) over the four steps; residual = closing − opening − explained steps | Step-by-step breakdown | Requires a trusted net worth figure at both range ends | `insufficient-data` if either end can't be computed; residual step never claims to be pure market movement (also absorbs unexplained quantity-change ingestion) | `tests/views/wealthIntelligenceView.test.ts` |
| Monthly Money Flow | Income, expenses, EMIs, investment and unallocated cash per month | Effective budget plan | `summarizeMonth`, once per fully-covered month | Per-month flow breakdown | Only trusted, extractable plan lines | `insufficient-data` for a month `summarizeMonth` can't resolve | `tests/views/wealthIntelligenceView.test.ts` |
| Savings Rate Trend | Retained income ÷ income, per month | Effective budget plan | `summarizeMonth`'s `savingsRate` | Per-month ratio | Same as Monthly Money Flow | Same as Monthly Money Flow | `tests/views/wealthIntelligenceView.test.ts` |
| Investment Rate Trend | Planned investment ÷ income, per month | Effective budget plan | `summarizeMonth`'s `investmentRate` | Per-month ratio | Same as Monthly Money Flow | Same as Monthly Money Flow | `tests/views/wealthIntelligenceView.test.ts` |

## IM-03 — Investment Intelligence (`src/views/investmentIntelligenceView.ts`)

| Widget | Purpose | Data | Calculation | Drilldown | Trust | Coverage | Test |
|---|---|---|---|---|---|---|---|
| Portfolio X-Ray | Every trusted holding's weight, price, cost basis and P&L | `getPortfolioView` | Weight = holding value ÷ valued total; P&L = `computeProfitAndLoss` | Per-holding row with price age and exclusions | Trusted, priced holdings only (`getPortfolioView`'s own filter) | Holdings without cost basis show `null` P&L, not zero | `tests/views/investmentIntelligenceView.test.ts` |
| Planned vs Actual Allocation | Planned investment lines vs actual holdings by asset class | Budget plan, portfolio | `buildAllocationComparison` (exported from `analyticsView.ts`, same function the Analytics screen uses) | Per-class planned/observed/status | Trusted plan lines and holdings only | `insufficient-data` when there are no planned lines and no holdings | `tests/views/investmentIntelligenceView.test.ts` |
| Portfolio Growth Decomposition | Decomposes portfolio value change into contributions, withdrawals, market movement | Portfolio value at two dates, confirmed `buy`/`sip`/`sell` activity | `buildDecomposition` | Step-by-step breakdown | Requires trusted, priced valuation at both ends | `insufficient-data` if either end can't be valued | `tests/views/investmentIntelligenceView.test.ts` |
| Contribution vs Return | Net capital contributed vs residual market return | Growth Decomposition's own steps | Reads contribution/withdrawal/appreciation steps, never recomputes | Same steps as Growth Decomposition | Derived from Growth Decomposition | Same as Growth Decomposition | `tests/views/investmentIntelligenceView.test.ts` |
| Portfolio Performance | Aggregate P&L, CAGR, and XIRR | Holdings with cost basis, portfolio value at range start/end, confirmed activity | `computeCagr`, `computeXirr`, `computeProfitAndLoss` sums | Each of the three figures independently | Each of the three sub-results has its own guard (e.g. `MIN_ANNUALIZATION_DAYS` for CAGR) | Each sub-result reports `insufficient-data` independently — never estimated | `tests/views/investmentIntelligenceView.test.ts` |
| Concentration Heatmap | Portfolio weight by instrument and asset class against the concentration threshold | Portfolio | `getPortfolioView`'s `concentrationByInstrument`/`allocationByAssetClass`; same 25% threshold `flagConcentration` already applies | Per-instrument and per-class weight | Same as Portfolio X-Ray | `insufficient-data` if concentration/allocation can't be computed | `tests/views/investmentIntelligenceView.test.ts` |
| Drawdown Monitor | Peak-to-trough decline in portfolio value | Portfolio value sampled only at real snapshot dates (`loadDistinctSnapshotDates`) | Running-peak vs each point; worst decline = max drawdown | Full observation series plus peak/trough | Requires ≥2 valued observation dates in range | `insufficient-data` with fewer than 2 observations; never a fabricated daily series | `tests/views/investmentIntelligenceView.test.ts` |
| Portfolio vs Benchmark | Portfolio return vs each tracked index's return over the same dates | Portfolio value, last dated `Valuation` per index at/before each boundary | Simple return ratio for each side | Per-index comparison | Requires a dated index observation at or before both boundaries (D-007/D-016) | Missing index observation on either side reports that index `insufficient-data`, never a stale/interpolated price | `tests/views/investmentIntelligenceView.test.ts` |
| Investment Plan Adherence | Planned investment amount vs confirmed buy/SIP activity, per month | Budget plan's investment lines, confirmed `buy`/`sip` activity | Direct comparison per fully-covered month | Per-month planned/actual/status | Trusted, extractable plan lines and trusted activity only | A month with no confirmed activity or no plan line is `insufficient-data`, never a "missed investment" | `tests/views/investmentIntelligenceView.test.ts` |

## IM-04 — Goal & Liability Intelligence (`src/views/goalLiabilityIntelligenceView.ts`)

| Widget | Purpose | Data | Calculation | Drilldown | Trust | Coverage | Test |
|---|---|---|---|---|---|---|---|
| Goal Funding Radar | Every active goal's progress and projected completion, priority order | Goals, goal activities | `computeGoalProgress`, `projectGoalCompletion` (trailing 6-month contribution average — same rate the Goals screen uses) | Per-goal progress and projection | `computeGoalProgress`'s own trusted-activity filter | `insufficient-data` if no active goal exists | `tests/views/goalLiabilityIntelligenceView.test.ts` |
| Goal Collision Detector | Whether active goals' deadlines collectively demand more than demonstrated monthly capacity | Active goals with target dates, latest month's unallocated cash | Sum of each goal's own required-monthly figure vs `summarizeMonth`'s `unallocatedMinorUnits` | Per-goal required amount plus aggregate shortfall | Requires ≥2 unfunded goals with future target dates and a positive capacity figure | Identifies collision only — never auto-decides which goal to sacrifice; existing fixed priority order is untouched | `tests/views/goalLiabilityIntelligenceView.test.ts` |
| Emergency Fund Runway | Months of essential spending the emergency fund covers | N/A — always insufficient today | N/A | N/A | N/A | Always `insufficient-data` per D-017 (`docs/19_OPEN_DECISIONS.md`): no essential/discretionary expense split exists in the data model, so runway is never approximated from total spending | `tests/views/goalLiabilityIntelligenceView.test.ts` |
| Debt Freedom Meter | Aggregate repaid-principal ratio and the latest projected debt-free date | Liabilities, confirmed `emi_payment` activity | `repaidRatio` = (total principal − total outstanding) ÷ total principal; date = latest `projectEmiRelease` across liabilities | Per-liability release status, excluded liabilities listed separately | Requires ≥1 liability; a liability without a recorded tenure is excluded from the date but kept in the totals | `insufficient-data` if no liability has a projectable release | `tests/views/goalLiabilityIntelligenceView.test.ts` |
| EMI Release Timeline | Per-liability projected date each EMI obligation ends | Liabilities, confirmed `emi_payment` activity | `projectEmiRelease` (from confirmed payments, falling back to recorded tenure, flagged `fromScheduleOnly`), `splitEmiByPayer` | Per-liability release schedule and payer shares | Same function the Liabilities screen uses | Never assumes an EMI ended merely because a plausible date passed | `tests/views/goalLiabilityIntelligenceView.test.ts` |
| Goal Trade-Off Simulator | Simulates sequential, priority-order funding of goals at a stated monthly capacity | Active unfunded goals, latest month's unallocated cash | Sequential allocation of full capacity to top-priority goal until complete, then next; wrapped in `buildScenarioResult` (IM-01) | Per-goal simulated completion date | A scenario, never a mutation — proven by a before/after diff test | `insufficient-data` if every goal is already funded or no capacity baseline exists | `tests/views/goalLiabilityIntelligenceView.test.ts` |

## IM-05 — Behavioral & Data Intelligence (`src/views/behavioralIntelligenceView.ts`)

| Widget | Purpose | Data | Calculation | Drilldown | Trust | Coverage | Test |
|---|---|---|---|---|---|---|---|
| What's Changed | Month-over-month variance in budget totals, activity, and net worth | Effective plan, activities, net worth at two calendar-month-aligned boundaries | `comparePeriods`/`computePeriodMetrics` (M7) plus `computeNetWorthAsOf` at both boundaries | Per-metric variance rows | Same trust filters as the Analytics screen | Incomplete variances are flagged, not silently included | `tests/views/behavioralIntelligenceView.test.ts` |
| Financial Anomaly Detector | Consolidated list of anomalies the engine already flags elsewhere | Trust-state summary, unexplained position changes, goal progress anomalies | Concatenates existing findings — no new detection heuristic | Full finding list with human-readable descriptions | Reuses `trustStateSummary`, `getUnexplainedPositionChanges`, `computeGoalProgress`'s anomaly flag | Empty list, not an error, when nothing is flagged | `tests/views/behavioralIntelligenceView.test.ts` |
| Financial Health Score | A transparent 0–100 data/process health score | Data Health, Financial Anomaly Detector | Sum of 4 disclosed components (trusted-record share, no unexplained position changes, no goal anomalies, price freshness) | Every component's own points/max/reason shown | Explicitly scoped to data/process health, never a financial-adequacy judgment | `insufficient-data` if either dependency is unresolved | `tests/views/behavioralIntelligenceView.test.ts` |
| Data Health | Trust-state counts per record type, unexplained position changes, price freshness | `trustStateSummary`, `getUnexplainedPositionChanges`, portfolio staleness | Direct rollup, no new logic | Full per-type trust counts | Same as Command Center's Data Center | Always resolves — an empty data set just reports zero counts | `tests/views/behavioralIntelligenceView.test.ts` |
| Historical Coverage | Which months since inception have complete/partial/missing budget data | Effective plan records from inception to now | `computePeriodMetrics`'s own `PeriodCoverage` (M7) | Per-month coverage classification | Same as every other analytics comparison | `insufficient-data` if no inception date can be resolved (no data recorded yet) | `tests/views/behavioralIntelligenceView.test.ts` |

## IM-06 — Scenario Engine (`src/views/scenarioEngineView.ts`, `src/domain/scenarios.ts`)

| Widget | Purpose | Data | Calculation | Drilldown | Trust | Coverage | Test |
|---|---|---|---|---|---|---|---|
| SIP Increase Simulator | Projected portfolio value at illustrative SIP increase percentages | Latest month's planned investment, portfolio's own observed CAGR since inception | `projectFutureValue` compounding at the observed CAGR, with monthly contribution scaled by 0%/10%/25% (illustrative, not a recommendation) | Per-ratio, per-horizon projected corpus | Growth rate is always an *observed* CAGR, never invented | `insufficient-data` if CAGR or current portfolio value can't be computed | `tests/views/scenarioEngineView.test.ts`, `tests/domain/scenarios.test.ts` |
| Debt Prepayment Simulator | How illustrative extra monthly payments shorten payoff and reduce interest | Liabilities' outstanding balance, interest rate, EMI | `simulateDebtPrepayment` (reducing-balance amortization) at ₹0/₹2,000/₹5,000 extra (illustrative) | Per-liability, per-extra-amount result | Never mutates the recorded liability/EMI/tenure | `insufficient-data` if no liability is recorded | `tests/views/scenarioEngineView.test.ts`, `tests/domain/scenarios.test.ts` |
| Wealth Projection | Projected net worth at 5/10/20-year horizons | Current net worth, net worth's own observed CAGR since inception, latest month's retained cash | `projectFutureValue` | Per-horizon projected net worth | Growth rate is always observed, never invented | `insufficient-data` if CAGR, net worth, or retained cash can't be resolved | `tests/views/scenarioEngineView.test.ts`, `tests/domain/scenarios.test.ts` |
| Financial Independence Projection | Months until net worth reaches 25x annual expense (4% rule) | Same inputs as Wealth Projection, plus latest month's expense+EMI total | `monthsUntilTarget` against the 25x-expense target (an explicitly disclosed external convention, not a project rule) | Target amount and months-to-target | Same as Wealth Projection | `insufficient-data` if the target isn't reached within the bounded search horizon, or inputs are missing | `tests/views/scenarioEngineView.test.ts`, `tests/domain/scenarios.test.ts` |

Every Scenario Engine result is wrapped in `ScenarioResult<T>` (IM-01),
which retains its input assumptions and carries the standard
`SCENARIO_DISCLAIMER` — never mutating a real record.

## IM-07 — AI Intelligence (`src/views/dailyBriefView.ts`)

| Widget | Purpose | Data | Calculation | Drilldown | Trust | Coverage | Test |
|---|---|---|---|---|---|---|---|
| WealthForge Daily Brief | A single narrated summary spanning position, changes, why, deviations, risks, goals, portfolio and data quality | Command Center view plus IM-02–IM-05's `Insight<T>` outputs | Assembles a `Report` (M10's existing FACT/INFERENCE/RECOMMENDATION structure) restating already-computed figures — no new calculation | Full 8-section report, then `explainReport`/`checkGrounding` (unchanged M11 pipeline) for the natural-language version | Every line traces to an existing Insight/view; grounding rejects any AI response asserting a figure not present in the report | Each section reports its own insufficiency when its underlying data is incomplete, rather than omitting the section silently | `tests/views/dailyBriefView.test.ts` |

(Goal Trade-Off Simulator is listed once under IM-04 though also named in
IM-06's directive scope; Investment Plan Adherence is listed once under
IM-03 though also named in IM-05's directive scope — both duplicate
namings from the original directive, not duplicate implementations.)
