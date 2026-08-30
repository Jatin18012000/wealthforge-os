import { describe, expect, it } from "vitest";
import {
  comparePeriods,
  comparePlannedAllocation,
  computePeriodMetrics,
  expectOk,
  type FilterableActivity,
  type PlanRecordInput,
} from "../../src/domain";

const range = (start: string, end: string) => ({
  start: new Date(`${start}T00:00:00Z`),
  end: new Date(`${end}T00:00:00Z`),
});

function monthOf(periodMonth: string, income: number, expense: number): PlanRecordInput[] {
  return [
    {
      id: `${periodMonth}-income`,
      periodMonth,
      category: "income",
      labelRaw: "Salary",
      amountMinorUnits: income * 100,
      trustState: "validated",
    },
    {
      id: `${periodMonth}-expense`,
      periodMonth,
      category: "expense",
      labelRaw: "Living",
      amountMinorUnits: expense * 100,
      trustState: "validated",
    },
  ];
}

const PLAN: PlanRecordInput[] = [
  ...monthOf("2026-05", 60_000, 20_000),
  ...monthOf("2026-06", 62_000, 22_000),
  ...monthOf("2026-07", 64_000, 21_000),
  ...monthOf("2026-08", 65_000, 23_000),
];

const activity = (
  id: string,
  kind: string,
  amount: number,
  on: string,
  extra: Partial<FilterableActivity> = {},
): FilterableActivity => ({
  id,
  kind,
  amountMinorUnits: amount * 100,
  occurredOn: new Date(`${on}T00:00:00Z`),
  trustState: "validated",
  ...extra,
});

describe("period metrics", () => {
  it("sums whole months that fall inside the range", () => {
    const metrics = computePeriodMetrics(range("2026-06-01", "2026-08-01"), PLAN, []);
    const budget = expectOk(metrics.budget);

    expect(metrics.coverage.monthsCounted).toEqual(["2026-06", "2026-07"]);
    expect(budget.incomeMinorUnits).toBe((62_000 + 64_000) * 100);
    expect(budget.expenseMinorUnits).toBe((22_000 + 21_000) * 100);
    expect(metrics.coverage.isComplete).toBe(true);
    expect(metrics.coverage.notes).toEqual([]);
  });

  it("refuses to pro-rate a month the range only partly covers", () => {
    // The decisive rule: half of August's salary is a number that appears in
    // no source, so it is excluded and the exclusion is reported.
    const metrics = computePeriodMetrics(range("2026-08-10", "2026-08-25"), PLAN, []);

    expect(metrics.coverage.monthsCounted).toEqual([]);
    expect(metrics.coverage.monthsPartial).toEqual(["2026-08"]);
    expect(metrics.budget.kind).toBe("insufficient-data");
    expect(metrics.coverage.isComplete).toBe(false);
    expect(metrics.coverage.notes.join(" ")).toContain("excluded rather than divided up");
  });

  it("counts a month with no data as absent, not as zero", () => {
    // April has no plan records at all.
    const metrics = computePeriodMetrics(range("2026-04-01", "2026-07-01"), PLAN, []);

    expect(metrics.coverage.monthsMissing).toEqual(["2026-04"]);
    expect(metrics.coverage.isComplete).toBe(false);
    expect(metrics.coverage.notes.join(" ")).toContain("not as zero");

    // The total covers only the months that had data.
    const budget = expectOk(metrics.budget);
    expect(budget.incomeMinorUnits).toBe((60_000 + 62_000) * 100);
  });

  it("derives retained and left over cash from the summed components", () => {
    const plan = [
      ...monthOf("2026-06", 60_000, 20_000),
      {
        id: "emi",
        periodMonth: "2026-06",
        category: "emi" as const,
        labelRaw: "Home emi",
        amountMinorUnits: 10_000 * 100,
        trustState: "validated",
      },
      {
        id: "sip",
        periodMonth: "2026-06",
        category: "investment" as const,
        labelRaw: "SIP",
        amountMinorUnits: 19_500 * 100,
        trustState: "validated",
      },
    ];
    const metrics = computePeriodMetrics(range("2026-06-01", "2026-07-01"), plan, []);
    const budget = expectOk(metrics.budget);

    expect(budget.retainedMinorUnits).toBe((60_000 - 20_000 - 10_000) * 100);
    expect(budget.unallocatedMinorUnits).toBe((30_000 - 19_500) * 100);
  });

  it("sums dated activity exactly, with no month-granularity problem", () => {
    const activities = [
      activity("a", "one_time_expense", 500, "2026-06-15"),
      activity("b", "one_time_expense", 300, "2026-07-20"),
      // Outside the range.
      activity("c", "one_time_expense", 900, "2026-08-05"),
    ];
    const metrics = computePeriodMetrics(range("2026-06-01", "2026-08-01"), PLAN, activities);

    expect(metrics.activityByCategory.expense).toBe(800 * 100);
    expect(metrics.activityCount).toBe(2);
  });

  it("ignores untrusted activity", () => {
    const activities = [
      activity("a", "one_time_expense", 500, "2026-06-15"),
      activity("b", "one_time_expense", 999, "2026-06-16", { trustState: "needs_review" }),
    ];
    const metrics = computePeriodMetrics(range("2026-06-01", "2026-07-01"), PLAN, activities);
    expect(metrics.activityByCategory.expense).toBe(500 * 100);
  });

  it("excludes goal transfers, which move money between the household's own buckets", () => {
    const activities = [activity("g", "goal_contribution", 5_000, "2026-06-15")];
    const metrics = computePeriodMetrics(range("2026-06-01", "2026-07-01"), PLAN, activities);

    expect(metrics.activityCount).toBe(0);
    expect(metrics.activityByCategory.expense).toBe(0);
  });
});

