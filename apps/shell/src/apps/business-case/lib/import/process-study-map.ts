/**
 * Reading a process time study out of an uploaded sheet.
 *
 * Harder than the flat study or the volume sheet, because three of the groups are
 * variable-width and have to be discovered rather than looked up:
 *
 *   - taxonomy levels    L1..L5, but some studies stop at L3 and some go to L6
 *   - applicability      one column per transaction type and per outcome
 *   - role assignments   current / proposed / target / whatever the client calls them
 *
 * A fixed column list cannot express any of that, so the mapping is a proposal the user
 * corrects. And the correction step is not a nicety: a role column read as the wrong
 * scenario, or a taxonomy level read as an applicability flag, produces a study that
 * computes cleanly and answers the wrong question.
 */

import type { ProcessRow } from "../engine/process-study";
import { parseCellNumber } from "./numbers";
import type { Sheet } from "./tabular";

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

export interface StudyColumnMapping {
  stepId: number | null;
  /** Taxonomy columns, coarse to fine. */
  pathLevels: number[];
  lob: number | null;
  region: number | null;
  /** Transaction type name -> column, e.g. { New: 8, Renewal: 9 }. */
  transactionTypes: Record<string, number>;
  /** Outcome name -> column, e.g. { Bound: 11, Lost: 12 }. */
  statuses: Record<string, number>;
  /** Scenario key -> column, e.g. { current: 14, proposed: 15, target: 16 }. */
  roles: Record<string, number>;
  ahtMinutes: number | null;
  frequency: number | null;
  reworkMinutes: number | null;
  reworkFrequency: number | null;
  /** The study's own expected-minutes column, where it has one separate from the inputs. */
  statedMinutes: number | null;
  ahtMin: number | null;
  ahtMax: number | null;
}

const normalise = (header: string): string =>
  header
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]/g, "");

/** Transaction-type vocabulary. Blank cells in these columns mean "does not apply". */
const TRANSACTION_HINTS = [
  "new",
  "newbusiness",
  "newsubmission",
  "renewal",
  "renew",
  "endorsement",
  "endorse",
  "midtermadjustment",
  "mta",
  "cancellation",
];

const STATUS_HINTS = [
  "bound",
  "written",
  "issued",
  "lost",
  "declined",
  "withdrawn",
  "nottakenup",
  "ntu",
  "quoted",
];

/** Taxonomy headers: "Level 3", "L4", "L5 (Process)", "Level4". */
const levelNumber = (header: string): number | null => {
  const norm = normalise(header);
  const match = /^(?:level|lvl|l)(\d+)/.exec(norm);
  return match ? Number(match[1]) : null;
};

const matchesAny = (header: string, hints: string[]): boolean => {
  const norm = normalise(header);
  if (norm === "") return false;
  // Whole-token match against the hint, so "Renewal" matches and "Renewal Premium" does
  // not silently become an applicability flag.
  return hints.some((hint) => norm === hint || norm === `applies${hint}` || norm === `${hint}flag`);
};

/**
 * Turn a role header into a scenario key.
 *
 * "Current Role" -> current, "Proposed Role (Post Madrid Meeting)" -> proposed,
 * "Madrid outcome role" -> madridoutcome. The key is what the rest of the app uses to
 * name a scenario, so it has to be derived from the header rather than positional —
 * a study with the columns in a different order must still resolve correctly.
 */
export const roleColumnKey = (header: string): string => {
  const norm = normalise(header);
  const stripped = norm.replace(/role$/, "").replace(/^role/, "");
  return stripped === "" ? "role" : stripped;
};

const isRoleHeader = (header: string): boolean => {
  const norm = normalise(header);
  if (!norm.includes("role")) return false;
  // "Target Role/Proposed Role Match" and "Current role vs proposed" are comparison
  // columns, not assignments. Reading one as a scenario would produce a study whose
  // to-be state was the word "Match".
  return !/match|vs|versus|compare/.test(norm);
};

