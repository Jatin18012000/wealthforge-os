import type { PrismaClient } from "@prisma/client";
import { loadAdjustments, loadEffectiveAdjustments } from "../data/adjustmentStore";
import { loadGoalActivities } from "../data/loaders";
import {
  adjustmentKey,
  applyAdjustment,
  computeGoalProgress,
  insufficient,
  ok,
  previewAdjustment,
  resolveEffectiveValue,
  type AdjustmentInput,
  type AdjustmentMode,
  type AdjustmentPreview,
  type Computed,
  type EffectiveValue,
} from "../domain";
import {
  findOverridableField,
  OVERRIDABLE_FIELDS,
  WHOLE_IN_BPS,
  type OverridableField,
  type OverrideGroup,
} from "./registry";

/**
 * The write side of manual controls.
 *
 * Every override goes through `previewOverride` first — docs/04_USER_FLOWS.md
 * requires the user to see "source value + proposed manual adjustment =
 * resulting current value" before confirming — and `applyOverride` recomputes
 * that same preview rather than trusting a figure sent back from the browser.
 *
 * Nothing here updates a source table. An override is a new
 * `manual_adjustment` row plus an `audit_event`; withdrawing one stamps
 * `revokedAt` and leaves the row in place. That is what makes an override
 * reversible: revoke it and the source value is what remains, unchanged and
 * unrecoverable-from-nothing, because it was never touched.
 */

export interface OverrideRequest {
  readonly entityType: string;
  readonly entityId: string;
  readonly field: string;
  readonly mode: AdjustmentMode;
  /** Minor units for money, basis points, a count, or a quantity — never rupees. */
  readonly value: number;
  readonly reason: string | null;
}

export interface OverrideTarget {
  readonly definition: OverridableField;
  readonly entityId: string;
  /** What this value belongs to, e.g. "August 2026 · Take-home salary". */
  readonly label: string;
  readonly sourceValue: number | null;
  /** The figure the rest of the app is using right now. */
  readonly currentValue: number | null;
  readonly effective: EffectiveValue | null;
  /** Why a recorded override could not be applied, if it could not. */
  readonly unresolved: readonly string[];
}

export interface OverrideGroupView {
  readonly group: OverrideGroup;
  readonly targets: readonly OverrideTarget[];
}

