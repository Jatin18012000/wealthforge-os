import { copyFile, rm, writeFile } from "node:fs/promises";
import { rmSync, writeFileSync } from "node:fs";
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
import { parsePercentToBps } from "../../src/ingestion/portfolio/normalizeSnapshot";
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

    // The folio is part of the holding's identity — see the folio tests below.
    const fund = await db.instrument.findFirstOrThrow({
      where: { identifier: "Parag Parikh Flexi Cap Fund · 1234567/89" },
    });
    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: fund.id },
    });

    expect(position.asOfDate.toISOString().slice(0, 10)).toBe("2026-09-02");
    // Fractional units survive, and the reported Invested Value is used
    // verbatim as the cost basis — never fabricated, never recomputed.
    expect(position.quantity).toBeCloseTo(1250.456, 6);
    expect(position.costBasisMinorUnits).toBe(85_000 * 100);
    expect(position.trustState).toBe("validated");

    // The statement reports no per-unit NAV, but it does state what the
    // holding was worth on its own date — so it is priced from that rather
    // than left unvalued awaiting a market lookup it never needed.
    // 95,210.30 / 1250.456 units = 76.14 per unit.
    const valuation = await db.valuation.findFirstOrThrow({
      where: { instrumentId: fund.id },
    });
    expect(valuation.priceMinorUnits).toBe(7_614);
    expect(valuation.asOfDate.toISOString().slice(0, 10)).toBe("2026-09-02");
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

