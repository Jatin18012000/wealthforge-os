import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { insufficient, ok, type Computed } from "../domain";

/**
 * The one place an uploaded file becomes a path on disk.
 *
 * `importBudgetWorkbook` and `importPortfolioSnapshot` read from a
 * filesystem path — this is what turns a browser upload into one safely,
 * per docs/13_SECURITY_PRIVACY.md ("File handling"):
 *
 * - validated before parsing (extension and size), so an oversized or
 *   wrong-kind file is rejected before exceljs/the CSV reader ever touches
 *   it;
 * - stored at a generated name under `data/uploads/`, never at a path built
 *   from the browser-supplied filename — the original name is kept only as
 *   a label, so nothing in it (`../../etc/passwd`, a null byte) can steer
 *   where the bytes land.
 */

export interface UploadKindRule {
  readonly label: string;
  readonly extensions: readonly string[];
  readonly maxBytes: number;
}

const MEBIBYTE = 1024 * 1024;

export const UPLOAD_KINDS = {
  budgetWorkbook: {
    label: "budget workbook",
    extensions: [".xlsx"],
    maxBytes: 20 * MEBIBYTE,
  },
  portfolioSnapshot: {
    label: "portfolio snapshot",
    extensions: [".xlsx", ".csv"],
    maxBytes: 20 * MEBIBYTE,
  },
} as const satisfies Record<string, UploadKindRule>;

export type UploadKind = keyof typeof UPLOAD_KINDS;

export interface StoredUpload {
  /** Absolute path on disk. Only this module and its caller ever see it. */
  readonly path: string;
  /** The name the browser reported, kept for display only — never for I/O. */
  readonly originalName: string;
  readonly byteLength: number;
  cleanup(): Promise<void>;
}

function uploadsDir(): string {
  // process.cwd(), not __dirname: Next.js bundles this module under
  // .next/server/ at build time, so __dirname there points inside the build
  // output, not the repo — resolving relative to it would silently write
  // uploads into .next/server/data/uploads instead of the repo-root data/
  // directory (found via the Data Center screen's audit log during M9's
  // visual QA, the same class of bug .env.example's DATABASE_URL note warns
  // about for Prisma). Every script and server entry point here is run from
  // the repo root (`pnpm dev`/`start`/the CLI scripts), so process.cwd() is
  // reliable.
  return path.resolve(process.cwd(), "data/uploads");
}

/**
 * Validates and persists an uploaded file.
 *
 * Takes a `File`/`Blob`-like object (what a Next.js server action receives
 * from `FormData`) rather than a path, so there is no stage at which a
 * caller could pass a path built from user input.
 */
export async function storeUpload(
  file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  kind: UploadKind,
): Promise<Computed<StoredUpload>> {
  const rule = UPLOAD_KINDS[kind];
  const originalName = file.name.trim() === "" ? "upload" : file.name;
  const extension = path.extname(originalName).toLowerCase();

  if (!(rule.extensions as readonly string[]).includes(extension)) {
    return insufficient(
      `"${originalName}" is not a supported file type for a ${rule.label} — expected ${rule.extensions.join(" or ")}`,
    );
  }
  if (file.size <= 0) {
    return insufficient(`"${originalName}" is empty`);
  }
  if (file.size > rule.maxBytes) {
    return insufficient(
      `"${originalName}" is ${(file.size / MEBIBYTE).toFixed(1)} MiB, which is over the ${rule.maxBytes / MEBIBYTE} MiB limit for a ${rule.label}`,
    );
  }

  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });

  // The stored name keeps a human-readable trace of the original for
  // provenance (Import Audit and the Data Center's source-document list
  // both display it) without ever letting the browser-supplied name choose
  // where the bytes land: every path separator, ".." segment, and anything
  // outside a safe character set is stripped before it is used, and a
  // random id is prepended so two uploads can never collide or overwrite
  // one another.
  const safeStem = path
    .basename(originalName, extension)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 60);
  const generatedName = `${randomUUID()}-${safeStem === "" ? "upload" : safeStem}${extension}`;
  const filePath = path.join(dir, generatedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const written = await stat(filePath);

  return ok({
    path: filePath,
    originalName,
    byteLength: written.size,
    async cleanup() {
      await unlink(filePath).catch(() => undefined);
    },
  });
}
