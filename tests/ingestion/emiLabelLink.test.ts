import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importBudgetWorkbook } from "../../src/ingestion";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/reference");
const BUDGET = path.join(FIXTURES, "budget-reference-layout.xlsx");

/**
 * Proves the EMI-from-workbook link: once a budget-EMI label is linked to a
 * Liability (`EmiLabelLink`), every import that carries that label
 * auto-records the same `emi_payment` Activity a manual entry would — see
 * `recordLinkedEmiPayment` in `src/ingestion/importWorkbook.ts`. An import
 * never creates the link itself; it only acts once one already exists.
 */
describe("EMI label → Liability auto-payment link", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeEach(async () => {
    await db.activity.deleteMany();
    await db.emiLabelLink.deleteMany();
    await db.liability.deleteMany();
    await db.revision.deleteMany();
    await db.planRecord.deleteMany();
    await db.sheetSnapshot.deleteMany();
    await db.sourceDocument.deleteMany();
    await db.auditEvent.deleteMany();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  async function createLiability(name: string) {
    return db.liability.create({
      data: {
        name,
        kind: "other",
        principalMinorUnits: 100_000 * 100,
        outstandingMinorUnits: 100_000 * 100,
        outstandingAsOf: new Date("2026-01-01"),
        interestRateBps: 0,
        tenureMonths: 12,
        emiAmountMinorUnits: 10_000 * 100,
      },
    });
  }

  it("auto-records an emi_payment activity when the imported label is linked", async () => {
    const liability = await createLiability("Home loan");
    await db.emiLabelLink.create({
      data: { labelNormalized: "home emi", liabilityId: liability.id },
    });

    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });

    // The reference workbook carries "home emi" across every month sheet it
    // has, so a linked label auto-records one payment per month imported —
    // not one payment overall.
    const records = await db.planRecord.findMany({
      where: { labelNormalized: "home emi", supersededById: null },
    });
    const payments = await db.activity.findMany({
      where: { kind: "emi_payment", liabilityId: liability.id },
    });

    expect(records.length).toBeGreaterThan(0);
    expect(payments).toHaveLength(records.length);
    expect(payments.map((p) => p.amountMinorUnits).sort()).toEqual(
      records.map((r) => r.amountMinorUnits).sort(),
    );

    const august = await db.planRecord.findFirstOrThrow({
      where: {
        labelNormalized: "home emi",
        periodMonth: "2026-08",
        supersededById: null,
      },
    });
    const augustPayment = payments.find(
      (p) => p.occurredOn.toISOString().slice(0, 7) === "2026-08",
    );
    expect(augustPayment?.amountMinorUnits).toBe(august.amountMinorUnits);
  });

  it("never records a payment for a label with no link", async () => {
    // No EmiLabelLink created at all.
    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });
    const payments = await db.activity.findMany({ where: { kind: "emi_payment" } });
    expect(payments).toHaveLength(0);
  });

  it("never records a payment against a closed liability", async () => {
    const liability = await createLiability("Old loan");
    await db.liability.update({
      where: { id: liability.id },
      data: { closedAt: new Date() },
    });
    await db.emiLabelLink.create({
      data: { labelNormalized: "home emi", liabilityId: liability.id },
    });

    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });

    const payments = await db.activity.findMany({
      where: { kind: "emi_payment", liabilityId: liability.id },
    });
    expect(payments).toHaveLength(0);
  });

  it("does not duplicate the payment on a re-import of an unchanged sheet", async () => {
    const liability = await createLiability("Home loan");
    await db.emiLabelLink.create({
      data: { labelNormalized: "home emi", liabilityId: liability.id },
    });

    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });
    const records = await db.planRecord.findMany({
      where: { labelNormalized: "home emi", supersededById: null },
    });

    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });

    const payments = await db.activity.findMany({
      where: { kind: "emi_payment", liabilityId: liability.id },
    });
    expect(payments).toHaveLength(records.length);
  });
});
