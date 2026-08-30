/**
 * Development seed: the fixed goal set, liability, and insurance baseline
 * documented in docs/02_REQUIREMENTS.md. These are the project's own
 * recorded requirements (not fabricated), used so the app has a realistic
 * starting shape to develop M4+ against before real budget ingestion (M3)
 * populates plan/activity data.
 *
 * Idempotent: safe to re-run against a fresh dev database.
 * Run: pnpm db:seed
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // --- Goals, in fixed priority order (docs/02_REQUIREMENTS.md) ---
  const goals: Array<{
    name: string;
    kind: string;
    targetAmountMinorUnits: number;
    targetDate: Date | null;
    priorityRank: number;
    lifecycleState: string;
  }> = [
    {
      name: "Emergency fund",
      kind: "emergency_fund",
      targetAmountMinorUnits: 300_000 * 100, // placeholder target; user-overridable in Settings
      targetDate: null,
      priorityRank: 1,
      lifecycleState: "in_progress",
    },
    {
      name: "Car (Kia Seltos target)",
      kind: "car",
      targetAmountMinorUnits: 1_300_000 * 100, // ceiling of the ₹10-13L range
      targetDate: new Date("2027-12-31"),
      priorityRank: 2,
      lifecycleState: "in_progress",
    },
    {
      name: "Marriage",
      kind: "marriage",
      targetAmountMinorUnits: 1_000_000 * 100, // upper end of ₹8-10L range
      targetDate: null,
      priorityRank: 3,
      lifecycleState: "planned",
    },
    {
      name: "Third-floor construction",
      kind: "third_floor",
      targetAmountMinorUnits: 1_000_000 * 100,
      targetDate: null,
      priorityRank: 4,
      lifecycleState: "planned",
    },
    {
      name: "PS5",
      kind: "custom",
      targetAmountMinorUnits: 55_000 * 100,
      targetDate: null,
      priorityRank: 5,
      lifecycleState: "in_progress",
    },
    {
      name: "Apple Watch",
      kind: "custom",
      targetAmountMinorUnits: 25_000 * 100,
      targetDate: null,
      priorityRank: 6,
      lifecycleState: "achieved",
    },
  ];

  for (const goal of goals) {
    const existing = await db.goal.findFirst({ where: { name: goal.name } });
    if (!existing) {
      await db.goal.create({ data: goal });
    }
  }

  // --- Liability: home loan with payer split ---
  const existingLiability = await db.liability.findFirst({ where: { name: "Home Loan / LAP" } });
  if (!existingLiability) {
    const liability = await db.liability.create({
      data: {
        name: "Home Loan / LAP",
        kind: "home_loan",
        principalMinorUnits: 2_500_000 * 100,
        outstandingMinorUnits: 2_373_000 * 100,
        outstandingAsOf: new Date("2026-08-01"),
        interestRateBps: 850,
        tenureMonths: 180,
        emiAmountMinorUnits: 28_416 * 100,
      },
    });
    await db.liabilityPayerSplit.createMany({
      data: [
        {
          liabilityId: liability.id,
          payerName: "User",
          shareBps: Math.round((10_000 / 28_416) * 10_000),
          effectiveFrom: new Date("2026-07-01"),
        },
        {
          liabilityId: liability.id,
          payerName: "Father & Brother (combined)",
          shareBps: 10_000 - Math.round((10_000 / 28_416) * 10_000),
          effectiveFrom: new Date("2026-07-01"),
        },
      ],
    });
  }

  // --- Insurance policies ---
  const policies: Array<{
    kind: string;
    insuredParty: string;
    coverAmountMinorUnits: number;
    premiumMinorUnits: number;
    premiumFrequency: string;
    provider: string;
    status: string;
  }> = [
    {
      kind: "health_personal",
      insuredParty: "User",
      coverAmountMinorUnits: 250_000 * 100,
      premiumMinorUnits: 0,
      premiumFrequency: "annual",
      provider: "Unspecified",
      status: "active",
    },
    {
      kind: "health_family",
      insuredParty: "Family",
      coverAmountMinorUnits: 1_000_000 * 100,
      premiumMinorUnits: 0,
      premiumFrequency: "annual",
      provider: "Aditya Birla One NXT",
      status: "active",
    },
    {
      kind: "term",
      insuredParty: "User",
      coverAmountMinorUnits: 0,
      premiumMinorUnits: 0,
      premiumFrequency: "annual",
      provider: "Unspecified",
      status: "planned",
    },
  ];

  for (const policy of policies) {
    const existing = await db.insurancePolicy.findFirst({
      where: { kind: policy.kind, insuredParty: policy.insuredParty },
    });
    if (!existing) {
      await db.insurancePolicy.create({ data: policy });
    }
  }

  // --- App settings ---
  await db.appSetting.upsert({
    where: { key: "salary_increment_split" },
    update: {},
    create: {
      key: "salary_increment_split",
      valueJson: JSON.stringify({ investmentsPct: 50, priorityGoalPct: 30, lifestylePct: 20 }),
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
