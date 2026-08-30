# 16 — Data Migration, Backup & Restore

## Automatic backup

The app takes an automatic local backup on a schedule (default: on each app
startup after a threshold interval since the last backup, plus after every
workbook import) to a local backup directory outside the live database file.
Retention policy and exact interval are configurable in Settings; default
values are finalized in M9 alongside implementation.

## Manual operations

- **Export Full Backup** — a single portable file capturing the database,
  historical records, revisions, goals, transactions, settings, audit log,
  and provenance.
- **Import Full Backup** — load a previously exported backup file.
- **Restore Backup** — apply a backup over the live database, with the
  safety sequence below.
- **Export Data / Import Data** — scoped export/import (e.g. just goals, or
  just a date range) for portability, distinct from a full backup.

## Restore safety sequence (mandatory, no exceptions)

1. Take an automatic safety backup of the current live state before touching
   anything.
2. Compare the backup being restored against current data by timestamp/
   revision markers.
3. If the restore would overwrite data newer than the backup, surface the
   conflict explicitly and require the user to choose — restore never
   silently destroys newer data.
4. On confirmed restore, write an `audit_event` recording what was restored,
   from which backup, and when.

## Schema migrations

Prisma migrations version the schema. A migration that changes the shape of
historical data must preserve the ability to answer "what did we believe at
time T" — a migration is not permitted to collapse revision history to save
space without an explicit, separately-approved archival decision.

## Prisma/schema versioning

Every migration is committed with the code change that requires it, and
`06_DATABASE_SCHEMA.md` is updated in the same commit if the logical schema
changed.
