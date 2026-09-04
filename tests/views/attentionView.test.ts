import { describe, expect, it } from "vitest";
import { buildInsight, insufficient, ok, type Insight, type MetricDefinition } from "../../src/domain";
import { buildAttentionPanel, type AttentionPanelInput } from "../../src/views/attentionView";
import type {
  AnomalyFinding,
  BehavioralIntelligenceView,
  DataHealth,
  HealthScore,
  HistoricalCoverage,
  WhatsChangedResult,
} from "../../src/views/behavioralIntelligenceView";
import type {
  DebtFreedomSummary,
  GoalCollision,
  GoalLiabilityIntelligenceView,
  GoalRadarRow,
  GoalTradeOffRow,
} from "../../src/views/goalLiabilityIntelligenceView";
import type {
  AllocationDriftRow,
  BenchmarkRow,
  ConcentrationHeatmap,
  DrawdownResult,
  InvestmentIntelligenceView,
  PortfolioPerformance,
  PortfolioXRay,
} from "../../src/views/investmentIntelligenceView";
import type { Decomposition, ScenarioResult } from "../../src/domain";
import type { ContributionVsReturn, AdherenceRow } from "../../src/views/investmentIntelligenceView";

const ASOF = new Date("2026-08-31T00:00:00Z");
const METRIC: MetricDefinition = { id: "test", label: "Test", unit: "money", description: "test" };

function insight<T>(result: Insight<T>["result"]): Insight<T> {
  return buildInsight({ metric: METRIC, result, asOf: ASOF, calculationBasis: "test fixture" });
}

const emptyBehavioral: BehavioralIntelligenceView = {
  whatsChanged: insight<WhatsChangedResult>(insufficient("no data")),
  anomalyDetector: insight<readonly AnomalyFinding[]>(ok([])),
  healthScore: insight<HealthScore>(insufficient("no data")),
  dataHealth: insight<DataHealth>(insufficient("no data")),
  historicalCoverage: insight<HistoricalCoverage>(insufficient("no data")),
};

const emptyGoalLiability: GoalLiabilityIntelligenceView = {
  goalFundingRadar: insight<readonly GoalRadarRow[]>(ok([])),
  goalCollisionDetector: insight<GoalCollision>(insufficient("no data")),
  emergencyFundRunway: insight<{ readonly monthsOfRunway: number }>(
    insufficient("D-017: no essential-expense split exists"),
  ),
  debtFreedomMeter: insight<DebtFreedomSummary>(insufficient("no data")),
  emiReleaseTimeline: insight<readonly never[]>(insufficient("no data")) as GoalLiabilityIntelligenceView["emiReleaseTimeline"],
  goalTradeOffSimulator: insight<ScenarioResult<readonly GoalTradeOffRow[]>>(insufficient("no data")),
  milestones: [],
};

const emptyInvestment: InvestmentIntelligenceView = {
  portfolioXRay: insight<PortfolioXRay>(insufficient("no data")),
  plannedVsActualAllocation: insight<readonly AllocationDriftRow[]>(ok([])),
  growthDecomposition: insight<Decomposition>(insufficient("no data")),
  contributionVsReturn: insight<ContributionVsReturn>(insufficient("no data")),
  performance: insight<PortfolioPerformance>(insufficient("no data")),
  concentrationHeatmap: insight<ConcentrationHeatmap>(insufficient("no data")),
  drawdownMonitor: insight<DrawdownResult>(insufficient("no data")),
  portfolioVsBenchmark: insight<readonly BenchmarkRow[]>(ok([])),
  planAdherence: insight<readonly AdherenceRow[]>(ok([])),
};

function baseInput(overrides: Partial<AttentionPanelInput> = {}): AttentionPanelInput {
  return {
    investment: null,
    goalLiability: emptyGoalLiability,
    behavioral: emptyBehavioral,
    portfolioStalestPriceAgeDays: null,
    ...overrides,
  };
}

describe("attention panel — empty/insufficient inputs", () => {
  it("is healthy when nothing is flagged and Emergency Fund Runway's own insufficiency is the only watch item", () => {
    const panel = buildAttentionPanel(baseInput());
    expect(panel.critical).toHaveLength(0);
    expect(panel.important).toHaveLength(0);
    // Emergency Fund Runway's D-017 insufficiency is always surfaced as a watch item.
    expect(panel.watch).toHaveLength(1);
    expect(panel.watch[0]?.title).toBe("Emergency Fund Runway cannot be measured yet");
    expect(panel.isHealthy).toBe(false);
  });
});

