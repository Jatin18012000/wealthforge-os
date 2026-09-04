import { describe, expect, it } from "vitest";
import {
  activityToTimelineEntry,
  buildWealthTimeline,
  planRecordToTimelineEntry,
  positionSnapshotToTimelineEntry,
} from "../../src/domain/timeline";

describe("planRecordToTimelineEntry", () => {
  it("anchors to the first of the month and carries only month-level precision", () => {
    const entry = planRecordToTimelineEntry({
      id: "pr1",
      periodMonth: "2026-03",
      category: "expense",
      labelNormalized: "Groceries",
      amountMinorUnits: 500000,
      trustState: "validated",
    });
    expect(entry.bucket).toBe("plan");
    expect(entry.date).toBeNull();
    expect(entry.periodMonth).toBe("2026-03");
    expect(entry.sortDate.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(entry.label).toBe("Planned expense: Groceries");
    expect(entry.amountMinorUnits).toBe(500000);
    expect(entry.trustState).toBe("validated");
  });

  it("passes through a null amount rather than substituting zero", () => {
    const entry = planRecordToTimelineEntry({
      id: "pr2",
      periodMonth: "2026-03",
      category: "income",
      labelNormalized: "Bonus (TBD)",
      amountMinorUnits: null,
      trustState: "needs_review",
    });
    expect(entry.amountMinorUnits).toBeNull();
  });

  it("falls back to the raw category string for an unrecognized category", () => {
    const entry = planRecordToTimelineEntry({
      id: "pr3",
      periodMonth: "2026-03",
      category: "unknown_category",
      labelNormalized: "Something",
      amountMinorUnits: 100,
      trustState: "extracted",
    });
    expect(entry.label).toBe("unknown_category: Something");
  });
});

describe("activityToTimelineEntry", () => {
  it("carries day-level precision and a human label per activity kind", () => {
    const occurredOn = new Date("2026-04-15T00:00:00Z");
    const entry = activityToTimelineEntry({
      id: "a1",
      kind: "sip",
      occurredOn,
      amountMinorUnits: 1000000,
      subjectLabel: "Axis Bluechip Fund",
      trustState: "verified",
    });
    expect(entry.bucket).toBe("confirmed_activity");
    expect(entry.date).toEqual(occurredOn);
    expect(entry.periodMonth).toBeNull();
    expect(entry.sortDate).toEqual(occurredOn);
    expect(entry.label).toBe("SIP — Axis Bluechip Fund");
    expect(entry.amountMinorUnits).toBe(1000000);
  });

  it("falls back to the raw kind string for an unrecognized kind", () => {
    const entry = activityToTimelineEntry({
      id: "a2",
      kind: "unknown_kind",
      occurredOn: new Date("2026-01-01T00:00:00Z"),
      amountMinorUnits: 1,
      subjectLabel: "Something",
      trustState: "extracted",
    });
    expect(entry.label).toBe("unknown_kind — Something");
  });
});

describe("positionSnapshotToTimelineEntry", () => {
  it("has no amount — a snapshot states a position, not a monetary flow", () => {
    const asOfDate = new Date("2026-09-02T00:00:00Z");
    const entry = positionSnapshotToTimelineEntry({
      id: "s1",
      asOfDate,
      instrumentLabel: "Nifty Bank Index Fund",
      quantity: 123.456,
      unit: "units",
      trustState: "extracted",
    });
    expect(entry.bucket).toBe("observed");
    expect(entry.date).toEqual(asOfDate);
    expect(entry.amountMinorUnits).toBeNull();
    expect(entry.label).toBe("Nifty Bank Index Fund — 123.456 units observed");
  });
});

describe("buildWealthTimeline", () => {
  it("sorts most recent first", () => {
    const older = activityToTimelineEntry({
      id: "a1",
      kind: "buy",
      occurredOn: new Date("2026-01-01T00:00:00Z"),
      amountMinorUnits: 100,
      subjectLabel: "X",
      trustState: "validated",
    });
    const newer = activityToTimelineEntry({
      id: "a2",
      kind: "sell",
      occurredOn: new Date("2026-06-01T00:00:00Z"),
      amountMinorUnits: 100,
      subjectLabel: "X",
      trustState: "validated",
    });
    const merged = buildWealthTimeline([older, newer]);
    expect(merged.map((e) => e.id)).toEqual([newer.id, older.id]);
  });

  it("on a tied sortDate, ranks a confirmed activity before an observation, and an observation before a plan", () => {
    const sameDate = new Date("2026-06-01T00:00:00Z");
    const plan = planRecordToTimelineEntry({
      id: "p1",
      periodMonth: "2026-06",
      category: "expense",
      labelNormalized: "Rent",
      amountMinorUnits: 100,
      trustState: "validated",
    });
    const observed = positionSnapshotToTimelineEntry({
      id: "s1",
      asOfDate: sameDate,
      instrumentLabel: "X",
      quantity: 1,
      unit: "units",
      trustState: "validated",
    });
    const activity = activityToTimelineEntry({
      id: "a1",
      kind: "buy",
      occurredOn: sameDate,
      amountMinorUnits: 100,
      subjectLabel: "X",
      trustState: "validated",
    });
    const merged = buildWealthTimeline([plan, observed, activity]);
    expect(merged.map((e) => e.bucket)).toEqual(["confirmed_activity", "observed", "plan"]);
  });

  it("is deterministic when two entries in the same bucket tie on sortDate", () => {
    const sameDate = new Date("2026-06-01T00:00:00Z");
    const first = activityToTimelineEntry({
      id: "aaa",
      kind: "buy",
      occurredOn: sameDate,
      amountMinorUnits: 1,
      subjectLabel: "X",
      trustState: "validated",
    });
    const second = activityToTimelineEntry({
      id: "zzz",
      kind: "sell",
      occurredOn: sameDate,
      amountMinorUnits: 1,
      subjectLabel: "Y",
      trustState: "validated",
    });
    const runOne = buildWealthTimeline([second, first]).map((e) => e.id);
    const runTwo = buildWealthTimeline([first, second]).map((e) => e.id);
    expect(runOne).toEqual(runTwo);
    expect(runOne).toEqual(["activity:aaa", "activity:zzz"]);
  });

  it("does not mutate the input array", () => {
    const a = activityToTimelineEntry({
      id: "a1",
      kind: "buy",
      occurredOn: new Date("2026-01-01T00:00:00Z"),
      amountMinorUnits: 1,
      subjectLabel: "X",
      trustState: "validated",
    });
    const b = activityToTimelineEntry({
      id: "a2",
      kind: "sell",
      occurredOn: new Date("2026-06-01T00:00:00Z"),
      amountMinorUnits: 1,
      subjectLabel: "X",
      trustState: "validated",
    });
    const input = [a, b];
    buildWealthTimeline(input);
    expect(input).toEqual([a, b]);
  });
});
