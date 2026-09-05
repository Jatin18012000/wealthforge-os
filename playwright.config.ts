import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E configuration.
 *
 * `executablePath` points at the Chromium already present in this
 * environment rather than downloading one — the pinned Playwright version
 * and the installed browser build differ, and re-downloading on every run
 * is both slow and unnecessary. Override with PLAYWRIGHT_CHROMIUM_PATH.
 */
const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const PORT = Number(process.env.E2E_PORT ?? 3311);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Minimal KEY=value parser — .env.test only ever needs one line, so this
 * avoids taking on a full dotenv dependency for it.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf8");
  const result: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Database isolation: `pnpm e2e` must never touch data/wealthforge.db, the
 * account owner's real local database. `.env.test` — never the app's own
 * `.env` — is loaded here explicitly, refused if it looks like the real
 * database, and pushed onto the spawned webServer's env explicitly (so
 * Next.js's own `.env` loading, which only fills in variables not already
 * set, cannot override it).
 *
 * Migrating and seeding happen as the first two steps of `webServer.command`
 * itself, not in Playwright's `globalSetup` — Playwright starts `webServer`
 * before running `globalSetup`, so a migration there would race the app
 * server already accepting connections against the unmigrated database.
 * Chaining them into one shell command guarantees the app only starts once
 * its database is ready.
 */
const ENV_TEST_PATH = path.resolve(__dirname, ".env.test");
const testEnv = parseEnvFile(ENV_TEST_PATH);
const TEST_DATABASE_URL = testEnv.DATABASE_URL;

if (TEST_DATABASE_URL === undefined || TEST_DATABASE_URL.trim() === "") {
  throw new Error(`${ENV_TEST_PATH} must define DATABASE_URL.`);
}
if (TEST_DATABASE_URL.includes("wealthforge.db")) {
  throw new Error(
    `${ENV_TEST_PATH}'s DATABASE_URL must not point at data/wealthforge.db — that is the real database. E2E requires its own, isolated database file.`,
  );
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

const webServerEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) webServerEnv[key] = value;
}
webServerEnv.DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    launchOptions: { executablePath: CHROMIUM_PATH },
  },

  projects: [
    {
      name: "laptop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The iPad is the documented secondary device
      // (docs/15_DEPLOYMENT_ARCHITECTURE.md), so the layout is verified at
      // its width rather than assumed to work.
      name: "ipad",
      use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } },
    },
  ],

  webServer: {
    // Migrate and seed the isolated E2E database first, idempotently
    // (`prisma migrate deploy` no-ops on an already-migrated database;
    // prisma/demo-seed.ts dedupes its own imports by content hash) — so
    // the app is only started once its database is actually ready, on
    // every `pnpm e2e` invocation, not just the first.
    command: `pnpm exec prisma migrate deploy && pnpm exec tsx prisma/demo-seed.ts && pnpm build && PORT=${PORT} pnpm start`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
    env: webServerEnv,
  },
});
