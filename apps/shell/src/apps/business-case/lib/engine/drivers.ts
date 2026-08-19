/**
 * Driver resolution — the one place that decides what a unit's effective value
 * for a driver actually is, and where it came from.
 *
 * There are three states, and none of them is 0:
 *   number       -> the unit supplies its own value      (origin 'own')
 *   key absent   -> inherit the global assumption        (origin 'inherited')
 *   SENTINEL     -> known-missing, must not become 0     (origin 'missing')
 *
 * One resolver serves three consumers, so they cannot disagree: the own/inherited
 * badge in the register, `LitSpec.origin` in the trace, and the ingest match
 * report ("handle time: 9 of 14 units supplied, 5 inherit global 20.0 min").
 */

import { MISSING } from "./alg";
import type {
  Case,
  Driver,
  Globals,
  Origin,
  Resolved,
  Role,
  TimeStudyRow,
  Unit,
} from "./types";
import { SENTINEL } from "./types";

/** Drivers a unit may override. Anything else is global-only. */
export type InheritableDriver =
  | "handleTimeMinutes"
  | "workingHoursPerYear"
  | "utilisationPct"
  | "upliftPct";

export const INHERITABLE_DRIVERS: readonly InheritableDriver[] = [
  "handleTimeMinutes",
  "workingHoursPerYear",
  "utilisationPct",
  "upliftPct",
] as const;

const resolveValue = (raw: Driver | undefined, fallback: number): Resolved => {
  if (raw === SENTINEL) return { value: MISSING, origin: "missing" };
  if (typeof raw === "number") return { value: raw, origin: "own" };
  // Inheriting a value that does not exist is still missing. Reporting "inherited"
  // here would badge a blank cell as though it had successfully picked something up.
  if (Number.isNaN(fallback)) return { value: MISSING, origin: "missing" };
  return { value: fallback, origin: "inherited" };
};

/**
 * G11 — the volume-weighted average from the Time Study tab.
 *
 * Returns the sentinel rather than 0 when there is no volume, so an empty study
 * cannot silently zero the model's handle time. Callers fall back to the manual
 * value.
 */
export const weightedAverageHandleTime = (rows: TimeStudyRow[]): number => {
  const totalVolume = rows.reduce((acc, r) => acc + r.volume, 0);
  if (totalVolume === 0) return MISSING;
  const weighted = rows.reduce((acc, r) => acc + r.minutes * r.volume, 0);
  return weighted / totalVolume;
};

/** Rows measured in a given region. */
export const studyRowsForRegion = (rows: TimeStudyRow[], region: string): TimeStudyRow[] =>
  rows.filter((r) => r.region === region);

/** Rows with no region — the portfolio-wide fallback. */
export const studyRowsPortfolio = (rows: TimeStudyRow[]): TimeStudyRow[] =>
  rows.filter((r) => r.region === undefined);

/** Every region that has a study of its own. */
export const regionsWithStudy = (rows: TimeStudyRow[]): string[] => {
  const seen: string[] = [];
  for (const r of rows) {
    if (r.region !== undefined && !seen.includes(r.region)) seen.push(r.region);
  }
  return seen;
};

/**
 * The per-region weighted average, for regions that have their own study rows.
 *
 * A region absent from this map falls back to the portfolio study and then to the
 * manual figure. Precomputed into the context rather than derived per unit, so the
 * cost is paid once per recompute and not once per row.
 */
export const handleTimeByRegion = (rows: TimeStudyRow[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const region of regionsWithStudy(rows)) {
    const avg = weightedAverageHandleTime(studyRowsForRegion(rows, region));
    // A region whose rows carry no volume gets no entry at all, rather than a NaN
    // that would then have to be distinguished from a genuine sentinel downstream.
    if (!Number.isNaN(avg)) out[region] = avg;
  }
  return out;
};

/** Total task volume in a study scope. Used to reconcile the study against the register. */
export const studyVolume = (rows: TimeStudyRow[]): number =>
  rows.reduce((acc, r) => acc + r.volume, 0);

export interface RoleIndex {
  frontLine: string[];
  managers: string[];
  other: string[];
  all: string[];
}

export const indexRoles = (roles: Role[]): RoleIndex => ({
  frontLine: roles.filter((r) => r.tier === "front-line").map((r) => r.id),
  managers: roles.filter((r) => r.tier === "manager").map((r) => r.id),
  other: roles.filter((r) => r.tier === "other").map((r) => r.id),
  all: roles.map((r) => r.id),
});

export interface ResolvedGlobals extends Globals {
  /**
   * G11 — the active handle time after the Manual / Time Study toggle is applied.
   * Resolved exactly once here; nothing downstream re-reads the toggle.
   */
  activeHandleTimeMinutes: number;
  activeHandleTimeOrigin: Origin;
}

