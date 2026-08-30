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
    command: `pnpm build && PORT=${PORT} pnpm start`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
