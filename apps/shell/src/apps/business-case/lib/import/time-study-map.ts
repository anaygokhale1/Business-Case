/**
 * Mapping an uploaded sheet onto time-study rows.
 *
 * Three jobs, in order: find the header row, guess which column is which, and convert
 * the body into rows while recording everything that was skipped or looked odd.
 *
 * The guesses are always overridable in the UI. That is the point of separating the
 * *proposal* from the *conversion* — an automatic mapping that cannot be corrected is
 * worse than no automatic mapping, because a wrong column silently produces a
 * plausible handle time.
 */

import type { TimeStudyRow } from "../engine/types";
import { looksLikeTimeSerial, parseCellNumber } from "./numbers";
import type { Sheet } from "./tabular";

export type StudyField = "taskType" | "minutes" | "volume" | "region";

/** A column index per field. `null` means "not present in this file". */
export type StudyMapping = Record<StudyField, number | null>;

/**
 * Header aliases.
 *
 * Seeded from the vocabulary the skill itself uses plus the obvious synonyms, and
 * deliberately NOT from invented client headers. Extend it from real files as they
 * arrive — a table padded with plausible-sounding guesses gives false confidence
 * about what the matcher can actually handle.
 */
const ALIASES: Record<StudyField, string[]> = {
  taskType: [
    "task",
    "tasktype",
    "task type",
    "activity",
    "activitytype",
    "process",
    "processstep",
    "step",
    "worktype",
    "transactiontype",
    "description",
  ],
  minutes: [
    "minutes",
    "min",
    "mins",
    "handletime",
    "handlingtime",
    "handletimeminutes",
    "avghandletime",
    "averagehandletime",
    "aht",
    "timeperunit",
    "transactiontime",
    "durationminutes",
    "duration",
    "time",
  ],
  volume: [
    "volume",
    "annualvolume",
    "volumes",
    "count",
    "quantity",
    "qty",
    "transactions",
    "transactionsperyear",
    "units",
    "cases",
    "claims",
    "items",
    "frequency",
  ],
  region: ["region", "geography", "geo", "country", "location", "market", "site", "area"],
};

const normalise = (header: string): string =>
  header
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * Score a header against a field.
 *
 * Exact match beats prefix beats contains, so "Handle time" wins the minutes column
 * over "Time in system" even though both contain "time".
 */
const scoreHeader = (header: string, field: StudyField): number => {
  const norm = normalise(header);
  if (norm === "") return 0;

  let best = 0;
  for (const alias of ALIASES[field]) {
    const target = normalise(alias);
    if (norm === target) {
      best = Math.max(best, 100);
      continue;
    }
    // Partial matches need at least three characters on the shorter side. Without
    // that floor a column headed "C" matches "count", "cases" and "claims", and a
    // sheet of single-letter columns scores higher than the real header row.
    const shorter = Math.min(norm.length, target.length);
    if (shorter < 3) continue;

    if (norm.startsWith(target) || target.startsWith(norm)) best = Math.max(best, 70);
    else if (norm.includes(target)) best = Math.max(best, 50);
  }
  return best;
};

/**
 * Find the header row.
 *
 * Real exports carry a title, a blank line and sometimes a logo before the table, so
 * the header is rarely row 1. The row scoring highest across all four fields wins,
 * searching only the first 30 rows — beyond that it is data, not preamble.
 */