export const resolveGlobals = (c: Case): ResolvedGlobals => {
  const { globals, timeStudy } = c;

  if (globals.handleTimeSource === "Time Study") {
    // Portfolio rows ONLY — never all rows. A study measured in one region must not
    // become the figure every other region inherits: that is how a real difference in
    // how work is done disappears, and the resulting number looks entirely plausible.
    const weighted = weightedAverageHandleTime(studyRowsPortfolio(timeStudy));
    if (!Number.isNaN(weighted)) {
      return { ...globals, activeHandleTimeMinutes: weighted, activeHandleTimeOrigin: "input" };
    }

    // No portfolio rows. The manual entry is the fallback if there is one; otherwise
    // the sentinel, because there is genuinely no answer for a region that did not
    // measure and has nothing to inherit. G21 — a 0 here would make required FTE 0
    // and report the entire current headcount as surplus.
    return globals.handleTimeMinutes > 0
      ? {
          ...globals,
          activeHandleTimeMinutes: globals.handleTimeMinutes,
          activeHandleTimeOrigin: "default",
        }
      : { ...globals, activeHandleTimeMinutes: MISSING, activeHandleTimeOrigin: "missing" };
  }

  return {
    ...globals,
    activeHandleTimeMinutes: globals.handleTimeMinutes > 0 ? globals.handleTimeMinutes : MISSING,
    activeHandleTimeOrigin: globals.handleTimeMinutes > 0 ? "input" : "missing",
  };
};

/**
 * Q29 — apply the implementation-cost mode.
 *
 * The mode wins over the individual figures. If a user models consulting cost, then
 * switches to "Severance only", the consulting number stays in the input box so it
 * is not lost — but it must not reach a total. Resolving that here, once, is what
 * stops each consumer deciding for itself.
 */
export const effectiveCostInputs = (
  g: Globals,
): { severanceWeeks: number; consultingCost: number } => {
  switch (g.implementationCosts) {
    case "None":
      return { severanceWeeks: 0, consultingCost: 0 };
    case "Severance only":
      return { severanceWeeks: g.severanceWeeks, consultingCost: 0 };
    case "Severance + consulting":
      return { severanceWeeks: g.severanceWeeks, consultingCost: g.consultingCost };
  }
};

/**
 * Evaluation context for a single unit.
 *
 * G23 — note what is NOT here: the unit array. A per-unit computation takes this
 * context and one unit, so it structurally cannot read a sibling row. That is the
 * bug class the AIG workbook shipped, where four register columns were joined to
 * an arbitrary other building because relative row references survived a sort.
 *
 * `handleTimeByRegion` does not breach that. It is derived from the time study, not
 * from other units, so it is context in the same sense the globals are — a unit
 * still cannot see a sibling row through it.
 */
export interface Ctx {
  globals: ResolvedGlobals;
  roles: RoleIndex;
  /** Region -> weighted average from that region's own study rows. */
  handleTimeByRegion: Record<string, number>;
}

export const buildCtx = (c: Case): Ctx => ({
  globals: resolveGlobals(c),
  roles: indexRoles(c.roles),
  // Only consulted when the source is Time Study. Keeping the map empty otherwise
  // means the Manual/Time Study toggle has exactly one effect, in one place.
  handleTimeByRegion:
    c.globals.handleTimeSource === "Time Study" ? handleTimeByRegion(c.timeStudy) : {},
});

/**
 * The fallback for a driver the unit does not supply.
 *
 * Handle time has one more layer than the others, and the order matters:
 *
 *   this region's own study  ->  the portfolio study  ->  the manual figure
 *
 * A region that measured its own tasks uses its own number. A region that did not
 * falls back to the portfolio study, and to the manual entry if there is none. What
 * must never happen is one region's study being applied to another as though it were
 * a global truth — that is how a real difference in how work is done vanishes.
 */
const driverFallback = (
  ctx: Ctx,
  unit: Unit,
  key: InheritableDriver,
): number => {
  switch (key) {
    case "handleTimeMinutes": {
      const regional = ctx.handleTimeByRegion[unit.region];
      return regional === undefined ? ctx.globals.activeHandleTimeMinutes : regional;
    }
    case "workingHoursPerYear":
      return ctx.globals.workingHoursPerYear;
    case "utilisationPct":
      return ctx.globals.utilisationPct;
    case "upliftPct":
      return ctx.globals.upliftPct;
  }
};

export const resolveDriver = (
  unit: Unit,
  ctx: Ctx,
  key: InheritableDriver,
): Resolved => resolveValue(unit[key], driverFallback(ctx, unit, key));

/** Volume is required, so it has no global fallback — absent means missing. */
export const resolveVolume = (unit: Unit): Resolved => {
  if (unit.volume === SENTINEL) return { value: MISSING, origin: "missing" };
  if (typeof unit.volume === "number") return { value: unit.volume, origin: "own" };
  return { value: MISSING, origin: "missing" };
};

/** Sum a per-role map over a set of role ids, propagating the sentinel. */
export const sumRoles = (
  map: Record<string, Driver>,
  roleIds: readonly string[],
): number => {
  let acc = 0;
  for (const id of roleIds) {
    const raw = map[id];
    if (raw === SENTINEL) return MISSING;
    if (typeof raw === "number") acc += raw;
  }
  return acc;
};

/**
 * Coverage read-out for the ingest match report and the register badges: how many
 * units supplied each inheritable driver themselves.
 */
export interface DriverCoverage {
  driver: InheritableDriver;
  own: number;
  inherited: number;
  missing: number;
  total: number;
}

export const driverCoverage = (c: Case): DriverCoverage[] =>
  INHERITABLE_DRIVERS.map((driver) => {
    let own = 0;
    let missing = 0;
    for (const unit of c.units) {
      const raw = unit[driver];
      if (raw === SENTINEL) missing += 1;
      else if (typeof raw === "number") own += 1;
    }
    return {
      driver,
      own,
      missing,
      inherited: c.units.length - own - missing,
      total: c.units.length,
    };
  });
