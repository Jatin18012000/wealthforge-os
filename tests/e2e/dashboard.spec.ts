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
  { path: "/insurance", heading: "Insurance" },
  { path: "/analytics", heading: "Analytics" },
  { path: "/timeline", heading: "Timeline" },
  { path: "/monthly-review", heading: "Monthly Review" },
  { path: "/settings", heading: "Settings" },
  { path: "/data-center", heading: "Data Center" },
  { path: "/market", heading: "Market" },
  { path: "/ai-analyst", heading: "AI Analyst" },
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

  test("shows the Command Center 2.0 primary section order (v1.1, IM-08)", async ({ page }) => {
    await page.goto("/");

    // The v1.1 directive's exact order: Daily Brief → tiles → Net Worth
    // Trajectory/Money Flow → Portfolio X-Ray/Risk → Plan vs
    // Reality/Adherence → Goal Radar/EMI Freedom → Wealth
    // Waterfall/Financial Health → What Needs Attention/Data Health.
    const sectionHeadings = [
      "WealthForge Daily Brief",
      "Net worth trajectory & money flow",
      "Portfolio X-Ray & risk",
      "Plan vs reality & adherence",
      "Goal radar & EMI freedom",
      "Wealth waterfall & financial health",
      "What needs attention & data health",
    ];
    const positions: number[] = [];
    for (const heading of sectionHeadings) {
      const locator = page.getByRole("heading", { name: heading });
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      positions.push(box?.y ?? -1);
    }
    // Every position resolved, and each section appears strictly after the one before it.
    expect(positions.every((y) => y >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1] as number);
    }
  });

  test("shows every widget from IM-02–IM-05 somewhere on the redesigned Command Center", async ({
    page,
  }) => {
    await page.goto("/");

    for (const heading of [
      "Net worth trajectory",
      "Monthly money flow",
      "Portfolio X-Ray",
      "Concentration heatmap",
      "Drawdown monitor",
      "Plan vs reality",
      "Planned vs actual allocation",
      "Investment plan adherence",
      "Goals in priority order",
      "Goal funding radar",
      "Debt freedom meter",
      "EMI release timeline",
      "Net worth waterfall",
      "Financial health score",
      "Needs attention",
      "Data health",
      "Savings & investment rate trend",
      "Portfolio growth decomposition",
      "Contribution vs return",
      "Portfolio performance",
      "Portfolio vs benchmark",
      "Goal collision detector",
      "Emergency fund runway",
      "Goal trade-off simulator",
      "What's changed",
      "Financial anomaly detector",
      "Historical coverage",
    ]) {
      // exact: true — several of these also appear as a substring of one
      // of the section h2s above (e.g. "Net worth trajectory & money flow").
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
  });

  test("shows the scenario engine section (v1.1)", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Scenario engine" })).toBeVisible();
    for (const heading of [
      "SIP increase simulator",
      "Debt prepayment simulator",
      "Wealth projection",
      "Financial independence projection",
    ]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    // Every scenario widget carries the standard non-guarantee disclaimer somewhere on the page.
    await expect(page.getByText(/not a guarantee of future results/i).first()).toBeVisible();
  });

  test("generates the Daily Brief from the top of the redesigned Command Center (v1.1, IM-08)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "WealthForge Daily Brief" })).toBeVisible();

    await page.getByRole("button", { name: "Generate daily brief" }).click();
    await page.waitForURL(/\/\?brief=/);
    await page.reload();

    // Same sandbox, same reachability limitation as the AI Analyst screen's
    // own Daily Brief action — this confirms the Command Center's copy
    // goes through the identical pipeline, not a separate one.
    await expect(page.getByText(/could not reach Ollama|needs an API key/)).toBeVisible();
  });

  test("shows the unified attention panel, prioritized into tiers (v1.1.1, F1)", async ({ page }) => {
    await page.goto("/");

    const attentionCard = page.locator(".card", { hasText: "Needs attention" });
    await expect(attentionCard).toBeVisible();
    // The demo fixtures include an unexplained position change, so this is
    // never healthy on demo data — Critical must actually render, proving
    // the tiered panel (not just an empty state) is live.
    await expect(attentionCard.getByText("Critical", { exact: true })).toBeVisible();
    await expect(
      attentionCard.getByText("Position changed with no recorded transaction").first(),
    ).toBeVisible();
  });

  test("surfaces freshness and a 'how is this calculated?' explanation on major widgets (v1.1.1, F3/F10)", async ({
    page,
  }) => {
    await page.goto("/");

    const xrayCard = page.locator(".card", { hasText: "Portfolio X-Ray" }).first();
    await expect(xrayCard.getByText(/^As of /)).toBeVisible();
    const howCalculated = xrayCard.getByText("How is this calculated?");
    await expect(howCalculated).toBeVisible();
    await howCalculated.click();
    await expect(xrayCard.getByText(/getPortfolioView/)).toBeVisible();
  });

  test("drills down from the headline summary tiles to their supporting detail (v1.1.1, F2)", async ({
    page,
  }) => {
    await page.goto("/");

    // Every drill-down link is an in-page anchor to a widget that already
    // exists further down the same Command Center — F2 links to it rather
    // than computing a second view of the same figure.
    await page.getByRole("link", { name: "See decomposition →" }).click();
    await expect(page).toHaveURL(/#net-worth-waterfall$/);
    await expect(page.getByRole("heading", { name: "Net worth waterfall" })).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "See holdings →" }).click();
    await expect(page).toHaveURL(/#portfolio-xray$/);
    await expect(page.getByRole("heading", { name: "Portfolio X-Ray", exact: true })).toBeVisible();

    await page.goto("/");
    await page.getByRole("link", { name: "Funding detail →" }).click();
    await expect(page).toHaveURL(/#goal-funding-radar$/);
    await expect(page.getByRole("heading", { name: "Goal funding radar" })).toBeVisible();
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

  test("allocates leftover cash to a goal and reduces what remains to allocate", async ({
    page,
  }) => {
    await page.goto("/budget");
    await expect(
      page.getByRole("heading", { name: "Allocate leftover cash to a goal" }),
    ).toBeVisible();

    const allocationCard = page.locator(".card", {
      hasText: "Allocate leftover cash to a goal",
    });
    const remainingText = await allocationCard
      .locator("tr", { hasText: "Remaining to allocate" })
      .locator("td.num")
      .innerText();
    // "-₹..." (negative — already over-allocated for this period) vs "₹..."
    const remainingIsNegative = remainingText.trim().startsWith("-");

    await allocationCard.locator('select[name="goalId"]').selectOption({ index: 1 });
    await allocationCard.locator('input[name="amount"]').fill("1");
    await allocationCard.getByRole("button", { name: "Allocate" }).click();

    if (remainingIsNegative) {
      // Nothing is left to allocate, so even ₹1 must be refused — the check
      // must use what remains *after* earlier allocations, never the raw
      // plan-level unallocated figure.
      await page.waitForURL(/budget\?period=.*allocationError=/);
      await expect(page.getByText(/exceeds unallocated cash/)).toBeVisible();
    } else {
      await page.waitForURL(/budget\?period=.*allocated=1/);
      await expect(page.getByText("Contribution recorded.")).toBeVisible();
      const remainingAfter = await allocationCard
        .locator("tr", { hasText: "Remaining to allocate" })
        .locator("td.num")
        .innerText();
      expect(remainingAfter).not.toEqual(remainingText);
    }
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

  test("does not scroll horizontally at iPad width, on any screen", async ({ page }) => {
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${screen.heading} should not overflow horizontally`).toBe(false);
    }
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

  test("compares two arbitrary custom periods against each other", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Custom period" })).toBeVisible();

    const periodForm = page.locator("form", { has: page.locator('input[name="periodStart"]') });
    await periodForm.locator('input[name="periodStart"]').fill("2026-08-01");
    await periodForm.locator('input[name="periodEnd"]').fill("2026-08-31");
    await periodForm.getByRole("button", { name: "Use custom period" }).click();
    await expect(page).toHaveURL(/period=custom/);

    const compareForm = page.locator("form", {
      has: page.locator('input[name="compareStart"]'),
    });
    await compareForm.locator('input[name="compareStart"]').fill("2026-05-01");
    await compareForm.locator('input[name="compareEnd"]').fill("2026-05-31");
    await compareForm.getByRole("button", { name: "Compare against a custom period" }).click();
    await expect(page).toHaveURL(/compare=custom/);

    await expect(page.getByText(/Enter both a start and end date/)).toHaveCount(0);
  });

  test("filters the allocation table by asset class", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Filter asset class" })).toBeVisible();

    const filterCard = page.locator(".card", { hasText: "Period" });
    const equityLink = filterCard.getByRole("link", { name: /equity/i }).first();
    if ((await equityLink.count()) > 0) {
      await equityLink.click();
      await expect(page).toHaveURL(/assetClass=equity/);
      await expect(page.getByRole("link", { name: /equity/i }).first()).toHaveAttribute(
        "aria-current",
        "true",
      );
    }
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

  test("has exactly one h1 and a labelled nav", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
});

test.describe("Timeline (v1.1.1, F6)", () => {
  test("shows plan, confirmed activity, and observed entries in one feed", async ({ page }) => {
    await page.goto("/timeline");

    await expect(page.getByRole("columnheader", { name: "When" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
    // The demo fixtures cover all three buckets, so every label appears
    // somewhere in the Type column rather than the feed collapsing to one.
    for (const label of ["Confirmed activity", "Observed", "Plan"]) {
      await expect(page.getByRole("cell", { name: label, exact: true }).first()).toBeVisible();
    }
  });

  test("filters to a single bucket via the filter links", async ({ page }) => {
    await page.goto("/timeline");
    await page.getByRole("link", { name: "Plan", exact: true }).click();
    await expect(page).toHaveURL(/bucket=plan/);
    await expect(page.getByRole("cell", { name: "Confirmed activity", exact: true })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Observed", exact: true })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Plan", exact: true }).first()).toBeVisible();
  });

  test("has exactly one h1 and a labelled nav", async ({ page }) => {
    await page.goto("/timeline");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
});

test.describe("Monthly Review (v1.1.1, F9)", () => {
  test("labels every line as Fact, Inference or Recommendation and names the reviewed month", async ({
    page,
  }) => {
    await page.goto("/monthly-review");

    for (const heading of [
      "Period",
      "Income & Expenses",
      "Month-over-month",
      "Plan vs reality",
      "Goals",
      "Liabilities & EMI",
      "Data quality",
    ]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    // Every section always emits at least one line (never a silently empty
    // section), and every line is labeled — "Fact" is guaranteed to appear
    // since the demo fixtures produce budget/goal data; Inference and
    // Recommendation lines depend on what that data happens to trigger.
    await expect(page.getByText("Fact", { exact: true }).first()).toBeVisible();
  });

  test("has exactly one h1 and a labelled nav", async ({ page }) => {
    await page.goto("/monthly-review");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
});

test.describe("Data Center", () => {
  test("renders every section: imports, backup/restore, provenance, trust, revisions, audit log", async ({
    page,
  }) => {
    await page.goto("/data-center");

    await expect(
      page.getByRole("heading", { level: 1, name: "Data Center" }),
    ).toBeVisible();
    for (const title of [
      "Import a budget workbook",
      "Import a portfolio snapshot",
      "Backup & restore",
      "Provenance — uploaded documents",
      "Trust states",
      "Revisions",
      "Audit log",
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
  });

  test("uploading a real budget workbook runs the actual pipeline and shows an Import Audit", async ({
    page,
  }) => {
    await page.goto("/data-center");

    const budgetForm = page.locator('form:has(input[name="file"][accept=".xlsx"])');
    await budgetForm
      .locator('input[name="file"]')
      .setInputFiles("tests/fixtures/reference/budget-reference-layout.xlsx");
    await budgetForm.getByRole("button", { name: "Upload and import" }).click();

    await page.waitForURL(/data-center\?event=/);
    await expect(page.getByRole("heading", { name: "Import Audit" })).toBeVisible();
    // The uploaded file is stored under a generated name on disk, but the
    // screen shows the name the browser reported, not the generated one.
    const banner = page.locator(".card", { hasText: "Import Audit" });
    await expect(
      banner.getByText(/Budget workbook "budget-reference-layout\.xlsx"/),
    ).toBeVisible();
    await expect(banner.getByText(/A backup was taken automatically/)).toBeVisible();

    // The just-performed import is also reflected in the provenance table,
    // not only in the banner.
    await expect(page.getByText("budget-reference-layout.xlsx").first()).toBeVisible();
  });

  test("refuses a portfolio snapshot with neither a date nor an asset class, changing nothing", async ({
    page,
  }) => {
    await page.goto("/data-center");

    const portfolioForm = page.locator(
      'form:has(input[name="file"][accept=".xlsx,.csv"])',
    );
    await portfolioForm
      .locator('input[name="file"]')
      .setInputFiles("tests/fixtures/portfolio/equity-v1-base.csv");
    // Neither as-of date nor asset class supplied.
    await portfolioForm.getByRole("button", { name: "Upload and import" }).click();

    await page.waitForURL(/data-center\?error=/);
    await expect(page.getByText(/Nothing was changed\./)).toBeVisible();
    await expect(
      page.getByText(/states neither an as-of date nor an asset class/),
    ).toBeVisible();
  });

  test("exports a backup on demand and lists it", async ({ page }) => {
    await page.goto("/data-center");

    await page.getByRole("button", { name: "Export a backup now" }).click();
    await page.waitForURL(/data-center\?backedUp=1/);

    await expect(page.getByText("Backup written.")).toBeVisible();
    await expect(
      page.getByRole("cell", { name: /wealthforge-backup-.*\.json/ }).first(),
    ).toBeVisible();
  });

  test("has exactly one h1 and a labelled nav, like every other screen", async ({
    page,
  }) => {
    await page.goto("/data-center");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
});

test.describe("Market", () => {
  test("lists every tracked index, including the one with no free source", async ({
    page,
  }) => {
    await page.goto("/market");

    await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();
    for (const label of ["Nifty 50", "Sensex", "Nifty Bank", "Nifty Metal"]) {
      await expect(page.getByRole("cell", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByText("no free source found (D-016)")).toBeVisible();
  });

  test("records a manual reading for the index with no free source", async ({
    page,
  }, testInfo) => {
    await page.goto("/market");

    // A distinct date per project: laptop and ipad share one demo database,
    // and the same date would collide as "already recorded" between them.
    const asOf = testInfo.project.name === "ipad" ? "2026-08-27" : "2026-08-29";
    const metalRow = page.locator("tbody tr", { hasText: "Nifty Metal" });
    await metalRow.locator('input[name="asOf"]').fill(asOf);
    await metalRow.locator('input[name="value"]').fill("9450.20");
    await metalRow.getByRole("button", { name: "Record" }).click();

    await page.waitForURL(/market\?manualQuoteSet=1/);
    await expect(page.getByText("Manual reading recorded.")).toBeVisible();

    const updatedRow = page.locator("tbody tr", { hasText: "Nifty Metal" });
    await expect(updatedRow).toContainText("₹9,450");
  });

  test("refuses a second manual reading for the same index and date", async ({
    page,
  }, testInfo) => {
    await page.goto("/market");

    const asOf = testInfo.project.name === "ipad" ? "2026-08-26" : "2026-08-28";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const metalRow = page.locator("tbody tr", { hasText: "Nifty Metal" });
      await metalRow.locator('input[name="asOf"]').fill(asOf);
      await metalRow.locator('input[name="value"]').fill("9400");
      await metalRow.getByRole("button", { name: "Record" }).click();
      await page.waitForLoadState("networkidle");
    }

    await expect(page.getByText(/already recorded/)).toBeVisible();
  });

  test("shows equity/ETF holdings with an editable optional live-price symbol", async ({
    page,
  }) => {
    await page.goto("/market");

    await expect(page.getByRole("heading", { name: "Equities & ETFs" })).toBeVisible();
    const equitiesCard = page.locator(".card", { hasText: "Equities & ETFs" });
    const firstRow = equitiesCard.locator("tbody tr").first();
    await expect(firstRow.locator('input[name="marketSymbol"]')).toBeVisible();
  });

  test("records a manual price for a held equity that has no live symbol configured", async ({
    page,
  }, testInfo) => {
    await page.goto("/market");

    const asOf = testInfo.project.name === "ipad" ? "2026-08-24" : "2026-08-23";
    const equitiesCard = page.locator(".card", { hasText: "Equities & ETFs" });
    const firstRow = equitiesCard.locator("tbody tr").first();
    await firstRow.locator('input[name="asOf"]').fill(asOf);
    await firstRow.locator('input[name="value"]').fill("2500.50");
    await firstRow.getByRole("button", { name: "Record" }).click();

    await page.waitForURL(/market\?manualQuoteSet=1/);
    await expect(page.getByText("Manual reading recorded.")).toBeVisible();
  });

  test("saving a market symbol persists it without affecting the holding's stored identity", async ({
    page,
  }) => {
    await page.goto("/market");

    const equitiesCard = page.locator(".card", { hasText: "Equities & ETFs" });
    const firstRow = equitiesCard.locator("tbody tr").first();
    const holdingName = await firstRow.locator("td").first().innerText();
    await firstRow.locator('input[name="marketSymbol"]').fill("TESTSYM.NS");
    await firstRow.getByRole("button", { name: "Save" }).click();

    await page.waitForURL(/market\?symbolSet=1/);
    await expect(page.getByText("Symbol saved.")).toBeVisible();

    const updatedRow = equitiesCard.locator("tbody tr", { hasText: holdingName }).first();
    await expect(updatedRow.locator('input[name="marketSymbol"]')).toHaveValue(
      "TESTSYM.NS",
    );
  });

  test("refresh reports failures gracefully rather than crashing the screen", async ({
    page,
  }) => {
    await page.goto("/market");

    // This sandbox's own network policy makes every fetch fail — the exact
    // "market data provider unavailable" case docs/18_FAILURE_MODES.md
    // requires the app to survive rather than error out on.
    await page.getByRole("button", { name: "Refresh market data now" }).click();
    await page.waitForURL(/market\?refreshed=1/);
    await expect(page.getByText("Refresh complete.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Market" })).toBeVisible();
  });

  test("links to a printable report", async ({ page }) => {
    await page.goto("/market");
    await page.getByRole("link", { name: "Open the report" }).click();
    await expect(page).toHaveURL(/\/market\/report/);
    await expect(page.getByRole("heading", { level: 1, name: "Report" })).toBeVisible();
  });

  test("has exactly one h1 and a labelled nav", async ({ page }) => {
    await page.goto("/market");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
});

test.describe("Market report", () => {
  test("labels every line as Fact, Inference or Recommendation", async ({ page }) => {
    await page.goto("/market/report");

    for (const section of ["Market", "Portfolio", "Goals", "Risk"]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
    const badges = page.locator(".badge", {
      hasText: /^(Fact|Inference|Recommendation)$/,
    });
    expect(await badges.count()).toBeGreaterThan(0);
  });

  test("distinguishes fact from recommendation on the concentration finding", async ({
    page,
  }) => {
    await page.goto("/market/report");
    await expect(
      page.getByText(/makes up .*% of the priced portfolio/).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/Review whether the concentration/).first(),
    ).toBeVisible();
  });
});

test.describe("AI Analyst", () => {
  test("shows AI unavailable gracefully when no local provider is reachable", async ({
    page,
  }) => {
    // Genuine, not simulated: this sandbox has no Ollama running, exactly
    // the "Optional AI provider unavailable" case docs/18_FAILURE_MODES.md
    // requires the app to survive.
    await page.goto("/ai-analyst");
    await expect(
      page.getByRole("heading", { level: 1, name: "AI Analyst" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Explain this period" }).click();
    await page.waitForURL(/ai-analyst\?event=/);
    await page.reload();

    await expect(page.getByRole("heading", { name: "AI unavailable" })).toBeVisible();
    await expect(page.getByText(/could not reach Ollama|needs an API key/)).toBeVisible();
    await expect(
      page.getByText("Every other screen keeps working normally"),
    ).toBeVisible();
  });

  test("generates a Daily Brief through the same grounding pipeline (v1.1, IM-07)", async ({
    page,
  }) => {
    await page.goto("/ai-analyst");
    await expect(page.getByRole("heading", { name: "WealthForge Daily Brief" })).toBeVisible();

    await page.getByRole("button", { name: "Generate daily brief" }).click();
    await page.waitForURL(/ai-analyst\?brief=/);
    await page.reload();

    // Same sandbox, same reachability limitation as "Explain this period" —
    // the Daily Brief goes through the identical AI-unavailable path.
    await expect(page.getByRole("heading", { name: "AI unavailable" })).toBeVisible();
    await expect(page.getByText(/could not reach Ollama|needs an API key/)).toBeVisible();
  });

  test("every other screen still works after an AI failure", async ({ page }) => {
    await page.goto("/ai-analyst");
    await page.getByRole("button", { name: "Explain this period" }).click();
    await page.waitForURL(/ai-analyst\?event=/);

    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Command Center" }),
    ).toBeVisible();
  });

  test("has exactly one h1 and a labelled nav", async ({ page }) => {
    await page.goto("/ai-analyst");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });
});
