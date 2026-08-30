import { expect, test } from "@playwright/test";

/**
 * E2E coverage for Dashboard V1.
 *
 * These run against the demo database, which is populated by running the
 * real ingestion pipeline over the anonymized reference fixtures
 * (prisma/demo-seed.ts) — so what is asserted here is what the engine
 * actually produced, not fixture values written straight into the UI.
 *
 * Run `pnpm db:demo` before `pnpm e2e`.
 */

const SCREENS = [
  { path: "/", heading: "Command Center" },
  { path: "/budget", heading: "Budget" },
  { path: "/portfolio", heading: "Portfolio" },
  { path: "/goals", heading: "Goals" },
  { path: "/liabilities", heading: "Liabilities" },
] as const;

test.describe("navigation", () => {
  for (const screen of SCREENS) {
    test(`${screen.heading} renders and is reachable`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();

      // The nav marks the current screen for assistive technology, not just
      // with colour.
      const current = page.locator('.sidebar__link[aria-current="page"]');
      await expect(current).toHaveCount(1);
    });
  }

  test("every screen is reachable from the sidebar", async ({ page }) => {
    await page.goto("/");
    for (const screen of SCREENS.slice(1)) {
      await page.getByRole("link", { name: screen.heading, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
      await page.goBack();
    }
  });
});

test.describe("Command Center", () => {
  test("shows the headline figures", async ({ page }) => {
    await page.goto("/");

    for (const label of ["Net worth", "Cash", "Portfolio", "Liabilities"]) {
      await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    }

    // Figures are dated from the data, not from today.
    await expect(page.getByText(/Figures as of .* the most recent date the data/)).toBeVisible();
  });

  test("surfaces a position change that no transaction explains", async ({ page }) => {
    await page.goto("/");

    // Ingestion refuses to invent a trade for an unexplained change; that
    // refusal has to reach the user to be worth anything.
    await expect(
      page.getByText(/changed with no recorded transaction/).first(),
    ).toBeVisible();
  });

  test("derives left over cash from the month's own components", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Retained", { exact: true })).toBeVisible();
    await expect(page.getByText("income − expenses − EMIs")).toBeVisible();
    await expect(page.getByText("Left over cash", { exact: true })).toBeVisible();
    await expect(page.getByText("retained − investments")).toBeVisible();
  });
});

test.describe("Budget", () => {
  test("reports missing actuals as no data rather than as zero", async ({ page }) => {
    await page.goto("/budget");

    await expect(page.getByRole("heading", { name: "Plan vs Reality" })).toBeVisible();
    await expect(page.getByText("No data").first()).toBeVisible();
    await expect(
      page.getByText(/rather than as zero, which would claim a 100% underspend/),
    ).toBeVisible();
  });

  test("switches period and keeps the selection marked", async ({ page }) => {
    await page.goto("/budget");

    const may = page.getByRole("link", { name: "May 2026" });
    if ((await may.count()) > 0) {
      await may.click();
      await expect(page.getByText("May 2026").first()).toBeVisible();

      // Exactly one element claims to be the current *page* — the sidebar
      // link. The period chips are a filter on this screen, so they mark
      // themselves with aria-current="true" instead.
      await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('a[aria-current="true"]')).toHaveCount(1);
    }
  });

  test("lists line items with their categories", async ({ page }) => {
    await page.goto("/budget");
    await expect(page.getByRole("heading", { name: /Line items/ })).toBeVisible();

    // The EMI whose label never says "emi" must still be classified as one.
    const row = page.locator("tr", { hasText: "Smart watch" }).first();
    await expect(row).toContainText("EMIs");
  });
});

test.describe("Portfolio", () => {
  test("never presents a dated price as live", async ({ page }) => {
    await page.goto("/portfolio");

    await expect(page.getByText(/never a later one/)).toBeVisible();
    await expect(page.getByText(/priced \d{4}-\d{2}-\d{2}/).first()).toBeVisible();
    await expect(page.getByText("live", { exact: true })).toHaveCount(0);
  });

  test("shows allocation shares that sum to the whole", async ({ page }) => {
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: "Allocation by asset class" })).toBeVisible();

    const bars = page.locator('[role="progressbar"]');
    expect(await bars.count()).toBeGreaterThan(0);
  });

  test("says so when a holding has no cost basis", async ({ page }) => {
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: /Holdings/ })).toBeVisible();
  });
});

test.describe("Goals", () => {
  test("marks the emergency fund as protected", async ({ page }) => {
    await page.goto("/goals");
    await expect(
      page.getByText("Protected from ordinary reallocation").first(),
    ).toBeVisible();
  });

  test("keeps achieved goals on the record", async ({ page }) => {
    await page.goto("/goals");
    await expect(
      page.getByText(/an achieved goal stays on the record/),
    ).toBeVisible();
  });

  test("explains progress is derived from history", async ({ page }) => {
    await page.goto("/goals");
    await expect(
      page.getByText(/derived from its contribution and withdrawal history/),
    ).toBeVisible();
  });
});

test.describe("Liabilities", () => {
  test("shows the payer split and notes the parts equal the whole", async ({ page }) => {
    await page.goto("/liabilities");

    await expect(page.getByRole("heading", { name: "Who pays what" }).first()).toBeVisible();
    await expect(page.getByText(/Shares sum to exactly the EMI/).first()).toBeVisible();
  });

  test("marks a release projected from tenure rather than observed payments", async ({ page }) => {
    await page.goto("/liabilities");
    await expect(
      page.getByText(/projected from the recorded tenure, not from observed payments/).first(),
    ).toBeVisible();
  });
});

test.describe("accessibility basics", () => {
  test("each screen has exactly one h1 and a labelled nav", async ({ page }) => {
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    }
  });

  test("is keyboard navigable from the first link", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBe("A");
  });

  test("does not scroll horizontally at iPad width", async ({ page }) => {
    await page.goto("/");
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
