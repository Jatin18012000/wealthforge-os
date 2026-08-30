import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importBudgetWorkbook } from "../../src/ingestion";
import { getReport } from "../../src/views/reportView";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/reference");

describe("report generation", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeAll(async () => {
    await importBudgetWorkbook(db, path.join(FIXTURES, "budget-reference-layout.xlsx"), {
      defaultYear: 2026,
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("produces every section, each labeled fact/inference/recommendation", async () => {
    const report = await getReport(db);
    expect(report.sections.map((s) => s.title)).toEqual([
      "Market",
      "Portfolio",
      "Goals",
      "Risk",
    ]);

    for (const section of report.sections) {
      for (const line of section.lines) {
        expect(["fact", "inference", "recommendation"]).toContain(line.kind);
      }
    }
  });

  it("reports every tracked index as a fact, even with no data fetched", async () => {
    const report = await getReport(db);
    const market = report.sections.find((s) => s.title === "Market");
    expect(market?.lines.every((l) => l.kind === "fact")).toBe(true);
    expect(market?.lines.some((l) => l.text.includes("Nifty 50"))).toBe(true);
    expect(market?.lines.some((l) => l.text.includes("no free source"))).toBe(true);
  });

  it("states insufficient data for portfolio value rather than inventing a number, when there is no portfolio", async () => {
    const report = await getReport(db);
    const portfolio = report.sections.find((s) => s.title === "Portfolio");
    expect(portfolio?.lines[0]?.text).toContain("insufficient data");
  });

  it("says so when there are no risk alerts, rather than showing an empty section", async () => {
    const report = await getReport(db);
    const risk = report.sections.find((s) => s.title === "Risk");
    expect(risk?.lines.length).toBeGreaterThan(0);
  });

  it("carries the period and as-of date used to build it", async () => {
    const report = await getReport(db);
    expect(report.periodMonth).not.toBeNull();
    expect(report.generatedAt).toBeInstanceOf(Date);
  });
});
