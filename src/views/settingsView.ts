import type { PrismaClient } from "@prisma/client";
import { insufficient, type AdjustmentMode, type Computed } from "../domain";
import {
  listAdjustmentHistory,
  listOverrideTargets,
  previewOverride,
  type AdjustmentHistoryRow,
  type OverrideGroupView,
  type OverridePreviewResult,
  type OverrideTarget,
} from "../manual/overrides";
import { findOverridableField } from "../manual/registry";
import { parseEntryValue } from "../presentation/parse";
import { listPeriods } from "./context";

/**
 * The Settings screen's view model.
 *
 * Two things happen here and nowhere else on this screen: raw typed text is
 * turned into a number (at the parse boundary), and a proposed override is
 * previewed. The page component renders the result and performs no
 * arithmetic of its own, exactly as on every other screen.
 */

export interface OverrideEntry {
  readonly entityType: string;
  readonly entityId: string;
  readonly field: string;
  readonly mode: AdjustmentMode;
  /** Exactly what the user typed, so the form can show it back to them. */
  readonly value: string;
  readonly reason: string;
}

export interface PreviewPanel {
  readonly entry: OverrideEntry;
  readonly target: OverrideTarget | null;
  readonly result: Computed<OverridePreviewResult>;
}

export interface SettingsView {
  readonly groups: readonly OverrideGroupView[];
  readonly history: readonly AdjustmentHistoryRow[];
  readonly periodMonth: string | null;
  readonly periods: readonly string[];
  /** Present only while an override is being previewed, before it is confirmed. */
  readonly preview: PreviewPanel | null;
  /** How many overrides are currently in force, for the screen's summary line. */
  readonly activeCount: number;
}

export async function getSettingsView(
  db: PrismaClient,
  options: { periodMonth?: string; entry?: OverrideEntry } = {},
): Promise<SettingsView> {
  const periods = await listPeriods(db);
  const periodMonth =
    options.periodMonth !== undefined && periods.includes(options.periodMonth)
      ? options.periodMonth
      : (periods[0] ?? null);

  const groups = await listOverrideTargets(
    db,
    periodMonth === null ? {} : { periodMonth },
  );
  const history = await listAdjustmentHistory(db);

  return {
    groups,
    history,
    periodMonth,
    periods,
    preview:
      options.entry === undefined ? null : await buildPreview(db, groups, options.entry),
    activeCount: history.filter((row) => row.adjustment.revokedAt === null).length,
  };
}

async function buildPreview(
  db: PrismaClient,
  groups: readonly OverrideGroupView[],
  entry: OverrideEntry,
): Promise<PreviewPanel> {
  const target =
    groups
      .flatMap((group) => group.targets)
      .find(
        (candidate) =>
          candidate.definition.entityType === entry.entityType &&
          candidate.definition.field === entry.field &&
          candidate.entityId === entry.entityId,
      ) ?? null;

  const definition = findOverridableField(entry.entityType, entry.field);
  if (definition === undefined) {
    return {
      entry,
      target,
      result: insufficient(
        `"${entry.entityType}.${entry.field}" is not an overridable field`,
      ),
    };
  }

  const parsed = parseEntryValue(entry.value, definition.unit);
  if (parsed.kind !== "ok") return { entry, target, result: parsed };

  return {
    entry,
    target,
    result: await previewOverride(db, {
      entityType: entry.entityType,
      entityId: entry.entityId,
      field: entry.field,
      mode: entry.mode,
      value: parsed.value,
      reason: entry.reason.trim() === "" ? null : entry.reason.trim(),
    }),
  };
}

/** Narrows an arbitrary query-string value to a mode, defaulting to the safer one. */
export function toMode(raw: string | undefined): AdjustmentMode {
  return raw === "delta" ? "delta" : "set";
}
