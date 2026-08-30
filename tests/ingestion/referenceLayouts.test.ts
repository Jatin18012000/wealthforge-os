import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadEffectivePlanRecords } from "../../src/data/loaders";
import { expectOk, roundHalfToEven, summarizeMonth, sumMinorUnits } from "../../src/domain";
import { importBudgetWorkbook } from "../../src/ingestion";
import { importPortfolioSnapshot } from "../../src/ingestion/portfolio";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/reference");
const BUDGET = path.join(FIXTURES, "budget-reference-layout.xlsx");
const ZERODHA_AUG_03 = path.join(FIXTURES, "zerodha-holdings-2026-08-03.xlsx");
const ZERODHA_AUG_08 = path.join(FIXTURES, "zerodha-holdings-2026-08-08.xlsx");

/**
 * Proves the REAL budget workbook layout normalizes into the canonical model
 * (docs/REFERENCE_DOCUMENT_REGISTER.md, R-01).
 *
 * The fixture reproduces the reference workbook's structure exactly — banner
 * rows, a section header row, side-by-side label+amount column pairs whose
 * positions shift between sheets, formula-derived subtotals, and a separate
 * Investments block — with every amount anonymized.
 */
describe("reference budget workbook layout", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeEach(async () => {
    await db.revision.deleteMany();
    await db.planRecord.deleteMany();
    await db.sheetSnapshot.deleteMany();
    await db.sourceDocument.deleteMany();
    await db.auditEvent.deleteMany();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("extracts line items from the side-by-side income and expense blocks", async () => {
    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });

    // Labels are queried from the database rather than the domain input type:
    // the engine needs no labels to do arithmetic, so PlanRecordInput
    // deliberately does not carry them.
    const records = await db.planRecord.findMany({
      where: { periodMonth: "2026-08", supersededById: null },
    });
    const byLabel = new Map(records.map((r) => [r.labelNormalized, r]));

    expect(byLabel.get("salary")?.amountMinorUnits).toBe(65_000 * 100);
    expect(byLabel.get("salary")?.category).toBe("income");
    expect(byLabel.get("daily commute and exp")?.amountMinorUnits).toBe(10_000 * 100);
    expect(byLabel.get("daily commute and exp")?.category).toBe("expense");
    expect(byLabel.get("index fund a direct growth")?.category).toBe("investment");

    // Source labels are trimmed of incidental spreadsheet whitespace, so
    // "Mobile recharge " in one month and "Mobile recharge" in another are
    // one line's history rather than two. The untrimmed cell is still
    // retained verbatim in the sheet snapshot's raw JSON for provenance.
    expect(byLabel.get("mobile recharge")?.labelRaw).toBe("Mobile recharge");

    const snapshot = await db.sheetSnapshot.findFirstOrThrow({ where: { sheetName: "August" } });
    expect(snapshot.rawDataJson).toContain("Mobile recharge");
  });

  it("excludes formula-derived subtotals, which would otherwise double-count the month", async () => {
    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });
    const records = await db.planRecord.findMany({
      where: { periodMonth: "2026-08", supersededById: null },
    });

    // "total", the "Investment" availability figure, the investments SUM, and
    // "Left over cash" are all formulas restating rows above them.
    const labels = records.map((r) => r.labelNormalized);
    expect(labels).not.toContain("total");
    expect(labels).not.toContain("investment");
    expect(labels).not.toContain("left over cash for the month");

    // The decisive check: the sum of imported line items must equal the
    // workbook's own totals, not some inflated multiple of them.
    const income = sumMinorUnits(
      records.filter((r) => r.category === "income").map((r) => r.amountMinorUnits as number),
    );
    expect(income).toBe(67_250 * 100);
  });

  it("classifies EMIs inside the expenses column, including one whose label never says so", async () => {
    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });
    const records = await db.planRecord.findMany({
      where: { periodMonth: "2026-08", supersededById: null },
    });

    const emis = records.filter((r) => r.category === "emi").map((r) => r.labelNormalized);
    expect(emis).toContain("home emi");
    expect(emis).toContain("tablet emi");
    // "Smart watch" carries an EMI end date but no "emi" in its label — the
    // Apple-Watch shaped case. Missing it would understate EMI burden.
    expect(emis).toContain("smart watch");

    // Ordinary expenses stay expenses.
    const expenses = records.filter((r) => r.category === "expense").map((r) => r.labelNormalized);
    expect(expenses).toContain("card a");
    expect(expenses).toContain("daily commute and exp");
  });

  it("reproduces the workbook's own derived figures from imported line items", async () => {
    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });

    const records = await loadEffectivePlanRecords(db, "2026-08");
    const budget = expectOk(summarizeMonth(records, "2026-08"));

    // The workbook computes "Investment" available as =income total - expense
    // total. The engine's `retained` must reproduce it exactly.
    expect(budget.retainedMinorUnits).toBe(25_223 * 100);

    // Planned investments total the documented baseline.
    expect(budget.investmentMinorUnits).toBe(19_500 * 100);

    // And "Left over cash for the month" = available - invested.
    expect(budget.unallocatedMinorUnits).toBe((25_223 - 19_500) * 100);

    // EMI is separated from ordinary expense without changing the arithmetic:
    // the two still sum to the workbook's expense total.
    expect(budget.expenseMinorUnits + budget.emiMinorUnits).toBe(42_027 * 100);
    expect(budget.emiMinorUnits).toBe((10_000 + 2_900 + 3_600 + 2_999) * 100);
  });

  it("handles a sheet whose columns sit at different positions", async () => {
    await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });

    // May places its blocks two columns right of August's and has no
    // Frequency column. Positions are detected per sheet, never hardcoded.
    const may = await loadEffectivePlanRecords(db, "2026-05");
    expect(may.length).toBeGreaterThan(0);

    const budget = expectOk(summarizeMonth(may, "2026-05"));
    expect(budget.incomeMinorUnits).toBe((60_000 + 1_500 + 3_000) * 100);
    expect(budget.investmentMinorUnits).toBe(19_500 * 100);
  });

  it("flags carry-over income rather than silently counting it as earnings", async () => {
    const audit = await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });

    // "Previous month left" moves last month's leftover into this month's
    // income, which is ambiguous for a savings-rate denominator (D-012).
    expect(audit.sheetIssues.some((issue) => issue.includes("D-012"))).toBe(true);
  });

  it("is idempotent across two byte-different copies with identical content", async () => {
    const first = await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });
    expect(first.counts.new).toBeGreaterThan(0);

    // The two supplied copies of the real workbook had different SHA-256
    // hashes but byte-for-byte identical content — Excel rewrites metadata on
    // save. Content-based hashing must see no change; a byte-hash design
    // would have reported every sheet as modified.
    const second = await importBudgetWorkbook(db, BUDGET, { defaultYear: 2026 });
    expect(second.counts.unchanged).toBe(first.sheetsScanned);
    expect(second.recordsCreated).toBe(0);
  });
});

