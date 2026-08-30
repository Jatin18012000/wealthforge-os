// Generates synthetic budget-workbook fixtures for ingestion tests.
// These figures are entirely fictional — they reproduce the documented
// 2026 workbook SHAPE (month sheets + a Core expenses reference sheet) from
// docs/09_INGESTION_ARCHITECTURE.md, not real financial data. See
// docs/19_OPEN_DECISIONS.md (D-005): no real workbook was available to copy
// from, so structure is inferred from the controlling documents and must be
// re-validated against the real workbook when it is supplied.
//
// Run: node scripts/generate-budget-fixtures.mjs

import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve("tests/fixtures/budget");

function addMonthSheet(workbook, sheetName, { salary, sip, pfEmployee, emi, groceries, utilities, rent }) {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [
    { header: "Category", key: "category", width: 24 },
    { header: "Label", key: "label", width: 28 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Frequency", key: "frequency", width: 12 },
    { header: "Date", key: "date", width: 14 },
  ];
  sheet.addRows([
    { category: "Income", label: "Salary (take-home)", amount: salary, frequency: "monthly", date: null },
    { category: "Investment", label: "SIP - Total", amount: sip, frequency: "monthly", date: null },
    { category: "Investment", label: "PF - Employee", amount: pfEmployee, frequency: "monthly", date: null },
    { category: "EMI", label: "Home Loan EMI", amount: emi, frequency: "monthly", date: `${sheetName}-05` },
    { category: "Expense", label: "Groceries", amount: groceries, frequency: "monthly", date: null },
    { category: "Expense", label: "Utilities", amount: utilities, frequency: "monthly", date: null },
    { category: "Expense", label: "Rent/Housing", amount: rent, frequency: "monthly", date: null },
  ]);
  return sheet;
}

function addCoreExpensesSheet(workbook) {
  const sheet = workbook.addWorksheet("Core expenses");
  sheet.columns = [
    { header: "Category", key: "category", width: 24 },
    { header: "Typical Monthly Amount", key: "amount", width: 20 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  sheet.addRows([
    { category: "Groceries", amount: 8000, notes: "Recurring reference figure" },
    { category: "Utilities", amount: 3200, notes: "Electricity + internet" },
    { category: "Insurance premiums", amount: 2100, notes: "Amortized monthly" },
  ]);
  return sheet;
}

const BASE_MONTHS = {
  May: { salary: 62000, sip: 15000, pfEmployee: 2200, emi: 28000, groceries: 8000, utilities: 3200, rent: 0 },
  June: { salary: 62000, sip: 15000, pfEmployee: 2200, emi: 28000, groceries: 7800, utilities: 3100, rent: 0 },
  July: { salary: 63500, sip: 16500, pfEmployee: 2200, emi: 28000, groceries: 8200, utilities: 3400, rent: 0 },
  August: { salary: 63500, sip: 16500, pfEmployee: 2200, emi: 28000, groceries: 8100, utilities: 3050, rent: 0 },
};

async function buildBase() {
  const wb = new ExcelJS.Workbook();
  for (const [month, data] of Object.entries(BASE_MONTHS)) {
    addMonthSheet(wb, month, data);
  }
  addCoreExpensesSheet(wb);
  return wb;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // v1: base workbook — May, June, July, August, Core expenses
  const v1 = await buildBase();
  await v1.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v1-base.xlsx"));

  // v2: corrected August (MODIFIED sheet scenario) — groceries figure revised
  const v2 = await buildBase();
  const augSheetV2 = v2.getWorksheet("August");
  augSheetV2.getRow(6).getCell("amount").value = 8600; // corrected groceries
  await v2.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v2-modified-august.xlsx"));

  // v3: renamed August sheet -> "Aug-26" (DELETED_RENAMED scenario)
  const v3 = await buildBase();
  v3.getWorksheet("August").name = "Aug-26";
  await v3.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v3-renamed-august.xlsx"));

  // v4: August sheet removed entirely (DELETED_RENAMED scenario, no replacement)
  const v4 = await buildBase();
  v4.removeWorksheet(v4.getWorksheet("August").id);
  await v4.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v4-deleted-august.xlsx"));

  // v5: malformed cells — text in a numeric cell, blank row, malformed date
  const v5 = await buildBase();
  const augSheetV5 = v5.getWorksheet("August");
  augSheetV5.getRow(3).getCell("amount").value = "TBD"; // text where a number is expected
  augSheetV5.spliceRows(4, 0, []); // blank row inserted
  augSheetV5.getRow(5).getCell("date").value = "32/13/2026"; // malformed date
  await v5.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v5-malformed.xlsx"));

  // v6: unexpected extra sheet not matching month or reference conventions
  const v6 = await buildBase();
  const notes = v6.addWorksheet("Random Notes");
  notes.addRow(["This sheet is not a month sheet and not a recognized reference sheet."]);
  await v6.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v6-unexpected-sheet.xlsx"));

  // v7: byte-identical re-save of v1, for idempotency testing (regenerated,
  // not a copy, so the *content* is identical even though this is a fresh
  // write — the ingestion idempotency test compares parsed content, not
  // file bytes, per docs/09_INGESTION_ARCHITECTURE.md "sheet identity").
  const v7 = await buildBase();
  await v7.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v7-identical-reupload.xlsx"));

  // v8: August asserts two DIFFERENT amounts for the same budget line, with
  // nothing in the file to say which is authoritative — the CONFLICT case.
  const v8 = await buildBase();
  const augSheetV8 = v8.getWorksheet("August");
  augSheetV8.addRow({
    category: "Expense",
    label: "Groceries",
    amount: 9999,
    frequency: "monthly",
    date: null,
  });
  await v8.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v8-conflicting-rows.xlsx"));

  // v9: August repeats an identical line (same category, label AND amount).
  // Indistinguishable from a copy-paste slip, so both copies are flagged
  // rather than collapsed (losing a real line) or kept (double counting).
  const v9 = await buildBase();
  v9.getWorksheet("August").addRow({
    category: "Expense",
    label: "Groceries",
    amount: 8100,
    frequency: "monthly",
    date: null,
  });
  await v9.xlsx.writeFile(path.join(OUT_DIR, "2026-budget-v9-duplicate-rows.xlsx"));

  console.log("Generated budget fixtures in", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