const AHT_ORIGINAL_HINTS = ["ahtoriginal", "ahtbase", "ahtraw", "baseaht", "handletimeoriginal"];
const AHT_PLAIN_HINTS = ["aht", "handletime", "handlingtime", "avghandletime", "averagehandletime", "timepertask"];
const STATED_HINTS = ["statedaht", "ahtstated", "effectiveaht", "ahtfinal", "totalaht"];

export const proposeStudyMapping = (header: string[]): StudyColumnMapping => {
  const mapping: StudyColumnMapping = {
    stepId: null,
    pathLevels: [],
    lob: null,
    region: null,
    transactionTypes: {},
    statuses: {},
    roles: {},
    ahtMinutes: null,
    frequency: null,
    reworkMinutes: null,
    reworkFrequency: null,
    statedMinutes: null,
    ahtMin: null,
    ahtMax: null,
  };

  const levels: Array<{ level: number; column: number }> = [];
  const ahtCandidates: Array<{ column: number; norm: string; header: string }> = [];

  header.forEach((raw, column) => {
    const norm = normalise(raw);
    if (norm === "") return;

    // Rework first: "Rework AHT" must not be claimed as the handle time.
    if (norm.includes("rework")) {
      if (norm.includes("freq")) mapping.reworkFrequency ??= column;
      else if (norm.includes("aht") || norm.includes("time") || norm.includes("min")) {
        mapping.reworkMinutes ??= column;
      }
      return;
    }

    const level = levelNumber(raw);
    if (level !== null) {
      levels.push({ level, column });
      return;
    }

    if (mapping.stepId === null && /^(stepid|id|processid|rowid|ref|reference|code)$/.test(norm)) {
      mapping.stepId = column;
      return;
    }
    if (mapping.lob === null && /^(lob|lineofbusiness|line|product|portfolio|segment)$/.test(norm)) {
      mapping.lob = column;
      return;
    }
    if (mapping.region === null && /^(region|geography|geo|market|area)$/.test(norm)) {
      mapping.region = column;
      return;
    }
    if (mapping.frequency === null && norm.includes("frequency")) {
      mapping.frequency = column;
      return;
    }
    if (mapping.ahtMin === null && /^(ahtmin|minaht|min|minimum|ahtlow|low)$/.test(norm)) {
      mapping.ahtMin = column;
      return;
    }
    if (mapping.ahtMax === null && /^(ahtmax|maxaht|max|maximum|ahthigh|high)$/.test(norm)) {
      mapping.ahtMax = column;
      return;
    }

    if (isRoleHeader(raw)) {
      const key = roleColumnKey(raw);
      if (!(key in mapping.roles)) mapping.roles[key] = column;
      return;
    }

    if (matchesAny(raw, TRANSACTION_HINTS)) {
      mapping.transactionTypes[raw.trim().replace(/^Applies:\s*/i, "")] = column;
      return;
    }
    if (matchesAny(raw, STATUS_HINTS)) {
      mapping.statuses[raw.trim().replace(/^Applies:\s*/i, "")] = column;
      return;
    }

    if (
      STATED_HINTS.includes(norm) ||
      AHT_ORIGINAL_HINTS.includes(norm) ||
      AHT_PLAIN_HINTS.includes(norm)
    ) {
      ahtCandidates.push({ column, norm, header: raw });
    }
  });

  mapping.pathLevels = levels.sort((a, b) => a.level - b.level).map((l) => l.column);

  /*
   * Resolving the handle-time columns.
   *
   * A study may carry one AHT column or two: the raw per-occurrence time, and a computed
   * or overridden expected-minutes figure. Where both exist the "original" is the input
   * and the other is the stated figure — which is the shape a real study has, and getting
   * it backwards would feed the already-frequency-weighted number through the frequency
   * multiplication a second time.
   */
  const original = ahtCandidates.find((c) => AHT_ORIGINAL_HINTS.includes(c.norm));
  const stated = ahtCandidates.find((c) => STATED_HINTS.includes(c.norm));
  const plain = ahtCandidates.find((c) => AHT_PLAIN_HINTS.includes(c.norm));

  if (original) {
    mapping.ahtMinutes = original.column;
    mapping.statedMinutes = (stated ?? plain)?.column ?? null;
  } else if (plain) {
    mapping.ahtMinutes = plain.column;
    mapping.statedMinutes = stated?.column ?? null;
  } else if (stated) {
    // Only a stated figure: treat it as the handle time and let frequency apply, since
    // there is nothing else for the frequency column to multiply.
    mapping.ahtMinutes = stated.column;
  }

  return mapping;
};

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

