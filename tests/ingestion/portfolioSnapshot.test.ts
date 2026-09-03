import { copyFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { expectOk, valuePortfolio } from "../../src/domain";
import { loadPositionsAsOf, loadValuations } from "../../src/data/loaders";
import {
  findGenericHoldingsAsOnDate,
  findHeaderRowIndex,
  importPortfolioSnapshot,
  parseCsv,
} from "../../src/ingestion/portfolio";
import { createTestDb } from "../setup/testDb";

const FIXTURES = path.resolve(__dirname, "../fixtures/portfolio");
const fixture = (name: string) => path.join(FIXTURES, name);

const AUG_31 = new Date("2026-08-31T00:00:00Z");
const SEP_30 = new Date("2026-09-30T00:00:00Z");
const EQUITY = { asOf: AUG_31, assetClass: "equity" as const };

describe("CSV parsing", () => {
  it("handles quoted fields, embedded commas, and escaped quotes", () => {
    const rows = parseCsv('a,b\n"x, y","he said ""hi"""\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
    ]);
  });

  it("handles CRLF line endings and a UTF-8 BOM", () => {
    const rows = parseCsv("﻿a,b\r\n1,2\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not emit a phantom row for a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });
});

describe("header row detection", () => {
  it("finds the header at row 0 when the file is already a plain table", () => {
    const grid = [
      ["Symbol", "Name", "Quantity", "LTP"],
      ["INFY", "Infosys Ltd", "50", "1520.40"],
    ];
    expect(findHeaderRowIndex(grid)).toBe(0);
  });

  it("finds the header past a multi-row personal-details and summary preamble", () => {
    const grid = [
      ["Personal Details"],
      ["Name", "Test Investor"],
      ["Mobile Number", "9999999999"],
      ["PAN", "ABCDE1234F"],
      [],
      ["HOLDING SUMMARY"],
      ["Total Invested Value", "375000.00"],
      [],
      ["HOLDINGS AS ON 2026-09-02"],
      ["Scheme Name", "AMC", "Category", "Folio No.", "Units", "Invested Value"],
      ["Parag Parikh Flexi Cap Fund", "PPFAS Mutual Fund", "Equity", "1234567/89", "1250.456", "85000.00"],
    ];
    expect(findHeaderRowIndex(grid)).toBe(9);
  });

  it("does not mistake a preamble label row for a header — both an identity AND a quantity column are required", () => {
    // "Name" alone (no quantity column on the same row) must not be
    // accepted as the header, or every downstream column mapping would be
    // built against a row that isn't actually one.
    const grid = [
      ["Name", "Test Investor"],
      ["HOLDING SUMMARY"],
      ["Total Invested Value", "375000.00"],
    ];
    expect(findHeaderRowIndex(grid)).toBeNull();
  });

  it("returns null (never guesses) when no recognizable header exists within the search bound", () => {
    const grid = [
      ["Symbol", "Name", "Notes"],
      ["INFY", "Infosys Ltd", "some note"],
    ];
    expect(findHeaderRowIndex(grid)).toBeNull();
  });

  it("gives up past the search bound rather than scanning an entire malformed file", () => {
    const preamble = Array.from({ length: 60 }, (_, i) => [`junk row ${i}`]);
    const grid = [
      ...preamble,
      ["Scheme Name", "Units"],
      ["Some Fund", "100"],
    ];
    expect(findHeaderRowIndex(grid)).toBeNull();
  });
});

async function writeCsv(filePath: string, lines: readonly string[]): Promise<void> {
  await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}

describe("generic 'HOLDINGS AS ON' date detection", () => {
  const scratch = (name: string) => path.join(FIXTURES, name);

  it("finds the date in the real mutual-fund fixture's preamble", async () => {
    const found = await findGenericHoldingsAsOnDate(fixture("mutualfund-v2-real-layout.xlsx"));
    expect(found?.toISOString().slice(0, 10)).toBe("2026-09-02");
  });

  it("returns null for a plain table with no such phrase", async () => {
    const found = await findGenericHoldingsAsOnDate(fixture("equity-v1-base.csv"));
    expect(found).toBeNull();
  });

  it("matches the exact phrase (case-insensitive) via a CSV cell, not a bare date or the Zerodha-style phrasing", async () => {
    const bareDate = scratch("holdings-as-on-scratch-bare-date.csv");
    const zerodhaStyle = scratch("holdings-as-on-scratch-zerodha-style.csv");
    const exactPhrase = scratch("holdings-as-on-scratch-exact.csv");
    try {
      // A bare date-looking cell must never be accepted as the portfolio date.
      await writeCsv(bareDate, ["2026-09-02", "Scheme Name,Units", "Some Fund,100"]);
      expect(await findGenericHoldingsAsOnDate(bareDate)).toBeNull();

      // Zerodha's own "...as on..." phrasing (no "HOLDINGS" prefix) must not
      // satisfy this generic-path pattern — the two are deliberately distinct.
      await writeCsv(zerodhaStyle, ["Equity Holdings Statement as on 2026-09-02"]);
      expect(await findGenericHoldingsAsOnDate(zerodhaStyle)).toBeNull();

      // Case-insensitive, and the exact phrase is sufficient on its own.
      await writeCsv(exactPhrase, ["holdings as on 2026-09-02"]);
      expect((await findGenericHoldingsAsOnDate(exactPhrase))?.toISOString().slice(0, 10)).toBe(
        "2026-09-02",
      );
    } finally {
      await Promise.all([bareDate, zerodhaStyle, exactPhrase].map((f) => rm(f, { force: true })));
    }
  });

  it("gives up past the same bounded search window findHeaderRowIndex uses, rather than scanning an entire file", async () => {
    const beyondBound = scratch("holdings-as-on-scratch-beyond-bound.csv");
    try {
      const junkRows = Array.from({ length: 55 }, (_, i) => `junk row ${i}`);
      await writeCsv(beyondBound, [...junkRows, "HOLDINGS AS ON 2026-09-02"]);
      expect(await findGenericHoldingsAsOnDate(beyondBound)).toBeNull();
    } finally {
      await rm(beyondBound, { force: true });
    }
  });
});

describe("portfolio snapshot ingestion", () => {
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

  it("imports holdings, creating instruments, positions, and dated valuations", async () => {
    const audit = await importPortfolioSnapshot(
      db,
      fixture("equity-v1-base.csv"),
      EQUITY,
    );

    expect(audit.rowsScanned).toBe(3);
    expect(audit.instrumentsCreated).toBe(3);
    expect(audit.positionsCreated).toBe(3);
    expect(audit.valuationsCreated).toBe(3);
    expect(audit.rowsNeedingReview).toBe(0);

    const infosys = await db.instrument.findFirstOrThrow({
      where: { identifier: "INFY" },
    });
    expect(infosys.displayName).toBe("Infosys Ltd");

    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: infosys.id },
    });
    expect(position.quantity).toBe(50);
    expect(position.unit).toBe("shares");
    // 50 shares at an average cost of Rs 1,410 = Rs 70,500.
    expect(position.costBasisMinorUnits).toBe(70_500 * 100);
    expect(position.trustState).toBe("validated");

    const valuation = await db.valuation.findFirstOrThrow({
      where: { instrumentId: infosys.id },
    });
    expect(valuation.priceMinorUnits).toBe(152_040);
    expect(valuation.source).toContain("equity-v1-base.csv");
  });

  it("is idempotent: re-importing the same file changes nothing", async () => {
    await importPortfolioSnapshot(db, fixture("equity-v1-base.csv"), EQUITY);
    const repeat = await importPortfolioSnapshot(
      db,
      fixture("equity-v1-base.csv"),
      EQUITY,
    );

    expect(repeat.isRepeatUpload).toBe(true);
    expect(repeat.positionsUnchanged).toBe(3);
    expect(repeat.positionsCreated).toBe(0);
    expect(repeat.instrumentsCreated).toBe(0);
    expect(repeat.valuationsCreated).toBe(0);

    expect(await db.positionSnapshot.count()).toBe(3);
    expect(await db.valuation.count()).toBe(3);
    expect(await db.sourceDocument.count()).toBe(1);
  });

  it("treats a same-date change as a correction, superseding without deleting", async () => {
    await importPortfolioSnapshot(db, fixture("equity-v1-base.csv"), EQUITY);
    const audit = await importPortfolioSnapshot(
      db,
      fixture("equity-v2-corrected.csv"),
      EQUITY,
    );

    expect(audit.positionsRevised).toBe(1);

    const tcs = await db.instrument.findFirstOrThrow({ where: { identifier: "TCS" } });
    const all = await db.positionSnapshot.findMany({ where: { instrumentId: tcs.id } });
    expect(all).toHaveLength(2);

    const original = all.find((p) => p.trustState === "superseded");
    expect(original?.quantity).toBe(20);
    expect(original?.supersededById).not.toBeNull();

    const effective = all.find((p) => p.supersededById === null);
    expect(effective?.quantity).toBe(25);

    const revision = await db.revision.findFirstOrThrow({
      where: { entityType: "position_snapshot" },
    });
    expect(JSON.parse(revision.originalValueJson).quantity).toBe(20);
    expect(JSON.parse(revision.revisedValueJson).quantity).toBe(25);
  });

  it("reports a later-date quantity change without inventing a transaction", async () => {
    await importPortfolioSnapshot(db, fixture("equity-v1-base.csv"), EQUITY);
    const audit = await importPortfolioSnapshot(db, fixture("equity-v3-later-date.csv"), {
      asOf: SEP_30,
      assetClass: "equity",
    });

    const change = audit.observedChanges.find((c) => c.instrumentLabel === "Infosys Ltd");
    expect(change).toBeDefined();
    expect(change?.previousQuantity).toBe(50);
    expect(change?.newQuantity).toBe(75);
    expect(change?.quantityDelta).toBe(25);
    expect(change?.transactionCount).toBe(0);
    expect(change?.reconciled).toBe(false);
    expect(audit.issues.some((i) => i.includes("not recorded as a trade"))).toBe(true);

    // Both observations stand; the earlier one is history, not a mistake.
    const infosys = await db.instrument.findFirstOrThrow({
      where: { identifier: "INFY" },
    });
    const snapshots = await db.positionSnapshot.findMany({
      where: { instrumentId: infosys.id },
      orderBy: { asOfDate: "asc" },
    });
    expect(snapshots.map((s) => s.quantity)).toEqual([50, 75]);
    expect(snapshots.every((s) => s.supersededById === null)).toBe(true);

    // Critically: no buy was fabricated to explain the increase.
    expect(await db.activity.count({ where: { kind: "buy" } })).toBe(0);
  });

  it("marks an observed change reconciled when a recorded transaction explains it", async () => {
    await importPortfolioSnapshot(db, fixture("equity-v1-base.csv"), EQUITY);

    const infosys = await db.instrument.findFirstOrThrow({
      where: { identifier: "INFY" },
    });
    await db.activity.create({
      data: {
        kind: "buy",
        instrumentId: infosys.id,
        amountMinorUnits: 25 * 152_040,
        quantity: 25,
        occurredOn: new Date("2026-09-10T00:00:00Z"),
        trustState: "validated",
      },
    });

    const audit = await importPortfolioSnapshot(db, fixture("equity-v3-later-date.csv"), {
      asOf: SEP_30,
      assetClass: "equity",
    });

    const change = audit.observedChanges.find((c) => c.instrumentLabel === "Infosys Ltd");
    expect(change?.recordedTransactionQuantity).toBe(25);
    expect(change?.reconciled).toBe(true);
    expect(audit.issues.some((i) => i.includes("Infosys"))).toBe(false);
  });

  it("flags malformed rows for review instead of coercing them", async () => {
    const audit = await importPortfolioSnapshot(
      db,
      fixture("equity-v4-malformed.csv"),
      EQUITY,
    );

    expect(audit.rowsScanned).toBe(3); // the blank row is skipped, not flagged
    expect(audit.rowsNeedingReview).toBe(3);

    const flagged = await db.positionSnapshot.findMany({
      where: { trustState: "needs_review" },
    });
    expect(flagged).toHaveLength(3);

    // An unparseable price yields no valuation rather than a fabricated one.
    const niftybees = await db.instrument.findFirstOrThrow({
      where: { identifier: "NIFTYBEES" },
    });
    expect(await db.valuation.count({ where: { instrumentId: niftybees.id } })).toBe(0);
  });

  it("flags a duplicated holding rather than summing or dropping it", async () => {
    const audit = await importPortfolioSnapshot(
      db,
      fixture("equity-v5-duplicate.csv"),
      EQUITY,
    );

    expect(audit.rowsNeedingReview).toBe(2);
    expect(audit.issues.some((i) => i.includes("appears 2 times"))).toBe(true);

    const infosys = await db.instrument.findFirstOrThrow({
      where: { identifier: "INFY" },
    });
    const positions = await db.positionSnapshot.findMany({
      where: { instrumentId: infosys.id },
    });
    // Both lots survive: neither summed into 80, nor one silently superseding
    // the other. Duplicates within one file are an ambiguity to resolve, not
    // a correction of each other.
    expect(positions).toHaveLength(2);
    expect(positions.map((p) => p.quantity).sort((a, b) => a - b)).toEqual([30, 50]);
    expect(positions.every((p) => p.trustState === "needs_review")).toBe(true);
    expect(positions.every((p) => p.supersededById === null)).toBe(true);
    // No revision was invented for what is not a correction.
    expect(await db.revision.count()).toBe(0);
  });

  it("parses quoted CSV fields correctly on import", async () => {
    await importPortfolioSnapshot(db, fixture("equity-v6-quoted.csv"), EQUITY);

    const infosys = await db.instrument.findFirstOrThrow({
      where: { identifier: "INFY" },
    });
    expect(infosys.displayName).toBe("Infosys Ltd, India");

    const tcs = await db.instrument.findFirstOrThrow({ where: { identifier: "TCS" } });
    expect(tcs.displayName).toBe('Tata "TCS" Consultancy');
  });

  it("refuses an export with no usable quantity column, writing nothing", async () => {
    const audit = await importPortfolioSnapshot(
      db,
      fixture("equity-v7-unusable-layout.csv"),
      EQUITY,
    );

    expect(audit.rowsScanned).toBe(0);
    expect(audit.issues.some((i) => i.includes("no recognizable quantity column"))).toBe(
      true,
    );
    expect(await db.positionSnapshot.count()).toBe(0);
  });

  it("imports mutual fund units and NAV with an invested-total cost basis", async () => {
    const audit = await importPortfolioSnapshot(db, fixture("mutualfund-v1-base.csv"), {
      asOf: AUG_31,
      assetClass: "mutual_fund",
    });

    expect(audit.positionsCreated).toBe(2);

    const fund = await db.instrument.findFirstOrThrow({
      where: { identifier: "120503" },
    });
    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: fund.id },
    });

    // Fractional units must survive intact.
    expect(position.quantity).toBeCloseTo(1250.456, 6);
    expect(position.unit).toBe("units");
    // The reported invested total is used verbatim, not recomputed.
    expect(position.costBasisMinorUnits).toBe(85_000 * 100);

    const valuation = await db.valuation.findFirstOrThrow({
      where: { instrumentId: fund.id },
    });
    expect(valuation.priceMinorUnits).toBe(7890); // Rs 78.9012 rounds to paise
  });

  it("imports an XLSX export equivalently to CSV", async () => {
    const audit = await importPortfolioSnapshot(
      db,
      fixture("equity-v9-xlsx-export.xlsx"),
      EQUITY,
    );

    expect(audit.rowsScanned).toBe(2);
    expect(audit.positionsCreated).toBe(2);

    const infosys = await db.instrument.findFirstOrThrow({
      where: { identifier: "INFY" },
    });
    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: infosys.id },
    });
    expect(position.quantity).toBe(50);
  });

  it("locates the real mutual-fund statement's holdings header past a personal-details and summary preamble, and reads its own 'HOLDINGS AS ON' date without asOf being supplied", async () => {
    const audit = await importPortfolioSnapshot(
      db,
      fixture("mutualfund-v2-real-layout.xlsx"),
      { assetClass: "mutual_fund" }, // no asOf supplied — must be read from "HOLDINGS AS ON 2026-09-02"
    );

    // Zero would mean the header-row bug reproduced; both real holdings must
    // be found past the "Personal Details"/"HOLDING SUMMARY" preamble.
    expect(audit.rowsScanned).toBe(2);
    expect(audit.positionsCreated).toBe(2);
    expect(audit.issues.some((issue) => issue.includes("no recognizable"))).toBe(false);
    // The statement's own preamble date, never the filename, never guessed.
    expect(audit.asOf.toISOString().slice(0, 10)).toBe("2026-09-02");

    const fund = await db.instrument.findFirstOrThrow({
      where: { identifier: "Parag Parikh Flexi Cap Fund" },
    });
    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: fund.id },
    });

    expect(position.asOfDate.toISOString().slice(0, 10)).toBe("2026-09-02");
    // Fractional units survive, and the reported Invested Value is used
    // verbatim as the cost basis — never fabricated, never recomputed.
    expect(position.quantity).toBeCloseTo(1250.456, 6);
    expect(position.costBasisMinorUnits).toBe(85_000 * 100);
    // This export carries no NAV/price column at all — price must be
    // absent, never guessed at.
    expect(await db.valuation.count({ where: { instrumentId: fund.id } })).toBe(0);
    expect(position.trustState).toBe("validated");
  });

  it("refuses rather than silently trusting one date when the statement's own 'HOLDINGS AS ON' date disagrees with an explicitly supplied asOf", async () => {
    await expect(
      importPortfolioSnapshot(db, fixture("mutualfund-v2-real-layout.xlsx"), {
        asOf: SEP_30, // the fixture itself states 2026-09-02, not 2026-09-30
        assetClass: "mutual_fund",
      }),
    ).rejects.toThrow(/is dated 2026-09-02 but 2026-09-30 was supplied/);
    expect(await db.positionSnapshot.count()).toBe(0);
  });

  it("does not derive the portfolio date from the filename — a date-shaped filename with no in-file date still requires an explicit asOf", async () => {
    // equity-v1-base.csv's own filename carries no date, so this proves the
    // general rule using a renamed copy whose *name* looks dated but whose
    // *content* (no "HOLDINGS AS ON" phrase, a plain Symbol/Name/Quantity
    // table) states none — exactly the case a filename-derived date would
    // wrongly "fix".
    const datedNameCopy = path.join(FIXTURES, "equity-v1-base-2026-01-01.csv");
    await copyFile(fixture("equity-v1-base.csv"), datedNameCopy);
    try {
      await expect(
        importPortfolioSnapshot(db, datedNameCopy, { assetClass: "equity" }),
      ).rejects.toThrow(/states neither an as-of date nor an asset class/);
      expect(await db.positionSnapshot.count()).toBe(0);
    } finally {
      await rm(datedNameCopy, { force: true });
    }
  });

  it("feeds the valuation engine, which values the portfolio from imported data", async () => {
    await importPortfolioSnapshot(db, fixture("equity-v1-base.csv"), EQUITY);

    const positions = await loadPositionsAsOf(db, AUG_31);
    const valuations = await loadValuations(db, AUG_31);
    const portfolio = expectOk(valuePortfolio(positions, valuations, AUG_31));

    // 50 x 1520.40 + 20 x 3890.75 + 100 x 250.10 = 76,020 + 77,815 + 25,010.
    expect(portfolio.totalMinorUnits).toBe((76_020 + 77_815 + 25_010) * 100);
    expect(portfolio.positions).toHaveLength(3);
    expect(portfolio.exclusions).toHaveLength(0);
    // Prices are same-day here, so nothing is stale.
    expect(portfolio.positions.every((p) => p.priceAgeDays === 0)).toBe(true);
  });

  it("excludes needs-review holdings from the valued total", async () => {
    await importPortfolioSnapshot(db, fixture("equity-v4-malformed.csv"), EQUITY);

    const positions = await loadPositionsAsOf(db, AUG_31);
    const valuations = await loadValuations(db, AUG_31);
    const result = valuePortfolio(positions, valuations, AUG_31);

    // Every holding in this file is flagged, so nothing can be valued.
    expect(result.kind).toBe("insufficient-data");
  });
});

describe("displayFileName override", () => {
  const testDb = createTestDb();
  const db = testDb.db;

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("records the display name instead of the on-disk path's basename when supplied", async () => {
    const audit = await importPortfolioSnapshot(db, fixture("equity-v1-base.csv"), {
      ...EQUITY,
      displayFileName: "My Broker Holdings.csv",
    });

    expect(audit.fileName).toBe("My Broker Holdings.csv");

    const stored = await db.sourceDocument.findFirst();
    expect(stored?.fileName).toBe("My Broker Holdings.csv");
  });

  it("falls back to the path's basename when no override is given", async () => {
    await db.sourceDocument.deleteMany();
    const audit = await importPortfolioSnapshot(
      db,
      fixture("equity-v1-base.csv"),
      EQUITY,
    );
    expect(audit.fileName).toBe("equity-v1-base.csv");
  });
});
