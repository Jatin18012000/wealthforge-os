# 15 — Deployment Architecture

## Primary environment

Laptop, running the Next.js app locally (`pnpm dev` in development;
`pnpm build && pnpm start` for a persistent local run). The SQLite database
file lives on the laptop's disk under `data/`.

## Secondary device: iPad

The iPad is a browser client to the same locally-running app, not a separate
build. Two supported ways to reach it, both without any cloud dependency:

1. **Same LAN** — run the app bound to `0.0.0.0` on the laptop and open
   `http://<laptop-lan-ip>:3000` from the iPad's browser while both devices
   are on the same network.
2. **Export/import** — for offline portability, use Data Center's
   export/import instead of live network access, if LAN access isn't
   available at a given time.

No requirement to package this as a native iPad app; a responsive web UI
reachable over the LAN satisfies "iPad as secondary interface"
(source doc §37 success condition #19).

## No cloud dependency for core operation

Core financial features (view net worth, budget, goals, liabilities,
portfolio, manual entry) work fully with the laptop offline. Only optional
market-data refresh and optional cloud AI providers require network access,
and both degrade gracefully when unavailable (`18_FAILURE_MODES.md`).

## Packaging

v1 target: run via Node/pnpm directly (`pnpm build && pnpm start`), which is
sufficient for a laptop-first single-user app and keeps the setup a
`git clone && pnpm install && pnpm dev` away from running, per the project's
"clone and run without paid services" requirement. Packaging as a desktop
app (e.g. Tauri/Electron) is an option to revisit later if double-click
launch becomes a real friction point — not required for v1. See
`19_OPEN_DECISIONS.md`.

## Optional sync

If a shared-local-sync mechanism is added later, local data remains
authoritative and any conflict is surfaced explicitly — never silently
resolved in favor of the remote copy. Not implemented in v1.
