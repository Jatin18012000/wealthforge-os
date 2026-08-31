/**
 * Populates a database for developing and demonstrating the dashboard.
 *
 * It runs the REAL ingestion pipeline over the anonymized reference fixtures
 * rather than inserting rows directly, so what the screens display is the
 * genuine output of parsing, normalization, validation and the engine — not
 * hand-written numbers that could flatter the UI.
 *
 * All figures are the invented fixture values (see
 * tests/fixtures/reference/README.md). Safe to re-run: ingestion is
 * idempotent, and the non-ingested records below are upserted.
 *
 * Run: pnpm db:demo
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { importBudgetWorkbook } from "../src/ingestion";
import { importPortfolioSnapshot } from "../src/ingestion/portfolio";
import { PRIMARY_PAYER_SETTING_KEY } from "../src/views/liabilitiesView";

const db = new PrismaClient();

const FIXTURES = path.resolve("tests/fixtures/reference");
const PRIMARY_PAYER = "You";

async function ingestFixtures(): Promise<void> {
  const budget = await importBudgetWorkbook(
    db,
    path.join(FIXTURES, "budget-reference-layout.xlsx"),
    { defaultYear: 2026 },
  );
  console.log(
    `Budget: ${budget.sheetsScanned} sheets scanned — ${budget.counts.new} new, ${budget.counts.modified} modified, ${budget.counts.unchanged} unchanged`,
  );

  for (const file of [
    "zerodha-holdings-2026-08-03.xlsx",
    "zerodha-holdings-2026-08-08.xlsx",
  ]) {
    const snapshot = await importPortfolioSnapshot(db, path.join(FIXTURES, file), {});
    console.log(
      `Holdings ${snapshot.asOf.toISOString().slice(0, 10)}: ${snapshot.positionsCreated} created, ${snapshot.positionsUnchanged} unchanged, ${snapshot.observedChanges.length} observed changes`,
    );
  }
}

/**
 * Cash is modelled as an instrument priced at ₹1 per unit, so the valuation
 * engine handles it with no special case while the portfolio screen filters
 * it out of asset allocation.
 */
async function seedCash(asOf: Date, rupees: number): Promise<void> {
  const instrument =
    (await db.instrument.findFirst({ where: { kind: "cash", identifier: "CASH-INR" } })) ??
    (await db.instrument.create({
      data: { kind: "cash", identifier: "CASH-INR", displayName: "Cash" },
    }));

  const existingValuation = await db.valuation.findFirst({
    where: { instrumentId: instrument.id, asOfDate: asOf },
  });
  if (existingValuation === null) {
    await db.valuation.create({
      data: {
        instrumentId: instrument.id,
        asOfDate: asOf,
        priceMinorUnits: 100, // ₹1 per unit
        source: "demo-seed",
      },
    });
  }

  const existingPosition = await db.positionSnapshot.findFirst({
    where: { instrumentId: instrument.id, asOfDate: asOf, supersededById: null },
  });
  if (existingPosition === null) {
    await db.positionSnapshot.create({
      data: {
        instrumentId: instrument.id,
        asOfDate: asOf,
        quantity: rupees,
        unit: "rupees",
        trustState: "validated",
      },
    });
  }
}

