import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../src/domain";
import { importBudgetWorkbook } from "../../src/ingestion";
import { importPortfolioSnapshot } from "../../src/ingestion/portfolio";
import { getCommandCenterView } from "../../src/views/commandCenterView";
import { listPeriods, resolveAsOf, resolveLatestPeriod } from "../../src/views/context";
import { getBudgetView } from "../../src/views/budgetView";
import { getGoalsView } from "../../src/views/goalsView";
import {
  PRIMARY_PAYER_SETTING_KEY,
  getLiabilitiesView,
} from "../../src/views/liabilitiesView";
import { getPortfolioView } from "../../src/views/portfolioView";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/reference");

/**
 * Screens are tested through their view models rather than a rendered DOM.
 *
 * The view layer is where loaders meet the engine, so it is where a screen
 * can actually be wrong about money. Rendering is covered separately by the
 * Playwright E2E run.
 */
describe("dashboard view models", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await importBudgetWorkbook(db, path.join(FIXTURES, "budget-reference-layout.xlsx"), {
      defaultYear: 2026,
    });
    await importPortfolioSnapshot(db, path.join(FIXTURES, "zerodha-holdings-2026-08-03.xlsx"), {});
    await importPortfolioSnapshot(db, path.join(FIXTURES, "zerodha-holdings-2026-08-08.xlsx"), {});

    const cash = await db.instrument.create({
      data: { kind: "cash", identifier: "CASH-INR", displayName: "Cash" },
    });
    await db.valuation.create({
      data: {
        instrumentId: cash.id,
        asOfDate: new Date("2026-08-08T00:00:00Z"),
        priceMinorUnits: 100,
        source: "test",
      },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: cash.id,
        asOfDate: new Date("2026-08-08T00:00:00Z"),
        quantity: 27_000,
        unit: "rupees",
        trustState: "validated",
      },
    });

    const goal = await db.goal.create({
      data: {
        name: "Emergency fund",
        kind: "emergency_fund",
        targetAmountMinorUnits: 300_000 * 100,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 15_000 * 100,
        occurredOn: new Date("2026-08-01T00:00:00Z"),
        trustState: "validated",
      },
    });

    const liability = await db.liability.create({
      data: {
        name: "Home Loan",
        kind: "home_loan",
        principalMinorUnits: 2_500_000 * 100,
        outstandingMinorUnits: 2_373_000 * 100,
        outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
        interestRateBps: 850,
        tenureMonths: 180,
        emiAmountMinorUnits: 28_416 * 100,
      },
    });
    await db.liabilityPayerSplit.createMany({
      data: [
        {
          liabilityId: liability.id,
          payerName: "You",
          shareBps: 3_519,
          effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        },
        {
          liabilityId: liability.id,
          payerName: "Family",
          shareBps: 6_481,
          effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        },
      ],
    });
    await db.appSetting.create({
      data: { key: PRIMARY_PAYER_SETTING_KEY, valueJson: JSON.stringify("You") },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("dates every figure from the data, not from today", async () => {
    const asOf = await resolveAsOf(db);
    // The newest statement is 8 August; showing today's date over these
    // figures would imply a freshness the data does not have.
    expect(asOf.toISOString().slice(0, 10)).toBe("2026-08-08");
  });

  it("builds a budget view whose totals match the workbook's own formulas", async () => {
    const periods = await listPeriods(db);
    const latest = await resolveLatestPeriod(db);
    const view = await getBudgetView(db, latest as string, periods);

    const summary = expectOk(view.summary);
    expect(summary.retainedMinorUnits).toBe(25_223 * 100);
    expect(summary.investmentMinorUnits).toBe(19_500 * 100);
    expect(summary.unallocatedMinorUnits).toBe((25_223 - 19_500) * 100);

    // Line items are listed for drill-down, grouped by category.
    expect(view.lines.length).toBeGreaterThan(0);
    expect(view.lines.every((line) => line.trustLabel.length > 0)).toBe(true);
    expect(view.availablePeriods).toContain("2026-08");
  });

  it("reports missing actuals as uncovered rather than as zero", async () => {
    const periods = await listPeriods(db);
    const view = await getBudgetView(db, "2026-08", periods);
    const comparison = expectOk(view.planVsReality);

    expect(comparison.hasNoActuals).toBe(true);
    expect(comparison.categories.every((row) => row.actualMinorUnits === null)).toBe(true);
  });

  it("excludes cash from portfolio allocation but keeps it in net worth", async () => {
    const asOf = await resolveAsOf(db);
    const portfolio = await getPortfolioView(db, asOf);

    // Cash would distort every allocation share if mixed into the portfolio.
    expect(portfolio.holdings.some((h) => h.assetClass === "cash")).toBe(false);

    const view = await getCommandCenterView(db, asOf, "2026-08", await listPeriods(db));
    expect(view.cashMinorUnits).toBe(27_000 * 100);

    const netWorth = expectOk(view.netWorth);
    const portfolioTotal = expectOk(portfolio.valuation).totalMinorUnits;
    expect(netWorth.totalAssetsMinorUnits).toBe(portfolioTotal + 27_000 * 100);
  });

  it("computes net worth as trusted assets minus trusted liabilities", async () => {
    const asOf = await resolveAsOf(db);
    const view = await getCommandCenterView(db, asOf, "2026-08", await listPeriods(db));
    const netWorth = expectOk(view.netWorth);

    expect(netWorth.totalLiabilitiesMinorUnits).toBe(2_373_000 * 100);
    expect(netWorth.netWorthMinorUnits).toBe(
      netWorth.totalAssetsMinorUnits - netWorth.totalLiabilitiesMinorUnits,
    );
  });

  it("surfaces unexplained position changes on the Command Center", async () => {
    const asOf = await resolveAsOf(db);
    const view = await getCommandCenterView(db, asOf, "2026-08", await listPeriods(db));

    // Two ETF holdings grew between the statements with no transaction
    // recorded. Ingestion refuses to invent a trade — that refusal is only
    // useful if the change actually reaches the user.
    const unexplained = view.alerts.filter((alert) =>
      alert.title.includes("no recorded transaction"),
    );
    expect(unexplained).toHaveLength(2);
    expect(unexplained.every((alert) => alert.level === "caution")).toBe(true);
  });

  it("flags the emergency fund as protected and under-funded", async () => {
    const asOf = await resolveAsOf(db);
    const goals = await getGoalsView(db, asOf);

    const emergency = goals.active.find((card) => card.goal.kind === "emergency_fund");
    expect(emergency?.progress.isProtected).toBe(true);
    expect(emergency?.progress.currentAmountMinorUnits).toBe(15_000 * 100);

    const view = await getCommandCenterView(db, asOf, "2026-08", await listPeriods(db));
    expect(view.alerts.some((alert) => alert.title.includes("Emergency fund"))).toBe(true);
  });

  it("splits EMI by payer so the parts sum to the whole", async () => {
    const asOf = await resolveAsOf(db);
    const view = await getLiabilitiesView(db, asOf);

    const shares = expectOk(view.cards[0]!.payerShares);
    const total = shares.reduce((sum, share) => sum + share.shareMinorUnits, 0);
    expect(total).toBe(28_416 * 100);
  });

  it("marks an EMI release projection as schedule-only with no payment history", async () => {
    const asOf = await resolveAsOf(db);
    const view = await getLiabilitiesView(db, asOf);

    const release = expectOk(view.cards[0]!.release);
    expect(release.fromScheduleOnly).toBe(true);
    expect(release.paymentsMade).toBe(0);
  });

  it("passes insufficient-data through instead of substituting zero", async () => {
    const empty = createTestDb();
    try {
      const asOf = await resolveAsOf(empty.db);
      const view = await getCommandCenterView(empty.db, asOf, null, []);

      // With no data at all, net worth must be an explained absence — a ₹0
      // net worth derived from nothing is a fabricated number.
      expect(view.netWorth.kind).toBe("insufficient-data");
      expect(view.portfolio.valuation.kind).toBe("insufficient-data");
      expect(view.cashMinorUnits).toBeNull();
      expect(view.budget).toBeNull();
    } finally {
      await empty.cleanup();
    }
  });
});
