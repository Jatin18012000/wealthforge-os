# Backup and Recovery

Practical guide to where your data lives, what to back up, and how to
restore. See `docs/16_DATA_MIGRATION.md` for the underlying architecture;
this document is the operational how-to.

## Where your data lives

Everything WEALTHFORGE OS knows about your finances is a single SQLite
file, plus two directories, all under the repository's `data/` folder
(created automatically on first run, gitignored — never pushed to GitHub):

| What | Path | Contains |
|---|---|---|
| Database | `data/wealthforge.db` | Every budget line, holding, goal, liability, insurance policy, activity, revision, manual override, and audit log entry. |
| Uploaded documents | `data/uploads/` | Copies of every budget workbook and portfolio snapshot file you have imported. |
| Backups | `data/backups/` | Every full-backup JSON file, automatic and manual. Also `data/backups/safety/`, holding the pre-restore safety snapshot the app always takes before a restore. |

**`data/wealthforge.db` is the single source of truth.** If you back up
nothing else, back up this file.

## What must be backed up

1. `data/wealthforge.db` (mandatory — this is your data)
2. `data/uploads/` (recommended — original source documents, useful for
   re-import or dispute resolution, but everything they contributed is
   already inside the database)
3. `data/backups/` (optional — these are themselves backups; keeping a
   copy of them elsewhere is defense-in-depth, not a second copy of new
   information)

## What must NOT be stored in Git

Never commit anything under `data/`. The repository's `.gitignore`
already blocks it (`data/*.db`, `data/uploads/`, `data/backups/`, and a
catch-all `**/*.db` in case a misconfigured `DATABASE_URL` puts the file
somewhere else) — but always double-check with `git status` before
committing if you have ever hand-edited `.gitignore` or forced an add.

## Automatic backups

The app takes a backup automatically:
- After every workbook or portfolio import (always, unconditionally).
- Otherwise, once per configured interval (default: every 24 hours,
  checked whenever the Data Center screen loads — there is no background
  process, so this is the local-first equivalent of "on startup").

You do not need to do anything for these — they accumulate in
`data/backups/`. You can see the full list, with timestamps and sizes, on
the **Data Center** screen.

## Creating a manual backup

**From the app** (recommended): open **Data Center** → **Export a backup
now**.

**From the command line**:
```
pnpm backup:export
```
This prints the path to the backup file it wrote, under `data/backups/`.

Do this before any import you are unsure about, before updating the
application, and before moving to a new machine.

## Restoring from a backup

**From the app**: open **Data Center**, find the backup in the list, click
**Restore this backup**. The app always takes a safety backup of your
*current* data first. If the backup you are restoring would overwrite data
newer than itself, the app refuses and tells you so — restoring never
silently destroys newer data. You would need to confirm explicitly to
proceed anyway in that situation.

**From the command line**:
```
pnpm backup:restore -- data/backups/<the-file>.json
```
Add `--force` only if you have already seen and understood a conflict
warning and still want to proceed:
```
pnpm backup:restore -- data/backups/<the-file>.json --force
```

## Recovering after reinstalling your laptop

1. Before wiping/reinstalling, copy `data/wealthforge.db` (and ideally
   `data/uploads/` and `data/backups/`) somewhere safe — a USB drive, an
   external disk, a personal cloud folder. This is a plain file copy; no
   special tool is needed.
2. On the new machine, follow `docs/LOCAL_DEPLOYMENT.md` to clone the
   repository and install dependencies, up through database
   initialization.
3. **Before** running the demo seed or starting the app for real use, copy
   your saved `wealthforge.db` back into `data/` (overwriting the empty
   one the migration step created), and restore `data/uploads/` and
   `data/backups/` the same way if you saved them.
4. Start the app (`pnpm build && pnpm start`, or `pnpm dev`) and confirm
   the Command Center shows your real figures, not the demo data.

## Safely moving the application to another laptop

Same procedure as recovery above, minus the reinstall step: copy `data/`
in full to the new machine after cloning and installing there, before
first launch.

## Verifying a backup is good

Open the Data Center screen after taking or restoring a backup and
confirm the audit log shows the operation (`backup` or `restore` kind,
with a timestamp) and that the trust-state and provenance tables still
show the record counts you expect.