/**
 * Proves the REAL Zerodha holdings statement layout normalizes into the
 * canonical model (docs/REFERENCE_DOCUMENT_REGISTER.md, R-02).
 *
 * The fixture reproduces the statement's structure exactly — the preamble,
 * the empty column A, the header row buried around row 23, the summary
 * block, and the Combined sheet that restates the others — with anonymized
 * symbols and amounts.
 */
describe("reference Zerodha holdings layout", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  beforeEach(async () => {
    await db.revision.deleteMany();
    await db.positionSnapshot.deleteMany();
    await db.valuation.deleteMany();
    await db.activity.deleteMany();
    await db.instrument.deleteMany();
    await db.sourceDocument.deleteMany();
    await db.auditEvent.deleteMany();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("reads holdings past the preamble and blank leading column", async () => {
    const audit = await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});

    // Six holdings, from a header row at r23 with data starting at column B.
    expect(audit.rowsScanned).toBe(6);
    expect(audit.positionsCreated).toBe(6);
    expect(await db.instrument.count()).toBe(6);
  });

  it("takes the statement's own as-of date, so none need be supplied", async () => {
    const audit = await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});
    expect(audit.asOf.toISOString().slice(0, 10)).toBe("2026-08-03");
  });

  it("refuses to import when the supplied date contradicts the statement", async () => {
    // Silently trusting either would misdate every valuation built on this
    // snapshot, so the disagreement is fatal (D-011).
    await expect(
      importPortfolioSnapshot(db, ZERODHA_AUG_03, { asOf: new Date("2026-09-01T00:00:00Z") }),
    ).rejects.toThrow(/dated 2026-08-03 but 2026-09-01 was supplied/);

    expect(await db.positionSnapshot.count()).toBe(0);
  });

  it("skips the Combined sheet, which would double-count the whole portfolio", async () => {
    const audit = await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});

    // Equity has six holdings; Combined restates all six. Reading both would
    // report twelve positions and double every total.
    expect(audit.rowsScanned).toBe(6);
    expect(audit.issues.some((i) => i.includes("double-counting"))).toBe(true);
  });

  it("identifies instruments by ISIN, not by the mutable trading symbol", async () => {
    await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});

    // A trading symbol can be renamed when a company rebrands — one holding
    // in the real statements has — but its ISIN does not, so ISIN is the
    // identity that keeps an instrument's history intact.
    const gold = await db.instrument.findFirstOrThrow({ where: { identifier: "INF900A01011" } });
    expect(gold.displayName).toBe("GOLDETF-E");
  });

  it("derives asset class from the statement rather than requiring it", async () => {
    await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});

    const byIdentifier = new Map(
      (await db.instrument.findMany()).map((i) => [i.identifier as string, i.kind]),
    );

    // Sector "ETF" and an INF-prefixed ISIN both mark a fund; gold and silver
    // are split out so allocation can separate metals from equity ETFs.
    expect(byIdentifier.get("INF900A01011")).toBe("gold");
    expect(byIdentifier.get("INF900B01012")).toBe("silver");
    expect(byIdentifier.get("INF900C01013")).toBe("etf");
    expect(byIdentifier.get("INE111A01011")).toBe("equity");
  });

  it("records cost basis and a dated price from the statement's own columns", async () => {
    await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});

    const gold = await db.instrument.findFirstOrThrow({ where: { identifier: "INF900A01011" } });
    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: gold.id },
    });

    expect(position.quantity).toBe(90);
    // 90 units at an average of 102.3417 = ₹9,210.753 = 921,075 paise.
    // Rounding the 4-decimal average to whole paise first would give 921,060 —
    // 15 paise short here, and short by more on larger holdings.
    expect(position.costBasisMinorUnits).toBe(roundHalfToEven(90 * 102.3417 * 100));
    expect(position.costBasisMinorUnits).not.toBe(roundHalfToEven(102.3417 * 100) * 90);

    const valuation = await db.valuation.findFirstOrThrow({ where: { instrumentId: gold.id } });
    // Previous Closing Price, explicitly not a live quote.
    expect(valuation.priceMinorUnits).toBe(11_140);
  });

  it("reports the real observed position changes between two statements", async () => {
    await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});
    const audit = await importPortfolioSnapshot(db, ZERODHA_AUG_08, {});

    // The genuine movement seen between the reference statements: two ETF
    // positions grew with no transaction recorded in the system.
    const changed = audit.observedChanges.map((c) => c.instrumentLabel).sort();
    expect(changed).toEqual(["GOLDETF-E", "SILVERETF-E"]);

    const gold = audit.observedChanges.find((c) => c.instrumentLabel === "GOLDETF-E");
    expect(gold?.previousQuantity).toBe(90);
    expect(gold?.newQuantity).toBe(115);
    expect(gold?.reconciled).toBe(false);

    // Still no fabricated trade to explain the increase.
    expect(await db.activity.count({ where: { kind: "buy" } })).toBe(0);
  });

  it("reconciles line-item cost basis against the statement's own Invested Value", async () => {
    const audit = await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});

    // The statement prints its own Invested Value. Summing the imported cost
    // bases must reproduce it — this is the check that caught the rounding
    // bug where per-unit prices were truncated to paise before scaling.
    const positions = await db.positionSnapshot.findMany();
    const summed = positions.reduce((total, p) => total + (p.costBasisMinorUnits ?? 0), 0);

    const holdings: Array<{ qty: number; avg: number }> = [
      { qty: 3, avg: 612.4 },
      { qty: 11, avg: 1420.375 },
      { qty: 90, avg: 102.3417 },
      { qty: 120, avg: 210.8264 },
      { qty: 9, avg: 254.6182 },
      { qty: 130, avg: 131.5093 },
    ];
    // Uses the project's own rounding policy, not Math.round: the second
    // holding (11 x 1420.375) lands on an exact half-paise tie, where
    // half-to-even and half-up disagree by a paise.
    const expected = holdings.reduce(
      (total, h) => total + roundHalfToEven(h.qty * h.avg * 100),
      0,
    );

    expect(summed).toBe(expected);
    // And no reconciliation warning was raised against the statement total.
    expect(audit.issues.some((i) => i.includes("may not have been read"))).toBe(false);
  });

  it("is idempotent when the same statement is re-imported", async () => {
    await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});
    const repeat = await importPortfolioSnapshot(db, ZERODHA_AUG_03, {});

    expect(repeat.isRepeatUpload).toBe(true);
    expect(repeat.positionsUnchanged).toBe(6);
    expect(repeat.positionsCreated).toBe(0);
    expect(await db.positionSnapshot.count()).toBe(6);
  });
});
