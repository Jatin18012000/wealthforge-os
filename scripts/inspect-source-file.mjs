// Structural inspector for a source file, used when onboarding a new import
// source. Prints sheet names, dimensions, and typed cell values so a source
// adapter can be written against the real layout rather than a guess.
//
// READ-ONLY: opens files for reading and never writes to them. Never point a
// fixture generator at a real file; anonymize first (see docs/13_SECURITY_PRIVACY.md).
//
// Usage: node scripts/inspect-source-file.mjs <file.xlsx|file.csv> [...]
//        node scripts/inspect-source-file.mjs --rows 60 <file.xlsx>

import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return `DATE(${value.toISOString().slice(0, 10)})`;
  if (typeof value === "object") {
    if ("result" in value) return `FORMULA(=${value.formula}) -> ${formatValue(value.result)}`;
    if ("richText" in value) return `RICH(${value.richText.map((r) => r.text).join("")})`;
    if ("error" in value) return `ERROR(${value.error})`;
    if ("text" in value) return `LINK(${value.text})`;
    return JSON.stringify(value);
  }
  if (typeof value === "number") return `NUM(${value})`;
  return `STR(${value})`;
}

async function inspectXlsx(filePath, maxRows) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  workbook.eachSheet((sheet) => {
    console.log(`\n--- SHEET "${sheet.name}" (rows=${sheet.rowCount}, cols=${sheet.columnCount}) ---`);
    let printed = 0;
    let skipped = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (printed >= maxRows) {
        skipped += 1;
        return;
      }
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(`${cell.address}=${formatValue(cell.value)}`);
      });
      if (cells.length > 0) {
        console.log(`r${rowNumber}: ${cells.join(" | ")}`);
        printed += 1;
      }
    });
    if (skipped > 0) console.log(`... (${skipped} further non-empty rows not shown)`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  let maxRows = 40;
  const files = [];

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--rows") {
      maxRows = Number(args[i + 1]);
      i += 1;
    } else {
      files.push(args[i]);
    }
  }

  if (files.length === 0) {
    console.error("Usage: node scripts/inspect-source-file.mjs [--rows N] <file> [...]");
    process.exit(1);
  }

  for (const filePath of files) {
    const buffer = await readFile(filePath);
    const hash = createHash("sha256").update(buffer).digest("hex");

    console.log("\n" + "=".repeat(78));
    console.log(`FILE: ${path.basename(filePath)}`);
    console.log(`sha256: ${hash}`);
    console.log(`bytes: ${buffer.length}`);
    console.log("=".repeat(78));

    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".csv" || extension === ".txt") {
      const lines = buffer.toString("utf-8").split(/\r?\n/).slice(0, maxRows);
      lines.forEach((line, i) => console.log(`r${i + 1}: ${line}`));
    } else {
      await inspectXlsx(filePath, maxRows);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
