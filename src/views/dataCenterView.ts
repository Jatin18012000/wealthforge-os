import type { PrismaClient } from "@prisma/client";
import {
  BACKUP_DIR,
  listAuditEvents,
  listBackupFiles,
  listRevisions,
  listSourceDocuments,
  trustStateSummary,
  type AuditEventRow,
  type BackupFile,
  type RevisionRow,
  type SourceDocumentRow,
  type TrustSummary,
} from "../data/dataCenterStore";

/**
 * The Data Center's view model: imports, revisions, provenance, trust
 * states, the audit log, and what backups exist
 * (`docs/03_INFORMATION_ARCHITECTURE.md`).
 *
 * Every audit_event payload is opaque JSON at the database boundary — this
 * is where it is decoded back into a human sentence per kind, so the page
 * component only ever renders text, never interprets payload shapes.
 */

export interface DecodedAuditEvent extends AuditEventRow {
  readonly summary: string;
}

function decodeAuditEvent(row: AuditEventRow): DecodedAuditEvent {
  return { ...row, summary: summarize(row) };
}

function summarize(row: AuditEventRow): string {
  const payload = row.payload;
  if (typeof payload !== "object" || payload === null)
    return `${row.kind} (unreadable payload)`;
  const p = payload as Record<string, unknown>;

  switch (row.kind) {
    case "import": {
      if (typeof p.portfolioSnapshot === "object" && p.portfolioSnapshot !== null) {
        const audit = p.portfolioSnapshot as Record<string, unknown>;
        return `Portfolio snapshot "${String(audit.fileName)}": ${String(audit.positionsCreated)} created, ${String(audit.positionsRevised)} revised, ${String(audit.observedChanges instanceof Array ? audit.observedChanges.length : 0)} unexplained change(s)`;
      }
      const sheets = Array.isArray(p.sheets) ? p.sheets.length : 0;
      return `Budget workbook "${String(p.fileName)}": ${sheets} sheet(s) scanned, ${String(p.recordsCreated)} record(s) created, ${String(p.recordsSuperseded)} superseded`;
    }
    case "backup":
      return `Backup written (${String(p.trigger ?? "manual")}) to ${String(p.filePath)}`;
    case "restore":
      return `Restored from ${String(p.backupFilePath)}${p.forced === true ? " (forced over a conflict)" : ""}`;
    case "manual_override":
      return p.action === "revoked"
        ? `Override withdrawn on ${String(p.entityType)}.${String(p.field)}`
        : `${String(p.entityType)}.${String(p.field)} overridden`;
    case "ai_explanation": {
      if (p.outcome === "shown")
        return `AI Analyst explanation shown (${String(p.providerName)})`;
      return `AI Analyst explanation ${String(p.outcome)} — ${String(p.reason)}`;
    }
    case "market_refresh": {
      if (!Array.isArray(payload)) return "Market data refreshed";
      const parts = payload.map((entry) => {
        const e = entry as Record<string, unknown>;
        return `${String(e.source)}: ${String(e.updatedCount)} updated, ${String(e.failedCount)} failed`;
      });
      return `Market data refreshed — ${parts.join("; ")}`;
    }
    default:
      return row.kind;
  }
}

/**
 * One budget-EMI label imported at least once (category "emi") that has no
 * `EmiLabelLink` to a Liability yet. Aggregated across every import of that
 * label so far — never a single row — because the same EMI recurs every
 * month it was budgeted.
 */
export interface UnlinkedEmiLabel {
  readonly labelNormalized: string;
  readonly labelRaw: string;
  /** The most recently imported month's amount for this label, in minor units. Null if that row's amount was unparseable. */
  readonly latestAmountMinorUnits: number | null;
  /** The most recent non-null EMI end date seen for this label, across every import. */
  readonly latestEmiEndDate: Date | null;
  /** How many distinct plan records (months) carry this label. */
  readonly occurrences: number;
}

async function loadUnlinkedEmiLabels(
  db: PrismaClient,
): Promise<readonly UnlinkedEmiLabel[]> {
  const [emiRecords, links] = await Promise.all([
    db.planRecord.findMany({
      where: { category: "emi", supersededById: null },
      orderBy: [{ periodMonth: "desc" }, { createdAt: "desc" }],
    }),
    db.emiLabelLink.findMany({ select: { labelNormalized: true } }),
  ]);

  const linked = new Set(links.map((link) => link.labelNormalized));

  const byLabel = new Map<string, UnlinkedEmiLabel>();
  for (const record of emiRecords) {
    if (linked.has(record.labelNormalized)) continue;

    const existing = byLabel.get(record.labelNormalized);
    if (existing === undefined) {
      byLabel.set(record.labelNormalized, {
        labelNormalized: record.labelNormalized,
        labelRaw: record.labelRaw,
        latestAmountMinorUnits: record.amountMinorUnits,
        latestEmiEndDate: record.emiEndDate,
        occurrences: 1,
      });
      continue;
    }

    byLabel.set(record.labelNormalized, {
      ...existing,
      // Rows are visited in periodMonth-desc order, so the first non-null
      // end date seen for a label is its most recent one.
      latestEmiEndDate: existing.latestEmiEndDate ?? record.emiEndDate,
      occurrences: existing.occurrences + 1,
    });
  }

  return [...byLabel.values()].sort((a, b) => a.labelRaw.localeCompare(b.labelRaw));
}

export interface DataCenterView {
  readonly auditLog: readonly DecodedAuditEvent[];
  readonly sourceDocuments: readonly SourceDocumentRow[];
  readonly revisions: readonly RevisionRow[];
  readonly trustSummaries: readonly TrustSummary[];
  readonly backups: readonly BackupFile[];
  /** The audit_event the caller just produced, decoded, if one was requested. */
  readonly justPerformed: DecodedAuditEvent | null;
  /** Budget-imported EMI labels with no Liability linked yet. */
  readonly unlinkedEmiLabels: readonly UnlinkedEmiLabel[];
}

export async function getDataCenterView(
  db: PrismaClient,
  options: { highlightEventId?: string } = {},
): Promise<DataCenterView> {
  const [
    auditLog,
    sourceDocuments,
    revisions,
    trustSummaries,
    backups,
    unlinkedEmiLabels,
  ] = await Promise.all([
    listAuditEvents(db),
    listSourceDocuments(db),
    listRevisions(db),
    trustStateSummary(db),
    listBackupFiles(BACKUP_DIR),
    loadUnlinkedEmiLabels(db),
  ]);

  const decoded = auditLog.map(decodeAuditEvent);
  const justPerformed =
    options.highlightEventId === undefined
      ? null
      : (decoded.find((event) => event.id === options.highlightEventId) ?? null);

  return {
    auditLog: decoded,
    sourceDocuments,
    revisions,
    trustSummaries,
    backups,
    justPerformed,
    unlinkedEmiLabels,
  };
}
