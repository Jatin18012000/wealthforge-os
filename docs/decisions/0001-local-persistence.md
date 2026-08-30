# ADR 0001: Local persistence — SQLite via Prisma

Status: Accepted (M0, 30 Aug 2026)

## Context

The source documents require: local-first core storage with no cloud
database dependency, immutable historical snapshots with revisions,
transactions, holdings, goals, liabilities, insurance, valuations, budget
data, manual overrides, provenance, audit events, and application settings.
The app must run fully offline for core operations, and a developer/user
must be able to clone and run it with no paid services.

## Options considered

1. **SQLite** (file-based, embedded, via Prisma or better-sqlite3 directly).
2. **IndexedDB** (browser-only storage).
3. **Local PostgreSQL** (self-hosted via Docker Compose).

## Decision

**SQLite, accessed through Prisma**, with the database file at
`data/wealthforge.db`.

## Rationale

- **Local-first fit:** a single file on the laptop's disk is the simplest,
  most robust local-first store for a single-user app — no server process
  to start/manage, no port to bind, works identically offline.
- **Vs. IndexedDB:** IndexedDB only exists in the browser context, which
  would tie all data access to client-side JS and complicate the
  server-side ingestion pipeline (Excel parsing, revision diffing) that
  needs to run in Node regardless. SQLite is accessible from both the
  Next.js API routes (Node runtime) and any future CLI/script tooling
  (`scripts/`) without duplicating storage logic.
- **Vs. local Postgres:** Postgres would require a running database server
  process (even via Docker Compose) for what is fundamentally a single-user
  local app — unnecessary operational overhead and a heavier "clone and
  run" experience. SQLite requires zero setup beyond `pnpm install`.
- **Prisma over raw SQL/better-sqlite3 directly:** typed schema, migration
  history (needed for `16_DATA_MIGRATION.md`'s schema-versioning
  requirement), and a query API that reduces the risk of hand-written SQL
  bugs in code that handles money.
- SQLite fully supports the relational modeling this domain needs
  (revisions referencing originals, foreign keys across goals/activities/
  liabilities) and scales far beyond a single household's data volume.

## Consequences

- Full-text/complex analytical queries across large history are still fine
  at this data scale (a personal budget/portfolio, not a multi-tenant SaaS
  dataset).
- If a genuine multi-user or remote-access requirement is approved later,
  this decision would need revisiting (Prisma's SQLite-to-Postgres migration
  path is well-supported if that day comes — noted here, not implemented).
- Concurrent write access is single-process by design, which matches a
  single local app instance; no concurrent-writer scenario is expected.
