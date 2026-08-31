import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectOk, splitEmiByPayer } from "../../src/domain";
import { loadEffectivePlanRecords, loadLiabilities } from "../../src/data/loaders";
import { importBudgetWorkbook } from "../../src/ingestion";
import {
  applyOverride,
  listOverrideTargets,
  previewOverride,
  revokeOverride,
} from "../../src/manual/overrides";
import { getBudgetView } from "../../src/views/budgetView";
import { getGoalsView } from "../../src/views/goalsView";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/reference");

/**
 * Manual controls, end to end against a real database.
 *
 * The three properties that matter are asserted directly: an override
 * changes what every downstream figure uses, it does NOT change what the
 * source said, and withdrawing it restores the source exactly.
 */
describe("manual overrides", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  let periodMonth: string;
  let salaryId: string;
  let sourceSalaryMinorUnits: number;

  beforeAll(async () => {
    await importBudgetWorkbook(db, path.join(FIXTURES, "budget-reference-layout.xlsx"), {
      defaultYear: 2026,
    });

    const salary = await db.planRecord.findFirstOrThrow({
      where: { category: "income", supersededById: null },
      orderBy: [{ periodMonth: "desc" }, { amountMinorUnits: "desc" }],
    });
    periodMonth = salary.periodMonth;
    salaryId = salary.id;
    sourceSalaryMinorUnits = salary.amountMinorUnits as number;
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("recomputes the budget from the overridden value", async () => {
    const before = expectOk(
      (await getBudgetView(db, periodMonth, [periodMonth])).summary,
    );

    const applied = await applyOverride(db, {
      entityType: "plan_record",
      entityId: salaryId,
      field: "amount",
      mode: "set",
      value: sourceSalaryMinorUnits + 5_000_00,
      reason: "April increment not yet in the workbook",
    });
    expect(applied.kind).toBe("ok");

    const after = expectOk((await getBudgetView(db, periodMonth, [periodMonth])).summary);
    expect(after.incomeMinorUnits).toBe(before.incomeMinorUnits + 5_000_00);

    // Savings rate is derived from income, so it moves too — the point of
    // layering the override in the loader rather than in one screen.
    expect(expectOk(after.savingsRate)).not.toBe(expectOk(before.savingsRate));
  });

  it("leaves the source record untouched", async () => {
    const row = await db.planRecord.findUniqueOrThrow({ where: { id: salaryId } });
    expect(row.amountMinorUnits).toBe(sourceSalaryMinorUnits);
  });

  it("records the override in the audit log with both values", async () => {
    const events = await db.auditEvent.findMany({ where: { kind: "manual_override" } });
    expect(events.length).toBeGreaterThan(0);

    const payload = JSON.parse(events[events.length - 1]?.payloadJson as string);
    expect(payload.action).toBe("applied");
    expect(payload.sourceValue).toBe(sourceSalaryMinorUnits);
    expect(payload.resultingValue).toBe(sourceSalaryMinorUnits + 5_000_00);
  });

  it("shows the override on the Settings screen as source, adjustment and current", async () => {
    const groups = await listOverrideTargets(db, { periodMonth });
    const target = groups
      .flatMap((group) => group.targets)
      .find((candidate) => candidate.entityId === salaryId);

    expect(target?.sourceValue).toBe(sourceSalaryMinorUnits);
    expect(target?.effective?.adjustmentValue).toBe(5_000_00);
    expect(target?.currentValue).toBe(sourceSalaryMinorUnits + 5_000_00);
  });

  it("orders Settings groups by the declared OVERRIDE_GROUPS sequence, not by incidental insertion order", async () => {
    const groups = await listOverrideTargets(db, { periodMonth });
    const order = groups.map((group) => group.group);
    const expectedOrder = ["Budget", "Portfolio", "Goals", "Liabilities", "Insurance", "Custom"].filter(
      (group) => order.includes(group as (typeof order)[number]),
    );
    expect(order).toEqual(expectedOrder);
  });

  it("restores the source value exactly when the override is withdrawn", async () => {
    const groups = await listOverrideTargets(db, { periodMonth });
    const target = groups
      .flatMap((group) => group.targets)
      .find((candidate) => candidate.entityId === salaryId);

    const revoked = await revokeOverride(db, target?.effective?.adjustmentId as string);
    expect(revoked.kind).toBe("ok");

    const records = await loadEffectivePlanRecords(db, periodMonth);
    expect(records.find((record) => record.id === salaryId)?.amountMinorUnits).toBe(
      sourceSalaryMinorUnits,
    );

    // The withdrawal is itself recorded, rather than the override vanishing.
    const stored = await db.manualAdjustment.findFirst({
      where: { entityId: salaryId },
      orderBy: { createdAt: "desc" },
    });
    expect(stored?.revokedAt).not.toBeNull();
  });

  it("carries a difference forward when the source is re-imported at a new value", async () => {
    await applyOverride(db, {
      entityType: "plan_record",
      entityId: salaryId,
      field: "amount",
      mode: "delta",
      value: 1_500_00,
      reason: "employer PF the workbook omits",
    });

    // Stand in for a later import correcting this line.
    await db.planRecord.update({
      where: { id: salaryId },
      data: { amountMinorUnits: sourceSalaryMinorUnits + 3_000_00 },
    });

    const records = await loadEffectivePlanRecords(db, periodMonth);
    expect(records.find((record) => record.id === salaryId)?.amountMinorUnits).toBe(
      sourceSalaryMinorUnits + 3_000_00 + 1_500_00,
    );

    await db.planRecord.update({
      where: { id: salaryId },
      data: { amountMinorUnits: sourceSalaryMinorUnits },
    });
    const adjustment = await db.manualAdjustment.findFirstOrThrow({
      where: { entityId: salaryId, revokedAt: null },
    });
    await revokeOverride(db, adjustment.id);
  });

  it("refuses to override a field that is not declared overridable", async () => {
    const result = await previewOverride(db, {
      entityType: "plan_record",
      entityId: salaryId,
      field: "trustState",
      mode: "set",
      value: 1,
      reason: null,
    });

    expect(result.kind).toBe("insufficient-data");
  });

  it("refuses to override a superseded record, pointing at the current one", async () => {
    const superseded = await db.planRecord.create({
      data: {
        periodMonth,
        category: "expense",
        labelRaw: "Old rent row",
        labelNormalized: "old rent row",
        amountMinorUnits: 10_000_00,
        trustState: "superseded",
        supersededById: salaryId,
      },
    });

    const result = await previewOverride(db, {
      entityType: "plan_record",
      entityId: superseded.id,
      field: "amount",
      mode: "set",
      value: 11_000_00,
      reason: null,
    });

    expect(result.kind).toBe("insufficient-data");
  });
});

describe("payer split overrides", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  let firstSplitId: string;
  let secondSplitId: string;

  beforeAll(async () => {
    const liability = await db.liability.create({
      data: {
        name: "Home Loan",
        kind: "home_loan",
        principalMinorUnits: 30_00_000_00,
        outstandingMinorUnits: 24_00_000_00,
        outstandingAsOf: new Date("2026-08-01T00:00:00Z"),
        interestRateBps: 850,
        tenureMonths: 180,
        emiAmountMinorUnits: 30_000_00,
        payerSplits: {
          create: [
            {
              payerName: "Self",
              shareBps: 7_000,
              effectiveFrom: new Date("2026-01-01T00:00:00Z"),
            },
            {
              payerName: "Sibling",
              shareBps: 3_000,
              effectiveFrom: new Date("2026-01-01T00:00:00Z"),
            },
          ],
        },
      },
      include: { payerSplits: true },
    });

    firstSplitId = liability.payerSplits[0]?.id as string;
    secondSplitId = liability.payerSplits[1]?.id as string;
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("moves the other payer's share with it, so the split still totals 100%", async () => {
    const preview = await previewOverride(db, {
      entityType: "liability_payer_split",
      entityId: firstSplitId,
      field: "shareBps",
      mode: "set",
      value: 8_000,
      reason: "sibling's contribution reduced from August",
    });

    // 70% → 80% is only meaningful as 30% → 20% on the other side, and the
    // user is shown that before confirming rather than after.
    expect(expectOk(preview).companion?.entityId).toBe(secondSplitId);
    expect(expectOk(preview).companion?.resultingValue).toBe(2_000);

    const applied = await applyOverride(db, {
      entityType: "liability_payer_split",
      entityId: firstSplitId,
      field: "shareBps",
      mode: "set",
      value: 8_000,
      reason: "sibling's contribution reduced from August",
    });
    expect(applied.kind).toBe("ok");

    const liabilities = await loadLiabilities(db);
    const shares = expectOk(
      splitEmiByPayer(liabilities[0]!, new Date("2026-08-01T00:00:00Z")),
    );

    expect(shares.map((share) => share.shareBps)).toEqual([8_000, 2_000]);
    // The EMI is still divided exactly, with nothing lost or invented.
    expect(shares.reduce((total, share) => total + share.shareMinorUnits, 0)).toBe(
      30_000_00,
    );
  });

  it("refuses a share above 100%", async () => {
    const result = await previewOverride(db, {
      entityType: "liability_payer_split",
      entityId: firstSplitId,
      field: "shareBps",
      mode: "set",
      value: 12_000,
      reason: null,
    });

    expect(result.kind).toBe("insufficient-data");
  });

  it("leaves the source shares untouched", async () => {
    const splits = await db.liabilityPayerSplit.findMany({
      orderBy: { payerName: "asc" },
    });
    expect(splits.map((split) => split.shareBps)).toEqual([7_000, 3_000]);
  });
});

describe("goal balance overrides", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  let goalId: string;

  beforeAll(async () => {
    const goal = await db.goal.create({
      data: {
        name: "Car",
        kind: "car",
        targetAmountMinorUnits: 8_00_000_00,
        priorityRank: 2,
        lifecycleState: "in_progress",
      },
    });
    goalId = goal.id;

    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 1_00_000_00,
        occurredOn: new Date("2026-07-01T00:00:00Z"),
        trustState: "validated",
      },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("states a balance without inventing a contribution to explain it", async () => {
    const applied = await applyOverride(db, {
      entityType: "goal",
      entityId: goalId,
      field: "currentAmount",
      mode: "set",
      value: 1_50_000_00,
      reason: "transfer made from the joint account, not yet recorded",
    });
    expect(applied.kind).toBe("ok");

    const view = await getGoalsView(db, new Date("2026-08-08T00:00:00Z"));
    const card = view.active.find((candidate) => candidate.goal.id === goalId);

    expect(card?.progress.currentAmountMinorUnits).toBe(1_50_000_00);
    // The derived balance is kept beside the stated one, and no activity row
    // was fabricated to bridge the difference.
    expect(card?.effectiveBalance?.sourceValue).toBe(1_00_000_00);
    expect(await db.activity.count({ where: { goalId } })).toBe(1);
  });

  it("recomputes remaining and progress from the stated balance", async () => {
    const view = await getGoalsView(db, new Date("2026-08-08T00:00:00Z"));
    const card = view.active.find((candidate) => candidate.goal.id === goalId);

    expect(card?.progress.remainingMinorUnits).toBe(8_00_000_00 - 1_50_000_00);
    expect(expectOk(card!.progress.progressRatio)).toBeCloseTo(0.1875, 6);
  });

  it("refuses a difference on a field with no source figure of its own", async () => {
    const result = await previewOverride(db, {
      entityType: "custom_variable",
      entityId: "Expected bonus",
      field: "value",
      mode: "delta",
      value: 50_000_00,
      reason: null,
    });

    expect(result.kind).toBe("insufficient-data");
  });

  it("records a user-defined variable that no import provides", async () => {
    const applied = await applyOverride(db, {
      entityType: "custom_variable",
      entityId: "Expected bonus",
      field: "value",
      mode: "set",
      value: 50_000_00,
      reason: null,
    });
    expect(applied.kind).toBe("ok");

    const groups = await listOverrideTargets(db);
    const custom = groups.find((group) => group.group === "Custom");
    expect(custom?.targets[0]?.currentValue).toBe(50_000_00);
    expect(custom?.targets[0]?.sourceValue).toBeNull();
  });
});