/** Everything currently overridable, grouped for the Settings screen. */
export async function listOverrideTargets(
  db: PrismaClient,
  options: { periodMonth?: string } = {},
): Promise<OverrideGroupView[]> {
  const adjustments = await loadEffectiveAdjustments(db);
  const rows: {
    definition: OverridableField;
    entityId: string;
    label: string;
    sourceValue: number | null;
  }[] = [];

  const periodMonth =
    options.periodMonth ??
    (
      await db.planRecord.findFirst({
        where: { supersededById: null },
        orderBy: { periodMonth: "desc" },
        select: { periodMonth: true },
      })
    )?.periodMonth;

  if (periodMonth !== undefined) {
    const planRecords = await db.planRecord.findMany({
      where: { periodMonth, supersededById: null },
      orderBy: [{ category: "asc" }, { labelRaw: "asc" }],
    });
    for (const record of planRecords) {
      rows.push({
        definition: field("plan_record", "amount"),
        entityId: record.id,
        // The period is stated once above the table, so it is not repeated
        // on every line.
        label: `${record.labelRaw} · ${CATEGORY_LABELS[record.category] ?? record.category}`,
        sourceValue: record.amountMinorUnits,
      });
    }
  }

  for (const snapshot of await latestSnapshots(db)) {
    rows.push({
      definition: field("position_snapshot", "quantity"),
      entityId: snapshot.id,
      label: `${snapshot.instrument.displayName} · ${snapshot.unit}`,
      sourceValue: snapshot.quantity,
    });
    rows.push({
      definition: field("position_snapshot", "costBasis"),
      entityId: snapshot.id,
      label: snapshot.instrument.displayName,
      sourceValue: snapshot.costBasisMinorUnits,
    });
  }

  const goals = await db.goal.findMany({ orderBy: { priorityRank: "asc" } });
  const goalActivities = goals.length === 0 ? [] : await loadGoalActivities(db);
  for (const goal of goals) {
    rows.push({
      definition: field("goal", "targetAmount"),
      entityId: goal.id,
      label: goal.name,
      sourceValue: goal.targetAmountMinorUnits,
    });
    rows.push({
      definition: field("goal", "currentAmount"),
      entityId: goal.id,
      label: goal.name,
      // The derived balance is this field's source: there is no stored one.
      sourceValue: computeGoalProgress(
        {
          id: goal.id,
          name: goal.name,
          kind: goal.kind,
          targetAmountMinorUnits: goal.targetAmountMinorUnits,
          targetDate: goal.targetDate,
          priorityRank: goal.priorityRank,
          lifecycleState: "planned",
        },
        goalActivities,
      ).currentAmountMinorUnits,
    });
  }

  for (const liability of await db.liability.findMany({
    include: { payerSplits: true },
  })) {
    rows.push({
      definition: field("liability", "emiAmount"),
      entityId: liability.id,
      label: liability.name,
      sourceValue: liability.emiAmountMinorUnits,
    });
    rows.push({
      definition: field("liability", "outstanding"),
      entityId: liability.id,
      label: liability.name,
      sourceValue: liability.outstandingMinorUnits,
    });
    rows.push({
      definition: field("liability", "tenureMonths"),
      entityId: liability.id,
      label: liability.name,
      sourceValue: liability.tenureMonths,
    });
    for (const split of liability.payerSplits) {
      rows.push({
        definition: field("liability_payer_split", "shareBps"),
        entityId: split.id,
        label: `${liability.name} · ${split.payerName}`,
        sourceValue: split.shareBps,
      });
    }
  }

  for (const policy of await db.insurancePolicy.findMany()) {
    rows.push({
      definition: field("insurance_policy", "coverAmount"),
      entityId: policy.id,
      label: `${policy.insuredParty} · ${policy.provider}`,
      sourceValue: policy.coverAmountMinorUnits,
    });
    rows.push({
      definition: field("insurance_policy", "premium"),
      entityId: policy.id,
      label: `${policy.insuredParty} · ${policy.provider} · ${policy.premiumFrequency}`,
      sourceValue: policy.premiumMinorUnits,
    });
  }

  // User-defined variables exist only as their own overrides, so they are
  // listed from what has been recorded rather than from a source table.
  for (const adjustment of adjustments.values()) {
    if (adjustment.entityType !== "custom_variable") continue;
    rows.push({
      definition: field("custom_variable", "value"),
      entityId: adjustment.entityId,
      label: adjustment.entityId,
      sourceValue: null,
    });
  }

  const targets = rows.map((row) => {
    const adjustment = adjustments.get(
      adjustmentKey(row.definition.entityType, row.entityId, row.definition.field),
    );
    const applied = applyAdjustment(row.sourceValue, adjustment);
    return {
      definition: row.definition,
      entityId: row.entityId,
      label: row.label,
      sourceValue: row.sourceValue,
      currentValue: applied.value,
      effective: applied.effective,
      unresolved: applied.unresolved,
    };
  });

  const groups = new Map<OverrideGroup, OverrideTarget[]>();
  for (const target of targets) {
    const list = groups.get(target.definition.group) ?? [];
    list.push(target);
    groups.set(target.definition.group, list);
  }

  return [...groups.entries()].map(([group, groupTargets]) => ({
    group,
    targets: groupTargets,
  }));
}

const CATEGORY_LABELS: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  investment: "Investment",
  emi: "EMI",
};

function field(entityType: string, fieldName: string): OverridableField {
  const definition = findOverridableField(entityType, fieldName);
  if (definition === undefined) {
    throw new Error(`no overridable field declared for ${entityType}.${fieldName}`);
  }
  return definition;
}

async function latestSnapshots(db: PrismaClient) {
  const rows = await db.positionSnapshot.findMany({
    where: { supersededById: null },
    orderBy: { asOfDate: "desc" },
    include: { instrument: true },
  });

  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.instrumentId)) latest.set(row.instrumentId, row);
  }
  return [...latest.values()];
}

