import { insufficient, ok, rupeesToMinorUnits, type Computed } from "../../domain";
import { AMFI_NAV_URL } from "../registry";
import type { FetchedQuote, Fetcher } from "../types";

/**
 * AMFI's `NAVAll.txt` — the official, free, unauthenticated daily NAV file
 * every Indian mutual fund reports into. Primary and sufficient source for
 * MF NAVs (docs/MARKET_DATA_PROVIDER_EVALUATION.md).
 *
 * Format (semicolon-delimited, no quoting):
 *   Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 * interleaved with blank lines and category header lines ("Open Ended
 * Schemes(...)") that carry no semicolons in the right places — those are
 * skipped rather than treated as malformed data rows.
 */

export interface AmfiNavRow {
  readonly schemeCode: string;
  /** May be the growth-plan ISIN or the dividend-reinvestment one; either is matched against Instrument.identifier. */
  readonly isinGrowth: string | null;
  readonly isinDivReinvestment: string | null;
  readonly schemeName: string;
  readonly navMinorUnits: number;
  readonly asOfDate: Date;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** "29-Aug-2026" -> Date. Returns null rather than an invalid Date on anything else. */
function parseAmfiDate(raw: string): Date | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (match === null) return null;
  const month = MONTHS[(match[2] as string).toLowerCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
}

/**
 * Parses the raw file text into rows. Never throws on a malformed line —
 * category headers, blank lines, and any row that doesn't have exactly the
 * expected shape are silently skipped, since the file interleaves genuine
 * data rows with section headings by design, not by error.
 */
export function parseAmfiNavText(text: string): readonly AmfiNavRow[] {
  const rows: AmfiNavRow[] = [];

  for (const line of text.split(/\r?\n/)) {
    const fields = line.split(";");
    if (fields.length !== 6) continue;

    const [schemeCode, isinGrowth, isinDivReinvestment, schemeName, navRaw, dateRaw] =
      fields as [string, string, string, string, string, string];

    if (!/^\d+$/.test(schemeCode.trim())) continue; // category headers etc. don't start with a numeric code

    const nav = Number(navRaw.trim());
    if (!Number.isFinite(nav) || nav <= 0) continue;

    const asOfDate = parseAmfiDate(dateRaw);
    if (asOfDate === null) continue;

    rows.push({
      schemeCode: schemeCode.trim(),
      isinGrowth: blankToNull(isinGrowth),
      isinDivReinvestment: blankToNull(isinDivReinvestment),
      schemeName: schemeName.trim(),
      navMinorUnits: rupeesToMinorUnits(nav),
      asOfDate,
    });
  }

  return rows;
}

/** Indexes parsed rows by every ISIN they carry, so a holding can be matched by either plan's ISIN. */
export function indexAmfiNavByIsin(
  rows: readonly AmfiNavRow[],
): ReadonlyMap<string, AmfiNavRow> {
  const byIsin = new Map<string, AmfiNavRow>();
  for (const row of rows) {
    if (row.isinGrowth !== null) byIsin.set(row.isinGrowth, row);
    if (row.isinDivReinvestment !== null) byIsin.set(row.isinDivReinvestment, row);
  }
  return byIsin;
}

/**
 * Fetches and parses the file in one step. `insufficient-data` (never a
 * throw) for a network failure, a non-200 response, or a response with no
 * parseable rows — every one of those is an ordinary "the provider is
 * unavailable right now" outcome, not a bug.
 */
export async function fetchAmfiNav(
  fetcher: Fetcher,
): Promise<Computed<readonly AmfiNavRow[]>> {
  let response;
  try {
    response = await fetcher(AMFI_NAV_URL);
  } catch (err) {
    return insufficient(
      `could not reach AMFI: ${err instanceof Error ? err.message : "unknown network error"}`,
    );
  }

  if (!response.ok) {
    return insufficient(`AMFI returned HTTP ${response.status}`);
  }

  const text = await response.text();
  const rows = parseAmfiNavText(text);
  if (rows.length === 0) {
    return insufficient("AMFI's file was reachable but contained no parseable NAV rows");
  }

  return ok(rows);
}

export function toFetchedQuote(row: AmfiNavRow): FetchedQuote {
  return { priceMinorUnits: row.navMinorUnits, asOfDate: row.asOfDate, currency: "INR" };
}
