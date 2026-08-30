// Generates fixtures that reproduce the REAL structures documented in
// docs/REFERENCE_DOCUMENT_REGISTER.md, with anonymized figures.
//
// The LAYOUT is copied faithfully — banner rows, section headers, shifting
// column positions, formula-derived subtotals, preamble blocks, blank
// leading columns — because that layout is what the adapters must handle.
// Every AMOUNT, symbol, and identifier is invented. No real financial data
// or account identifier is committed (docs/13_SECURITY_PRIVACY.md).
//
// Run: node scripts/generate-reference-fixtures.mjs

import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("tests/fixtures/reference");

// --- Budget workbook, R-01 layout -----------------------------------------

/**
 * Writes one month sheet in the reference layout: a banner row, a section
 * header row carrying "Income" and "Expenses", side-by-side label+amount
 * column pairs, a formula totals row, then an Investments block with its own
 * formula-derived availability, sum, and leftover rows.
 */
function addMonthSheet(workbook, name, spec) {
  const sheet = workbook.addWorksheet(name);
  const { bannerRow, incomeCol, expenseCol, frequencyCol, emiDateCol, income, expenses, investments } = spec;

  const headerRow = bannerRow + 1;
  const firstDataRow = headerRow + 1;

  const col = (n) => sheet.getColumn(n);
  const cell = (r, c) => sheet.getRow(r).getCell(c);

  // Banner spanning the block, as in the reference file.
  for (let c = incomeCol; c <= expenseCol + 1; c += 1) {
    cell(bannerRow, c).value = "Monthly budget";
  }

  cell(headerRow, incomeCol).value = "Income";
  cell(headerRow, expenseCol).value = "Expenses";
  if (frequencyCol) cell(headerRow, frequencyCol).value = "Frequency";
  if (emiDateCol) cell(headerRow, emiDateCol).value = "EMI end date";

  const maxLines = Math.max(income.length, expenses.length);
  for (let i = 0; i < maxLines; i += 1) {
    const r = firstDataRow + i;
    if (income[i]) {
      cell(r, incomeCol).value = income[i].label;
      cell(r, incomeCol + 1).value = income[i].amount;
    }
    if (expenses[i]) {
      cell(r, expenseCol).value = expenses[i].label;
      cell(r, expenseCol + 1).value = expenses[i].amount;
      if (frequencyCol && expenses[i].frequency) {
        cell(r, frequencyCol).value = expenses[i].frequency;
      }
      if (emiDateCol && expenses[i].emiEnd) {
        cell(r, emiDateCol).value = new Date(expenses[i].emiEnd);
      }
    }
  }

  // Formula-derived totals row — must never be imported as a line item.
  const totalRow = firstDataRow + maxLines;
  const incomeLetter = col(incomeCol + 1).letter;
  const expenseLetter = col(expenseCol + 1).letter;
  cell(totalRow, incomeCol).value = "total";
  cell(totalRow, incomeCol + 1).value = {
    formula: `SUM(${incomeLetter}${firstDataRow}:${incomeLetter}${totalRow - 1})`,
    result: income.reduce((s, r) => s + r.amount, 0),
  };
  cell(totalRow, expenseCol).value = "total";
  cell(totalRow, expenseCol + 1).value = {
    formula: `SUM(${expenseLetter}${firstDataRow}:${expenseLetter}${totalRow - 1})`,
    result: expenses.reduce((s, r) => s + r.amount, 0),
  };

  // Investments block, offset below as in the reference file.
  const bannerInv = totalRow + 5;
  const invLabelCol = incomeCol + 1;
  const invAmountCol = invLabelCol + 1;
  cell(bannerInv, invLabelCol).value = "Investments ";
  cell(bannerInv, invAmountCol).value = "Investments ";

  const availableRow = bannerInv + 1;
  const incomeTotal = income.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = expenses.reduce((s, r) => s + r.amount, 0);
  cell(availableRow, invLabelCol).value = "Investment";
  cell(availableRow, invAmountCol).value = {
    formula: `${incomeLetter}${totalRow}-${expenseLetter}${totalRow}`,
    result: incomeTotal - expenseTotal,
  };

  investments.forEach((line, i) => {
    const r = availableRow + 1 + i;
    cell(r, invLabelCol).value = line.label;
    cell(r, invAmountCol).value = line.amount;
  });

  const invSumRow = availableRow + 1 + investments.length;
  const invLetter = col(invAmountCol).letter;
  cell(invSumRow, invAmountCol).value = {
    formula: `SUM(${invLetter}${availableRow + 1}:${invLetter}${invSumRow - 1})`,
    result: investments.reduce((s, r) => s + r.amount, 0),
  };

  const leftRow = invSumRow + 3;
  cell(leftRow, invLabelCol).value = "Left over cash for the month";
  cell(leftRow, invAmountCol).value = {
    formula: `${invLetter}${availableRow}-${invLetter}${invSumRow}`,
    result: incomeTotal - expenseTotal - investments.reduce((s, r) => s + r.amount, 0),
  };

  return sheet;
}

