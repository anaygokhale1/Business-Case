/**
 * Reading a volumes study broken down by region.
 *
 * This is the demand side of the register: one annual volume per row of the case. It is a
 * different file from the capacity volume sheet in `volumes.ts` — that one is keyed on
 * line of business and transaction type and carries an outcome mix, this one is keyed on
 * where the work happens — so the two have separate vocabularies and separate detectors.
 *
 * Three decisions carry the weight here.
 *
 * **The period is asked for, never inferred.** A regional volume extract is monthly or
 * quarterly about as often as it is annual, and nothing in the file distinguishes 40,000
 * transactions a year from 40,000 a month. Reading a quarter as a year understates demand
 * fourfold, the case still computes, and every number in it looks ordinary. So the period
 * is an explicit choice, both totals are shown, and the multiplier is stated.
 *
 * **Rows are summed into their region, and the constituents stay visible.** Volume is
 * additive, so a file split by product or by month legitimately rolls up. But summing is
 * also how a double-counted extract inflates a case silently, so identical rows are
 * flagged rather than quietly added.
 *
 * **Handle time, if the file carries one, is volume-weighted.** Not a plain average. The
 * sum of volume x handle time equals total volume x the volume-weighted mean exactly, and
 * the region's productive minutes divide that sum once, so the weighted figure loses
 * nothing. A plain average would understate whenever the slower work is also the more
 * common work, which is the usual shape.
 */

import type { Case, Driver, Unit } from "../engine/types";
import { assignColumns, normaliseHeader, scoreAgainstAliases } from "./headers";
import { parseCellNumber } from "./numbers";
import type { Sheet } from "./tabular";

export type RegionVolumeField = "region" | "unitName" | "label" | "volume" | "handleTimeMinutes";

export type RegionVolumeMapping = Record<RegionVolumeField, number | null>;

export const REGION_VOLUME_FIELDS: readonly RegionVolumeField[] = [
  "region",
  "unitName",
  "label",
  "volume",
  "handleTimeMinutes",
] as const;

const ALIASES: Record<RegionVolumeField, readonly string[]> = {
  region: ["region", "country", "market", "geography", "geo", "territory", "site", "location"],
  unitName: ["team", "unit", "department", "function", "office", "group", "centre", "center"],
  label: [
    "process",
    "activity",
    "task",
    "tasktype",
    "worktype",
    "product",
    "lob",
    "lineofbusiness",
    "transactiontype",
    "category",
    "month",
    "period",
  ],
  volume: [
    "annualvolume",
    "volume",
    "transactions",
    "transactionsreceived",
    "received",
    "cases",
    "claims",
    "policies",
    "items",
    "requests",
    "submissions",
    "count",
    "workload",
  ],
  handleTimeMinutes: [
    "averagehandlingtime",
    "averagehandletime",
    "handlingtime",
    "handletime",
    "aht",
    "minutesperitem",
    "minutespertransaction",
    "minutes",
    "avgminutes",
  ],
};

/**
 * How much of a year the file covers.
 *
 * Held as periods-per-year rather than a month count so the arithmetic is one
 * multiplication and the label and the factor cannot disagree.
 */
export interface VolumePeriod {
  key: string;
  label: string;
  periodsPerYear: number;
}

export const VOLUME_PERIODS: readonly VolumePeriod[] = [
  { key: "annual", label: "A full year", periodsPerYear: 1 },
  { key: "half", label: "Six months", periodsPerYear: 2 },
  { key: "quarter", label: "One quarter", periodsPerYear: 4 },
  { key: "month", label: "One month", periodsPerYear: 12 },
  { key: "week", label: "One week", periodsPerYear: 52 },
] as const;