/**
 * The matching move on another record that an override forces.
 *
 * Payer shares must total exactly 100%, so changing one payer's share is
 * arithmetically the same act as changing the other's. The companion is
 * computed, shown in the preview, and written in the same transaction —
 * rather than letting the user save a split that adds up to 90% and
 * discover on the Liabilities screen that the breakdown has stopped working.
 */
export interface CompanionChange {
  readonly entityType: string;
  readonly entityId: string;
  readonly field: string;
  readonly label: string;
  readonly sourceValue: number;
  readonly resultingValue: number;
}

export interface OverridePreviewResult extends AdjustmentPreview {
  readonly definition: OverridableField;
  readonly entityId: string;
  readonly reason: string | null;
  readonly companion: CompanionChange | null;
}

/**
 * What the override would do, with every rule that could reject it applied —
 * so a preview the user confirms cannot then fail on write for a reason they
 * were never shown.
 */
export async function previewOverride(
  db: PrismaClient,
  request: OverrideRequest,
): Promise<Computed<OverridePreviewResult>> {
  const definition = findOverridableField(request.entityType, request.field);
  if (definition === undefined) {
    return insufficient(
      `"${request.entityType}.${request.field}" is not an overridable field`,
    );
  }
  if (request.mode === "delta" && !definition.allowsDelta) {
    return insufficient(
      `${definition.label} has no source value to take a difference from — enter the value itself`,
    );
  }
  if (request.entityId.trim() === "") {
    return insufficient("no record was identified to override");
  }

  const source = await resolveSourceValue(db, definition, request.entityId);
  if (source.kind !== "ok") return source;

  const preview = previewAdjustment(
    source.value,
    request.mode,
    request.value,
    definition.unit,
  );
  if (preview.kind !== "ok") return preview;

  if (preview.value.resultingValue < 0) {
    return insufficient(
      `the resulting value would be negative (${preview.value.resultingValue}), which none of these fields can be`,
    );
  }

  let companion: CompanionChange | null = null;
  if (definition.entityType === "liability_payer_split") {
    const planned = await planPayerSplitChange(
      db,
      request.entityId,
      preview.value.resultingValue,
    );
    if (planned.kind !== "ok") return planned;
    companion = planned.value;
  }

  return ok({
    ...preview.value,
    definition,
    entityId: request.entityId,
    reason: request.reason,
    companion,
  });
}

/**
 * The current source value for a target, or a stated reason it has none.
 *
 * A missing record is an error rather than a null: overriding a row that
 * does not exist would create an adjustment nothing will ever apply.
 */
async function resolveSourceValue(
  db: PrismaClient,
  definition: OverridableField,
  entityId: string,
): Promise<Computed<number | null>> {
  switch (`${definition.entityType}.${definition.field}`) {
    case "plan_record.amount": {
      const row = await db.planRecord.findUnique({ where: { id: entityId } });
      if (row === null) return insufficient("that budget line no longer exists");
      if (row.supersededById !== null) {
        return insufficient(
          "that budget line has been superseded by a later revision; override the current one instead",
        );
      }
      return ok(row.amountMinorUnits);
    }
    case "position_snapshot.quantity":
    case "position_snapshot.costBasis": {
      const row = await db.positionSnapshot.findUnique({ where: { id: entityId } });
      if (row === null) return insufficient("that holding snapshot no longer exists");
      if (row.supersededById !== null) {
        return insufficient(
          "that snapshot has been corrected by a later one; override the current snapshot instead",
        );
      }
      return ok(definition.field === "quantity" ? row.quantity : row.costBasisMinorUnits);
    }
    case "goal.targetAmount": {
      const row = await db.goal.findUnique({ where: { id: entityId } });
      if (row === null) return insufficient("that goal no longer exists");
      return ok(row.targetAmountMinorUnits);
    }
    case "goal.currentAmount": {
      const row = await db.goal.findUnique({ where: { id: entityId } });
      if (row === null) return insufficient("that goal no longer exists");
      const activities = await loadGoalActivities(db);
      return ok(
        computeGoalProgress(
          {
            id: row.id,
            name: row.name,
            kind: row.kind,
            targetAmountMinorUnits: row.targetAmountMinorUnits,
            targetDate: row.targetDate,
            priorityRank: row.priorityRank,
            lifecycleState: "planned",
          },
          activities,
        ).currentAmountMinorUnits,
      );
    }
    case "liability.emiAmount":
    case "liability.outstanding":
    case "liability.tenureMonths": {
      const row = await db.liability.findUnique({ where: { id: entityId } });
      if (row === null) return insufficient("that liability no longer exists");
      if (definition.field === "emiAmount") return ok(row.emiAmountMinorUnits);
      if (definition.field === "outstanding") return ok(row.outstandingMinorUnits);
      return ok(row.tenureMonths);
    }
    case "liability_payer_split.shareBps": {
      const row = await db.liabilityPayerSplit.findUnique({ where: { id: entityId } });
      if (row === null) return insufficient("that payer split no longer exists");
      return ok(row.shareBps);
    }
    case "insurance_policy.coverAmount":
    case "insurance_policy.premium": {
      const row = await db.insurancePolicy.findUnique({ where: { id: entityId } });
      if (row === null) return insufficient("that policy no longer exists");
      return ok(
        definition.field === "coverAmount"
          ? row.coverAmountMinorUnits
          : row.premiumMinorUnits,
      );
    }
    case "custom_variable.value":
      // Nothing imports these, so there is no source value — by design, not
      // by absence of data.
      return ok(null);
    default:
      return insufficient(
        `no source is defined for ${definition.entityType}.${definition.field}`,
      );
  }
}

