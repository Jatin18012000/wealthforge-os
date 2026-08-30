import type { PrismaClient } from "@prisma/client";

/**
 * View-model layer.
 *
 * Each builder here calls the loaders and the domain engine and returns
 * plain, render-ready data. Components receive that data and display it —
 * they perform no arithmetic and never touch the database
 * (CLAUDE.md §3, "no financial calculation logic inside a React component").
 *
 * Keeping the composition here also means every screen is unit-testable
 * without a DOM, which is what the M6 tests do.
 */

/**
 * The date every figure on a screen is computed "as of".
 *
 * Defaults to the most recent date the data actually covers rather than
 * today: showing today's date above figures derived from a three-week-old
 * snapshot would imply a freshness the data does not have.
 */
export async function resolveAsOf(db: PrismaClient): Promise<Date> {
  const latestPosition = await db.positionSnapshot.findFirst({
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  const latestValuation = await db.valuation.findFirst({
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });

  const candidates = [latestPosition?.asOfDate, latestValuation?.asOfDate].filter(
    (date): date is Date => date instanceof Date,
  );

  if (candidates.length === 0) return new Date();
  return candidates.reduce((latest, date) => (date > latest ? date : latest));
}

/** The most recent budget period that has any effective records. */
export async function resolveLatestPeriod(db: PrismaClient): Promise<string | null> {
  const record = await db.planRecord.findFirst({
    where: { supersededById: null },
    orderBy: { periodMonth: "desc" },
    select: { periodMonth: true },
  });
  return record?.periodMonth ?? null;
}

/** Every budget period with effective records, newest first. */
export async function listPeriods(db: PrismaClient): Promise<string[]> {
  const rows = await db.planRecord.findMany({
    where: { supersededById: null },
    distinct: ["periodMonth"],
    orderBy: { periodMonth: "desc" },
    select: { periodMonth: true },
  });
  return rows.map((row) => row.periodMonth);
}
