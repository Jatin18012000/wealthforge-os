/**
 * A minimal RFC 4180 CSV reader.
 *
 * Written rather than pulled in as a dependency because broker exports need
 * exactly three behaviours — quoted fields, embedded commas, and escaped
 * quotes — and a hand-rolled 60 lines is easier to audit than a general
 * parser for code that reads financial data.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM, which Excel writes into CSV exports and which would
  // otherwise become part of the first header's name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };

  const endRow = (): void => {
    endField();
    // A trailing newline at end of file must not produce a phantom empty row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index] as string;

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'; // an escaped quote
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      // Handles CRLF and a lone CR.
      endRow();
      index += input[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // Flush whatever the final line left behind.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}