const INVESTMENTS = [
  { label: "Index fund A direct growth", amount: 7000 },
  { label: "Flexi cap fund B direct growth", amount: 5000 },
  { label: "Midcap fund C direct growth", amount: 3000 },
  { label: "Gold bees", amount: 2000 },
  { label: "Silver bees", amount: 1000 },
  { label: "Mon100", amount: 1500 },
];

// May uses a different column offset from the later sheets, and has no
// Frequency column — exactly as the reference workbook does.
const MAY = {
  bannerRow: 2,
  incomeCol: 5, // E
  expenseCol: 7, // G
  frequencyCol: null,
  emiDateCol: 9, // I
  income: [
    { label: "Salary", amount: 60000 },
    { label: "Sibling contribution", amount: 1500 },
    { label: "Previous month left", amount: 3000 },
  ],
  expenses: [
    { label: "Home emi", amount: 5000, emiEnd: "2039-12-01" },
    { label: "Phone emi", amount: 2900, emiEnd: "2027-02-01" },
    { label: "Tablet emi", amount: 3600, emiEnd: "2027-01-01" },
    { label: "Card A", amount: 9900 },
    { label: "Card B", amount: 4000 },
    { label: "Mobile recharge ", amount: 379 },
    { label: "Cloud subscription ", amount: 749 },
    { label: "Daily commute and exp", amount: 10000 },
  ],
  investments: INVESTMENTS,
};

const AUGUST = {
  bannerRow: 4,
  incomeCol: 4, // D — shifted left relative to May
  expenseCol: 6, // F
  frequencyCol: 8, // H
  emiDateCol: 9, // I
  income: [
    { label: "Salary", amount: 65000 },
    { label: "Sibling contribution", amount: 2250 },
    { label: "Previous month leftover salary", amount: 0 },
  ],
  expenses: [
    { label: "Home emi", amount: 10000, frequency: "Monthly", emiEnd: "2039-12-01" },
    { label: "Phone emi (sibling)", amount: 2900, frequency: "Monthly", emiEnd: "2027-02-01" },
    { label: "Tablet emi", amount: 3600, frequency: "Monthly", emiEnd: "2027-01-01" },
    // No "emi" in the label, but it has an EMI end date — the Apple-Watch
    // shaped case the adapter must classify as an EMI.
    { label: "Smart watch", amount: 2999, frequency: "Monthly", emiEnd: "2027-04-01" },
    { label: "Card A", amount: 9000, frequency: "Every month, full payment " },
    { label: "Card B", amount: 2400, frequency: "Every month, full payment " },
    { label: "Mobile recharge ", amount: 379, frequency: "Monthly" },
    { label: "Cloud subscription ", amount: 749, frequency: "Monthly" },
    { label: "Daily commute and exp", amount: 10000, frequency: "Monthly" },
  ],
  investments: INVESTMENTS,
};

async function buildBudgetWorkbook() {
  const wb = new ExcelJS.Workbook();
  addMonthSheet(wb, "May", MAY);
  addMonthSheet(wb, "August", AUGUST);

  const core = wb.addWorksheet("Core expenses");
  core.getRow(4).getCell(2).value = "Core expenses";
  core.getRow(4).getCell(7).value = "EMI END";
  const coreLines = [
    ["Home EMI", 5000, "", "2039-12-01"],
    ["Tablet EMI", 3600, "", "2027-01-01"],
    ["Phone (sibling)", 2900, "1500 paid by sibling every month", "2027-01-01"],
  ];
  coreLines.forEach(([label, amount, note, end], i) => {
    const r = core.getRow(5 + i);
    r.getCell(2).value = label;
    r.getCell(3).value = amount;
    if (note) r.getCell(4).value = note;
    r.getCell(7).value = new Date(end);
  });

  return wb;
}

// --- Zerodha holdings statement, R-02 layout -------------------------------

// Every symbol, ISIN, quantity and price below is INVENTED. Real ISINs and
// real holding sizes are personal financial data and are never committed
// (docs/13_SECURITY_PRIVACY.md). What is preserved from the reference file is
// the SHAPE: a 4-decimal average price (so the cost-basis precision rule is
// exercised), a "-E" suffixed ETF with Sector "ETF", an INF-prefixed fund
// ISIN versus INE-prefixed equity, and gold/silver names for asset-class
// derivation.
const HOLDINGS = [
  { symbol: "ALPHAIND", isin: "INE111A01011", sector: "CHEMICALS", qty: 3, avg: 612.4, close: 501.25 },
  { symbol: "BETAFIN", isin: "INE222B01022", sector: "FINANCIAL SERVICES", qty: 11, avg: 1420.375, close: 1655.9 },
  { symbol: "GOLDETF-E", isin: "INF900A01011", sector: "ETF", qty: 90, avg: 102.3417, close: 111.4 },
  { symbol: "SILVERETF-E", isin: "INF900B01012", sector: "ETF", qty: 120, avg: 210.8264, close: 199.35 },
  { symbol: "NASDAQETF-E", isin: "INF900C01013", sector: "ETF", qty: 9, avg: 254.6182, close: 288.7 },
  { symbol: "GAMMASTEEL", isin: "INE333C01033", sector: "METALS", qty: 130, avg: 131.5093, close: 174.6 },
];

