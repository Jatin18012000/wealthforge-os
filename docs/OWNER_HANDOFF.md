# Owner Handoff

This document is written so you can read it without needing an AI
assistant. It answers the practical questions you'll have running
WEALTHFORGE OS yourself.

## 1. What is WealthForge OS?

A personal financial operating system that runs entirely on your own
computer. It replaces a manually-maintained Excel budget workbook and
ad-hoc portfolio tracking with one application that imports your budget
workbook and portfolio statements, calculates your net worth, budget
performance, goal progress, liabilities, and portfolio returns, and shows
it all on a dashboard — plus an optional AI assistant that explains those
numbers (never invents its own).

## 2. Where is the repository?

`https://github.com/Jatin18012000/wealthforge-os`, branch
`claude/wealthforge-os-foundation-5rfjdn`, tagged `v1.0.0` for this
release.

## 3. How do I clone it?

```
git clone https://github.com/Jatin18012000/wealthforge-os
cd wealthforge-os
git checkout v1.0.0
```

## 4. How do I install it?

```
pnpm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
```

Full detail, including prerequisites: `docs/LOCAL_DEPLOYMENT.md`.

## 5. How do I start it?

For everyday use:
```
pnpm build
pnpm start
```
Then open http://localhost:3000 in your browser.

(`pnpm dev` also works, and is fine for casual use — `pnpm build` +
`pnpm start` is the steadier, faster-loading option once you're not
actively changing anything.)

## 6. Where is my database?

`data/wealthforge.db` — a single SQLite file. This is the actual source
of truth for everything you see in the app. It is created automatically
the first time you run the database initialization step, and it is never
uploaded to GitHub.

## 7. Where are uploaded files?

`data/uploads/` — copies of every budget workbook and portfolio statement
you have imported through the app.

## 8. How do I back up?

Easiest: open the **Data Center** screen in the app and click **Export a
backup now**. From the command line: `pnpm backup:export`. Backups land in
`data/backups/`. Full procedure, including what to copy before
reinstalling your laptop: `docs/BACKUP_AND_RECOVERY.md`.

## 9. How do I restore?

From the app: **Data Center** → find the backup → **Restore this backup**.
From the command line: `pnpm backup:restore -- data/backups/<file>.json`.
The app always takes a safety backup of your current data first, and
refuses to overwrite anything newer than the backup you're restoring
unless you explicitly confirm.

## 10. How do I update the application?

```
git pull
pnpm install
npx prisma generate
npx prisma migrate deploy
pnpm build
```
Take a backup first (`pnpm backup:export`). `prisma migrate deploy` only
applies migrations you don't already have — safe to re-run.

## 11. How do I check whether it is working?

Open http://localhost:3000 after `pnpm start`. You should see the Command
Center with your net worth, cash, portfolio, and liabilities tiles. Click
through the sidebar — every screen should load without an error page. If
you see a number, check it's plausible; if you see "Insufficient data" or
"Not recorded," that's the app being honest about missing data, not a
bug.

## 12. What should I do if something breaks?

1. Check `docs/LOCAL_DEPLOYMENT.md`'s Troubleshooting section first — it
   covers the common cases (missing Prisma client, database not
   initialized, port conflicts, AI/market-data unavailability).
2. If a screen shows a genuine error page rather than a graceful
   "insufficient data" message, restart the app (`Ctrl+C`, then
   `pnpm start` again).
3. If the database itself seems wrong, restore your most recent known-good
   backup (see #9) rather than trying to hand-edit `data/wealthforge.db`.
4. Nothing here modifies data outside `data/` — reinstalling
   `node_modules` (`rm -rf node_modules && pnpm install`) or rebuilding
   (`pnpm build`) is always safe and never touches your financial data.

## 13. What features are deferred?

- Analytics filters by instrument, data source/provider, or metric.
- Data Center's backup list has no pagination yet (it will just get long
  over time — nothing breaks).
- No support for Groww statements (no adapter exists; use manual
  CSV/XLSX import instead).
- No live brokerage API connection, no packaged desktop app, no support
  for splitting one liability's EMI across more than two payers.

None of these block normal use. Full detail:
`docs/RELEASE_NOTES_v1.0.0.md`.

## 14. What must never be deleted?

- `data/wealthforge.db` — this is your actual financial data. Deleting it
  with no backup means losing everything the app knows.
- `data/backups/` — your safety net. Don't delete backups you might still
  need, and don't delete the whole folder casually.
- `.env` — your local configuration (though it can be recreated from
  `.env.example` if lost, since none of its defaults are secret).

Everything else (`node_modules/`, `.next/`, build output) can be deleted
and regenerated at any time with no data loss.

## 15. How do I safely move the application to another laptop?

1. On the old laptop: `pnpm backup:export` (belt-and-suspenders on top of
   automatic backups), then copy the entire `data/` folder somewhere safe
   (external drive, personal cloud storage) — not just the backups, the
   live `wealthforge.db` too.
2. On the new laptop: clone the repository and follow steps 3–5 above
   (install, environment, initialize) up through `npx prisma migrate
   deploy`, but **before starting the app for real use**, copy your saved
   `data/` folder's contents over the freshly created one (so your real
   `wealthforge.db` replaces the empty one the migration step made).
3. Start the app and confirm the Command Center shows your real data, not
   an empty dashboard.

## First-run workflow

If this is your very first time running the app with your own data (not
the demo data), follow this order — see `docs/LOCAL_DEPLOYMENT.md` for the
exact commands for each step:

1. Clone the repository.
2. Install dependencies.
3. Initialize the local database.
4. Start the application.
5. Confirm the Command Center loads (it will be empty — that's expected).
6. Create an initial backup (`pnpm backup:export`) — a clean baseline.
7. Import your budget workbook via the Data Center screen.
8. Review the Import Audit it produces — check it read your sheets
   correctly.
9. Import your portfolio data (CSV or XLSX) via the same screen.
10. Review the Portfolio screen.
11. Review Goals.
12. Review Liabilities.
13. Review Insurance.
14. Review Analytics.
15. Review Market.
16. Go back to Command Center and check the top-level numbers make sense.
17. Create another backup — now you have a baseline with your real data.
18. Begin normal use.

**Before relying on any report, verify your first imported data against
your own known financial records** — check net worth, cash balance, and a
couple of individual holdings match what you expect. The app is only as
correct as what you feed it, and this one-time check catches an import
misread (wrong column, wrong sheet) before it compounds into every later
figure.
