# 28 — Owner Deployment Checklist (Laptop, Local-First)

Step-by-step guide for the repository owner to clone WealthForge OS onto
their own laptop and run it locally, ahead of real-data UAT
(`docs/27_REAL_DATA_UAT_PLAN.md`). Every command below is already defined
in `package.json` or is a standard, free CLI tool (`git`, `pnpm`,
`node`). No paid software or service is introduced by this checklist.

Check each box as you go. If any step fails, stop and report it per
`docs/27_REAL_DATA_UAT_PLAN.md`'s "what happens if a defect is found"
section — do not work around it silently.

## 0. Prerequisites (one-time, on the laptop)

- [ ] **Node.js ≥ 20** installed (`package.json`'s `engines.node`).
  Check with:
  ```bash
  node -v
  ```
- [ ] **pnpm** installed (the project's package manager — see root
  `CLAUDE.md`, "Package Manager: pnpm"). If not installed:
  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  ```
  Check with:
  ```bash
  pnpm -v
  ```
- [ ] **git** installed. Check with:
  ```bash
  git -v
  ```
- [ ] *(Optional, only if you want the AI Analyst / Daily Brief to
  actually produce grounded explanations rather than "AI unavailable")*
  **Ollama** installed and running locally — free, no account, no key:
  https://ollama.com. After installing:
  ```bash
  ollama pull llama3.1
  ```
  This is entirely optional. Every other screen and every deterministic
  figure works with zero AI provider configured.

## 1. Clone the repository

```bash
git clone https://github.com/Jatin18012000/wealthforge-os.git
cd wealthforge-os
git checkout claude/wealthforge-os-foundation-5rfjdn
```
(Substitute `main` once the branch has been merged there, if you prefer
to run off the default branch instead.)

- [ ] Clone completes with no error.
- [ ] `git status` reports a clean working tree with no untracked files
  beyond what a fresh clone should have.

## 2. Install dependencies

```bash
pnpm install
```

- [ ] Completes with no error, using only `pnpm-lock.yaml`'s pinned
  versions (no unexpected registry, no paid package prompt).

## 3. Set up your environment file

```bash
cp .env.example .env
```

- [ ] `.env` now exists. For core operation (budget, portfolio, goals,
  liabilities, dashboard, analytics, data center, settings) **no edits
  are required** — the defaults are correct out of the box.
- [ ] Confirm `DATABASE_URL="file:../data/wealthforge.db"` was **not**
  changed to something like `file:./data/wealthforge.db` — that specific
  simplification silently writes the database to `prisma/data/` instead
  of the intended repo-root `data/` directory (documented directly in
  `.env.example`'s own comment). Leave it exactly as shipped.
- [ ] *(Optional)* If you installed Ollama and it runs on a non-default
  port, adjust `OLLAMA_BASE_URL`/`OLLAMA_MODEL`. Otherwise leave as-is.
- [ ] *(Optional, not recommended for real data)* If you want to try a
  cloud AI provider instead of local Ollama, you would set
  `AI_PROVIDER` and the corresponding API key — but this is never
  required, and using it means your report text (not your raw financial
  records) leaves your laptop. For real-data UAT, keep `AI_PROVIDER="ollama"`
  or leave the AI Analyst untested.

## 4. Generate the Prisma client and run migrations

```bash
pnpm prisma:generate
```

- [ ] Completes with no error.

For a brand-new local database:

```bash
npx prisma migrate deploy
```

- [ ] All migrations under `prisma/migrations/` apply cleanly to a fresh
  `data/wealthforge.db`.

(`pnpm db:reset` — i.e. `prisma migrate reset --force` — is available if
you ever need to wipe and re-migrate from scratch during testing, but it
is destructive to whatever is currently in your local database, so use
it deliberately, not as a routine step.)

## 5. Confirm the database file location

```bash
ls -la data/
```

- [ ] `data/wealthforge.db` exists at the **repo-root** `data/`
  directory (not `prisma/data/wealthforge.db`).
- [ ] `git status` shows nothing under `data/` as trackable — it should
  be entirely ignored (`.gitignore` already covers `data/*.db` and, as
  defense-in-depth, `**/*.db` anywhere in the tree).

## 6. (Optional) Seed demo data first, to sanity-check the install

Before loading any real data, you can confirm the app itself works end
to end using the built-in demo fixtures:

```bash
pnpm db:demo
```

- [ ] Completes with no error and prints a short summary of what it
  seeded.

Then start the app (next section) and confirm the Command Center shows
non-empty, plausible demo figures. Once confirmed, you can reset the
database (`pnpm db:reset`, or just delete `data/wealthforge.db` and
re-run migration) before importing your **real** data, so demo fixtures
never mix with your actual finances.

## 7. Start the application

```bash
pnpm dev
```

- [ ] Server starts with no error, by default at `http://localhost:3000`.
- [ ] Opening that URL in a browser shows the Command Center.

For a production-style run instead of the dev server:

```bash
pnpm build
pnpm start
```

- [ ] `pnpm build` compiles with no error.
- [ ] `pnpm start` serves the built app at `http://localhost:3000`.

## 8. Confirm the backup directory and take a first manual backup

```bash
pnpm backup:export
```

- [ ] `data/backups/` is created automatically if it did not already
  exist.
- [ ] A new timestamped `.json` backup file appears under `data/backups/`.
- [ ] That file is **not** shown by `git status` as trackable.

## 9. Import your real data (or a realistic fabricated copy)

Via the running app: go to **Data Center** → upload your budget workbook
and/or portfolio snapshot file(s).

- [ ] Each upload completes and shows an Import Audit.
- [ ] The resulting figures appear on the relevant screens (Budget,
  Portfolio, Goals, Liabilities, Analytics, Command Center).

See `docs/27_REAL_DATA_UAT_PLAN.md` areas 11–23 for the full set of
things to check once real data is loaded, and
`docs/29_REAL_DATA_VALIDATION_MATRIX.md` to record results as you go.

## 10. Verify automatic backup is running

- [ ] Visit the **Data Center** screen. If more than the configured
  interval (default 24h) has elapsed since the last automatic backup —
  which is true on a brand-new install, since none has ever run — a new
  automatic backup file appears under `data/backups/`.
- [ ] After an import, confirm a new automatic backup was also written
  (imports trigger one unconditionally, regardless of the interval).

## 11. Verify restore works before you rely on it

**Do this on a copy of your data, or after taking a fresh manual backup
you're willing to restore over** — restore changes your live database.

```bash
pnpm backup:restore -- data/backups/<the-file-you-just-exported>.json
```

- [ ] Restoring the backup you just took (no other changes since) succeeds
  cleanly.
- [ ] If you make an unrelated change first (e.g. add a goal) and then try
  to restore an older backup **without** `--force`, the restore is
  refused with a clear conflict message, and a safety backup of your
  pre-restore state is written before it stops.
- [ ] Re-running with `--force` completes the restore.

## 12. Check both viewports

- [ ] Resize your browser to a laptop width (e.g. 1280–1440px) and click
  through every screen.
- [ ] Resize to iPad width (or open in an actual iPad/iPad-simulator
  browser) and confirm no horizontal scrolling and full readability on
  every screen.

## 13. Record results

Fill in `docs/29_REAL_DATA_VALIDATION_MATRIX.md` as you complete each
area from `docs/27_REAL_DATA_UAT_PLAN.md`. Leave any area you have not
yet personally tested marked as pending — never mark a row as passed on
someone else's behalf.

## 14. If something breaks

Stop. Do not attempt to self-fix by editing files directly unless you
are comfortable doing so yourself. Bring the exact failure (with any real
financial figures redacted) back to the development conversation for a
scoped fix — per the owner's explicit instruction, a defect found here is
reported, not silently redesigned around.
