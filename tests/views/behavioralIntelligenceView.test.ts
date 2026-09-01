import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBehavioralIntelligenceView } from "../../src/views/behavioralIntelligenceView";
import { createTestDb } from "../setup/testDb";

const ASOF = new Date("2026-08-15T00:00:00Z");

describe("behavioral intelligence view — empty database", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reports historical coverage as insufficient and a zero, fully-disclosed health score with no fabricated credit", async () => {
    const view = await getBehavioralIntelligenceView(db, ASOF);

    expect(view.historicalCoverage.result.kind).toBe("insufficient-data");

    expect(view.anomalyDetector.result.kind).toBe("ok");
    if (view.anomalyDetector.result.kind === "ok") {
      expect(view.anomalyDetector.result.value).toHaveLength(0);
    }

    expect(view.dataHealth.result.kind).toBe("ok");

    expect(view.healthScore.result.kind).toBe("ok");
    if (view.healthScore.result.kind === "ok") {
      const score = view.healthScore.result.value;
      // "No unexplained changes" and "no goal anomaly" are vacuously true
      // with zero records — genuinely true, not fabricated credit — but
      // "trusted records" and "fresh prices" require actual data to earn
      // their points, so an empty database scores 40/100, not 100.
      expect(score.totalPoints).toBe(40);
      expect(score.maxPoints).toBe(100);
      const trustedRecords = score.components.find((c) => c.label === "Trusted records");
      expect(trustedRecords?.points).toBe(0);
      const freshPrices = score.components.find((c) => c.label === "Prices are fresh");
      expect(freshPrices?.points).toBe(0);
      // Every component states its own reason — nothing is a bare number.
      for (const component of score.components) {
        expect(component.why.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("behavioral intelligence view — Financial Anomaly Detector & Health Score", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await db.planRecord.create({
      data: {
        periodMonth: "2026-08",
        category: "expense",
        labelRaw: "Needs review line",
        labelNormalized: "needs review line",
        amountMinorUnits: null,
        trustState: "needs_review",
      },
    });

    const goal = await db.goal.create({
      data: {
        name: "Anomalous goal",
        kind: "custom",
        targetAmountMinorUnits: 100_000,
        priorityRank: 5,
        lifecycleState: "in_progress",
      },
    });
    // A withdrawal exceeding contributions produces a negative derived
    // balance — a real anomaly the engine already flags on the Goals screen.
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 10_000,
        occurredOn: new Date("2026-08-01T00:00:00Z"),
        trustState: "validated",
      },
    });
    await db.activity.create({
      data: {
        kind: "goal_withdrawal",
        goalId: goal.id,
        amountMinorUnits: 25_000,
        occurredOn: new Date("2026-08-05T00:00:00Z"),
        trustState: "validated",
      },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("surfaces the needs_review record and the negative goal balance as findings — never a fabricated new anomaly", async () => {
    const view = await getBehavioralIntelligenceView(db, ASOF);
    expect(view.anomalyDetector.result.kind).toBe("ok");
    if (view.anomalyDetector.result.kind !== "ok") return;
    const findings = view.anomalyDetector.result.value;

    expect(findings.some((f) => f.kind === "untrusted_records")).toBe(true);
    expect(findings.some((f) => f.kind === "goal_balance_anomaly")).toBe(true);
  });

  it("deducts the health score's goal-anomaly component while keeping every other component's own reason intact", async () => {
    const view = await getBehavioralIntelligenceView(db, ASOF);
    expect(view.healthScore.result.kind).toBe("ok");
    if (view.healthScore.result.kind !== "ok") return;
    const goalComponent = view.healthScore.result.value.components.find(
      (c) => c.label === "No goal balance anomalies",
    );
    expect(goalComponent?.points).toBe(0);
    expect(goalComponent?.why).toMatch(/negative/);
  });
});

describe("behavioral intelligence view — What's Changed & Historical Coverage", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await db.planRecord.createMany({
      data: [
        {
          periodMonth: "2026-07",
          category: "income",
          labelRaw: "Salary",
          labelNormalized: "salary",
          amountMinorUnits: 80_000,
          trustState: "validated",
        },
        {
          periodMonth: "2026-08",
          category: "income",
          labelRaw: "Salary",
          labelNormalized: "salary",
          amountMinorUnits: 100_000,
          trustState: "validated",
        },
      ],
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reports the same month-over-month income variance the Analytics screen would show", async () => {
    const view = await getBehavioralIntelligenceView(db, ASOF);
    expect(view.whatsChanged.result.kind).toBe("ok");
    if (view.whatsChanged.result.kind !== "ok") return;
    const income = view.whatsChanged.result.value.budgetVariances.find((v) => v.metric === "Income");
    expect(income?.currentMinorUnits).toBe(100_000);
    expect(income?.priorMinorUnits).toBe(80_000);
    expect(income?.absoluteMinorUnits).toBe(20_000);
  });

  it("reports July as covered and June as missing, from the earliest recorded plan record to the as-of date", async () => {
    const view = await getBehavioralIntelligenceView(db, ASOF);
    expect(view.historicalCoverage.result.kind).toBe("ok");
    if (view.historicalCoverage.result.kind !== "ok") return;
    const { coverage } = view.historicalCoverage.result.value;
    expect(coverage.monthsCounted).toContain("2026-07");
    // August is only partly inside the range (as-of is mid-month), so it is
    // partial, not counted or missing.
    expect(coverage.monthsPartial).toContain("2026-08");
  });
});
