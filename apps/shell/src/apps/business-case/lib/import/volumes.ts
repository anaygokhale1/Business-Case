/**
 * Reading transaction volumes from an uploaded sheet.
 *
 * The client-facing format asks for COUNTS by outcome, not percentages, and the shares
 * are derived here. That choice matters more than it looks:
 *
 *  - A count is what a policy admin system reports. A percentage is something someone
 *    worked out, and the working is usually lost.
 *  - Shares derived from counts sum to 1 by construction, so the "must total 100%"
 *    problem cannot arise from the upload at all.
 *  - The bind rate becomes an OUTPUT, comparable across lines of business, instead of
 *    an assumption nobody can check.
 *  - The counts reconcile against the received total, which catches a whole class of
 *    extract error that percentages hide completely.
 *
 * The one thing to be careful of: outcome mix differs by line of business. Shares are
 * therefore attached to each demand cell rather than shared across a transaction type.
 */

import type { DemandCell } from "../engine/process-study";
import { parseCellNumber } from "./numbers";
import type { Sheet } from "./tabular";

export type VolumeField =
  | "lob"
  | "transactionType"
  | "periodStart"
  | "periodEnd"
  | "received";

export type VolumeMapping = Record<VolumeField, number | null> & {
  /** Outcome name -> column index. Discovered from the header, not fixed. */
  outcomes: Record<string, number>;
};

/**
 * Header aliases.
 *
 * Outcome columns are NOT in this list on purpose — they are discovered from the header
 * text, because the outcome vocabulary is the client's (bound / lost / declined /
 * withdrawn / not-taken-up) and a fixed list would silently drop the ones we did not
 * anticipate.
 */
const ALIASES: Record<VolumeField, string[]> = {
  lob: ["lob", "lineofbusiness", "line", "product", "portfolio", "businessline", "segment"],
  transactionType: [
    "transactiontype",
    "transtype",
    "type",
    "businesstype",
    "transaction",
    "movementtype",
  ],
  periodStart: ["periodstart", "from", "startdate", "start", "periodfrom"],
  periodEnd: ["periodend", "to", "enddate", "end", "periodto"],
  received: [
    "transactionsreceived",
    "received",
    "submissions",
    "submissionsreceived",
    "transactions",
    "volume",
    "annualvolume",
    "count",
    "quoted",
    "requests",
  ],
};

/** Words that mark a column as an outcome count rather than a dimension or the total. */
const OUTCOME_HINTS = [
  "bound",
  "written",
  "issued",
  "lost",
  "declined",
  "withdrawn",
  "nottakenup",
  "ntu",
  "cancelled",
  "lapsed",
  "abandoned",
  "rejected",
];

const normalise = (header: string): string =>
  header
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");

const scoreHeader = (header: string, field: VolumeField): number => {
  const norm = normalise(header);
  if (norm === "") return 0;
  let best = 0;
  for (const alias of ALIASES[field]) {
    const target = normalise(alias);
    if (norm === target) {
      best = Math.max(best, 100);
      continue;
    }
    if (Math.min(norm.length, target.length) < 3) continue;
    if (norm.startsWith(target) || target.startsWith(norm)) best = Math.max(best, 70);
    else if (norm.includes(target)) best = Math.max(best, 50);
  }
  return best;
};

/**
 * Find the header row using the VOLUME vocabulary.
 *
 * Deliberately not shared with the time-study detector: the two files have different
 * headers, and scoring a volume sheet against "handle time" and "task type" would pick
 * whichever row happened to contain a stray matching word.
 */
