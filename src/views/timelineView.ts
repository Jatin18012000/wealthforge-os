import type { PrismaClient } from "@prisma/client";
import {
  activityToTimelineEntry,
  buildWealthTimeline,
  planRecordToTimelineEntry,
  positionSnapshotToTimelineEntry,
  type TimelineBucket,
  type TimelineEntry,
} from "../domain";

/**
 * v1.1.1 F6 — Unified Wealth Timeline view model.
 *
 * Composes three already-imported sources into one chronological feed —
 * no new calculation happens here, only restatement (docs/25 "What was not
 * built this pass", F6). Each source is capped independently so a very
 * long history cannot make one source crowd the others out of the merged,
 * most-recent-first result before it is capped again.
 */

const PER_SOURCE_LIMIT = 200;

export interface TimelineView {
  readonly entries: readonly TimelineEntry[];
  readonly totalBeforeLimit: number;
  readonly limitApplied: boolean;
}

export async function getWealthTimelineView(
  db: PrismaClient,
  options: { readonly limit?: number; readonly bucket?: TimelineBucket } = {},
): Promise<TimelineView> {
  const limit = options.limit ?? 100;

  const [planRows, activityRows, snapshotRows] = await Promise.all([
    db.planRecord.findMany({
      where: { supersededById: null },
      orderBy: { periodMonth: "desc" },
      take: PER_SOURCE_LIMIT,
    }),
    db.activity.findMany({
      orderBy: { occurredOn: "desc" },
      take: PER_SOURCE_LIMIT,
      include: { instrument: true, goal: true, liability: true },
    }),
    db.positionSnapshot.findMany({
      where: { supersededById: null },
      orderBy: { asOfDate: "desc" },
      take: PER_SOURCE_LIMIT,
      include: { instrument: true },
    }),
  ]);

  const entries: TimelineEntry[] = [
    ...planRows.map((row) =>
      planRecordToTimelineEntry({
        id: row.id,
        periodMonth: row.periodMonth,
        category: row.category,
        labelNormalized: row.labelNormalized,
        amountMinorUnits: row.amountMinorUnits,
        trustState: row.trustState,
      }),
    ),
    ...activityRows.map((row) =>
      activityToTimelineEntry({
        id: row.id,
        kind: row.kind,
        occurredOn: row.occurredOn,
        amountMinorUnits: row.amountMinorUnits,
        subjectLabel:
          row.instrument?.displayName ?? row.goal?.name ?? row.liability?.name ?? "Unspecified",
        trustState: row.trustState,
      }),
    ),
    ...snapshotRows.map((row) =>
      positionSnapshotToTimelineEntry({
        id: row.id,
        asOfDate: row.asOfDate,
        instrumentLabel: row.instrument.displayName,
        quantity: row.quantity,
        unit: row.unit,
        trustState: row.trustState,
      }),
    ),
  ];

  const merged = buildWealthTimeline(entries).filter(
    (entry) => options.bucket === undefined || entry.bucket === options.bucket,
  );
  const totalBeforeLimit = merged.length;

  return {
    entries: merged.slice(0, limit),
    totalBeforeLimit,
    limitApplied: totalBeforeLimit > limit,
  };
}