/**
 * Works out what else has to move for the payer shares to still total 100%.
 *
 * `splitEmiByPayer` refuses to divide an EMI whose shares do not total
 * 10000 bps, so an override that broke the total would silently disable the
 * liability's payer breakdown. With two payers the complement is the only
 * possible answer and is applied alongside; with more, there is no single
 * correct redistribution and the engine says so instead of choosing one.
 */
async function planPayerSplitChange(
  db: PrismaClient,
  splitId: string,
  proposedShareBps: number,
): Promise<Computed<CompanionChange | null>> {
  const split = await db.liabilityPayerSplit.findUnique({ where: { id: splitId } });
  if (split === null) return insufficient("that payer split no longer exists");

  if (proposedShareBps > WHOLE_IN_BPS) {
    return insufficient("a payer cannot cover more than 100% of the instalment");
  }

  const siblings = await db.liabilityPayerSplit.findMany({
    where: { liabilityId: split.liabilityId },
    orderBy: { effectiveFrom: "asc" },
  });
  const others = siblings.filter((sibling) => sibling.id !== splitId);

  if (others.length === 0) {
    return proposedShareBps === WHOLE_IN_BPS
      ? ok(null)
      : insufficient(
          "this liability has a single payer, who must cover 100% of the instalment",
        );
  }

  if (others.length > 1) {
    return insufficient(
      "this liability has more than two payers, so there is no single share that can absorb the change — record the shares together instead",
    );
  }

  const other = others[0] as (typeof siblings)[number];
  const adjustments = await loadEffectiveAdjustments(db, "liability_payer_split");
  const otherCurrent =
    applyAdjustment(
      other.shareBps,
      adjustments.get(adjustmentKey("liability_payer_split", other.id, "shareBps")),
    ).value ?? other.shareBps;

  const otherResulting = WHOLE_IN_BPS - proposedShareBps;
  if (otherResulting === otherCurrent) return ok(null);

  return ok({
    entityType: "liability_payer_split",
    entityId: other.id,
    field: "shareBps",
    label: other.payerName,
    sourceValue: other.shareBps,
    resultingValue: otherResulting,
  });
}

export interface AppliedOverride {
  readonly adjustmentId: string;
  readonly preview: OverridePreviewResult;
}

/**
 * Records an override.
 *
 * The preview is recomputed here rather than accepted from the caller: a
 * form round-trip can be replayed, edited, or simply stale, and the figure
 * that gets written must be the one the rules allow now.
 */