/** Cell values that mean "does not apply". Anything else non-blank means it does. */
const FALSY = new Set(["n", "no", "0", "false", "f", "-", "na", "n/a", "x-", "none"]);

export const flagApplies = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  return !FALSY.has(trimmed.toLowerCase());
};

export interface StudyRowIssue {
  sheetRow: number;
  message: string;
  dropped: boolean;
}

export interface StudyImportResult {
  rows: ProcessRow[];
  issues: StudyRowIssue[];
  considered: number;
  /** Distinct values found, for populating the form. */
  discovered: {
    lobs: string[];
    regions: string[];
    transactionTypes: string[];
    statuses: string[];
    roleColumns: string[];
    roles: string[];
  };
}

const pushUnique = (list: string[], value: string) => {
  if (value !== "" && !list.includes(value)) list.push(value);
};

export const convertStudyRows = (
  sheet: Sheet,
  headerRow: number,
  mapping: StudyColumnMapping,
): StudyImportResult => {
  const rows: ProcessRow[] = [];
  const issues: StudyRowIssue[] = [];
  const discovered: StudyImportResult["discovered"] = {
    lobs: [],
    regions: [],
    transactionTypes: Object.keys(mapping.transactionTypes),
    statuses: Object.keys(mapping.statuses),
    roleColumns: Object.keys(mapping.roles),
    roles: [],
  };
  let considered = 0;
  const usedIds = new Set<string>();

  const at = (row: string[], column: number | null) =>
    column === null ? "" : (row[column] ?? "");

  for (let i = headerRow + 1; i < sheet.rows.length; i += 1) {
    const raw = sheet.rows[i]!;
    if (raw.every((cell) => cell.trim() === "")) continue;
    considered += 1;
    const sheetRow = i + 1;

    const path = mapping.pathLevels.map((c) => at(raw, c).trim()).filter((v) => v !== "");
    const aht = parseCellNumber(at(raw, mapping.ahtMinutes), { grouping: "decimal" });
    const frequency = parseCellNumber(at(raw, mapping.frequency), { grouping: "decimal" });
    const statedRaw = at(raw, mapping.statedMinutes);
    const stated = parseCellNumber(statedRaw, { grouping: "decimal" });

    if (path.length === 0 && aht.value === null && stated.value === null) {
      issues.push({ sheetRow, message: "skipped — no process name and no handle time", dropped: true });
      continue;
    }

    if (aht.value === null && stated.value === null) {
      issues.push({
        sheetRow,
        message: `skipped — "${path[path.length - 1] ?? "unnamed"}" has no usable handle time`,
        dropped: true,
      });
      continue;
    }

    // A study that omits the frequency column is stating one occurrence per transaction.
    // Assumed rather than treated as missing, because a study with no frequency column at
    // all is a study where every step happens once, not one where nothing is known.
    const frequencyValue = mapping.frequency === null ? 1 : frequency.value;
    if (frequencyValue === null) {
      issues.push({
        sheetRow,
        message: `skipped — "${path[path.length - 1] ?? "unnamed"}" has a frequency of "${at(raw, mapping.frequency).trim()}", which is not a number`,
        dropped: true,
      });
      continue;
    }

    if (aht.note) issues.push({ sheetRow, message: aht.note, dropped: false });

    const stepIdRaw = at(raw, mapping.stepId).trim();
    // Falling back to the sheet row keeps ids stable for THIS import but not across a
    // re-upload — which is exactly why the template asks for a Step ID column.
    let id = stepIdRaw !== "" ? stepIdRaw : `row-${sheetRow}`;
    if (usedIds.has(id)) {
      issues.push({
        sheetRow,
        message: `step id "${id}" is repeated; this row is held as "${id}#${sheetRow}"`,
        dropped: false,
      });
      id = `${id}#${sheetRow}`;
    }
    usedIds.add(id);

    const transactionTypes = Object.entries(mapping.transactionTypes)
      .filter(([, column]) => flagApplies(at(raw, column)))
      .map(([name]) => name);
    const statuses = Object.entries(mapping.statuses)
      .filter(([, column]) => flagApplies(at(raw, column)))
      .map(([name]) => name);

    const roles: Record<string, string> = {};
    for (const [key, column] of Object.entries(mapping.roles)) {
      const value = at(raw, column).trim();
      if (value !== "") {
        roles[key] = value;
        pushUnique(discovered.roles, value.replace(/\s+/g, " ").trim());
      }
    }

    const lob = at(raw, mapping.lob).trim() || "All";
    const region = at(raw, mapping.region).trim() || "All";
    pushUnique(discovered.lobs, lob);
    pushUnique(discovered.regions, region);

    const row: ProcessRow = {
      id,
      path: path.length > 0 ? path : [`Row ${sheetRow}`],
      lob,
      region,
      transactionTypes,
      statuses,
      roles,
      ahtMinutes: aht.value ?? 0,
      frequency: frequencyValue,
    };

    const reworkMinutes = parseCellNumber(at(raw, mapping.reworkMinutes), { grouping: "decimal" });
    const reworkFrequency = parseCellNumber(at(raw, mapping.reworkFrequency), { grouping: "decimal" });
    if (reworkMinutes.value !== null) row.reworkMinutes = reworkMinutes.value;
    if (reworkFrequency.value !== null) row.reworkFrequency = reworkFrequency.value;

    // Only set when the sheet actually carries a figure. A blank stated column must not
    // become a stated zero, which would silently take the step out of the model.
    if (mapping.statedMinutes !== null && statedRaw.trim() !== "" && stated.value !== null) {
      row.statedMinutes = stated.value;
    }

    rows.push(row);
  }

  return { rows, issues, considered, discovered };
};

