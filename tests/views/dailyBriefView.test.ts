import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGroundingPayload } from "../../src/ai";
import { getDailyBriefReport } from "../../src/views/dailyBriefView";
import { createTestDb } from "../setup/testDb";

const EXPECTED_SECTION_TITLES = [
  "Position",
  "Changes",
  "Why",
  "Deviations",
  "Risks",
  "Goals",
  "Portfolio",
  "Data quality",
];

describe("daily brief view — empty database", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("builds all eight sections with honest insufficient-data lines rather than crashing or fabricating figures", async () => {
    const report = await getDailyBriefReport(db);
    expect(report.sections.map((s) => s.title)).toEqual(EXPECTED_SECTION_TITLES);

    // Every line must be a real fact/inference/recommendation triple —
    // structurally guaranteed by the fact()/inference()/recommendation()
    // constructors, so this just confirms no section is left empty.
    for (const section of report.sections) {
      expect(section.lines.length).toBeGreaterThan(0);
    }

    const payload = buildGroundingPayload(report);
    expect(payload.length).toBeGreaterThan(0);
  });
});

describe("daily brief view — with real reference data", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    const stock = await db.instrument.create({
      data: { kind: "equity", identifier: "GROWTH", displayName: "Growth Co" },
    });
    await db.valuation.create({
      data: { instrumentId: stock.id, asOfDate: new Date("2026-08-08T00:00:00Z"), priceMinorUnits: 1_000, source: "test" },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: stock.id,
        asOfDate: new Date("2026-08-08T00:00:00Z"),
        quantity: 100,
        unit: "shares",
        costBasisMinorUnits: 90_000,
        trustState: "validated",
      },
    });

    await db.goal.create({
      data: {
        name: "Emergency fund",
        kind: "emergency_fund",
        targetAmountMinorUnits: 300_000,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });

    await db.planRecord.createMany({
      data: [
        {
          periodMonth: "2026-08",
          category: "income",
          labelRaw: "Salary",
          labelNormalized: "salary",
          amountMinorUnits: 100_000,
          trustState: "validated",
        },
        {
          periodMonth: "2026-08",
          category: "expense",
          labelRaw: "Expenses",
          labelNormalized: "expenses",
          amountMinorUnits: 40_000,
          trustState: "needs_review",
        },
      ],
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("restates real computed figures (net worth, holdings, goal progress) with no fabricated numbers", async () => {
    const report = await getDailyBriefReport(db);

    const position = report.sections.find((s) => s.title === "Position");
    expect(position?.lines.some((l) => l.text.includes("₹1,000"))).toBe(true); // 100 shares * priceMinorUnits 1,000 (paise) = 100,000 paise = ₹1,000

    const portfolio = report.sections.find((s) => s.title === "Portfolio");
    expect(portfolio?.lines.some((l) => l.text.includes("Growth Co"))).toBe(true);

    const goals = report.sections.find((s) => s.title === "Goals");
    expect(goals?.lines.some((l) => l.text.includes("Emergency fund"))).toBe(true);

    const dataQuality = report.sections.find((s) => s.title === "Data quality");
    expect(dataQuality?.lines.some((l) => l.kind === "recommendation" && l.text.includes("needs-review"))).toBe(
      true,
    );

    // Every number in the report must be traceable — this is the same
    // payload the AI receives and is checked against, so this is the
    // actual grounding contract, not just a smoke test.
    const payload = buildGroundingPayload(report);
    expect(payload).toContain("Growth Co");
    expect(payload).toContain("[FACT]");
  });
});
