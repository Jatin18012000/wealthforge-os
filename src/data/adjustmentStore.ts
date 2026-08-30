import type { PrismaClient } from "@prisma/client";
import {
  effectiveAdjustments,
  type AdjustmentInput,
  type AdjustmentMode,
  type AdjustmentUnit,
} from "../domain/adjustments";

/**
 * Reads manual adjustments out of the database and into the plain shape the
 * domain layer works with.
 *
 * This lives beside the other loaders, not in `src/manual/`, so that
 * `loaders.ts` can layer overrides without importing the write path — the
 * read side has no reason to depend on the code that creates overrides, and
 * keeping them apart is what stops the two modules importing each other.
 */

const UNITS: ReadonlySet<string> = new Set<AdjustmentUnit>([
  "money",
  "quantity",
  "count",
  "bps",
]);
const MODES: ReadonlySet<string> = new Set<AdjustmentMode>(["set", "delta"]);

interface AdjustmentRow {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly field: string;
  readonly unit: string;
  readonly mode: string;
  readonly sourceValueJson: string;
  readonly adjustmentJson: string;
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

/**
 * SQLite stores these as strings; nothing downstream may assume they hold a
 * valid unit, mode or number without this check (prisma/schema.prisma header
 * note). A row that fails it is a corrupted financial record, so it raises
 * rather than being skipped silently.
 */
export function parseAdjustmentRow(row: AdjustmentRow): AdjustmentInput {
  if (!UNITS.has(row.unit)) {
    throw new Error(
      `manual_adjustment ${row.id} has an unrecognized unit: "${row.unit}"`,
    );
  }
  if (!MODES.has(row.mode)) {
    throw new Error(
      `manual_adjustment ${row.id} has an unrecognized mode: "${row.mode}"`,
    );
  }

  const sourceValue = parseJsonNumber(
    row.sourceValueJson,
    row.id,
    "sourceValueJson",
    true,
  );
  const adjustmentValue = parseJsonNumber(
    row.adjustmentJson,
    row.id,
    "adjustmentJson",
    false,
  );

  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    field: row.field,
    unit: row.unit as AdjustmentUnit,
    mode: row.mode as AdjustmentMode,
    sourceValueAtEntry: sourceValue,
    adjustmentValue: adjustmentValue as number,
    reason: row.reason,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

function parseJsonNumber(
  json: string,
  id: string,
  column: string,
  nullable: boolean,
): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`manual_adjustment ${id} has unparseable ${column}`);
  }

  if (parsed === null && nullable) return null;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`manual_adjustment ${id} has a non-numeric ${column}`);
  }
  return parsed;
}

export async function loadAdjustments(
  db: PrismaClient,
  where: { entityType?: string; includeRevoked?: boolean } = {},
): Promise<AdjustmentInput[]> {
  const rows = await db.manualAdjustment.findMany({
    where: {
      ...(where.entityType === undefined ? {} : { entityType: where.entityType }),
      ...(where.includeRevoked === true ? {} : { revokedAt: null }),
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map(parseAdjustmentRow);
}

/**
 * The adjustment in force per field, keyed `entityType|entityId|field`.
 * Loaders take this once per query rather than per row.
 */
export async function loadEffectiveAdjustments(
  db: PrismaClient,
  entityType?: string,
): Promise<Map<string, AdjustmentInput>> {
  const adjustments = await loadAdjustments(
    db,
    entityType === undefined ? {} : { entityType },
  );
  return effectiveAdjustments(adjustments);
}