export async function applyOverride(
  db: PrismaClient,
  request: OverrideRequest,
): Promise<Computed<AppliedOverride>> {
  const preview = await previewOverride(db, request);
  if (preview.kind !== "ok") return preview;

  const { sourceValue, adjustmentValue, resultingValue, definition } = preview.value;

  const created = await db.$transaction(async (tx) => {
    const adjustment = await tx.manualAdjustment.create({
      data: {
        entityType: definition.entityType,
        entityId: request.entityId,
        field: definition.field,
        unit: definition.unit,
        mode: request.mode,
        sourceValueJson: JSON.stringify(sourceValue),
        // Stored as entered: a delta stays a delta so it keeps tracking the
        // source, while a stated value stays absolute.
        adjustmentJson: JSON.stringify(
          request.mode === "delta" ? request.value : resultingValue,
        ),
        resultingValueJson: JSON.stringify(resultingValue),
        reason: request.reason,
      },
    });

    // The companion keeps an invariant true; it is written in the same
    // transaction so the shares are never stored in a state that does not
    // add up, not even between two writes.
    if (preview.value.companion !== null) {
      const companion = preview.value.companion;
      await tx.manualAdjustment.create({
        data: {
          entityType: companion.entityType,
          entityId: companion.entityId,
          field: companion.field,
          unit: definition.unit,
          mode: "set",
          sourceValueJson: JSON.stringify(companion.sourceValue),
          adjustmentJson: JSON.stringify(companion.resultingValue),
          resultingValueJson: JSON.stringify(companion.resultingValue),
          reason:
            request.reason === null
              ? "kept the payer shares at 100%"
              : `${request.reason} (kept the payer shares at 100%)`,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        kind: "manual_override",
        payloadJson: JSON.stringify({
          action: "applied",
          adjustmentId: adjustment.id,
          companion: preview.value.companion,
          entityType: definition.entityType,
          entityId: request.entityId,
          field: definition.field,
          unit: definition.unit,
          mode: request.mode,
          sourceValue,
          adjustmentValue,
          resultingValue,
          reason: request.reason,
        }),
      },
    });

    return adjustment;
  });

  return ok({ adjustmentId: created.id, preview: preview.value });
}

/**
 * Withdraws an override. The row is retained with `revokedAt` set, so the
 * history reads "this was overridden, then the override was withdrawn"
 * rather than losing both facts.
 */
export async function revokeOverride(
  db: PrismaClient,
  adjustmentId: string,
  reason: string | null = null,
): Promise<Computed<{ readonly adjustmentId: string }>> {
  const existing = await db.manualAdjustment.findUnique({ where: { id: adjustmentId } });
  if (existing === null) return insufficient("that override no longer exists");
  if (existing.revokedAt !== null)
    return insufficient("that override has already been withdrawn");

  await db.$transaction(async (tx) => {
    await tx.manualAdjustment.update({
      where: { id: adjustmentId },
      data: { revokedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        kind: "manual_override",
        payloadJson: JSON.stringify({
          action: "revoked",
          adjustmentId,
          entityType: existing.entityType,
          entityId: existing.entityId,
          field: existing.field,
          reason,
        }),
      },
    });
  });

  return ok({ adjustmentId });
}

export interface AdjustmentHistoryRow {
  readonly adjustment: AdjustmentInput;
  readonly definition: OverridableField | undefined;
  readonly resolved: EffectiveValue | null;
}

/**
 * Every override ever recorded, newest first, revoked ones included —
 * the answer to "what has been changed by hand, and is it still in force".
 */
export async function listAdjustmentHistory(
  db: PrismaClient,
): Promise<readonly AdjustmentHistoryRow[]> {
  const adjustments = await loadAdjustments(db, { includeRevoked: true });

  return adjustments
    .slice()
    .reverse()
    .map((adjustment) => {
      const resolved = resolveEffectiveValue(adjustment.sourceValueAtEntry, adjustment);
      return {
        adjustment,
        definition: findOverridableField(adjustment.entityType, adjustment.field),
        resolved: resolved.kind === "ok" ? resolved.value : null,
      };
    });
}

/** The declared fields, for callers that render the "what can be overridden" list. */
export { OVERRIDABLE_FIELDS };