export const detectVolumeHeaderRow = (rows: string[][]): number => {
  let bestRow = 0;
  let bestScore = -1;
  const fields: VolumeField[] = ["lob", "transactionType", "periodStart", "periodEnd", "received"];

  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i += 1) {
    const score = rows[i]!.reduce((total, cell) => {
      const norm = normalise(cell);
      const fieldBest = Math.max(0, ...fields.map((f) => scoreHeader(cell, f)));
      // An outcome column is strong evidence of a header row on its own.
      const outcomeBest = norm !== "" && OUTCOME_HINTS.some((h) => norm.includes(h)) ? 80 : 0;
      return total + Math.max(fieldBest, outcomeBest);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
};

export const proposeVolumeMapping = (header: string[]): VolumeMapping => {
  const fields: VolumeField[] = ["lob", "transactionType", "periodStart", "periodEnd", "received"];
  const candidates: Array<{ field: VolumeField; column: number; score: number }> = [];

  header.forEach((cell, column) => {
    for (const field of fields) {
      const score = scoreHeader(cell, field);
      if (score > 0) candidates.push({ field, column, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping: VolumeMapping = {
    lob: null,
    transactionType: null,
    periodStart: null,
    periodEnd: null,
    received: null,
    outcomes: {},
  };
  const used = new Set<number>();

  for (const candidate of candidates) {
    if (mapping[candidate.field] !== null) continue;
    if (used.has(candidate.column)) continue;
    mapping[candidate.field] = candidate.column;
    used.add(candidate.column);
  }

  // Outcome columns: any remaining header whose text names an outcome.
  header.forEach((cell, column) => {
    if (used.has(column)) return;
    const norm = normalise(cell);
    if (norm === "") return;
    if (OUTCOME_HINTS.some((hint) => norm.includes(hint))) {
      mapping.outcomes[cell.trim()] = column;
      used.add(column);
    }
  });

  return mapping;
};

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

export interface VolumeIssue {
  sheetRow: number;
  message: string;
  dropped: boolean;
}

export interface VolumeImportResult {
  demand: DemandCell[];
  issues: VolumeIssue[];
  /** Outcome names found across the file, in header order. */
  outcomes: string[];
  considered: number;
  /** Bind rate per cell, derived — reported so it can be sanity-checked. */
  bindRates: Array<{ lob: string; transactionType: string; outcome: string; share: number }>;
}

const isBlank = (row: string[]) => row.every((cell) => cell.trim() === "");

/**
 * Turn volume rows into demand cells with their own outcome shares.
 *
 * G33 — the outcome counts must reconcile to the received total. A row where they do not
 * is an extract that has lost or double-counted transactions, and the resulting shares
 * would be wrong in a way no percentage-based upload could ever reveal. Tolerated to
 * 0.5% for rounding in the source, reported beyond that, and the row is still imported
 * using its own counts as the basis so the case can proceed with the discrepancy visible.
 */
export const convertVolumeRows = (
  sheet: Sheet,
  headerRow: number,
  mapping: VolumeMapping,
): VolumeImportResult => {
  const demand: DemandCell[] = [];
  const issues: VolumeIssue[] = [];
  const bindRates: VolumeImportResult["bindRates"] = [];
  const outcomes = Object.keys(mapping.outcomes);
  let considered = 0;

  const at = (row: string[], column: number | null) =>
    column === null ? "" : (row[column] ?? "");

  for (let i = headerRow + 1; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i]!;
    if (isBlank(row)) continue;
    considered += 1;
    const sheetRow = i + 1;

    const lob = at(row, mapping.lob).trim();
    const transactionType = at(row, mapping.transactionType).trim();

    if (lob === "" || transactionType === "") {
      issues.push({
        sheetRow,
        message: `skipped — needs both a line of business and a transaction type`,
        dropped: true,
      });
      continue;
    }

    const receivedRaw = at(row, mapping.received);
    const received = parseCellNumber(receivedRaw, { grouping: "thousands" });

    const counts: Record<string, number> = {};
    let countTotal = 0;
    let anyCount = false;
    for (const [outcome, column] of Object.entries(mapping.outcomes)) {
      const parsed = parseCellNumber(at(row, column), { grouping: "thousands" });
      if (parsed.value === null) continue;
      counts[outcome] = parsed.value;
      countTotal += parsed.value;
      anyCount = true;
    }

    if (received.value === null && !anyCount) {
      issues.push({
        sheetRow,
        message: `skipped — no transaction count for ${lob} / ${transactionType}`,
        dropped: true,
      });
      continue;
    }

    // With no received total, the outcome counts ARE the total. That is the common shape
    // when a system reports only completed transactions by outcome.
    const total = received.value ?? countTotal;

    if (total <= 0) {
      issues.push({
        sheetRow,
        message: `skipped — ${lob} / ${transactionType} has a transaction count of ${total}`,
        dropped: true,
      });
      continue;
    }

    if (received.value !== null && anyCount) {
      const gap = countTotal - received.value;
      if (Math.abs(gap) > 0.005 * received.value) {
        issues.push({
          sheetRow,
          // G33. The check percentages cannot give you.
          message: `${lob} / ${transactionType}: outcomes total ${countTotal.toLocaleString("en-US")} against ${received.value.toLocaleString("en-US")} received, a gap of ${gap > 0 ? "+" : ""}${gap.toLocaleString("en-US")}. Imported using the outcome counts; check the extract.`,
          dropped: false,
        });
      }
    }

    const cell: DemandCell = { lob, transactionType, submissions: total };

    if (anyCount && countTotal > 0) {
      const shares: Record<string, number> = {};
      for (const [outcome, count] of Object.entries(counts)) {
        shares[outcome] = count / countTotal;
        bindRates.push({ lob, transactionType, outcome, share: count / countTotal });
      }
      // Derived from counts, so they sum to 1 by construction — G29 cannot fire on an
      // upload, only on a figure typed into the form.
      cell.outcomeShares = shares;
    }

    demand.push(cell);
  }

  const seen = new Set<string>();
  for (const cell of demand) {
    const key = `${cell.lob}|${cell.transactionType}`;
    if (seen.has(key)) {
      issues.push({
        sheetRow: 0,
        // Summing them would merge two different outcome mixes into one; the user has to
        // decide which row is right.
        message: `${cell.lob} / ${cell.transactionType} appears more than once. Both rows are imported and will be added together — remove one if that is not intended.`,
        dropped: false,
      });
    }
    seen.add(key);
  }

  return { demand, issues, outcomes, considered, bindRates };
};

export const importVolumeSheet = (
  sheet: Sheet,
): VolumeImportResult & { headerRow: number; mapping: VolumeMapping } => {
  const headerRow = detectVolumeHeaderRow(sheet.rows);
  const mapping = proposeVolumeMapping(sheet.rows[headerRow] ?? []);
  return { headerRow, mapping, ...convertVolumeRows(sheet, headerRow, mapping) };
};
