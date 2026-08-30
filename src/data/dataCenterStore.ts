import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { TrustState } from "../domain";

/**
 * Read-only queries behind the Data Center screen: the audit log, source
 * provenance, trust-state counts, and what backup files exist on disk.
 *
 * Kept separate from `src/data/loaders.ts` because these feed an
 * operational/provenance screen rather than a financial calculation — they
 * have no adjustments to layer and nothing here is engine input.
 */

export interface AuditEventRow {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt: Date;
}

export async function listAuditEvents(
  db: PrismaClient,
  limit = 50,
): Promise<AuditEventRow[]> {
  const rows = await db.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: parseJsonSafely(row.payloadJson),
    createdAt: row.createdAt,
  }));
}

function parseJsonSafely(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    // The audit log must remain readable even if one row's payload was
    // corrupted somehow — showing the raw text beats hiding the entry.
    return { unparsed: json };
  }
}

export interface SourceDocumentRow {
  readonly id: string;
  readonly fileName: string;
  readonly kind: string;
  readonly fileHash: string;
  readonly uploadedAt: Date;
  readonly sheetCount: number;
  readonly planRecordCount: number;
  readonly positionSnapshotCount: number;
}

export async function listSourceDocuments(
  db: PrismaClient,
): Promise<SourceDocumentRow[]> {
  const rows = await db.sourceDocument.findMany({
    orderBy: { uploadedAt: "desc" },
    include: {
      _count: {
        select: { sheetSnapshots: true, planRecords: true, positionSnapshots: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    kind: row.kind,
    fileHash: row.fileHash,
    uploadedAt: row.uploadedAt,
    sheetCount: row._count.sheetSnapshots,
    planRecordCount: row._count.planRecords,
    positionSnapshotCount: row._count.positionSnapshots,
  }));
}

export interface RevisionRow {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly source: string;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export async function listRevisions(
  db: PrismaClient,
  limit = 50,
): Promise<RevisionRow[]> {
  const rows = await db.revision.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt,
  }));
}

export type TrustCounts = Record<TrustState, number>;

const EMPTY_TRUST_COUNTS: TrustCounts = {
  extracted: 0,
  needs_review: 0,
  validated: 0,
  verified: 0,
  rejected: 0,
  superseded: 0,
};

export interface TrustSummary {
  readonly entityType: string;
  readonly label: string;
  readonly counts: TrustCounts;
}

/**
 * How many records of each kind sit in each trust state.
 *
 * `docs/03_INFORMATION_ARCHITECTURE.md` calls for a "trust state indicator"
 * wherever an untrusted record contributes to a total; this is the
 * screen-level rollup that motivates drilling into any one of them.
 */
export async function trustStateSummary(db: PrismaClient): Promise<TrustSummary[]> {
  const [planRecords, positionSnapshots, activities] = await Promise.all([
    db.planRecord.groupBy({ by: ["trustState"], _count: { trustState: true } }),
    db.positionSnapshot.groupBy({ by: ["trustState"], _count: { trustState: true } }),
    db.activity.groupBy({ by: ["trustState"], _count: { trustState: true } }),
  ]);

  return [
    { entityType: "plan_record", label: "Budget lines", groups: planRecords },
    {
      entityType: "position_snapshot",
      label: "Portfolio snapshots",
      groups: positionSnapshots,
    },
    { entityType: "activity", label: "Activity", groups: activities },
  ].map(({ entityType, label, groups }) => ({
    entityType,
    label,
    counts: groups.reduce<TrustCounts>(
      (counts, group) => {
        const state = group.trustState as TrustState;
        if (state in counts) counts[state] = group._count.trustState;
        return counts;
      },
      { ...EMPTY_TRUST_COUNTS },
    ),
  }));
}

export interface BackupFile {
  readonly fileName: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly createdAt: Date;
}

// process.cwd(), not __dirname — see the equivalent note in
// src/ingestion/uploadStorage.ts's uploadsDir(). Matches scripts/backup-cli.ts.
export const BACKUP_DIR = path.resolve(process.cwd(), "data/backups");
export const SAFETY_BACKUP_DIR = path.resolve(process.cwd(), "data/backups/safety");

/** Backups on disk, newest first. Missing directory reads as "no backups yet", not an error. */
export async function listBackupFiles(dir: string = BACKUP_DIR): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const filePath = path.join(dir, name);
        const info = await stat(filePath);
        return {
          fileName: name,
          path: filePath,
          sizeBytes: info.size,
          createdAt: info.mtime,
        };
      }),
  );

  return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