export const detectHeaderRow = (rows: string[][]): number => {
  let bestRow = 0;
  let bestScore = -1;

  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i]!;
    const score = row.reduce((acc, cell) => {
      const cellBest = Math.max(
        scoreHeader(cell, "taskType"),
        scoreHeader(cell, "minutes"),
        scoreHeader(cell, "volume"),
        scoreHeader(cell, "region"),
      );
      return acc + cellBest;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
};

/**
 * Propose a column for each field.
 *
 * Assignment is greedy on the best score across all (field, column) pairs, so one
 * column cannot be claimed by two fields — which matters because "Transaction time"
 * and "Transactions" both look like several things at once.
 */
export const proposeMapping = (header: string[]): StudyMapping => {
  const fields: StudyField[] = ["taskType", "minutes", "volume", "region"];
  const candidates: Array<{ field: StudyField; column: number; score: number }> = [];

  for (const field of fields) {
    header.forEach((cell, column) => {
      const score = scoreHeader(cell, field);
      if (score > 0) candidates.push({ field, column, score });
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping: StudyMapping = { taskType: null, minutes: null, volume: null, region: null };
  const usedColumns = new Set<number>();

  for (const candidate of candidates) {
    if (mapping[candidate.field] !== null) continue;
    if (usedColumns.has(candidate.column)) continue;
    mapping[candidate.field] = candidate.column;
    usedColumns.add(candidate.column);
  }

  return mapping;
};

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

export interface RowIssue {
  /** 1-based row number in the source sheet, so it matches what Excel shows. */
  sheetRow: number;
  message: string;
  /** Whether the row was dropped, or kept with a caveat. */
  dropped: boolean;
}

export interface ImportResult {
  rows: TimeStudyRow[];
  issues: RowIssue[];
  /** Rows examined, excluding the header and any blank lines. */
  considered: number;
  /** Regions found in the file, in order of appearance. */
  regions: string[];
}

const isBlank = (row: string[]): boolean => row.every((cell) => cell.trim() === "");

/**
 * Convert the sheet body into study rows.
 *
 * `defaultRegion` applies to rows whose region cell is empty, or to every row when the
 * file has no region column at all. `null` means portfolio-wide.
 */
export const convertStudyRows = (
  sheet: Sheet,
  headerRow: number,
  mapping: StudyMapping,
  defaultRegion: string | null,
): ImportResult => {
  const rows: TimeStudyRow[] = [];
  const issues: RowIssue[] = [];
  const regions: string[] = [];
  let considered = 0;

  const cellAt = (row: string[], column: number | null): string =>
    column === null ? "" : (row[column] ?? "");

  for (let i = headerRow + 1; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i]!;
    if (isBlank(row)) continue;
    considered += 1;
    const sheetRow = i + 1;

    const taskType = cellAt(row, mapping.taskType).trim();
    const minutesRaw = cellAt(row, mapping.minutes);
    const volumeRaw = cellAt(row, mapping.volume);

    // The grouping hint is where domain knowledge resolves "1.234". A handle time of
    // 1.234 minutes is ordinary; a volume of 1.234 is not.
    const minutes = parseCellNumber(minutesRaw, { grouping: "decimal" });
    const volume = parseCellNumber(volumeRaw, { grouping: "thousands" });

    // A row that carries neither number is almost certainly a subtotal or a note.
    // Dropping it silently is what makes a total quietly wrong, so it is reported.
    if (minutes.value === null && volume.value === null) {
      issues.push({
        sheetRow,
        message: `skipped — no handle time or volume (${taskType || "unnamed row"})`,
        dropped: true,
      });
      continue;
    }

    if (minutes.value === null) {
      issues.push({
        sheetRow,
        message: `skipped — handle time "${minutesRaw.trim()}" is not a number`,
        dropped: true,
      });
      continue;
    }

    if (volume.value === null) {
      issues.push({
        sheetRow,
        message: `skipped — volume "${volumeRaw.trim()}" is not a number`,
        dropped: true,
      });
      continue;
    }

    if (minutes.value < 0 || volume.value < 0) {
      issues.push({
        sheetRow,
        message: "skipped — negative handle time or volume",
        dropped: true,
      });
      continue;
    }

    if (looksLikeTimeSerial(minutes.value)) {
      // Excel stores a time-of-day as a fraction of a day, so a cell formatted 00:08:30
      // arrives as 0.0059 — three orders of magnitude out. Not converted, because a
      // genuine sub-minute task is indistinguishable from it.
      issues.push({
        sheetRow,
        message: `kept, but check: handle time ${minutes.value} is under a minute, which is what a time-formatted cell looks like`,
        dropped: false,
      });
    }

    if (minutes.note) {
      issues.push({ sheetRow, message: `${minutes.note}`, dropped: false });
    }
    if (volume.note) {
      issues.push({ sheetRow, message: `volume: ${volume.note}`, dropped: false });
    }

    const regionCell = cellAt(row, mapping.region).trim();
    const region = regionCell !== "" ? regionCell : defaultRegion;

    const studyRow: TimeStudyRow = {
      taskType: taskType || `Row ${sheetRow}`,
      minutes: minutes.value,
      volume: volume.value,
    };
    // Absent key, not `undefined` — portfolio-wide is the absence of a region.
    if (region !== null) studyRow.region = region;

    if (region !== null && !regions.includes(region)) regions.push(region);
    rows.push(studyRow);
  }

  return { rows, issues, considered, regions };
};

/** One-call convenience: detect, propose, convert. The UI uses the parts separately. */
export const importStudySheet = (
  sheet: Sheet,
  defaultRegion: string | null,
): ImportResult & { headerRow: number; mapping: StudyMapping } => {
  const headerRow = detectHeaderRow(sheet.rows);
  const mapping = proposeMapping(sheet.rows[headerRow] ?? []);
  return {
    headerRow,
    mapping,
    ...convertStudyRows(sheet, headerRow, mapping, defaultRegion),
  };
};