describe("activity filters", () => {
  const activities = [
    activity("buy1", "buy", 10_000, "2026-06-10", { instrumentId: "i1" }),
    activity("buy2", "buy", 4_000, "2026-06-12", { instrumentId: "i2" }),
    activity("exp", "one_time_expense", 700, "2026-06-14"),
  ];

  it("filters by activity kind", () => {
    const metrics = computePeriodMetrics(
      range("2026-06-01", "2026-07-01"),
      PLAN,
      activities,
      { kinds: ["buy"] },
    );
    expect(metrics.activityByCategory.investment).toBe(14_000 * 100);
    expect(metrics.activityByCategory.expense).toBe(0);
  });

  it("filters by instrument", () => {
    const metrics = computePeriodMetrics(
      range("2026-06-01", "2026-07-01"),
      PLAN,
      activities,
      { instrumentIds: ["i1"] },
    );
    expect(metrics.activityByCategory.investment).toBe(10_000 * 100);
    expect(metrics.activityCount).toBe(1);
  });

  it("treats an empty filter as no filter", () => {
    const metrics = computePeriodMetrics(range("2026-06-01", "2026-07-01"), PLAN, activities, {
      kinds: [],
    });
    expect(metrics.activityCount).toBe(3);
  });
});

describe("period comparison", () => {
  it("computes absolute and proportional variance", () => {
    const current = computePeriodMetrics(range("2026-07-01", "2026-08-01"), PLAN, []);
    const prior = computePeriodMetrics(range("2026-06-01", "2026-07-01"), PLAN, []);
    const comparison = comparePeriods(current, prior);

    const income = comparison.budgetVariances.find((v) => v.metric === "Income");
    expect(income?.currentMinorUnits).toBe(64_000 * 100);
    expect(income?.priorMinorUnits).toBe(62_000 * 100);
    expect(income?.absoluteMinorUnits).toBe(2_000 * 100);
    expect(income?.ratio).toBeCloseTo(2_000 / 62_000, 10);
    expect(income?.incomplete).toBe(false);
  });

  it("marks a metric incomplete rather than treating an absent side as zero", () => {
    const current = computePeriodMetrics(range("2026-07-01", "2026-08-01"), PLAN, []);
    // March has no data, so the prior side cannot produce budget totals.
    const prior = computePeriodMetrics(range("2026-03-01", "2026-04-01"), PLAN, []);
    const comparison = comparePeriods(current, prior);

    for (const variance of comparison.budgetVariances) {
      expect(variance.incomplete).toBe(true);
      expect(variance.absoluteMinorUnits).toBeNull();
      expect(variance.ratio).toBeNull();
    }
  });

  it("carries coverage warnings from both sides into the comparison", () => {
    const current = computePeriodMetrics(range("2026-08-10", "2026-08-25"), PLAN, []);
    const prior = computePeriodMetrics(range("2026-03-01", "2026-04-01"), PLAN, []);
    const comparison = comparePeriods(current, prior);

    expect(comparison.coverageNotes.some((note) => note.startsWith("Selected period:"))).toBe(true);
    expect(comparison.coverageNotes.some((note) => note.startsWith("Comparison period:"))).toBe(true);
  });

  it("leaves the ratio undefined against a zero base", () => {
    const zeroPlan = monthOf("2026-06", 0, 0);
    const current = computePeriodMetrics(range("2026-07-01", "2026-08-01"), PLAN, []);
    const prior = computePeriodMetrics(range("2026-06-01", "2026-07-01"), zeroPlan, []);
    const comparison = comparePeriods(current, prior);

    const income = comparison.budgetVariances.find((v) => v.metric === "Income");
    expect(income?.absoluteMinorUnits).toBe(64_000 * 100);
    // An infinite percentage increase is not a useful thing to display.
    expect(income?.ratio).toBeNull();
  });

  it("distinguishes no recorded activity from zero activity", () => {
    const withActivity = computePeriodMetrics(range("2026-07-01", "2026-08-01"), PLAN, [
      activity("a", "one_time_expense", 500, "2026-07-10"),
    ]);
    const withoutActivity = computePeriodMetrics(range("2026-06-01", "2026-07-01"), PLAN, []);
    const comparison = comparePeriods(withActivity, withoutActivity);

    const expenses = comparison.activityVariances.find((v) => v.metric === "Expenses paid");
    // The prior period has no activity records at all — an absence, not a zero.
    expect(expenses?.priorMinorUnits).toBeNull();
    expect(expenses?.incomplete).toBe(true);
  });
});