/** Detect the header row using the REGIONAL volume vocabulary. */
export const detectRegionVolumeHeaderRow = (rows: string[][]): number => {
  let bestRow = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i += 1) {
    const score = rows[i]!.reduce(
      (total, cell) =>
        total +
        Math.max(0, ...REGION_VOLUME_FIELDS.map((f) => scoreAgainstAliases(cell, ALIASES[f]))),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
};

export const proposeRegionVolumeMapping = (header: string[]): RegionVolumeMapping =>
  assignColumns(header, ALIASES, REGION_VOLUME_FIELDS);

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

export interface RegionVolumeIssue {
  sheetRow: number;
  message: string;
  dropped: boolean;
}

/** One row of the file, after parsing. */
export interface RegionVolumeRow {
  sheetRow: number;
  region: string;
  unitName: string;
  label: string;
  /** As stated in the file, before annualisation. */
  volume: number;
  handleTimeMinutes: number | null;
}

/** The rows of one (region, unit), rolled up. */
export interface RegionVolumeTarget {
  region: string;
  /** Blank when the file names no team inside the region. */
  unitName: string;
  rows: RegionVolumeRow[];
  /** Sum as stated in the file. */
  periodVolume: number;
  /** `periodVolume` scaled to a year. What the case is sized against. */
  annualVolume: number;
  /** Volume-weighted, or null when no row carried one. */
  handleTimeMinutes: number | null;
  /** Share of the volume stating a handle time. Below 1 the weighted figure is an extrapolation. */
  handleTimeCoverage: number;
}

export interface RegionVolumeResult {
  targets: RegionVolumeTarget[];
  issues: RegionVolumeIssue[];
  considered: number;
  periodsPerYear: number;
}

export interface ConvertRegionVolumeOptions {
  /** Region for rows whose region cell is blank, or when no region column is mapped. */
  defaultRegion: string | null;
  periodsPerYear: number;
}

const isBlank = (row: string[]) => row.every((cell) => cell.trim() === "");

const targetKey = (region: string, unitName: string) =>
  `${normaliseHeader(region)}|${normaliseHeader(unitName)}`;

export const convertRegionVolumeRows = (
  sheet: Sheet,
  headerRow: number,
  mapping: RegionVolumeMapping,
  { defaultRegion, periodsPerYear }: ConvertRegionVolumeOptions,
): RegionVolumeResult => {
  const issues: RegionVolumeIssue[] = [];
  const order: string[] = [];
  const byTarget = new Map<string, RegionVolumeTarget>();
  let considered = 0;

  const at = (row: string[], column: number | null) => (column === null ? "" : (row[column] ?? ""));

  for (let i = headerRow + 1; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i]!;
    if (isBlank(row)) continue;
    considered += 1;
    const sheetRow = i + 1;

    const stated = at(row, mapping.region).trim();
    const region = stated === "" ? (defaultRegion ?? "") : stated;
    if (region === "") {
      issues.push({
        sheetRow,
        message: "skipped — no region, and no region chosen for rows that leave it blank",
        dropped: true,
      });
      continue;
    }

    const parsed = parseCellNumber(at(row, mapping.volume), { grouping: "thousands" });
    if (parsed.value === null) {
      issues.push({ sheetRow, message: `skipped — ${region} has no readable volume`, dropped: true });
      continue;
    }
    if (parsed.value < 0) {
      issues.push({
        sheetRow,
        // A negative volume is a reversal or an adjustment line, not demand. Summing it
        // in would quietly reduce the sizing of the region it belongs to.
        message: `skipped — ${region} has a negative volume (${parsed.value.toLocaleString("en-US")})`,
        dropped: true,
      });
      continue;
    }
    if (parsed.note) issues.push({ sheetRow, message: parsed.note, dropped: false });

    // Minutes read with the decimal hint: "1,5" in a handle-time column is one and a
    // half minutes, where the same text in a volume column is fifteen hundred.
    const aht = parseCellNumber(at(row, mapping.handleTimeMinutes), { grouping: "decimal" });
    if (aht.note) issues.push({ sheetRow, message: aht.note, dropped: false });

    const unitName = at(row, mapping.unitName).trim();
    const entry: RegionVolumeRow = {
      sheetRow,
      region,
      unitName,
      label: at(row, mapping.label).trim(),
      volume: parsed.value,
      handleTimeMinutes: aht.value !== null && aht.value > 0 ? aht.value : null,
    };

    const key = targetKey(region, unitName);
    let target = byTarget.get(key);
    if (!target) {
      target = {
        region,
        unitName,
        rows: [],
        periodVolume: 0,
        annualVolume: 0,
        handleTimeMinutes: null,
        handleTimeCoverage: 0,
      };
      byTarget.set(key, target);
      order.push(key);
    }
    target.rows.push(entry);
  }

  const targets = order.map((key) => {
    const target = byTarget.get(key)!;
    const periodVolume = target.rows.reduce((total, r) => total + r.volume, 0);
    const timed = target.rows.filter((r) => r.handleTimeMinutes !== null);
    const timedVolume = timed.reduce((total, r) => total + r.volume, 0);
    const weighted = timed.reduce((total, r) => total + r.volume * r.handleTimeMinutes!, 0);

    return {
      ...target,
      periodVolume,
      annualVolume: periodVolume * periodsPerYear,
      // Weighted by volume, over the rows that stated one. A row with no time must not
      // enter the denominator as a zero.
      handleTimeMinutes: timedVolume > 0 ? weighted / timedVolume : null,
      handleTimeCoverage: periodVolume > 0 ? timedVolume / periodVolume : 0,
    };
  });

  for (const target of targets) {
    // Identical rows within a region: same label, same volume. Additive data means this
    // is legitimate often enough that dropping them would be wrong, and wrong often
    // enough that summing them silently would be worse.
    const seen = new Map<string, number>();
    for (const row of target.rows) {
      if (row.label === "") continue;
      const key = `${normaliseHeader(row.label)}|${row.volume}`;
      const first = seen.get(key);
      if (first !== undefined) {
        issues.push({
          sheetRow: row.sheetRow,
          message: `identical to row ${first} — ${target.region} "${row.label}" at ${row.volume.toLocaleString("en-US")} appears twice and both are being added. Remove one if the extract repeated it.`,
          dropped: false,
        });
      } else {
        seen.set(key, row.sheetRow);
      }
    }

    if (target.handleTimeMinutes !== null && target.handleTimeCoverage < 0.999) {
      issues.push({
        sheetRow: 0,
        message: `${target.region}: only ${(target.handleTimeCoverage * 100).toFixed(0)}% of the volume states a handle time. The weighted ${target.handleTimeMinutes.toFixed(1)} min is being extended to the rest.`,
        dropped: false,
      });
    }
  }

  return { targets, issues, considered, periodsPerYear };
};

