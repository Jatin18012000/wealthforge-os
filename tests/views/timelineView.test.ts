import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getWealthTimelineView } from "../../src/views/timelineView";
import { createTestDb } from "../setup/testDb";

describe("wealth timeline view — empty database", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reports an empty, non-limited timeline when nothing has been recorded", async () => {
    const view = await getWealthTimelineView(db);
    expect(view.entries).toHaveLength(0);
    expect(view.totalBeforeLimit).toBe(0);
    expect(view.limitApplied).toBe(false);
  });
});

describe("wealth timeline view — mixed sources", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await db.planRecord.create({
      data: {
        periodMonth: "2026-06",
        category: "expense",
        labelRaw: "Rent",
        labelNormalized: "Rent",
        amountMinorUnits: 2_000_000,
        trustState: "validated",
      },
    });

    const instrument = await db.instrument.create({
      data: { kind: "mutual_fund", displayName: "Axis Bluechip Fund" },
    });
    await db.activity.create({
      data: {
        kind: "sip",
        instrumentId: instrument.id,
        amountMinorUnits: 1_000_000,
        quantity: 10,
        occurredOn: new Date("2026-06-15T00:00:00Z"),
        trustState: "validated",
      },
    });
    await db.positionSnapshot.create({
      data: {
        instrumentId: instrument.id,
        asOfDate: new Date("2026-06-30T00:00:00Z"),
        quantity: 100,
        unit: "units",
        trustState: "validated",
      },
    });

    const goal = await db.goal.create({
      data: {
        name: "Car",
        kind: "car",
        targetAmountMinorUnits: 1_000_000,
        priorityRank: 1,
        lifecycleState: "in_progress",
      },
    });
    await db.activity.create({
      data: {
        kind: "goal_contribution",
        goalId: goal.id,
        amountMinorUnits: 500_000,
        occurredOn: new Date("2026-06-20T00:00:00Z"),
        trustState: "validated",
      },
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("merges plan, activity, and snapshot sources into one feed, most recent first", async () => {
    const view = await getWealthTimelineView(db);
    expect(view.entries).toHaveLength(4);
    // Most recent first: 06-30 snapshot, 06-20 goal contribution, 06-15 SIP, 06-01 plan.
    expect(view.entries.map((e) => e.bucket)).toEqual([
      "observed",
      "confirmed_activity",
      "confirmed_activity",
      "plan",
    ]);
    expect(view.entries[3]?.label).toContain("Rent");
  });

  it("resolves an activity's subject label from whichever relation it carries", async () => {
    const view = await getWealthTimelineView(db, { bucket: "confirmed_activity" });
    const labels = view.entries.map((e) => e.label);
    expect(labels).toContain("SIP — Axis Bluechip Fund");
    expect(labels).toContain("Goal contribution — Car");
  });

  it("filters to exactly one bucket when asked", async () => {
    const planOnly = await getWealthTimelineView(db, { bucket: "plan" });
    expect(planOnly.entries).toHaveLength(1);
    expect(planOnly.entries[0]?.bucket).toBe("plan");

    const observedOnly = await getWealthTimelineView(db, { bucket: "observed" });
    expect(observedOnly.entries).toHaveLength(1);
    expect(observedOnly.entries[0]?.bucket).toBe("observed");
  });

  it("caps the merged result at the requested limit and reports how many were cut", async () => {
    const capped = await getWealthTimelineView(db, { limit: 2 });
    expect(capped.entries).toHaveLength(2);
    expect(capped.totalBeforeLimit).toBe(4);
    expect(capped.limitApplied).toBe(true);
  });
});
