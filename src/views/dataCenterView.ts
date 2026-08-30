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
    default:
      return row.kind;
  }
}

export interface DataCenterView {
  readonly auditLog: readonly DecodedAuditEvent[];
  readonly sourceDocuments: readonly SourceDocumentRow[];
  readonly revisions: readonly RevisionRow[];
  readonly trustSummaries: readonly TrustSummary[];
  readonly backups: readonly BackupFile[];
  /** The audit_event the caller just produced, decoded, if one was requested. */
  readonly justPerformed: DecodedAuditEvent | null;
}

export async function getDataCenterView(
  db: PrismaClient,
  options: { highlightEventId?: string } = {},
): Promise<DataCenterView> {
  const [auditLog, sourceDocuments, revisions, trustSummaries, backups] =
    await Promise.all([
      listAuditEvents(db),
      listSourceDocuments(db),
      listRevisions(db),
      trustStateSummary(db),
      listBackupFiles(BACKUP_DIR),
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
  };
}
