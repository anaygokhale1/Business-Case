/**
 * The process time study: a register of L1..L5 process steps, each owned by a role.
 *
 * This is a second, richer shape of time study than the flat task/minutes/volume
 * table. It exists because a real capacity study arrives this way: a process taxonomy
 * several levels deep, each leaf carrying an average handle time, an occurrence rate,
 * a rework rate, and — the part that matters — a *role* that performs it, usually with
 * both an as-is and a to-be assignment.
 *
 * Capacity by role falls out of that directly, and it is the thing the flat study
 * cannot express: one blended handle time tells you how many people you need in total,
 * not how many of each kind.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 * No costs, no severance, no headcount reduction. It answers exactly one question —
 * how many FTE of each role does this volume require — for as many role assignments as
 * the study carries. Money is a separate layer on top and must not leak in here, or the
 * capacity numbers stop being checkable on their own.
 */

import { MISSING, isMissing } from "./alg";
import type { Driver, Sentinel } from "./types";
import { SENTINEL } from "./types";

/* -------------------------------------------------------------------------- */
/* Role identity                                                              */
/* -------------------------------------------------------------------------- */

/**
 * G27 — role names are normalised before they are ever compared.
 *
 * A single trailing space is enough to make a role vanish from a rollup. In the study
 * this was modelled on, one row read "UA " instead of "UA", so a SUMIFS matching on
 * the exact string silently dropped that row's minutes from the to-be total — and the
 * workbook's own reconciliation check reported the gap without being able to explain
 * it. Comparing normalised keys makes that class of error impossible; `roleCollisions`
 * reports the raw spellings so the source file can still be fixed.
 */
export const normaliseRole = (raw: string): string => raw.trim().replace(/\s+/g, " ");

/** Case-insensitive key, for detecting spellings that differ only in case. */
export const roleKey = (raw: string): string => normaliseRole(raw).toLowerCase();

/** Distinct raw spellings that collapse to the same role, so the file can be corrected. */
export const roleCollisions = (rows: ProcessRow[], columns: string[]): Array<{
  key: string;
  spellings: string[];
}> => {
  const byKey = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const column of columns) {
      const raw = row.roles[column];
      if (raw === undefined || raw === "") continue;
      const key = roleKey(raw);
      const set = byKey.get(key) ?? new Set<string>();
      set.add(raw);
      byKey.set(key, set);
    }
  }
  return [...byKey.entries()]
    .filter(([, spellings]) => spellings.size > 1)
    .map(([key, spellings]) => ({ key, spellings: [...spellings] }));
};

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One leaf of the process taxonomy.
 *
 * `applicability` is what makes a single register serve several transaction shapes: a
 * step may happen on a new submission but not a renewal, and on a bound policy but not
 * a declined one. An EMPTY list means "applies to all", because a study that leaves the
 * flags blank means the step is universal, not that it never happens.
 */
export interface ProcessRow {
  id: string;
  /** Coarse to fine, e.g. ["5 Client Servicing", "5.2 Process Request", ...]. */
  path: string[];
  /** Top-level split, e.g. line of business. */
  lob: string;
  region: string;
  /** Transaction types this step applies to. Empty = all. */
  transactionTypes: string[];
  /** Final statuses this step applies to. Empty = all. */
  statuses: string[];
  /**
   * Role assignment per column, e.g. { current: "UW", target: "UA" }. A column absent
   * from this map, or holding "", is unassigned for that scenario — see G30.
   */
  roles: Record<string, string>;
  /** Minutes for ONE occurrence of the step. */
  ahtMinutes: Driver;
  /**
   * Occurrences per transaction. At or below 1 this reads as the share of transactions
   * where the step happens; above 1 the step happens more than once. Both are legal.
   */
  frequency: Driver;
  /** Minutes to redo the step. Absent means no rework is modelled for this step. */
  reworkMinutes?: Driver;
  /** Share of occurrences that need redoing. */
  reworkFrequency?: Driver;
  /**
   * The study's own stated expected-minutes figure, where it carries one.
   *
   * A real study computes this from the components — but not always. In the study this
   * was modelled on, 170 of 2,229 cells were typed in rather than calculated, and six of
   * those disagreed with their own inputs: hardcoded to 0 while the components said
   * otherwise, evidently to take a step out of scope without deleting its measurements.
   *
   * So the stated figure WINS when present, because it is what the client's own totals
   * use and reproducing those is what makes the model trustworthy to them. G32 reports
   * every divergence, so a deliberate override stays visible and an accidental one gets
   * found.
   */
  statedMinutes?: Driver;
}

