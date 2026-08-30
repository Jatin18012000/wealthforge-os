import type { PrismaClient } from "@prisma/client";
import type {
  ActivityInput,
  GoalActivityInput,
  GoalInput,
  GoalLifecycle,
  LiabilityDetail,
  PlanCategory,
  PlanRecordInput,
  PositionInput,
  ValuationInput,
} from "../domain";

/**
 * Maps database rows to the plain-data inputs the domain engine expects.
 *
 * This layer exists so `src/domain/` never imports Prisma and stays a pure,
 * independently-testable calculation library (CLAUDE.md §3). It performs
 * mapping and validation of the string columns SQLite forces on us — it
 * contains no financial arithmetic of its own.
 */

const PLAN_CATEGORIES = new Set<PlanCategory>(["income", "expense", "investment", "emi"]);
const GOAL_LIFECYCLES = new Set<GoalLifecycle>([
  "planned",
  "in_progress",
  "achieved",
  "on_hold",
  "cancelled",
]);

/**
 * SQLite has no enum type, so these columns are validated here at the
 * database boundary rather than trusted blindly downstream
 * (prisma/schema.prisma header note).
 */
function assertPlanCategory(value: string, recordId: string): PlanCategory {
  if (!PLAN_CATEGORIES.has(value as PlanCategory)) {
    throw new Error(`plan_record ${recordId} has an unrecognized category: "${value}"`);
  }
  return value as PlanCategory;
}

function assertGoalLifecycle(value: string, goalId: string): GoalLifecycle {
  if (!GOAL_LIFECYCLES.has(value as GoalLifecycle)) {
    throw new Error(`goal ${goalId} has an unrecognized lifecycle state: "${value}"`);
  }
  return value as GoalLifecycle;
}

/**
 * Currently-effective plan records for a period: those not superseded by a
 * later revision. Superseded rows remain in the database and are readable
 * for history — they are simply not the current answer.
 */
export async function loadEffectivePlanRecords(
  db: PrismaClient,
  periodMonth?: string,
): Promise<PlanRecordInput[]> {
  const rows = await db.planRecord.findMany({
    where: periodMonth === undefined ? { supersededById: null } : { periodMonth, supersededById: null },
  });

  return rows.map((row) => ({
    id: row.id,
    periodMonth: row.periodMonth,
    category: assertPlanCategory(row.category, row.id),
    labelRaw: row.labelRaw,
    amountMinorUnits: row.amountMinorUnits,
    trustState: row.trustState,
  }));
}

export async function loadGoals(db: PrismaClient): Promise<GoalInput[]> {
  const rows = await db.goal.findMany({ orderBy: { priorityRank: "asc" } });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    targetAmountMinorUnits: row.targetAmountMinorUnits,
    targetDate: row.targetDate,
    priorityRank: row.priorityRank,
    lifecycleState: assertGoalLifecycle(row.lifecycleState, row.id),
  }));
}

export async function loadGoalActivities(db: PrismaClient): Promise<GoalActivityInput[]> {
  const rows = await db.activity.findMany({
    where: { kind: { in: ["goal_contribution", "goal_withdrawal"] }, goalId: { not: null } },
  });

  return rows.map((row) => ({
    id: row.id,
    goalId: row.goalId as string,
    kind: row.kind,
    amountMinorUnits: row.amountMinorUnits,
    occurredOn: row.occurredOn,
    trustState: row.trustState,
  }));
}

export async function loadActivities(db: PrismaClient): Promise<ActivityInput[]> {
  const rows = await db.activity.findMany();

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    amountMinorUnits: row.amountMinorUnits,
    occurredOn: row.occurredOn,
    trustState: row.trustState,
  }));
}

export async function loadLiabilities(db: PrismaClient): Promise<LiabilityDetail[]> {
  const rows = await db.liability.findMany({ include: { payerSplits: true } });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    outstandingMinorUnits: row.outstandingMinorUnits,
    outstandingAsOf: row.outstandingAsOf,
    emiAmountMinorUnits: row.emiAmountMinorUnits,
    tenureMonths: row.tenureMonths,
    interestRateBps: row.interestRateBps,
    payerSplits: row.payerSplits.map((split) => ({
      payerName: split.payerName,
      shareBps: split.shareBps,
      effectiveFrom: split.effectiveFrom,
    })),
  }));
}

/**
 * The latest position snapshot per instrument at or before `asOf`.
 * A later snapshot is never used to describe an earlier date.
 */
export async function loadPositionsAsOf(db: PrismaClient, asOf: Date): Promise<PositionInput[]> {
  const rows = await db.positionSnapshot.findMany({
    where: { asOfDate: { lte: asOf } },
    orderBy: { asOfDate: "desc" },
    include: { instrument: true },
  });

  const latestByInstrument = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByInstrument.has(row.instrumentId)) latestByInstrument.set(row.instrumentId, row);
  }

  return [...latestByInstrument.values()].map((row) => ({
    id: row.id,
    instrumentId: row.instrumentId,
    instrumentLabel: row.instrument.displayName,
    assetClass: row.instrument.kind,
    quantity: row.quantity,
    asOfDate: row.asOfDate,
    trustState: row.trustState,
  }));
}

export async function loadValuations(db: PrismaClient, asOf: Date): Promise<ValuationInput[]> {
  const rows = await db.valuation.findMany({ where: { asOfDate: { lte: asOf } } });

  return rows.map((row) => ({
    instrumentId: row.instrumentId,
    asOfDate: row.asOfDate,
    priceMinorUnits: row.priceMinorUnits,
  }));
}
