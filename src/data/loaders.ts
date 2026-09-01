import type { PrismaClient } from "@prisma/client";
import {
  applyAdjustment,
  adjustmentKey,
  type AdjustmentInput,
} from "../domain/adjustments";
import { loadEffectiveAdjustments } from "./adjustmentStore";
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
 *
 * It is also where manual adjustments are layered onto source values, so
 * that every screen and every calculation downstream sees the *effective*
 * figure without knowing overrides exist. An override therefore recomputes
 * net worth, budgets, goals and analytics for free, which is what
 * docs/04_USER_FLOWS.md means by "downstream calculations recompute".
 * The source row itself is never modified — see src/domain/adjustments.ts.
 */

/**
 * Applies the adjustment in force for one field, if any.
 *
 * Where an override cannot be applied (a difference recorded against a
 * source that has since lost its value), the source value stands unchanged
 * and the Settings screen reports the problem — a loader is the wrong place
 * to resolve a contradiction, and inventing a figure to paper over one is
 * never an option.
 */
function adjusted(
  adjustments: Map<string, AdjustmentInput>,
  entityType: string,
  entityId: string,
  field: string,
  sourceValue: number | null,
): number | null {
  return applyAdjustment(
    sourceValue,
    adjustments.get(adjustmentKey(entityType, entityId, field)),
  ).value;
}

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
    where:
      periodMonth === undefined
        ? { supersededById: null }
        : { periodMonth, supersededById: null },
  });
  const adjustments = await loadEffectiveAdjustments(db, "plan_record");

  return rows.map((row) => ({
    id: row.id,
    periodMonth: row.periodMonth,
    category: assertPlanCategory(row.category, row.id),
    labelRaw: row.labelRaw,
    amountMinorUnits: adjusted(
      adjustments,
      "plan_record",
      row.id,
      "amount",
      row.amountMinorUnits,
    ),
    trustState: row.trustState,
  }));
}

export async function loadGoals(db: PrismaClient): Promise<GoalInput[]> {
  const rows = await db.goal.findMany({ orderBy: { priorityRank: "asc" } });
  const adjustments = await loadEffectiveAdjustments(db, "goal");

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    targetAmountMinorUnits:
      adjusted(adjustments, "goal", row.id, "targetAmount", row.targetAmountMinorUnits) ??
      row.targetAmountMinorUnits,
    targetDate: row.targetDate,
    priorityRank: row.priorityRank,
    lifecycleState: assertGoalLifecycle(row.lifecycleState, row.id),
  }));
}

export async function loadGoalActivities(db: PrismaClient): Promise<GoalActivityInput[]> {
  const rows = await db.activity.findMany({
    where: {
      kind: { in: ["goal_contribution", "goal_withdrawal"] },
      goalId: { not: null },
    },
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
  const adjustments = await loadEffectiveAdjustments(db);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    principalMinorUnits: row.principalMinorUnits,
    outstandingMinorUnits:
      adjusted(
        adjustments,
        "liability",
        row.id,
        "outstanding",
        row.outstandingMinorUnits,
      ) ?? row.outstandingMinorUnits,
    outstandingAsOf: row.outstandingAsOf,
    emiAmountMinorUnits:
      adjusted(adjustments, "liability", row.id, "emiAmount", row.emiAmountMinorUnits) ??
      row.emiAmountMinorUnits,
    tenureMonths:
      adjusted(adjustments, "liability", row.id, "tenureMonths", row.tenureMonths) ??
      row.tenureMonths,
    interestRateBps: row.interestRateBps,
    payerSplits: row.payerSplits.map((split) => ({
      payerName: split.payerName,
      shareBps:
        adjusted(
          adjustments,
          "liability_payer_split",
          split.id,
          "shareBps",
          split.shareBps,
        ) ?? split.shareBps,
      effectiveFrom: split.effectiveFrom,
    })),
  }));
}

export interface InsurancePolicyDetail {
  readonly id: string;
  readonly kind: string;
  readonly insuredParty: string;
  readonly coverAmountMinorUnits: number | null;
  readonly premiumMinorUnits: number | null;
  readonly premiumFrequency: string | null;
  readonly provider: string;
  readonly status: string;
  readonly effectiveFrom: Date | null;
}