/** Capacity parameters for one role. No cost — that is a separate layer. */
export interface RoleCapacity {
  role: string;
  workingHoursPerYear: number;
  utilisationPct: number;
  /**
   * Work assigned here leaves human capacity entirely — an automation target. It still
   * appears in the results with its minutes, so the automation is visible rather than
   * simply missing, but it consumes no FTE.
   */
  automated?: boolean;
  /**
   * A placeholder owner rather than a real team, e.g. "NA" for a step nobody has been
   * assigned yet. Its minutes are reported as undecided scope and never costed or
   * staffed, because pretending someone does the work is the more dangerous error.
   */
  unassigned?: boolean;
}

/** Transactions received for one (lob, transactionType). */
export interface DemandCell {
  lob: string;
  transactionType: string;
  /**
   * Transactions RECEIVED, not transactions completed.
   *
   * This is the definition that matters most in the whole module. A submission that is
   * lost or declined still consumes most of the work a bound one does — in the study
   * this was modelled on, 826 minutes against 957 — so counting only bound policies
   * understates required capacity by nearly a factor of two.
   */
  submissions: Driver;
  /**
   * This cell's own outcome split, as shares summing to 1.
   *
   * Held per cell rather than only per transaction type because the mix genuinely
   * differs by line of business — one book may bind 60% of what it quotes and another
   * 50% — and a single split across both would move required capacity in the wrong
   * direction for each. Falls back to `CapacityStudy.statusShares` when absent.
   */
  outcomeShares?: Record<string, number>;
}

/**
 * Default outcome splits by transaction type, used for any demand cell that does not
 * carry its own.
 *
 * Endorsements are always bound; new submissions are bound, lost or declined. G29
 * requires each set to sum to 1 and does not silently normalise it.
 */
export type StatusShares = Record<string, Record<string, number>>;

/** The outcome split in force for a demand cell: its own, else the type default. */
export const sharesForCell = (
  cell: DemandCell,
  defaults: StatusShares,
): Record<string, number> => cell.outcomeShares ?? defaults[cell.transactionType] ?? {};

export interface CapacityStudy {
  rows: ProcessRow[];
  demand: DemandCell[];
  statusShares: StatusShares;
  roles: RoleCapacity[];
  /** Which role columns the study carries, e.g. ["current", "proposed", "target"]. */
  roleColumns: string[];
}

/* -------------------------------------------------------------------------- */
/* Effective minutes                                                          */
/* -------------------------------------------------------------------------- */

const num = (d: Driver | undefined, fallback: number): number => {
  if (d === undefined) return fallback;
  if (d === SENTINEL) return MISSING;
  return d;
};

/**
 * Expected minutes per transaction for one step, including rework.
 *
 *   frequency x (aht + reworkFrequency x reworkMinutes)
 *
 * Written to match the source study's own column exactly, expanded from its
 * `(aht x freq) + (reworkFreq x reworkAht x freq)` form — the same expression
 * factored, so the two agree to the last bit rather than approximately.
 *
 * Rework defaults to zero rather than to the sentinel: a study that records no rework
 * for a step is saying there is none, not that it is unknown. An unknown rework rate is
 * written as the sentinel explicitly.
 */
export const computedMinutes = (row: ProcessRow): number => {
  const aht = num(row.ahtMinutes, MISSING);
  const frequency = num(row.frequency, MISSING);
  const reworkMinutes = num(row.reworkMinutes, 0);
  const reworkFrequency = num(row.reworkFrequency, 0);

  if (isMissing(aht) || isMissing(frequency)) return MISSING;
  if (isMissing(reworkMinutes) || isMissing(reworkFrequency)) return MISSING;

  return frequency * (aht + reworkFrequency * reworkMinutes);
};

/**
 * The minutes the model uses: the study's stated figure where it has one, otherwise
 * recomputed from the components. See `statedMinutes` for why that precedence.
 */
export const effectiveMinutes = (row: ProcessRow): number => {
  const stated = num(row.statedMinutes, MISSING);
  return isMissing(stated) ? computedMinutes(row) : stated;
};

/** Steps whose stated figure and recomputed figure disagree. G32. */
export interface StatedDivergence {
  rowId: string;
  label: string;
  stated: number;
  computed: number;
  /** stated - computed. Negative means the study suppressed minutes its inputs imply. */
  delta: number;
}