function addZerodhaSheet(workbook, sheetName, statementLabel, asOn, holdings) {
  const sheet = workbook.addWorksheet(sheetName);
  const cell = (r, c) => sheet.getRow(r).getCell(c);

  // Preamble, mirroring the real statement's row positions. Column A is left
  // empty throughout, as in the reference file.
  cell(7, 2).value = "Client ID";
  cell(7, 3).value = "ANONYMISED";
  cell(11, 2).value = `${statementLabel} as on ${asOn}`;
  cell(13, 2).value = "Summary";

  const invested = holdings.reduce((s, h) => s + h.qty * h.avg, 0);
  const present = holdings.reduce((s, h) => s + h.qty * h.close, 0);
  cell(15, 2).value = "Invested Value";
  cell(15, 3).value = Number(invested.toFixed(4));
  cell(16, 2).value = "Present Value";
  cell(16, 3).value = Number(present.toFixed(2));
  cell(17, 2).value = "Unrealized P&L";
  cell(17, 3).value = Number((present - invested).toFixed(4));
  cell(18, 2).value = "Unrealized P&L Pct.";
  cell(18, 3).value = Number((((present - invested) / invested) * 100).toFixed(4));

  const headerRow = 23;
  const headers = [
    "Symbol", "ISIN", "Sector", "Quantity Available", "Quantity Discrepant",
    "Quantity Long Term", "Quantity Pledged (Margin)", "Quantity Pledged (Loan)",
    "Average Price", "Previous Closing Price", "Unrealized P&L", "Unrealized P&L Pct.",
  ];
  headers.forEach((h, i) => { cell(headerRow, 2 + i).value = h; });

  holdings.forEach((h, i) => {
    const r = headerRow + 1 + i;
    const pnl = h.qty * (h.close - h.avg);
    const values = [
      h.symbol, h.isin, h.sector, h.qty, 0,
      h.sector === "ETF" ? 0 : h.qty, 0, 0,
      h.avg, h.close, Number(pnl.toFixed(4)),
      Number(((pnl / (h.qty * h.avg)) * 100).toFixed(4)),
    ];
    values.forEach((v, c) => { cell(r, 2 + c).value = v; });
  });

  return sheet;
}

async function buildZerodhaWorkbook(asOn, holdings) {
  const wb = new ExcelJS.Workbook();
  addZerodhaSheet(wb, "Equity", "Equity Holdings Statement", asOn, holdings);

  // An empty Mutual Funds sheet, as in the reference statements.
  const mf = wb.addWorksheet("Mutual Funds");
  mf.getRow(7).getCell(2).value = "Client ID";
  mf.getRow(7).getCell(3).value = "ANONYMISED";
  mf.getRow(11).getCell(2).value = `Mutual Funds Holdings Statement as on ${asOn}`;
  mf.getRow(13).getCell(2).value = "Summary";
  mf.getRow(15).getCell(2).value = "Invested Value";
  mf.getRow(15).getCell(3).value = 0;
  const mfHeaders = [
    "Symbol", "ISIN", "Instrument Type", "Quantity Available", "Quantity Discrepant",
    "Quantity Pledged (Margin)", "Quantity Pledged (Loan)", "Average Price",
    "Previous Closing Price", "Unrealized P&L", "Unrealized P&L Pct.",
  ];
  mfHeaders.forEach((h, i) => { mf.getRow(22).getCell(2 + i).value = h; });

  // The Combined sheet restates Equity + Mutual Funds — the double-count trap.
  addZerodhaSheet(wb, "Combined", "Combined Holdings Statement", asOn, holdings);

  return wb;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const budget = await buildBudgetWorkbook();
  await budget.xlsx.writeFile(path.join(OUT_DIR, "budget-reference-layout.xlsx"));

  const aug03 = await buildZerodhaWorkbook("2026-08-03", HOLDINGS);
  await aug03.xlsx.writeFile(path.join(OUT_DIR, "zerodha-holdings-2026-08-03.xlsx"));

  // A later statement where two ETF positions grew — the real observed
  // change seen between the 3rd and 8th August reference statements.
  const laterHoldings = HOLDINGS.map((h) =>
    h.symbol === "GOLDETF-E"
      ? { ...h, qty: 115, avg: 103.7715, close: 118.9 }
      : h.symbol === "SILVERETF-E"
        ? { ...h, qty: 128, avg: 210.1108, close: 214.2 }
        : h,
  );
  const aug08 = await buildZerodhaWorkbook("2026-08-08", laterHoldings);
  await aug08.xlsx.writeFile(path.join(OUT_DIR, "zerodha-holdings-2026-08-08.xlsx"));

  console.log("Generated reference-layout fixtures in", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
