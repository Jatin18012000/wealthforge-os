import type { ExtractedSheet, ExtractedWorkbook, SheetDiff } from "./types";

/** The most recent stored state of a sheet, for diffing this upload against. */
export interface PriorSheetState {
  sheetName: string;
  contentHash: string;
}

/**
 * Detects rows within a single sheet that make a contradictory claim: the
 * same category+label appearing more than once with DIFFERENT amounts.
 * There is no way to tell which is authoritative from the file alone, so
 * the sheet is classified CONFLICT and nothing is written from it, rather
 * than picking one and silently discarding the other
 * (docs/09_INGESTION_ARCHITECTURE.md, CONFLICT).
 *
 * Identical duplicate rows are NOT a conflict — they make the same claim
 * twice, which the row-level dedupe in the importer collapses safely.
 */
export function findInternalConflict(sheet: ExtractedSheet): string | null {
  const seen = new Map<string, number | null>();

  for (const row of sheet.rows) {
    // Rows already failing validation are handled by their needs_review
    // trust state; they don't make a trusted claim to contradict.
    if (row.trustState !== "validated") continue;

    const key = `${row.category}::${row.labelNormalized}`;
    if (!seen.has(key)) {
      seen.set(key, row.amountMinorUnits);
      continue;
    }
    const previous = seen.get(key);
    if (previous !== row.amountMinorUnits) {
      return `Sheet "${sheet.name}" contains contradictory values for "${row.labelRaw}" (${row.category}): ${formatMinor(previous)} and ${formatMinor(row.amountMinorUnits)}. Cannot determine which is authoritative.`;
    }
  }

  return null;
}

function formatMinor(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return "no value";
  return `₹${(minorUnits / 100).toLocaleString("en-IN")}`;
}

/**
 * Classifies every sheet in this upload against stored history, and reports
 * any previously-seen sheet that is absent from this upload.
 *
 * Sheet identity is the sheet NAME; ordering within the workbook is
 * irrelevant, so reordering sheets is never misread as delete+add
 * (docs/09 "Sheet identity").
 */
export function diffWorkbook(
  extracted: ExtractedWorkbook,
  prior: PriorSheetState[],
): SheetDiff[] {
  const priorByName = new Map(prior.map((p) => [p.sheetName, p]));
  const seenNames = new Set<string>();
  const diffs: SheetDiff[] = [];

  for (const sheet of extracted.sheets) {
    seenNames.add(sheet.name);

    const conflictReason = findInternalConflict(sheet);
    if (conflictReason !== null) {
      diffs.push({
        sheetName: sheet.name,
        kind: sheet.kind,
        classification: "conflict",
        conflictReason,
        extracted: sheet,
      });
      continue;
    }

    const priorState = priorByName.get(sheet.name);
    if (priorState === undefined) {
      diffs.push({ sheetName: sheet.name, kind: sheet.kind, classification: "new", extracted: sheet });
      continue;
    }

    diffs.push({
      sheetName: sheet.name,
      kind: sheet.kind,
      classification: priorState.contentHash === sheet.contentHash ? "unchanged" : "modified",
      extracted: sheet,
    });
  }

  // A sheet we have history for that is missing from this upload. Cannot be
  // distinguished from a rename automatically, so it is flagged for the user
  // to confirm — and its historical records are never deleted.
  for (const priorState of prior) {
    if (!seenNames.has(priorState.sheetName)) {
      diffs.push({
        sheetName: priorState.sheetName,
        kind: "unrecognized",
        classification: "deleted_renamed",
      });
    }
  }

  return diffs;
}
