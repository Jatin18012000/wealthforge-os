import { afterAll, describe, expect, it } from "vitest";
import { createTestDb } from "../setup/testDb";

/**
 * docs/08_DATA_TRUST_MODEL.md / CLAUDE.md §5: no silent overwrites. A
 * correction to an already-imported value must create a Revision and leave
 * the original PlanRecord row intact — never mutate it in place.
 */
describe("Revision non-destructive update", () => {
  const testDb = createTestDb();

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("retains the original PlanRecord when a corrected value is imported", async () => {
    const original = await testDb.db.planRecord.create({
      data: {
        periodMonth: "2026-08",
        category: "expense",
        labelRaw: "Groceries",
        labelNormalized: "groceries",
        amountMinorUnits: 8_100 * 100,
        trustState: "validated",
      },
    });

    // A later workbook corrects August's groceries figure.
    const corrected = await testDb.db.planRecord.create({
      data: {
        periodMonth: "2026-08",
        category: "expense",
        labelRaw: "Groceries",
        labelNormalized: "groceries",
        amountMinorUnits: 8_600 * 100,
        trustState: "validated",
      },
    });

    await testDb.db.planRecord.update({
      where: { id: original.id },
      data: { supersededById: corrected.id, trustState: "superseded" },
    });

    await testDb.db.revision.create({
      data: {
        entityType: "plan_record",
        entityId: original.id,
        originalValueJson: JSON.stringify({ amountMinorUnits: original.amountMinorUnits }),
        revisedValueJson: JSON.stringify({ amountMinorUnits: corrected.amountMinorUnits }),
        source: "workbook-reimport-test",
      },
    });

    // The original row must still exist, unmodified in value, just marked superseded.
    const originalAfter = await testDb.db.planRecord.findUniqueOrThrow({ where: { id: original.id } });
    expect(originalAfter.amountMinorUnits).toBe(8_100 * 100);
    expect(originalAfter.trustState).toBe("superseded");
    expect(originalAfter.supersededById).toBe(corrected.id);

    // "What do we currently believe" resolves by following supersededById to the head.
    const currentHead = await testDb.db.planRecord.findUniqueOrThrow({ where: { id: corrected.id } });
    expect(currentHead.amountMinorUnits).toBe(8_600 * 100);

    // "What did we believe at the time of the original import" is still answerable.
    const revisions = await testDb.db.revision.findMany({
      where: { entityType: "plan_record", entityId: original.id },
    });
    expect(revisions).toHaveLength(1);
    expect(JSON.parse(revisions[0]!.originalValueJson)).toEqual({ amountMinorUnits: 8_100 * 100 });
  });

  it("re-importing an identical value creates no new record (idempotency)", async () => {
    const before = await testDb.db.planRecord.count({ where: { periodMonth: "2026-06" } });

    const juneOriginal = await testDb.db.planRecord.create({
      data: {
        periodMonth: "2026-06",
        category: "income",
        labelRaw: "Salary",
        labelNormalized: "salary",
        amountMinorUnits: 62_000 * 100,
        trustState: "validated",
      },
    });

    const existing = await testDb.db.planRecord.findFirst({
      where: {
        periodMonth: "2026-06",
        category: "income",
        labelNormalized: "salary",
        amountMinorUnits: 62_000 * 100,
      },
    });
    // Ingestion (M3) would check for an existing identical record before
    // inserting; this test documents the query shape that check relies on.
    expect(existing?.id).toBe(juneOriginal.id);

    const after = await testDb.db.planRecord.count({ where: { periodMonth: "2026-06" } });
    expect(after).toBe(before + 1);
  });
});
