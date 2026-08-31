# Local Deployment

Beginner-friendly, end-to-end procedure to run WEALTHFORGE OS on your own
machine. Every command below is copied verbatim from `package.json` and
was run as part of this release's clean-clone verification
(`docs/PROJECT_COMPLETION_CERTIFICATE.md`).

## Prerequisites

- **Node.js 20 or newer** (`node --version`)
- **pnpm** (`npm install -g pnpm` if you don't have it)
- Nothing else. No Docker, no cloud account, no paid service is required.

## Installation

### Clone

```
git clone https://github.com/Jatin18012000/wealthforge-os
cd wealthforge-os
```

Or, if you already have the code: `cd` into the repository directory.

Install dependencies:
```
pnpm install
```

### Environment setup

```
cp .env.example .env
```

The defaults work as-is for local use — a local SQLite database and the
free, local Ollama AI provider. You do not need to edit `.env` to start
using the app. See the comments inside `.env.example` for what each
variable does and which are optional (every AI/market-data variable is
optional; only `DATABASE_URL` matters for core operation, and its default
is already correct).

Generate the Prisma client (required once after install, and again after
any dependency reinstall):
```
npx prisma generate
```

### Database initialization

```
npx prisma migrate deploy
```

This creates `data/wealthforge.db` and the `data/` directory itself if
they don't exist yet, applying every schema migration in order.

(If you are actively developing rather than deploying, `pnpm
prisma:migrate` — `prisma migrate dev` — is the equivalent for a dev
workflow; `migrate deploy` is the non-interactive form appropriate for a
first run.)

## Development start

```
pnpm dev
```

Opens on http://localhost:3000 with hot reload. Good for trying things out
or making changes.

## Production build

```
pnpm build
```

Verified as part of this release: compiles cleanly, all 13 routes.

## Production start

```
pnpm start
```

Serves the build from `pnpm build` on http://localhost:3000 (or the `PORT`
you set in `.env`).

## Open in browser

Visit http://localhost:3000. You should see the Command Center. If you
have not imported any data yet, screens will show empty states rather
than numbers — that's expected on a first run with no data (see
`docs/OWNER_HANDOFF.md`'s first-run workflow for what to do next).

## Backup

```
pnpm backup:export
```

See `docs/BACKUP_AND_RECOVERY.md` for the full procedure, including the
in-app Data Center screen's Export/Restore buttons.

## Restore

```
pnpm backup:restore -- data/backups/<the-file>.json
```

Add `--force` only after seeing and understanding a conflict warning. See
`docs/BACKUP_AND_RECOVERY.md`.

## Update

To pull a newer version of the application:
```
git pull
pnpm install
npx prisma generate
npx prisma migrate deploy
pnpm build
```

`prisma migrate deploy` only applies migrations that haven't run yet — it
is always safe to re-run. **Take a backup first** (`pnpm backup:export`)
in case a new migration ever needs a rollback.

## Troubleshooting

- **"Cannot find module '@prisma/client'" or similar** — run `npx prisma
  generate`, then try again.
- **Database errors on first run** — run `npx prisma migrate deploy`
  before starting the app.
- **Port already in use** — set `PORT` in `.env` to something else, or
  stop whatever else is using port 3000.
- **AI Analyst says "AI unavailable"** — this is expected unless you have
  a local Ollama server running (`OLLAMA_BASE_URL` in `.env`) or have set
  `AI_PROVIDER` to `openai`/`anthropic` with an API key. Every other
  screen works regardless — the AI layer is optional by design.
- **Market data won't refresh** — this is expected if you have no
  internet access; every figure elsewhere in the app keeps working from
  the last known or manually entered price (see the Market screen).
- **You changed `DATABASE_URL` and now see a different (or empty)
  database** — Prisma resolves a relative SQLite path relative to
  `prisma/schema.prisma`'s directory, not your current directory. Keep the
  `.env.example` default (`file:../data/wealthforge.db`) unless you know
  exactly what you're doing.

## Stopping the application

- **Development** (`pnpm dev`) or **production** (`pnpm start`): press
  `Ctrl+C` in the terminal running it.
- No background services or daemons are started by any of the above —
  stopping the process stops everything.
