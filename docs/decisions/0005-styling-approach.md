# ADR 0005: Plain CSS with design tokens, no utility framework

Status: Accepted (M6, 30 Aug 2026)

## Context

Dashboard V1 needed a styling approach. The root specification's stack
mentions Tailwind and shadcn/ui, but that list describes the general
preferred stack rather than a requirement fixed for this project, and
`CLAUDE.md`'s own architecture section names only Next.js and TypeScript.

## Decision

Plain CSS in a single `globals.css` with CSS custom properties as design
tokens, plus semantic class names. No Tailwind, no component library, no
additional dependency.

## Rationale

- **The surface is small.** Five screens with tiles, tables, badges and
  progress bars. A token sheet of ~400 lines covers all of it and is easier
  to audit than utility classes scattered through JSX.
- **No build step to maintain.** Tailwind adds a PostCSS pipeline and a
  config to keep in sync; for one local single-user app that is cost without
  a matching benefit.
- **Consistent with the project's dependency posture.** The CSV reader was
  hand-written for the same reason: fewer dependencies in code that handles
  money means less to audit and less to break.
- **Dark mode is free.** Tokens redefined under `prefers-color-scheme`
  handle it in one block.
- **Design intent is enforceable.** `docs/10_DASHBOARD_SPEC.md` calls for
  decision usefulness over decoration; a small deliberate token set makes
  that easier to hold than an open-ended utility vocabulary.

## Consequences

- No component library means primitives (`Card`, `StatTile`, `ProgressBar`,
  `TrustBadge`) are written by hand — done once in
  `src/components/Primitives.tsx`.
- If the UI grows substantially, or a second developer joins and wants a
  shared vocabulary, revisiting this is cheap: the tokens map cleanly onto a
  Tailwind theme.
- Numeric columns use `font-variant-numeric: tabular-nums` so figures align
  down a column — a small thing that matters a lot when comparing money.