describe("planned versus observed allocation", () => {
  it("reports both sides as amounts and shares", () => {
    const rows = comparePlannedAllocation(
      [
        { label: "Gold", amountMinorUnits: 2_000 * 100 },
        { label: "Silver", amountMinorUnits: 1_000 * 100 },
      ],
      [
        { label: "Gold", valueMinorUnits: 13_674 * 100 },
        { label: "Silver", valueMinorUnits: 27_418 * 100 },
      ],
    );

    const gold = rows.find((row) => row.label === "Gold");
    expect(gold?.plannedRatio).toBeCloseTo(2 / 3, 10);
    expect(gold?.observedRatio).toBeCloseTo(13_674 / (13_674 + 27_418), 10);
  });

  it("keeps a null where a line exists on only one side", () => {
    const rows = comparePlannedAllocation(
      [{ label: "Planned only", amountMinorUnits: 1_000 * 100 }],
      [{ label: "Held only", valueMinorUnits: 500 * 100 }],
    );

    // Planning to buy something not yet held, and holding something never
    // planned, are different situations and must not look identical.
    expect(rows.find((r) => r.label === "Planned only")?.observedMinorUnits).toBeNull();
    expect(rows.find((r) => r.label === "Held only")?.plannedMinorUnits).toBeNull();
  });
});