describe("attention panel — critical tier", () => {
  it("classifies an unexplained position change and a goal balance anomaly as critical, not important", () => {
    const behavioral: BehavioralIntelligenceView = {
      ...emptyBehavioral,
      anomalyDetector: insight<readonly AnomalyFinding[]>(
        ok([
          { kind: "unexplained_position_change", description: "HDFC Bank moved from 10 to 15 with no recorded transaction" },
          { kind: "goal_balance_anomaly", description: '"Car": withdrawals exceed contributions' },
        ]),
      ),
    };
    const panel = buildAttentionPanel(baseInput({ behavioral }));
    expect(panel.critical).toHaveLength(2);
    expect(panel.critical.every((item) => item.severity === "critical")).toBe(true);
    expect(panel.important).toHaveLength(0);
  });
});

describe("attention panel — important tier", () => {
  it("classifies untrusted records, concentration breach, plan-adherence deviation, goal collision, excluded liability, and behind-trajectory goal as important", () => {
    const behavioral: BehavioralIntelligenceView = {
      ...emptyBehavioral,
      anomalyDetector: insight<readonly AnomalyFinding[]>(
        ok([{ kind: "untrusted_records", description: "2 budget record(s) are needs_review or rejected" }]),
      ),
    };

    const investment: InvestmentIntelligenceView = {
      ...emptyInvestment,
      portfolioXRay: insight<PortfolioXRay>(ok({ holdings: [], totalMinorUnits: 0, exclusions: [] })),
      concentrationHeatmap: insight<ConcentrationHeatmap>(
        ok({
          byInstrument: [{ key: "HDFC Bank", ratio: 0.4, valueMinorUnits: 400_000 }],
          byAssetClass: [],
          concentratedThresholdRatio: 0.25,
        }),
      ),
      planAdherence: insight<readonly AdherenceRow[]>(
        ok([{ periodMonth: "2026-08", status: "under-invested", plannedMinorUnits: 20_000, actualMinorUnits: 5_000 }]),
      ),
    };

    const goalLiability: GoalLiabilityIntelligenceView = {
      ...emptyGoalLiability,
      goalCollisionDetector: insight<GoalCollision>(
        ok({ collidingGoals: [], totalRequiredMonthlyMinorUnits: 300_000, monthlyCapacityMinorUnits: 40_000, shortfallMinorUnits: 260_000 }),
      ),
      debtFreedomMeter: insight<DebtFreedomSummary>(
        ok({
          totalPrincipalMinorUnits: 1_000_000,
          totalOutstandingMinorUnits: 800_000,
          repaidRatio: 0.2,
          latestDebtFreeDate: ASOF,
          liabilitiesExcluded: ["Personal Loan"],
        }),
      ),
      goalFundingRadar: insight<readonly GoalRadarRow[]>(
        ok([
          {
            goal: { id: "g1", name: "Car", targetAmountMinorUnits: 600_000, targetDate: ASOF, priorityRank: 1 } as never,
            progress: {
              goalId: "g1",
              currentAmountMinorUnits: 0,
              remainingMinorUnits: 600_000,
              progressRatio: ok(0),
              isProtected: false,
              anomaly: null,
            } as never,
            projection: ok({ goalId: "g1", monthsToTarget: 24, projectedCompletion: ASOF, missesTargetDate: true }),
          },
        ]),
      ),
    };

    const panel = buildAttentionPanel(baseInput({ investment, goalLiability, behavioral }));

    expect(panel.critical).toHaveLength(0);
    const titles = panel.important.map((item) => item.title);
    expect(titles).toContain("Untrusted records excluded from totals");
    expect(titles).toContain("HDFC Bank is concentrated");
    expect(titles).toContain("Investment plan under invested for 2026-08");
    expect(titles).toContain("Goal funding demand exceeds capacity");
    expect(titles).toContain("A liability has no recorded tenure");
    expect(titles).toContain('"Car" is behind its target trajectory');
  });
});

describe("attention panel — watch tier", () => {
  it("classifies stale prices and missing historical coverage as watch, alongside Emergency Fund Runway", () => {
    const behavioral: BehavioralIntelligenceView = {
      ...emptyBehavioral,
      historicalCoverage: insight<HistoricalCoverage>(
        ok({
          inceptionDate: ASOF,
          coverage: {
            monthsCounted: ["2026-08"],
            monthsPartial: ["2026-07"],
            monthsMissing: ["2026-06"],
            isComplete: false,
            notes: [],
          },
        }),
      ),
    };
    const panel = buildAttentionPanel(baseInput({ behavioral, portfolioStalestPriceAgeDays: 30 }));

    const titles = panel.watch.map((item) => item.title);
    expect(titles).toContain("Portfolio prices are stale");
    expect(titles).toContain("Historical coverage has gaps");
    expect(titles).toContain("Emergency Fund Runway cannot be measured yet");
    expect(panel.isHealthy).toBe(false);
  });

  it("does not flag fresh prices as stale", () => {
    const panel = buildAttentionPanel(baseInput({ portfolioStalestPriceAgeDays: 2 }));
    expect(panel.watch.map((item) => item.title)).not.toContain("Portfolio prices are stale");
  });
});