async function seedGoalsAndLiability(): Promise<void> {
  const goals: Array<{
    name: string;
    kind: string;
    targetRupees: number;
    priorityRank: number;
    lifecycleState: string;
    targetDate: Date | null;
    contributions: Array<{ rupees: number; on: string }>;
  }> = [
    {
      name: "Emergency fund",
      kind: "emergency_fund",
      targetRupees: 300_000,
      priorityRank: 1,
      lifecycleState: "in_progress",
      targetDate: null,
      contributions: [
        { rupees: 12_000, on: "2026-06-30" },
        { rupees: 12_000, on: "2026-07-31" },
        { rupees: 15_000, on: "2026-08-31" },
      ],
    },
    {
      name: "Car",
      kind: "car",
      targetRupees: 1_300_000,
      priorityRank: 2,
      lifecycleState: "in_progress",
      targetDate: new Date("2027-12-31T00:00:00Z"),
      contributions: [{ rupees: 40_000, on: "2026-08-31" }],
    },
    {
      name: "Marriage",
      kind: "marriage",
      targetRupees: 1_000_000,
      priorityRank: 3,
      lifecycleState: "planned",
      targetDate: null,
      contributions: [],
    },
    {
      name: "Third-floor construction",
      kind: "third_floor",
      targetRupees: 1_000_000,
      priorityRank: 4,
      lifecycleState: "planned",
      targetDate: null,
      contributions: [],
    },
    {
      name: "PS5",
      kind: "custom",
      targetRupees: 55_000,
      priorityRank: 5,
      lifecycleState: "in_progress",
      targetDate: null,
      contributions: [
        { rupees: 5_000, on: "2026-07-31" },
        { rupees: 5_000, on: "2026-08-31" },
      ],
    },
    {
      name: "Smart watch",
      kind: "custom",
      targetRupees: 25_000,
      priorityRank: 6,
      lifecycleState: "achieved",
      targetDate: null,
      contributions: [{ rupees: 25_000, on: "2026-05-31" }],
    },
  ];

  for (const spec of goals) {
    const existing = await db.goal.findFirst({ where: { name: spec.name } });
    if (existing !== null) continue;

    const goal = await db.goal.create({
      data: {
        name: spec.name,
        kind: spec.kind,
        targetAmountMinorUnits: spec.targetRupees * 100,
        targetDate: spec.targetDate,
        priorityRank: spec.priorityRank,
        lifecycleState: spec.lifecycleState,
      },
    });

    if (spec.contributions.length > 0) {
      await db.activity.createMany({
        data: spec.contributions.map((contribution) => ({
          kind: "goal_contribution",
          goalId: goal.id,
          amountMinorUnits: contribution.rupees * 100,
          occurredOn: new Date(`${contribution.on}T00:00:00Z`),
          trustState: "validated",
        })),
      });
    }
  }

  const existingLiability = await db.liability.findFirst({ where: { name: "Home Loan / LAP" } });
  if (existingLiability === null) {
    const liability = await db.liability.create({
      data: {
        name: "Home Loan / LAP",
        kind: "home_loan",
        principalMinorUnits: 2_500_000 * 100,
        outstandingMinorUnits: 2_373_000 * 100,
        outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
        interestRateBps: 850,
        tenureMonths: 180,
        emiAmountMinorUnits: 28_416 * 100,
      },
    });

    // The user pays ₹10,000 of the household EMI; the balance is covered by
    // family, per the documented baseline.
    const userShareBps = Math.round((10_000 / 28_416) * 10_000);
    await db.liabilityPayerSplit.createMany({
      data: [
        {
          liabilityId: liability.id,
          payerName: PRIMARY_PAYER,
          shareBps: userShareBps,
          effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        },
        {
          liabilityId: liability.id,
          payerName: "Family",
          shareBps: 10_000 - userShareBps,
          effectiveFrom: new Date("2026-07-01T00:00:00Z"),
        },
      ],
    });
  }
}

async function seedInsurance(): Promise<void> {
  const existing = await db.insurancePolicy.findFirst();
  if (existing !== null) return;

  // Figures per docs/02_REQUIREMENTS.md — the only insurance data the
  // requirements doc actually specifies. Cover amounts are recorded where
  // stated; premiums and the term policy's cover amount are not stated
  // anywhere, so they are left null (never fabricated as 0) and render as
  // "not recorded" on the Insurance screen. Term insurance is recorded as
  // `planned`, not `active`, since it is explicitly not yet in force.
  await db.insurancePolicy.createMany({
    data: [
      {
        kind: "health_personal",
        insuredParty: PRIMARY_PAYER,
        coverAmountMinorUnits: 2_50_000 * 100,
        premiumMinorUnits: null,
        premiumFrequency: null,
        provider: "Unspecified",
        status: "active",
      },
      {
        kind: "health_family",
        insuredParty: "Family",
        coverAmountMinorUnits: 10_00_000 * 100,
        premiumMinorUnits: null,
        premiumFrequency: null,
        provider: "Aditya Birla One NXT",
        status: "active",
      },
      {
        kind: "term",
        insuredParty: PRIMARY_PAYER,
        coverAmountMinorUnits: null,
        premiumMinorUnits: null,
        premiumFrequency: null,
        provider: "Unspecified",
        status: "planned",
        effectiveFrom: new Date("2026-12-31T00:00:00Z"),
      },
    ],
  });
}

async function main(): Promise<void> {
  await ingestFixtures();

  const latestPosition = await db.positionSnapshot.findFirst({
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  const asOf = latestPosition?.asOfDate ?? new Date("2026-08-08T00:00:00Z");

  await seedCash(asOf, 27_000);
  await seedGoalsAndLiability();
  await seedInsurance();

  await db.appSetting.upsert({
    where: { key: PRIMARY_PAYER_SETTING_KEY },
    update: { valueJson: JSON.stringify(PRIMARY_PAYER) },
    create: { key: PRIMARY_PAYER_SETTING_KEY, valueJson: JSON.stringify(PRIMARY_PAYER) },
  });
  await db.appSetting.upsert({
    where: { key: "salary_increment_split" },
    update: {},
    create: {
      key: "salary_increment_split",
      valueJson: JSON.stringify({ investmentsPct: 50, priorityGoalPct: 30, lifestylePct: 20 }),
    },
  });

  console.log("Demo seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
