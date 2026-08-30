# Data Center (M9)

The screen for imports, revisions, provenance, trust states, the audit
log, and backup/restore (`docs/03_INFORMATION_ARCHITECTURE.md`). It is the
first screen where a browser upload runs the real ingestion pipeline —
every earlier milestone drove `importBudgetWorkbook`/`importPortfolioSnapshot`
from a script or a test.

## Upload storage boundary

`src/ingestion/uploadStorage.ts` is the only place a browser-supplied file
becomes a path on disk, per `docs/13_SECURITY_PRIVACY.md` ("File handling"):

- Validated before parsing: extension against a closed list per upload
  kind, and a size ceiling (20 MiB).
- Stored under `data/uploads/` at a generated name — a random id plus a
  sanitized trace of the original name (separators, `..`, and anything
  outside a safe character set stripped). The browser-supplied name can
  never choose where the bytes land, but a human can still recognize the
  file in a directory listing.
- The _display_ name — what a person actually typed — is preserved
  separately and threaded through as `displayFileName` on both
  `importBudgetWorkbook` and `importPortfolioSnapshot` (optional,
  defaulting to the path's basename, so every existing script and test
  caller is unaffected). Without this, the Import Audit and provenance list
  would show a UUID-prefixed filename instead of what the user uploaded —
  found and fixed during this milestone's own visual QA pass.

## Running the pipeline from a browser

`src/app/data-center/actions.ts` wraps `importBudgetWorkbook` and
`importPortfolioSnapshot` exactly as they are — no parallel "web" ingestion
path exists. On success the uploaded file is kept (its `source_document`
row now points at it via `rawBlobPath`, satisfying "raw uploaded file blobs
live under `data/`"); on failure it is deleted, since nothing references it.

Every outcome is carried back to the screen through a redirect's query
string — an Import Audit's event id, an error, a backup confirmation, or a
restore conflict — the same pattern `src/app/settings/actions.ts`
established in M8.

## Automatic backup

`docs/16_DATA_MIGRATION.md` left the interval undecided ("finalized in M9
alongside implementation"). This milestone finalizes it:

- **After every import** (`backupAfterImport`): unconditional, because an
  import is exactly the kind of event the schedule exists to not miss.
- **On a 24-hour interval otherwise** (`ensureAutomaticBackup`, configurable
  via the `autoBackupIntervalHours` app setting): checked on every Data
  Center page render. This app has no background process — it is a
  local Next.js server started on demand — so "on startup" is implemented
  as "the next time a page checks, if due," which is the closest local-first
  equivalent without inventing a scheduler daemon this product doesn't need.

Both paths tag the `backup` audit_event with `trigger: "automatic"` so the
audit log can tell an automatic backup from someone clicking "Export a
backup now."

## A real defect this milestone's own audit caught

`BACKUP_DIR`, `SAFETY_BACKUP_DIR`, and the uploads directory were first
written as `path.resolve(__dirname, "../../data/...")` — the same pattern
`scripts/backup-cli.ts` predates. Under `next start`, Next.js bundles
server code into `.next/server/`, so `__dirname` at runtime pointed inside
the build output, not the repository. The Data Center's own audit log
surfaced it immediately (`Backup written ... to .../.next/server/data/backups/...`)
during this milestone's visual QA — the same class of bug as the M2
`DATABASE_URL` defect CLAUDE.md documents, and the same fix: resolve
against `process.cwd()` instead, which every entry point (`pnpm dev`,
`pnpm start`, the CLI scripts) always runs from the repo root.

## Provenance, trust, and revisions

`src/data/dataCenterStore.ts` reads what the screen needs without touching
the domain engine's loaders — this is an operational/audit view, not
financial calculation input:

- **Provenance**: every `source_document`, with counts of what it produced.
- **Trust states**: counts per trust state across budget lines, portfolio
  snapshots, and activity — the rollup behind
  `docs/03_INFORMATION_ARCHITECTURE.md`'s "trust state indicator."
- **Revisions**: every `revision` row, newest first.
- **Audit log**: every `audit_event`, decoded per `kind` into one readable
  sentence (`src/views/dataCenterView.ts`) rather than raw JSON.

## Acceptance

Closes acceptance test 1 (`docs/17_ACCEPTANCE_TESTS.md`): "Upload the
recurring workbook and receive an Import Audit" is now true through the UI,
not only through a script.
