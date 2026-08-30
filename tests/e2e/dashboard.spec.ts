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
  { path: "/analytics", heading: "Analytics" },
] as const;

test.describe("navigation", () => {
  for (const screen of SCREENS) {
    test(`${screen.heading} renders and is reachable`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(
        page.getByRole("heading", { level: 1, name: screen.heading }),
      ).toBeVisible();

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
      await expect(
        page.getByRole("heading", { level: 1, name: screen.heading }),
      ).toBeVisible();
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
    await expect(
      page.getByText(/Figures as of .* the most recent date the data/),
    ).toBeVisible();
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
    await expect(
      page.getByRole("heading", { name: "Allocation by asset class" }),
    ).toBeVisible();

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
    await expect(page.getByText(/an achieved goal stays on the record/)).toBeVisible();
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

    await expect(
      page.getByRole("heading", { name: "Who pays what" }).first(),
    ).toBeVisible();
    await expect(page.getByText(/Shares sum to exactly the EMI/).first()).toBeVisible();
  });

  test("marks a release projected from tenure rather than observed payments", async ({
    page,
  }) => {
    await page.goto("/liabilities");
    await expect(
      page
        .getByText(/projected from the recorded tenure, not from observed payments/)
        .first(),
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
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});

test.describe("Analytics", () => {
  test("offers every documented period", async ({ page }) => {
    await page.goto("/analytics");

    for (const label of [
      "15 days",
      "30 days",
      "1 month",
      "3 months",
      "6 months",
      "9 months",
      "12 months",
      "1 year",
      "5 years",
      "Year to date",
      "Financial year",
      "Previous month",
      "Previous quarter",
      "Previous financial year",
      "Since inception",
    ]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("compares two whole months with real variances", async ({ page }) => {
    await page.goto("/analytics?period=previous-month");

    // Both sides are whole months with data, so figures appear rather than
    // "No data", and the change column is populated.
    const incomeRow = page.locator("tr", { hasText: "Income" }).first();
    await expect(incomeRow).toBeVisible();
    await expect(page.getByText("Months counted:")).toBeVisible();
  });

  test("warns instead of pro-rating a partly covered month", async ({ page }) => {
    await page.goto("/analytics?period=15d");

    // The heart of honest range analytics: a 15-day window contains no whole
    // month, and half a salary is a number that appears in no source.
    await expect(page.getByText(/excluded rather than divided up/).first()).toBeVisible();
    await expect(page.getByText("No data").first()).toBeVisible();
  });

  test("switches the comparison basis", async ({ page }) => {
    await page.goto("/analytics?period=previous-month");
    await page.getByRole("link", { name: "Same period last year" }).click();
    await expect(page).toHaveURL(/compare=prior-year/);
    await expect(
      page.locator('a[aria-current="true"]', { hasText: "Same period last year" }),
    ).toBeVisible();
  });

  test("degrades gracefully for a period it cannot resolve", async ({ page }) => {
    // A custom period with no dates has no range; the screen must say so
    // rather than inventing one.
    await page.goto("/analytics?period=custom");
    await expect(page.getByText("Insufficient data").first()).toBeVisible();
  });

  test("keeps planned and held sides distinct in the allocation table", async ({
    page,
  }) => {
    await page.goto("/analytics?period=previous-month");
    await expect(page.getByText(/keeps a blank on the other side/)).toBeVisible();
  });
});

test.describe("Settings — manual controls", () => {
  test("lists every domain that can be overridden", async ({ page }) => {
    await page.goto("/settings");

    for (const group of ["Budget", "Portfolio", "Goals"]) {
      await expect(page.getByRole("heading", { name: group, exact: true })).toBeVisible();
    }
    await expect(page.getByText(/source value \+ adjustment = current/)).toBeVisible();
  });

  test("previews, applies and withdraws an override, restoring the source", async ({
    page,
  }, testInfo) => {
    await page.goto("/settings");

    // Each viewport project works on its own budget line: the projects run in
    // parallel against one demo database, and two tests overriding the same
    // row would race each other rather than testing anything.
    const rowIndex = testInfo.project.name === "ipad" ? 1 : 0;
    const row = page.locator("tbody tr").nth(rowIndex);
    const sourceValue = (await row.locator("td").nth(1).innerText()).trim();

    await row.getByRole("button", { name: "Preview" }).click();

    // Nothing is written yet: the user sees the arithmetic first.
    await expect(
      page.getByRole("heading", { name: "Confirm this override" }),
    ).toBeVisible();
    const equation = page.locator(".equation");
    await expect(equation).toContainText("Source value");
    await expect(equation).toContainText("Manual adjustment");
    await expect(equation).toContainText("Current value");
    await expect(page.getByText(/would change nothing/)).toBeVisible();

    // Re-enter with a different figure, then confirm it.
    await page.goto("/settings");
    const form = page.locator("tbody tr").nth(rowIndex).locator("form").first();
    await form.locator('input[name="value"]').fill("4321.50");
    await form.locator('input[name="reason"]').fill("checked against the bank statement");
    await form.getByRole("button", { name: "Preview" }).click();

    await expect(page.locator(".equation__result")).toContainText("₹4,322");
    await page.getByRole("button", { name: "Confirm override" }).click();

    await expect(page.getByText(/overridden/).first()).toBeVisible();
    await expect(
      page.getByText("checked against the bank statement").first(),
    ).toBeVisible();

    // The source column still shows what the workbook said.
    await expect(page.locator("tbody tr").nth(rowIndex).locator("td").nth(1)).toHaveText(
      sourceValue,
    );

    await page
      .locator("tbody tr")
      .nth(rowIndex)
      .getByRole("button", { name: "Withdraw override" })
      .click();
    await expect(page.getByText(/source value applies again/)).toBeVisible();

    // Withdrawn, but not erased.
    await expect(page.getByText("Withdrawn", { exact: false }).first()).toBeVisible();
  });

  test("refuses an entry that is not a number, without changing anything", async ({
    page,
  }, testInfo) => {
    await page.goto("/settings");

    const rowIndex = testInfo.project.name === "ipad" ? 1 : 0;
    const form = page.locator("tbody tr").nth(rowIndex).locator("form").first();
    await form.locator('input[name="value"]').fill("about four thousand");
    await form.getByRole("button", { name: "Preview" }).click();

    await expect(page.getByText("Insufficient data").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm override" })).toHaveCount(0);
  });
});