/**
 * Find the header row using the study vocabulary.
 *
 * Scored on the groups that identify a process study specifically — taxonomy levels,
 * role columns, a handle time — so a title block above the table does not win.
 */
export const detectStudyHeaderRow = (rows: string[][]): number => {
  let bestRow = 0;
  let bestScore = -1;

  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i += 1) {
    const score = rows[i]!.reduce((total, cell) => {
      const norm = normalise(cell);
      if (norm === "") return total;
      if (levelNumber(cell) !== null) return total + 100;
      if (isRoleHeader(cell)) return total + 100;
      if (norm.includes("frequency")) return total + 80;
      if (AHT_ORIGINAL_HINTS.includes(norm) || AHT_PLAIN_HINTS.includes(norm)) return total + 80;
      if (matchesAny(cell, TRANSACTION_HINTS) || matchesAny(cell, STATUS_HINTS)) return total + 40;
      if (/^(lob|region|stepid)$/.test(norm)) return total + 40;
      return total;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
};

export const importStudySheet = (
  sheet: Sheet,
): StudyImportResult & { headerRow: number; mapping: StudyColumnMapping } => {
  const headerRow = detectStudyHeaderRow(sheet.rows);
  const mapping = proposeStudyMapping(sheet.rows[headerRow] ?? []);
  return { headerRow, mapping, ...convertStudyRows(sheet, headerRow, mapping) };
};