/* -------------------------------------------------------------------------- */
/* Matching against the case                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the import will do with one target.
 *
 * `ambiguous` is the one that matters: the file names a region the case has split into
 * several rows, and says nothing about which row the volume belongs to. There is no
 * non-arbitrary split, so nothing is written and the user is told. Dividing it evenly
 * would produce a register that adds up and describes an organisation that does not exist.
 */
export type RegionVolumeMatch = "update" | "new-unit" | "new-region" | "ambiguous";

export interface RegionVolumePlanEntry {
  target: RegionVolumeTarget;
  match: RegionVolumeMatch;
  /** The unit that will hold the volume. Null when one will be created, or when ambiguous. */
  unitId: string | null;
  /** What that unit holds now, so the change is reviewable before it is applied. */
  currentVolume: Driver | null;
  /** Set when a placeholder row is being adopted and named after the team. */
  renameTo?: string;
  /** Candidates, when ambiguous — named so the user knows what to fix. */
  candidates: string[];
}

export interface RegionVolumePlan {
  entries: RegionVolumePlanEntry[];
  /** Rows of the case the file says nothing about. Their volume is left alone, not zeroed. */
  untouched: Unit[];
}

const sameText = (a: string, b: string) => normaliseHeader(a) === normaliseHeader(b);

export const planRegionVolumes = (c: Case, result: RegionVolumeResult): RegionVolumePlan => {
  const claimed = new Set<string>();

  const entries = result.targets.map((target): RegionVolumePlanEntry => {
    const inRegion = c.units.filter((u) => sameText(u.region, target.region));

    if (inRegion.length === 0) {
      return { target, match: "new-region", unitId: null, currentVolume: null, candidates: [] };
    }

    if (target.unitName !== "") {
      const named = inRegion.find((u) => sameText(u.name, target.unitName));
      if (named) {
        claimed.add(named.id);
        return {
          target,
          match: "update",
          unitId: named.id,
          currentVolume: named.volume,
          candidates: [],
        };
      }
      // A region added through the Scope step arrives as a single row carrying the
      // region's own name — a stand-in for the region, not a team. The file's team
      // belongs ON that row. Creating a second row beside it would leave the first
      // sitting in the register with no volume, reported as uncovered demand, for the
      // user to notice and delete by hand.
      const only = inRegion.length === 1 ? inRegion[0]! : null;
      if (only && sameText(only.name, only.region)) {
        claimed.add(only.id);
        return {
          target,
          match: "update",
          unitId: only.id,
          currentVolume: only.volume,
          renameTo: target.unitName,
          candidates: [],
        };
      }

      // The region is known and already has named rows; this team is not one of them.
      // Adding a row is right — the alternative is discarding volume the client says exists.
      return { target, match: "new-unit", unitId: null, currentVolume: null, candidates: [] };
    }

    if (inRegion.length === 1) {
      const only = inRegion[0]!;
      claimed.add(only.id);
      return {
        target,
        match: "update",
        unitId: only.id,
        currentVolume: only.volume,
        candidates: [],
      };
    }

    return {
      target,
      match: "ambiguous",
      unitId: null,
      currentVolume: null,
      candidates: inRegion.map((u) => u.name || u.id),
    };
  });

  return { entries, untouched: c.units.filter((u) => !claimed.has(u.id)) };
};

/** The entries that will actually write. */
export const applicableEntries = (plan: RegionVolumePlan): RegionVolumePlanEntry[] =>
  plan.entries.filter((e) => e.match !== "ambiguous");