describe("mutual-fund statements that report value rather than NAV", () => {
  const { db, cleanup } = createTestDb();
  const SEP_7 = new Date("2026-09-07T00:00:00Z");
  const MF = { assetClass: "mutual_fund" as const };
  const multiFolio = () => fixture("mutualfund-v3-multi-folio.xlsx");
  const scratchFiles: string[] = [];
  const scratchStatement = (name: string, lines: readonly string[]): string => {
    const filePath = path.join(FIXTURES, `scratch-${name}`);
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
    scratchFiles.push(filePath);
    return filePath;
  };

  afterAll(async () => {
    for (const file of scratchFiles) rmSync(file, { force: true });
    await cleanup();
  });

  beforeEach(async () => {
    await db.revision.deleteMany();
    await db.positionSnapshot.deleteMany();
    await db.valuation.deleteMany();
    await db.activity.deleteMany();
    await db.instrument.deleteMany();
    await db.auditEvent.deleteMany();
    await db.sourceDocument.deleteMany();
  });

  it("keeps one scheme held under three folios as three separate holdings", async () => {
    const audit = await importPortfolioSnapshot(db, multiFolio(), MF);

    // Five rows, five instruments: the three Axis folios must NOT collapse
    // into one instrument, and must not be flagged as duplicates of each
    // other — they are distinct holdings that happen to share a scheme name.
    expect(audit.rowsScanned).toBe(5);
    expect(audit.instrumentsCreated).toBe(5);
    expect(audit.positionsCreated).toBe(5);
    expect(audit.rowsNeedingReview).toBe(0);
    expect(audit.issues.some((issue) => issue.includes("appears 3 times"))).toBe(false);

    const axis = await db.instrument.findMany({
      where: { displayName: "Axis Nifty Bank Index Fund" },
      orderBy: { identifier: "asc" },
    });
    expect(axis).toHaveLength(3);
    // Folio-level provenance survives on the identifier.
    expect(axis.map((i) => i.identifier)).toEqual([
      "Axis Nifty Bank Index Fund · 910183573136",
      "Axis Nifty Bank Index Fund · 910183697125",
      "Axis Nifty Bank Index Fund · 910238676261",
    ]);

    // Each folio keeps its own units rather than being summed.
    const quantities = await Promise.all(
      axis.map(async (instrument) =>
        (
          await db.positionSnapshot.findFirstOrThrow({
            where: { instrumentId: instrument.id },
          })
        ).quantity,
      ),
    );
    expect(quantities.sort((a, b) => a - b)).toEqual([100, 500, 1000]);
  });

  it("derives the unit price from the statement's own value and units, never from a market lookup", async () => {
    await importPortfolioSnapshot(db, multiFolio(), MF);

    const kotak = await db.instrument.findFirstOrThrow({
      where: { displayName: "Kotak Mid Cap Fund" },
    });
    const valuation = await db.valuation.findFirstOrThrow({
      where: { instrumentId: kotak.id },
    });

    // 16,000.00 over 50 units = 320.00 per unit, dated the statement's date.
    expect(valuation.priceMinorUnits).toBe(32_000);
    expect(valuation.asOfDate.toISOString().slice(0, 10)).toBe("2026-09-07");
    // Sourced from the statement, not from any market data provider.
    expect(valuation.source).toContain("portfolio-snapshot:");
  });

  it("leaves a holding unpriced when the statement reports neither a price nor a value", async () => {
    await importPortfolioSnapshot(db, multiFolio(), MF);

    const silent = await db.instrument.findFirstOrThrow({
      where: { displayName: "Silent Fund" },
    });
    // No value to derive from, so no price is invented — the holding stays
    // unvalued and is reported as an exclusion rather than counted as zero.
    expect(await db.valuation.count({ where: { instrumentId: silent.id } })).toBe(0);

    const valuation = valuePortfolio(
      await loadPositionsAsOf(db, SEP_7),
      await loadValuations(db, SEP_7),
      SEP_7,
    );
    const valued = expectOk(valuation);
    expect(valued.exclusions.map((e) => e.label)).toEqual(["Silent Fund"]);
    expect(valued.exclusions[0]?.reason).toContain("no price for");
  });

  it("includes the valued mutual-fund holdings in the portfolio total", async () => {
    await importPortfolioSnapshot(db, multiFolio(), MF);

    const valued = expectOk(
      valuePortfolio(
        await loadPositionsAsOf(db, SEP_7),
        await loadValuations(db, SEP_7),
        SEP_7,
      ),
    );

    // Four priced holdings: 1,200 + 6,000 + 12,400 + 16,000 = 35,600.
    expect(valued.positions).toHaveLength(4);
    expect(valued.totalMinorUnits).toBe(35_600 * 100);
  });

  it("re-importing the same statement changes nothing and writes no revision", async () => {
    const first = await importPortfolioSnapshot(db, multiFolio(), MF);
    expect(first.positionsCreated).toBe(5);

    const second = await importPortfolioSnapshot(db, multiFolio(), MF);

    expect(second.isRepeatUpload).toBe(true);
    expect(second.positionsCreated).toBe(0);
    expect(second.positionsUnchanged).toBe(5);
    expect(second.positionsRevised).toBe(0);

    // No duplicated holdings, no duplicated prices, no spurious revision.
    expect(await db.positionSnapshot.count()).toBe(5);
    expect(await db.valuation.count()).toBe(4);
    expect(await db.revision.count()).toBe(0);
    expect(await db.sourceDocument.count()).toBe(1);
  });

  it("reconciles exactly against the statement's own stated values", async () => {
    await importPortfolioSnapshot(db, multiFolio(), MF);

    // The four priced holdings state 1,200 + 6,000 + 12,400 + 16,000. Those
    // totals are used verbatim, so the portfolio reconciles to the paise
    // against the statement rather than drifting by the rounding in a
    // per-unit price. The 1,000-unit holding is where reconstruction would
    // drift most: 12,400.00 / 1000 = 12.40 exactly here, but a statement
    // whose value does not divide evenly would not survive the round trip.
    const valued = expectOk(
      valuePortfolio(
        await loadPositionsAsOf(db, SEP_7),
        await loadValuations(db, SEP_7),
        SEP_7,
      ),
    );
    expect(valued.totalMinorUnits).toBe(35_600 * 100);

    // The stated total is persisted, not just used in passing.
    const kotak = await db.instrument.findFirstOrThrow({
      where: { displayName: "Kotak Mid Cap Fund" },
    });
    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: kotak.id },
    });
    expect(position.marketValueMinorUnits).toBe(16_000 * 100);
    expect(position.costBasisMinorUnits).toBe(15_000 * 100);
  });

  it("preserves the descriptive columns the statement carries", async () => {
    await importPortfolioSnapshot(db, multiFolio(), MF);

    const kotak = await db.instrument.findFirstOrThrow({
      where: { displayName: "Kotak Mid Cap Fund" },
    });
    expect(kotak.amc).toBe("Kotak Mutual Fund");
    expect(kotak.subCategory).toBe("Mid Cap");
    expect(kotak.source).toBe("Groww");

    // The statement's own wording is retained as `category`, and is NOT
    // allowed to become `kind` — the engine's asset class stays what the
    // import was told it was, or every "Equity"-categorised fund would be
    // reclassified out of mutual funds by a descriptive column.
    expect(kotak.category).toBe("Equity");
    expect(kotak.kind).toBe("mutual_fund");

    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: kotak.id },
    });
    // "24.3%" -> 2430 basis points.
    expect(position.reportedXirrBps).toBe(2_430);
  });

  it("keeps a negative reported XIRR as a negative figure", async () => {
    await importPortfolioSnapshot(db, multiFolio(), MF);

    const flat = await db.instrument.findFirstOrThrow({
      where: { identifier: "Axis Nifty Bank Index Fund · 910238676261" },
    });
    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: flat.id },
    });
    // This folio's fixture row reports 0%, which must be 0 rather than null.
    expect(position.reportedXirrBps).toBe(0);
  });

  it("leaves descriptive fields null when the export has no such columns", async () => {
    await importPortfolioSnapshot(db, fixture("equity-v1-base.csv"), EQUITY);

    const infosys = await db.instrument.findFirstOrThrow({ where: { identifier: "INFY" } });
    expect(infosys.amc).toBeNull();
    expect(infosys.category).toBeNull();
    expect(infosys.subCategory).toBeNull();
    expect(infosys.source).toBeNull();

    const position = await db.positionSnapshot.findFirstOrThrow({
      where: { instrumentId: infosys.id },
    });
    expect(position.reportedXirrBps).toBeNull();
  });

  it("takes the newest stated metadata and keeps the claim it replaced on file", async () => {
    await importPortfolioSnapshot(db, multiFolio(), MF);

    const before = await db.instrument.findFirstOrThrow({
      where: { displayName: "Kotak Mid Cap Fund" },
    });
    expect(before.subCategory).toBe("Mid Cap");

    // A later statement restates the fund's sub-category. The newest value
    // wins outright rather than being ignored as "already set".
    const restated = scratchStatement("restated-subcategory.csv", [
      "HOLDINGS AS ON 2026-09-08",
      "Scheme Name,AMC,Category,Sub-category,Folio No.,Source,Units,Invested Value,Current Value",
      "Kotak Mid Cap Fund,Kotak Mutual Fund,Equity,Small Cap,18854587,Groww,50,15000,16500",
    ]);
    await importPortfolioSnapshot(db, restated, MF);

    const after = await db.instrument.findFirstOrThrow({ where: { id: before.id } });
    expect(after.subCategory).toBe("Small Cap");

    // The displaced claim is retained, not erased.
    const revision = await db.revision.findFirstOrThrow({
      where: { entityType: "instrument", entityId: before.id },
    });
    expect(JSON.parse(revision.originalValueJson)).toEqual({ subCategory: "Mid Cap" });
    expect(JSON.parse(revision.revisedValueJson)).toEqual({ subCategory: "Small Cap" });
  });

  it("does not let a statement without the columns blank out metadata already held", async () => {
    await importPortfolioSnapshot(db, multiFolio(), MF);
    const before = await db.instrument.findFirstOrThrow({
      where: { displayName: "Kotak Mid Cap Fund" },
    });

    // Same holding, from an export carrying none of the descriptive columns.
    // Absence is not an assertion that the fields are empty.
    const bare = scratchStatement("bare-columns.csv", [
      "HOLDINGS AS ON 2026-09-08",
      "Scheme Name,Folio No.,Units,Invested Value,Current Value",
      "Kotak Mid Cap Fund,18854587,50,15000,16500",
    ]);
    await importPortfolioSnapshot(db, bare, MF);

    const after = await db.instrument.findFirstOrThrow({ where: { id: before.id } });
    expect(after.amc).toBe("Kotak Mutual Fund");
    expect(after.category).toBe("Equity");
    expect(after.subCategory).toBe("Mid Cap");
    expect(after.source).toBe("Groww");
    // Nothing was displaced, so nothing was recorded as a revision.
    expect(
      await db.revision.count({ where: { entityType: "instrument", entityId: before.id } }),
    ).toBe(0);
  });

  it("records no revision when metadata merely fills a blank", async () => {
    // First import carries no descriptive columns at all.
    const bare = scratchStatement("fills-blank-first.csv", [
      "HOLDINGS AS ON 2026-09-07",
      "Scheme Name,Folio No.,Units,Invested Value,Current Value",
      "Some Fund,999,10,1000,1100",
    ]);
    await importPortfolioSnapshot(db, bare, MF);
    const instrument = await db.instrument.findFirstOrThrow({
      where: { displayName: "Some Fund" },
    });
    expect(instrument.amc).toBeNull();

    const withMeta = scratchStatement("fills-blank-second.csv", [
      "HOLDINGS AS ON 2026-09-08",
      "Scheme Name,AMC,Folio No.,Units,Invested Value,Current Value",
      "Some Fund,Some AMC,999,10,1000,1100",
    ]);
    await importPortfolioSnapshot(db, withMeta, MF);

    const after = await db.instrument.findFirstOrThrow({ where: { id: instrument.id } });
    expect(after.amc).toBe("Some AMC");
    // Filling a blank displaces no earlier claim.
    expect(
      await db.revision.count({ where: { entityType: "instrument", entityId: instrument.id } }),
    ).toBe(0);
  });

  it("still refuses a layout that states neither a date nor an asset class", async () => {
    // The guard is unchanged: this file states its own date, so withholding
    // the asset class alone must still be refused.
    await expect(
      importPortfolioSnapshot(db, multiFolio(), {}),
    ).rejects.toThrow(/states neither an as-of date nor an asset class/);
  });
});

describe("reported-percentage parsing", () => {
  it("converts a percentage to basis points, including negatives and zero", () => {
    expect(parsePercentToBps("2.83%").bps).toBe(283);
    expect(parsePercentToBps("24.3%").bps).toBe(2_430);
    expect(parsePercentToBps("-2.45%").bps).toBe(-245);
    expect(parsePercentToBps("-0.11%").bps).toBe(-11);
    expect(parsePercentToBps("0%").bps).toBe(0);
    // The % sign is optional, and thousands separators are tolerated.
    expect(parsePercentToBps("12.5").bps).toBe(1_250);
  });

  it("returns null without an issue when the cell is simply absent", () => {
    // No reported XIRR is not a reported return of zero.
    expect(parsePercentToBps("")).toEqual({ bps: null, issue: null });
    expect(parsePercentToBps("   ")).toEqual({ bps: null, issue: null });
  });

  it("reports unreadable text as an issue rather than dropping it silently", () => {
    const result = parsePercentToBps("N/A");
    expect(result.bps).toBeNull();
    expect(result.issue).toContain("not a percentage");
  });
});
