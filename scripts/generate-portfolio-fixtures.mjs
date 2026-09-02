// Generates synthetic portfolio-snapshot fixtures for ingestion tests.
// Holdings and prices are entirely fictional — they reproduce the SHAPE of
// broker and fund-house holdings exports, not real positions. See
// docs/19_OPEN_DECISIONS.md (D-005): no real export was available, so the
// column layouts are inferred from the common formats and must be
// re-validated against the user's actual exports.
//
// Run: node scripts/generate-portfolio-fixtures.mjs

import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("tests/fixtures/portfolio");

const EQUITY_HEADER = "Symbol,Name,Quantity,LTP,Avg Cost";
const EQUITY_ROWS_V1 = [
  "INFY,Infosys Ltd,50,1520.40,1410.00",
  "TCS,Tata Consultancy Services,20,3890.75,3600.50",
  "NIFTYBEES,Nippon India Nifty 50 BeES,100,250.10,232.80",
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // v1: baseline equity holdings.
  await writeFile(
    path.join(OUT_DIR, "equity-v1-base.csv"),
    [EQUITY_HEADER, ...EQUITY_ROWS_V1].join("\n") + "\n",
    "utf-8",
  );

  // v2: same date, TCS quantity corrected 20 -> 25. A correction, so the
  // original observation must be superseded rather than overwritten.
  await writeFile(
    path.join(OUT_DIR, "equity-v2-corrected.csv"),
    [
      EQUITY_HEADER,
      "INFY,Infosys Ltd,50,1520.40,1410.00",
      "TCS,Tata Consultancy Services,25,3890.75,3600.50",
      "NIFTYBEES,Nippon India Nifty 50 BeES,100,250.10,232.80",
    ].join("\n") + "\n",
    "utf-8",
  );

  // v3: a LATER date where INFY has grown 50 -> 75. A new observation, not a
  // correction — and not a transaction either unless one is recorded.
  await writeFile(
    path.join(OUT_DIR, "equity-v3-later-date.csv"),
    [
      EQUITY_HEADER,
      "INFY,Infosys Ltd,75,1602.00,1410.00",
      "TCS,Tata Consultancy Services,20,3910.00,3600.50",
      "NIFTYBEES,Nippon India Nifty 50 BeES,100,258.30,232.80",
    ].join("\n") + "\n",
    "utf-8",
  );

  // v4: malformed — non-numeric quantity, a negative holding, a blank row,
  // and a price that is not a number.
  await writeFile(
    path.join(OUT_DIR, "equity-v4-malformed.csv"),
    [
      EQUITY_HEADER,
      "INFY,Infosys Ltd,N/A,1520.40,1410.00",
      "TCS,Tata Consultancy Services,-20,3890.75,3600.50",
      "",
      "NIFTYBEES,Nippon India Nifty 50 BeES,100,not-a-price,232.80",
    ].join("\n") + "\n",
    "utf-8",
  );

  // v5: the same instrument listed twice — indistinguishable from a genuine
  // second lot, so both copies are flagged rather than summed or dropped.
  await writeFile(
    path.join(OUT_DIR, "equity-v5-duplicate.csv"),
    [
      EQUITY_HEADER,
      "INFY,Infosys Ltd,50,1520.40,1410.00",
      "INFY,Infosys Ltd,30,1520.40,1410.00",
    ].join("\n") + "\n",
    "utf-8",
  );

  // v6: quoted fields containing commas, and an escaped quote — the CSV
  // shapes that break naive split(",") parsing.
  await writeFile(
    path.join(OUT_DIR, "equity-v6-quoted.csv"),
    [
      EQUITY_HEADER,
      '"INFY","Infosys Ltd, India",50,1520.40,1410.00',
      '"TCS","Tata ""TCS"" Consultancy",20,3890.75,3600.50',
    ].join("\n") + "\n",
    "utf-8",
  );

  // v7: an export with no recognizable quantity column at all.
  await writeFile(
    path.join(OUT_DIR, "equity-v7-unusable-layout.csv"),
    ["Symbol,Name,Notes", "INFY,Infosys Ltd,some note"].join("\n") + "\n",
    "utf-8",
  );

  // v8: mutual fund holdings, reporting units and NAV with an invested total
  // rather than an average cost.
  await writeFile(
    path.join(OUT_DIR, "mutualfund-v1-base.csv"),
    [
      "Scheme Code,Scheme Name,Units,NAV,Invested",
      "120503,Parag Parikh Flexi Cap Fund,1250.456,78.9012,85000.00",
      "119551,UTI Nifty 50 Index Fund,2100.100,152.3400,290000.00",
    ].join("\n") + "\n",
    "utf-8",
  );

  // v9: the same equity holdings as an XLSX export rather than CSV.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Holdings");
  sheet.columns = [
    { header: "Symbol", key: "symbol", width: 16 },
    { header: "Name", key: "name", width: 32 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "LTP", key: "ltp", width: 12 },
    { header: "Avg Cost", key: "avgCost", width: 12 },
  ];
  sheet.addRows([
    { symbol: "INFY", name: "Infosys Ltd", quantity: 50, ltp: 1520.4, avgCost: 1410 },
    { symbol: "TCS", name: "Tata Consultancy Services", quantity: 20, ltp: 3890.75, avgCost: 3600.5 },
  ]);
  await workbook.xlsx.writeFile(path.join(OUT_DIR, "equity-v9-xlsx-export.xlsx"));

  // v10: a mutual-fund statement in the layout real fund-house exports
  // actually use — NOT a plain table starting at row 1. It opens with a
  // personal-details block and a holdings-summary block before the real
  // header. All names/numbers are fictional (no real PAN, mobile number,
  // or holder name — see docs/19_OPEN_DECISIONS.md, D-005). Written as raw
  // rows (not `sheet.columns`) so nothing auto-injects a header at row 1.
  const mfWorkbook = new ExcelJS.Workbook();
  const mfSheet = mfWorkbook.addWorksheet("Holdings");
  mfSheet.addRows([
    ["Personal Details"],
    ["Name", "Test Investor"],
    ["Mobile Number", "9999999999"],
    ["PAN", "ABCDE1234F"],
    [],
    ["HOLDING SUMMARY"],
    ["Total Invested Value", "375000.00"],
    ["Total Current Value", "410250.55"],
    [],
    ["HOLDINGS AS ON 2026-09-02"],
    [
      "Scheme Name",
      "AMC",
      "Category",
      "Sub-category",
      "Folio No.",
      "Source",
      "Units",
      "Invested Value",
      "Current Value",
      "Returns",
      "XIRR",
    ],
    [
      "Parag Parikh Flexi Cap Fund",
      "PPFAS Mutual Fund",
      "Equity",
      "Flexi Cap",
      "1234567/89",
      "Direct",
      1250.456,
      85000.0,
      95210.3,
      10210.3,
      "12.4%",
    ],
    [
      "UTI Nifty 50 Index Fund",
      "UTI Mutual Fund",
      "Equity",
      "Index",
      "9876543/21",
      "Direct",
      2100.1,
      290000.0,
      315040.25,
      25040.25,
      "9.8%",
    ],
  ]);
  await mfWorkbook.xlsx.writeFile(path.join(OUT_DIR, "mutualfund-v2-real-layout.xlsx"));

  console.log("Generated portfolio fixtures in", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
