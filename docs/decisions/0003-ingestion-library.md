# ADR 0003: Excel ingestion library — exceljs

Status: Accepted (M0, 30 Aug 2026)

## Context

Budget ingestion requires full-workbook parsing with row/field-level detail
sufficient for provenance tracking, and must never execute formulas/macros
as code — only read evaluated cell values.

## Options considered

1. **exceljs** — actively maintained, TypeScript-friendly, cell-level API.
2. **xlsx (SheetJS)** — widely used, but the free Community Edition has had
   historical security advisories around prototype pollution/ReDoS in some
   versions, and the actively-patched distribution is via a non-npm channel,
   complicating supply-chain hygiene for a project that never wants to hand-
   manage dependency sourcing.

## Decision

Use **`exceljs`** for all workbook parsing in `src/ingestion/`.

## Rationale

- Cell-level access (row, column, value, and style/format where needed)
  supports the provenance requirement (`08_DATA_TRUST_MODEL.md`) directly.
- Stays on the standard npm registry with regular maintenance releases,
  which matters for a project with a long-term "no fake completion, no
  cut corners" security posture.
- Only reads evaluated values by default — no formula execution.

## Consequences

- If a future need arises for extremely large workbooks requiring streaming
  parse for memory reasons, `exceljs` supports a streaming reader API — no
  library change needed if that requirement appears later.