export async function loadInsurancePolicies(
  db: PrismaClient,
): Promise<InsurancePolicyDetail[]> {
  const rows = await db.insurancePolicy.findMany({ orderBy: { createdAt: "asc" } });
  const adjustments = await loadEffectiveAdjustments(db, "insurance_policy");

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    insuredParty: row.insuredParty,
    coverAmountMinorUnits: adjusted(
      adjustments,
      "insurance_policy",
      row.id,
      "coverAmount",
      row.coverAmountMinorUnits,
    ),
    premiumMinorUnits: adjusted(
      adjustments,
      "insurance_policy",
      row.id,
      "premium",
      row.premiumMinorUnits,
    ),
    premiumFrequency: row.premiumFrequency,
    provider: row.provider,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
  }));
}

/**
 * The latest position snapshot per instrument at or before `asOf`.
 * A later snapshot is never used to describe an earlier date.
 */
export async function loadPositionsAsOf(
  db: PrismaClient,
  asOf: Date,
): Promise<PositionInput[]> {
  const rows = await db.positionSnapshot.findMany({
    where: { asOfDate: { lte: asOf } },
    orderBy: { asOfDate: "desc" },
    include: { instrument: true },
  });

  const latestByInstrument = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByInstrument.has(row.instrumentId))
      latestByInstrument.set(row.instrumentId, row);
  }
  const adjustments = await loadEffectiveAdjustments(db, "position_snapshot");

  return [...latestByInstrument.values()].map((row) => ({
    id: row.id,
    instrumentId: row.instrumentId,
    instrumentLabel: row.instrument.displayName,
    assetClass: row.instrument.kind,
    quantity:
      adjusted(adjustments, "position_snapshot", row.id, "quantity", row.quantity) ??
      row.quantity,
    asOfDate: row.asOfDate,
    trustState: row.trustState,
  }));
}

/**
 * Cost basis per instrument, from the latest effective snapshot at or before
 * `asOf`, with any manual correction applied.
 *
 * Null where no cost was ever recorded: profit and loss must then report
 * insufficient data rather than infer a purchase price from a later
 * valuation (docs/07_FINANCIAL_CALCULATIONS.md, "P&L").
 */
export async function loadCostBasesAsOf(
  db: PrismaClient,
  asOf: Date,
): Promise<Map<string, number | null>> {
  const rows = await db.positionSnapshot.findMany({
    where: { asOfDate: { lte: asOf }, supersededById: null },
    orderBy: { asOfDate: "desc" },
    select: { id: true, instrumentId: true, costBasisMinorUnits: true },
  });
  const adjustments = await loadEffectiveAdjustments(db, "position_snapshot");

  const byInstrument = new Map<string, number | null>();
  for (const row of rows) {
    if (byInstrument.has(row.instrumentId)) continue;
    byInstrument.set(
      row.instrumentId,
      adjusted(
        adjustments,
        "position_snapshot",
        row.id,
        "costBasis",
        row.costBasisMinorUnits,
      ),
    );
  }
  return byInstrument;
}

/**
 * Overrides on goal balances, keyed by goal id.
 *
 * A goal's balance is derived from its activity history, so there is no
 * stored figure for a loader to adjust — the goals view applies these to the
 * derived progress instead, keeping both the derived and the stated balance
 * visible rather than replacing one with the other.
 */
export async function loadGoalBalanceAdjustments(
  db: PrismaClient,
): Promise<Map<string, AdjustmentInput>> {
  const adjustments = await loadEffectiveAdjustments(db, "goal");
  const byGoal = new Map<string, AdjustmentInput>();
  for (const adjustment of adjustments.values()) {
    if (adjustment.field === "currentAmount") byGoal.set(adjustment.entityId, adjustment);
  }
  return byGoal;
}

export async function loadValuations(
  db: PrismaClient,
  asOf: Date,
): Promise<ValuationInput[]> {
  const rows = await db.valuation.findMany({ where: { asOfDate: { lte: asOf } } });

  return rows.map((row) => ({
    instrumentId: row.instrumentId,
    asOfDate: row.asOfDate,
    priceMinorUnits: row.priceMinorUnits,
  }));
}

/**
 * Every distinct date a portfolio position snapshot was actually recorded,
 * at or before `asOf`, ascending. This is the real observation cadence the
 * data supports — used so a historical series (e.g. a drawdown monitor)
 * samples only dates something was actually observed, rather than
 * fabricating a daily series between two statements
 * (docs/09_INGESTION_ARCHITECTURE.md, "snapshot ≠ activity").
 */
export async function loadDistinctSnapshotDates(
  db: PrismaClient,
  asOf: Date,
): Promise<readonly Date[]> {
  const rows = await db.positionSnapshot.findMany({
    where: { asOfDate: { lte: asOf }, supersededById: null },
    select: { asOfDate: true },
    distinct: ["asOfDate"],
    orderBy: { asOfDate: "asc" },
  });
  return rows.map((row) => row.asOfDate);
}
