# ADR 0002: Single package, not a monorepo

Status: Accepted (M0, 30 Aug 2026)

## Context

The source documents' own repository tree (§6/§27 of the build plan) is a
flat layout: `src/`, `tests/`, `scripts/`, `data/`, `docs/` at the repo root
— not an `apps/`+`packages/` Turborepo structure.

## Decision

WEALTHFORGE OS is built as a single Next.js package at the repository root.
No Turborepo, no `apps/`/`packages/` split.

## Rationale

This is one deployable local application for one user, not a platform with
multiple independently-deployable apps or shared packages consumed by
multiple teams/products. A monorepo's benefits (independent app deployment,
shared package versioning across multiple apps) don't apply here and would
add build-tooling overhead with no corresponding benefit. If the domain
layer (`src/domain/`) is ever reused by a genuinely separate application,
that would be the point to extract it into a published/shared package — not
before.

## Consequences

- Simpler `package.json`, single `tsconfig.json`, single build/test
  pipeline.
- `src/domain/` is still kept as an internally-isolated module (no
  React/Next.js imports) so the boundary that would matter for future
  extraction is enforced by convention and lint rules from the start, even
  without physical package separation.