export const statedDivergences = (
  rows: ProcessRow[],
  tolerance = 1e-9,
): StatedDivergence[] =>
  rows
    .flatMap((row) => {
      const stated = num(row.statedMinutes, MISSING);
      if (isMissing(stated)) return [];
      const computed = computedMinutes(row);
      if (isMissing(computed)) return [];
      const delta = stated - computed;
      if (Math.abs(delta) <= tolerance) return [];
      return [
        {
          rowId: row.id,
          label: row.path[row.path.length - 1] ?? row.id,
          stated,
          computed,
          delta,
        },
      ];
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

/** Whether a step applies to a given transaction type and status. Empty list = all. */
export const applies = (row: ProcessRow, transactionType: string, status: string): boolean =>
  (row.transactionTypes.length === 0 || row.transactionTypes.includes(transactionType)) &&
  (row.statuses.length === 0 || row.statuses.includes(status));

/**
 * The role a step is assigned to in a given column, normalised.
 *
 * G30 — an unassigned step falls back to its `current` assignment rather than
 * disappearing. Work whose future owner has not been decided is still work, and a
 * to-be state that quietly omits it reports an improvement nobody has agreed to.
 * `null` only when there is no assignment in any column.
 */
export const roleFor = (
  row: ProcessRow,
  column: string,
  fallbackColumn = "current",
): { role: string; carried: boolean } | null => {
  const direct = row.roles[column];
  if (direct !== undefined && direct.trim() !== "") {
    return { role: normaliseRole(direct), carried: false };
  }
  const fallback = row.roles[fallbackColumn];
  if (fallback !== undefined && fallback.trim() !== "") {
    return { role: normaliseRole(fallback), carried: true };
  }
  return null;
};

/* -------------------------------------------------------------------------- */
/* Duplicates                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * G28 — the signature of a row across every field that affects the arithmetic.
 *
 * Two rows sharing it are either a step that genuinely happens twice or a copy-paste
 * duplicate, and nothing in the data distinguishes them. Both readings change the
 * answer, so they are surfaced with their minute impact and never silently summed or
 * de-duplicated.
 */
export const rowSignature = (row: ProcessRow, columns: string[]): string =>
  JSON.stringify([
    row.path,
    row.lob,
    row.region,
    [...row.transactionTypes].sort(),
    [...row.statuses].sort(),
    columns.map((c) => roleKey(row.roles[c] ?? "")),
    row.ahtMinutes,
    row.frequency,
    row.reworkMinutes ?? null,
    row.reworkFrequency ?? null,
    row.statedMinutes ?? null,
  ]);

export interface DuplicateGroup {
  signature: string;
  rowIds: string[];
  /** Minutes counted more than once if every copy is kept. */
  excessMinutes: number;
  /** A readable label, taken from the deepest level of the taxonomy. */
  label: string;
}

export const duplicateGroups = (
  rows: ProcessRow[],
  columns: string[],
): DuplicateGroup[] => {
  const groups = new Map<string, ProcessRow[]>();
  for (const row of rows) {
    const sig = rowSignature(row, columns);
    groups.set(sig, [...(groups.get(sig) ?? []), row]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([signature, members]) => {
      const minutes = effectiveMinutes(members[0]!);
      return {
        signature,
        rowIds: members.map((m) => m.id),
        excessMinutes: isMissing(minutes) ? MISSING : minutes * (members.length - 1),
        label: members[0]!.path[members[0]!.path.length - 1] ?? members[0]!.id,
      };
    })
    .sort((a, b) => (b.excessMinutes || 0) - (a.excessMinutes || 0));
};

/** Row ids to exclude when the user has chosen to keep one copy of a duplicate group. */
export const excessRowIds = (groups: DuplicateGroup[]): Set<string> =>
  new Set(groups.flatMap((g) => g.rowIds.slice(1)));

/* -------------------------------------------------------------------------- */
/* Small helpers used by the capacity computation and its QC                   */
/* -------------------------------------------------------------------------- */

export const distinctRoles = (rows: ProcessRow[], columns: string[]): string[] => {
  const seen: string[] = [];
  for (const row of rows) {
    for (const column of columns) {
      const raw = row.roles[column];
      if (raw === undefined || raw.trim() === "") continue;
      const role = normaliseRole(raw);
      if (!seen.includes(role)) seen.push(role);
    }
  }
  return seen.sort((a, b) => a.localeCompare(b));
};

export const statusesFor = (shares: StatusShares, transactionType: string): string[] =>
  Object.keys(shares[transactionType] ?? {});

/** Marks a driver as explicitly unknown, for callers building rows from an import. */
export const unknown = (): Sentinel => SENTINEL;
